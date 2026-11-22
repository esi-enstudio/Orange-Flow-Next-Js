import asyncio
import base64
import binascii
import hashlib
import hmac
import json
import logging
import re
import secrets
from datetime import timedelta
from typing import Literal
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, TypeAdapter, ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.house import House
from app.models.live_c2c_automation import (
    LiveC2CAutomationConfig,
    LiveC2CInboundFile,
)
from app.models.role import Role
from app.models.user import User
from app.routers.deps import (
    get_current_user,
    get_db,
    has_any_permission,
    has_permission,
    require_house_context,
)
from app.services.live_c2c_automation_service import (
    decrypt_secret,
    encrypt_secret,
    enqueue_live_c2c_file,
)
from app.services.live_c2c_gmail_service import (
    LiveC2CGmailError,
    build_gmail_authorization_url,
    exchange_gmail_code,
    poll_gmail_config,
    revoke_gmail_credentials,
)
from app.services.live_c2c_inbound_service import process_pending_live_c2c_files
from app.services.whatsapp_service_client import (
    WhatsAppServiceClient,
    WhatsAppServiceError,
)
from app.services.whatsapp_token import (
    WaTarget,
    resolve_house_wa_target,
    with_target_token,
)
from app.utils.access_control import is_admin_role, is_admin_user, is_super_admin_user
from app.utils.activity_logger import log_activity
from app.utils.timezone import now_naive
from config.settings import settings

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/live-c2c-automation",
    tags=["Live C2C Automation"],
)

MAX_WEBHOOK_BODY_SIZE = 15 * 1024 * 1024
OAUTH_STATE_TTL = timedelta(minutes=10)
LIVE_C2C_WHATSAPP_WEBHOOK_PATH = "/api/v1/live-c2c-automation/whatsapp/webhook"


def configure_live_c2c_whatsapp_webhook_url(public_url: str) -> str:
    if settings.LIVE_C2C_WHATSAPP_WEBHOOK_URL:
        return settings.LIVE_C2C_WHATSAPP_WEBHOOK_URL
    callback_url = f"{public_url.rstrip('/')}{LIVE_C2C_WHATSAPP_WEBHOOK_PATH}"
    settings.LIVE_C2C_WHATSAPP_WEBHOOK_URL = callback_url
    return callback_url


class AutomationConfigUpdate(BaseModel):
    source_type: Literal["gmail", "whatsapp"] | None = None
    is_enabled: bool = False
    source_group_jid: str | None = None
    destination_group_jid: str | None = None


def _safe_config(config: LiveC2CAutomationConfig | None, house: House) -> dict:
    if config is None:
        return {
            "source_type": None,
            "is_enabled": False,
            "gmail_address": house.email,
            "gmail_status": "disconnected",
            "gmail_error": None,
            "source_group_jid": None,
            "source_group_name": None,
            "destination_group_jid": None,
            "destination_group_name": None,
        }
    return {
        "source_type": config.source_type,
        "is_enabled": config.is_enabled,
        "gmail_address": config.gmail_address or house.email,
        "gmail_status": config.gmail_status,
        "gmail_error": _safe_error_code(config.gmail_error),
        "source_group_jid": config.source_group_jid,
        "source_group_name": config.source_group_name,
        "destination_group_jid": config.destination_group_jid,
        "destination_group_name": config.destination_group_name,
    }


def _safe_error_code(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 120 and re.fullmatch(r"[A-Za-z0-9_.:-]+", value):
        return value
    return "live_c2c_processing_failed"


def _redirect_to_live_c2c(status: str) -> RedirectResponse:
    query = urlencode({"automation": status})
    return RedirectResponse(
        f"{settings.APP_URL.rstrip('/')}/reports/live-c2c?{query}",
        status_code=303,
    )


def _safe_return_path(value: str | None) -> str | None:
    """Accept only a local absolute path (no scheme, no protocol-relative URL)."""
    if not value:
        return None
    value = value.strip()
    if not value.startswith("/") or value.startswith("//"):
        return None
    if len(value) > 100 or "\\" in value or "\n" in value or "\r" in value:
        return None
    return value


def _redirect_after_oauth(return_path: str | None, status: str) -> RedirectResponse:
    path = _safe_return_path(return_path)
    if path is None:
        return _redirect_to_live_c2c(status)
    separator = "&" if "?" in path else "?"
    return RedirectResponse(
        f"{settings.APP_URL.rstrip('/')}{path}{separator}{urlencode({'automation': status})}",
        status_code=303,
    )


def _house_email(house: House) -> str:
    try:
        return str(TypeAdapter(EmailStr).validate_python(house.email or ""))
    except ValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail={"code": "live_c2c_house_email_invalid"},
        ) from exc


async def _load_config(
    db: AsyncSession,
    house_id: int,
) -> LiveC2CAutomationConfig | None:
    return await db.scalar(
        select(LiveC2CAutomationConfig).where(
            LiveC2CAutomationConfig.house_id == house_id,
            LiveC2CAutomationConfig.is_deleted.is_(False),
        )
    )


async def _get_groups(
    db: AsyncSession,
    house: House,
) -> tuple[WaTarget, list[dict[str, str]]]:
    target = await resolve_house_wa_target(db, house)
    if target is None or not target.device_id:
        raise HTTPException(
            status_code=422,
            detail={"code": "live_c2c_whatsapp_device_not_configured"},
        )
    client = WhatsAppServiceClient()
    try:
        groups = await with_target_token(
            db,
            target,
            lambda token: client.get_groups(token),
        )
    except WhatsAppServiceError as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": exc.code},
        ) from exc
    return target, groups


def _group_name(groups: list[dict[str, str]], group_jid: str | None) -> str | None:
    return next(
        (group["name"] for group in groups if group.get("id") == group_jid),
        None,
    )


async def _webhook_target(
    db: AsyncSession,
    house: House,
    config: LiveC2CAutomationConfig,
) -> WaTarget:
    target = await resolve_house_wa_target(db, house)
    if target is None or not target.device_id or target.device_id != config.wa_device_id:
        raise HTTPException(
            status_code=409,
            detail={"code": "live_c2c_whatsapp_device_changed"},
        )
    return target


async def _delete_webhook(
    db: AsyncSession,
    target: WaTarget,
    config: LiveC2CAutomationConfig,
) -> None:
    if config.wa_webhook_id is None:
        return
    client = WhatsAppServiceClient()
    try:
        await with_target_token(
            db,
            target,
            lambda token: client.delete_webhook(token, config.wa_webhook_id),
        )
    except WhatsAppServiceError as exc:
        raise HTTPException(
            status_code=503,
            detail={"code": exc.code},
        ) from exc
    config.wa_webhook_id = None


async def _cleanup_created_webhook(
    client: WhatsAppServiceClient,
    jwt_token: str | None,
    webhook_id: int,
) -> None:
    if not jwt_token:
        return
    try:
        await client.delete_webhook(jwt_token, webhook_id)
    except WhatsAppServiceError:
        logger.exception("Could not remove uncommitted Live C2C webhook %s", webhook_id)


@router.get("")
async def get_live_c2c_automation(
    house_id: int = Depends(require_house_context),
    current_user: User = Depends(
        has_any_permission(
            ["live_c2c.automation_view", "live_c2c.automation_manage"]
        )
    ),
    db: AsyncSession = Depends(get_db),
):
    house = await db.scalar(select(House).where(House.id == house_id))
    if house is None:
        raise HTTPException(status_code=404, detail={"code": "house_not_found"})
    config = await _load_config(db, house_id)
    recent = list(
        (
            await db.scalars(
                select(LiveC2CInboundFile)
                .where(
                    LiveC2CInboundFile.house_id == house_id,
                    LiveC2CInboundFile.is_deleted.is_(False),
                )
                .order_by(
                    LiveC2CInboundFile.received_at.desc(),
                    LiveC2CInboundFile.id.desc(),
                )
                .limit(10)
            )
        ).all()
    )
    recent_files = [
        {
            "id": record.id,
            "filename": record.filename,
            "received_at": record.received_at,
            "processed_at": record.processed_at,
            "import_status": record.import_status,
            "delivery_status": record.delivery_status,
            "import_attempts": record.import_attempts,
            "delivery_attempts": record.delivery_attempts,
            "last_error": _safe_error_code(record.last_error),
        }
        for record in recent
    ]
    latest_file = recent_files[0] if recent_files else None
    return {
        "house_id": house_id,
        "config": _safe_config(config, house),
        "latest_file": latest_file,
        "recent_files": recent_files,
    }


@router.put("")
async def update_live_c2c_automation(
    payload: AutomationConfigUpdate,
    request: Request,
    house_id: int = Depends(require_house_context),
    current_user: User = Depends(has_permission("live_c2c.automation_manage")),
    db: AsyncSession = Depends(get_db),
):
    house = await db.scalar(select(House).where(House.id == house_id))
    if house is None:
        raise HTTPException(status_code=404, detail={"code": "house_not_found"})
    config = await _load_config(db, house_id)
    old_values = _safe_config(config, house)
    actor_id = current_user.id
    house_email = _house_email(house) if payload.source_type == "gmail" else house.email
    if (
        payload.is_enabled
        and payload.source_type == "whatsapp"
        and payload.source_group_jid
        and payload.destination_group_jid
        and payload.source_group_jid == payload.destination_group_jid
    ):
        raise HTTPException(
            status_code=422,
            detail={"code": "live_c2c_source_destination_same_group"},
        )
    target = None
    groups: list[dict[str, str]] = []
    callback_url = settings.LIVE_C2C_WHATSAPP_WEBHOOK_URL

    if payload.is_enabled:
        if payload.source_type is None:
            raise HTTPException(
                status_code=422,
                detail={"code": "live_c2c_source_required"},
            )
        if not payload.destination_group_jid:
            raise HTTPException(
                status_code=422,
                detail={"code": "live_c2c_destination_group_required"},
            )
        target, groups = await _get_groups(db, house)
        if _group_name(groups, payload.destination_group_jid) is None:
            raise HTTPException(
                status_code=422,
                detail={"code": "live_c2c_destination_group_invalid"},
            )
        if payload.source_type == "whatsapp":
            if not payload.source_group_jid:
                raise HTTPException(
                    status_code=422,
                    detail={"code": "live_c2c_source_group_required"},
                )
            if _group_name(groups, payload.source_group_jid) is None:
                raise HTTPException(
                    status_code=422,
                    detail={"code": "live_c2c_source_group_invalid"},
                )
            if not callback_url:
                raise HTTPException(
                    status_code=503,
                    detail={"code": "live_c2c_whatsapp_webhook_url_not_configured"},
                )

    if payload.is_enabled and payload.source_type == "gmail":
        conditions = [
            func.lower(LiveC2CAutomationConfig.gmail_address) == house_email.casefold(),
            LiveC2CAutomationConfig.source_type == "gmail",
            LiveC2CAutomationConfig.is_enabled.is_(True),
            LiveC2CAutomationConfig.is_deleted.is_(False),
        ]
        if config is not None:
            conditions.append(LiveC2CAutomationConfig.id != config.id)
        duplicate = await db.scalar(
            select(LiveC2CAutomationConfig.id).where(*conditions)
        )
        if duplicate is not None:
            raise HTTPException(
                status_code=409,
                detail={"code": "live_c2c_gmail_mapping_exists"},
            )
    if (
        payload.is_enabled
        and payload.source_type == "whatsapp"
        and target is not None
    ):
        conditions = [
            LiveC2CAutomationConfig.wa_device_id == target.device_id,
            LiveC2CAutomationConfig.source_group_jid == payload.source_group_jid,
            LiveC2CAutomationConfig.source_type == "whatsapp",
            LiveC2CAutomationConfig.is_enabled.is_(True),
            LiveC2CAutomationConfig.is_deleted.is_(False),
        ]
        if config is not None:
            conditions.append(LiveC2CAutomationConfig.id != config.id)
        duplicate = await db.scalar(
            select(LiveC2CAutomationConfig.id).where(*conditions)
        )
        if duplicate is not None:
            raise HTTPException(
                status_code=409,
                detail={"code": "live_c2c_whatsapp_mapping_exists"},
            )

    previous_source = config.source_type if config is not None else None
    previous_email = config.gmail_address if config is not None else None
    has_gmail_credentials = bool(
        config is not None
        and (
            config.gmail_refresh_token_encrypted
            or config.gmail_access_token_encrypted
        )
    )
    gmail_address_changed = payload.source_type == "gmail" and (
        not previous_email
        or not house_email
        or previous_email.casefold() != house_email.casefold()
    )
    should_revoke_gmail = has_gmail_credentials and (
        payload.source_type != "gmail" or gmail_address_changed
    )
    should_clear_gmail = payload.source_type != "gmail" or gmail_address_changed
    needs_webhook = (
        payload.is_enabled
        and payload.source_type == "whatsapp"
        and target is not None
    )
    webhook_target_to_delete = None
    same_webhook = (
        needs_webhook
        and config is not None
        and config.wa_webhook_id is not None
        and config.wa_device_id == target.device_id
        and previous_source == "whatsapp"
    )
    if needs_webhook and config is not None and config.wa_webhook_id and not same_webhook:
        raise HTTPException(
            status_code=409,
            detail={"code": "live_c2c_whatsapp_webhook_reconfiguration_required"},
        )
    if not needs_webhook and config is not None and config.wa_webhook_id is not None:
        webhook_target_to_delete = await _webhook_target(db, house, config)

    client = WhatsAppServiceClient()
    if config is None:
        config = LiveC2CAutomationConfig(
            house_id=house_id,
            created_by=actor_id,
            updated_by=actor_id,
        )
        db.add(config)
        await db.flush()

    config.source_type = payload.source_type
    config.is_enabled = payload.is_enabled
    config.updated_by = actor_id
    if payload.source_type == "gmail":
        config.gmail_address = house_email

    if payload.source_type == "whatsapp":
        config.source_group_jid = payload.source_group_jid
        config.source_group_name = _group_name(groups, payload.source_group_jid)
        config.destination_group_jid = payload.destination_group_jid
        config.destination_group_name = _group_name(groups, payload.destination_group_jid)
        if target is not None:
            config.wa_device_id = target.device_id
    else:
        config.source_group_jid = None
        config.source_group_name = None
        config.destination_group_jid = payload.destination_group_jid
        config.destination_group_name = (
            _group_name(groups, payload.destination_group_jid)
            if groups
            else None
        )
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail={"code": "live_c2c_mapping_exists"},
        ) from exc

    created_webhook: dict | None = None
    created_webhook_token: str | None = None
    if needs_webhook and not same_webhook:
        try:
            if target is None or not target.jwt_token:
                raise WhatsAppServiceError(
                    code="WA_NOT_CONFIGURED",
                    message="WhatsApp is not connected",
                )
            created_webhook_token = target.jwt_token
            created_webhook = await client.create_webhook(
                created_webhook_token,
                callback_url,
                ["media.received"],
            )
        except WhatsAppServiceError as exc:
            await db.rollback()
            raise HTTPException(
                status_code=503,
                detail={"code": exc.code},
            ) from exc
        webhook_id = created_webhook.get("webhook_id")
        secret = created_webhook.get("secret")
        if not webhook_id or not secret:
            await db.rollback()
            if isinstance(webhook_id, (int, str)) and str(webhook_id).isdigit() and int(webhook_id) > 0:
                await _cleanup_created_webhook(
                    client,
                    created_webhook_token,
                    int(webhook_id),
                )
            raise HTTPException(
                status_code=502,
                detail={"code": "live_c2c_whatsapp_webhook_invalid_response"},
            )
        config.wa_webhook_id = int(webhook_id)
        config.wa_webhook_secret_encrypted = encrypt_secret(secret)

    if should_revoke_gmail and config is not None:
        try:
            await revoke_gmail_credentials(config)
        except LiveC2CGmailError as exc:
            await db.rollback()
            if created_webhook is not None:
                await _cleanup_created_webhook(
                    client,
                    created_webhook_token,
                    int(created_webhook["webhook_id"]),
                )
            raise HTTPException(
                status_code=502,
                detail={"code": exc.code},
            ) from exc
    if should_clear_gmail:
        config.gmail_access_token_encrypted = None
        config.gmail_refresh_token_encrypted = None
        config.gmail_token_expires_at = None
        config.gmail_history_id = None
        config.gmail_status = "disconnected"
        config.gmail_error = None
        config.oauth_state_hash = None
        config.oauth_state_expires_at = None
        config.oauth_state_user_id = None

    try:
        await db.flush()
        await log_activity(
            db,
            user_id=current_user.id,
            user_name=current_user.name,
            module="live_c2c",
            action="automation.config_updated",
            record_identifier=f"house:{house_id}",
            old_values=old_values,
            new_values=_safe_config(config, house),
            request=request,
            commit=False,
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        if created_webhook is not None:
            await _cleanup_created_webhook(
                client,
                created_webhook_token,
                int(created_webhook["webhook_id"]),
            )
        raise HTTPException(
            status_code=409,
            detail={"code": "live_c2c_mapping_exists"},
        ) from exc
    except SQLAlchemyError as exc:
        await db.rollback()
        if created_webhook is not None:
            await _cleanup_created_webhook(
                client,
                created_webhook_token,
                int(created_webhook["webhook_id"]),
            )
        logger.exception("Failed to save Live C2C automation config for house %s", house_id)
        raise HTTPException(
            status_code=503,
            detail={"code": "live_c2c_automation_save_failed"},
        ) from exc
    if webhook_target_to_delete is not None:
        try:
            await _delete_webhook(db, webhook_target_to_delete, config)
            await db.commit()
        except HTTPException as exc:
            await db.rollback()
            logger.exception(
                "Failed to clean up Live C2C WhatsApp webhook for house %s",
                house_id,
            )
            raise HTTPException(
                status_code=503,
                detail={"code": "live_c2c_whatsapp_webhook_cleanup_failed"},
            ) from exc
        except SQLAlchemyError as exc:
            await db.rollback()
            logger.exception(
                "Failed to save Live C2C WhatsApp webhook cleanup for house %s",
                house_id,
            )
            raise HTTPException(
                status_code=503,
                detail={"code": "live_c2c_whatsapp_webhook_cleanup_failed"},
            ) from exc
    return {"config": _safe_config(config, house)}


@router.post("/gmail/authorize")
async def authorize_gmail(
    request: Request,
    return_path: str | None = None,
    house_id: int = Depends(require_house_context),
    current_user: User = Depends(
        has_any_permission(["live_c2c.automation_manage", "gmail.connect"])
    ),
    db: AsyncSession = Depends(get_db),
):
    house = await db.scalar(select(House).where(House.id == house_id))
    if house is None:
        raise HTTPException(status_code=404, detail={"code": "house_not_found"})
    gmail_address = _house_email(house)
    config = await _load_config(db, house_id)
    if config is None:
        config = LiveC2CAutomationConfig(
            house_id=house_id,
            source_type="gmail",
            gmail_address=gmail_address,
            created_by=current_user.id,
            updated_by=current_user.id,
        )
        db.add(config)
    elif config.source_type not in (None, "gmail"):
        raise HTTPException(
            status_code=409,
            detail={"code": "live_c2c_source_is_not_gmail"},
        )
    state = secrets.token_urlsafe(32)
    config.source_type = "gmail"
    config.gmail_address = gmail_address
    config.oauth_state_hash = hashlib.sha256(state.encode("utf-8")).hexdigest()
    config.oauth_state_expires_at = now_naive() + OAUTH_STATE_TTL
    config.oauth_state_user_id = current_user.id
    config.oauth_return_path = _safe_return_path(return_path)
    config.updated_by = current_user.id
    try:
        authorization_url = await build_gmail_authorization_url(db, config, state)
    except LiveC2CGmailError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=503,
            detail={"code": exc.code},
        ) from exc
    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="live_c2c",
        action="automation.gmail_authorization_started",
        record_identifier=f"house:{house_id}",
        new_values={"gmail_address": gmail_address},
        request=request,
        commit=False,
    )
    await db.commit()
    return {"authorization_url": authorization_url}


async def _authorized_oauth_user(
    db: AsyncSession,
    user_id: int,
    house_id: int,
) -> User | None:
    user = await db.scalar(
        select(User)
        .options(
            selectinload(User.roles).selectinload(Role.permissions),
            selectinload(User.houses),
        )
        .where(User.id == user_id)
    )
    house = await db.scalar(select(House.id).where(House.id == house_id))
    if user is None or user.status != "Active" or house is None:
        return None
    if not any(
        is_admin_role([role.name.lower()])
        or any(
            permission.name in ("live_c2c.automation_manage", "gmail.connect")
            for permission in role.permissions
        )
        for role in user.roles
    ):
        return None
    if is_super_admin_user(user):
        return user
    if any(linked_house.id == house_id for linked_house in user.houses):
        return user
    if not settings.TENANT_STRICT_HOUSE_ISOLATION and is_admin_user(user):
        return user
    return None


@router.get("/gmail/callback")
async def gmail_oauth_callback(
    request: Request,
    state: str | None = None,
    code: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    if not state:
        return _redirect_to_live_c2c("gmail_error")
    state_hash = hashlib.sha256(state.encode("utf-8")).hexdigest()
    config = await db.scalar(
        select(LiveC2CAutomationConfig)
        .where(
            LiveC2CAutomationConfig.oauth_state_hash == state_hash,
            LiveC2CAutomationConfig.oauth_state_expires_at > now_naive(),
            LiveC2CAutomationConfig.is_deleted.is_(False),
        )
        .with_for_update()
    )
    if config is None:
        return _redirect_to_live_c2c("gmail_error")
    user_id = config.oauth_state_user_id
    return_path = config.oauth_return_path
    config.oauth_state_hash = None
    config.oauth_state_expires_at = None
    config.oauth_state_user_id = None
    config.oauth_return_path = None
    await db.commit()
    user = await _authorized_oauth_user(db, user_id, config.house_id) if user_id else None
    if user is None:
        return _redirect_after_oauth(return_path, "gmail_error")
    if error or not code:
        config.gmail_error = "gmail_authorization_denied"
        await log_activity(
            db,
            user_id=user.id,
            user_name=user.name,
            module="live_c2c",
            action="automation.gmail_authorization_failed",
            record_identifier=f"house:{config.house_id}",
            new_values={"error": "gmail_authorization_denied"},
            request=request,
            status_code=400,
            commit=False,
        )
        await db.commit()
        return _redirect_after_oauth(return_path, "gmail_error")
    try:
        await exchange_gmail_code(db, config, code)
    except LiveC2CGmailError as exc:
        config.gmail_status = "error"
        config.gmail_error = exc.code
        await log_activity(
            db,
            user_id=user.id,
            user_name=user.name,
            module="live_c2c",
            action="automation.gmail_authorization_failed",
            record_identifier=f"house:{config.house_id}",
            new_values={"error": exc.code},
            request=request,
            status_code=400,
            commit=False,
        )
        await db.commit()
        return _redirect_after_oauth(return_path, "gmail_error")
    await log_activity(
        db,
        user_id=user.id,
        user_name=user.name,
        module="live_c2c",
        action="automation.gmail_connected",
        record_identifier=f"house:{config.house_id}",
        new_values={"gmail_address": config.gmail_address, "gmail_status": "connected"},
        request=request,
    )
    return _redirect_after_oauth(return_path, "gmail_connected")


@router.post("/gmail/disconnect")
async def disconnect_gmail(
    request: Request,
    house_id: int = Depends(require_house_context),
    current_user: User = Depends(
        has_any_permission(["live_c2c.automation_manage", "gmail.connect"])
    ),
    db: AsyncSession = Depends(get_db),
):
    config = await _load_config(db, house_id)
    if config is None:
        raise HTTPException(status_code=404, detail={"code": "live_c2c_automation_not_configured"})
    try:
        await revoke_gmail_credentials(config)
    except LiveC2CGmailError as exc:
        raise HTTPException(
            status_code=502,
            detail={"code": exc.code},
        ) from exc
    config.gmail_access_token_encrypted = None
    config.gmail_refresh_token_encrypted = None
    config.gmail_token_expires_at = None
    config.gmail_history_id = None
    config.gmail_status = "disconnected"
    config.gmail_error = None
    config.oauth_state_hash = None
    config.oauth_state_expires_at = None
    config.oauth_state_user_id = None
    config.oauth_return_path = None
    config.updated_by = current_user.id
    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="live_c2c",
        action="automation.gmail_disconnected",
        record_identifier=f"house:{house_id}",
        new_values={"gmail_address": config.gmail_address, "gmail_status": "disconnected"},
        request=request,
        commit=False,
    )
    await db.commit()
    return {"gmail_status": "disconnected"}


async def _read_webhook_body(request: Request) -> bytes:
    length = request.headers.get("content-length")
    if length:
        try:
            if int(length) > MAX_WEBHOOK_BODY_SIZE:
                raise HTTPException(status_code=413, detail={"code": "webhook_body_too_large"})
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"code": "webhook_content_length_invalid"}) from exc
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_WEBHOOK_BODY_SIZE:
            raise HTTPException(status_code=413, detail={"code": "webhook_body_too_large"})
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/whatsapp/webhook")
async def whatsapp_live_c2c_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    body = await _read_webhook_body(request)
    try:
        event = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail={"code": "webhook_json_invalid"}) from exc
    if not isinstance(event, dict):
        raise HTTPException(status_code=400, detail={"code": "webhook_json_invalid"})
    device_id = event.get("device_id")
    if not isinstance(device_id, str) or not device_id:
        raise HTTPException(status_code=400, detail={"code": "webhook_device_missing"})
    supplied_signature = (
        request.headers.get("X-Webhook-Signature")
        or request.headers.get("X-Hub-Signature-256")
        or ""
    )
    if not supplied_signature.startswith("sha256=") or len(supplied_signature) != 71:
        raise HTTPException(status_code=401, detail={"code": "webhook_signature_invalid"})
    candidates = list(
        (
            await db.scalars(
                select(LiveC2CAutomationConfig).where(
                    LiveC2CAutomationConfig.wa_device_id == device_id,
                    LiveC2CAutomationConfig.wa_webhook_secret_encrypted.is_not(None),
                    LiveC2CAutomationConfig.is_deleted.is_(False),
                )
            )
        ).all()
    )
    matched_config = None
    for candidate in candidates:
        try:
            secret = decrypt_secret(candidate.wa_webhook_secret_encrypted)
        except (ValueError, TypeError):
            logger.exception(
                "Could not decrypt Live C2C webhook secret for config %s",
                candidate.id,
            )
            continue
        expected = "sha256=" + hmac.new(
            secret.encode("utf-8"),
            body,
            hashlib.sha256,
        ).hexdigest()
        if hmac.compare_digest(supplied_signature, expected):
            matched_config = candidate
            break
    if matched_config is None:
        raise HTTPException(status_code=401, detail={"code": "webhook_signature_invalid"})

    data = event.get("data")
    if (
        event.get("event_type") != "media.received"
        or matched_config.source_type != "whatsapp"
        or not matched_config.is_enabled
        or not isinstance(data, dict)
        or data.get("chat") != matched_config.source_group_jid
    ):
        return {"status": "ignored"}
    filename = data.get("filename")
    encoded_content = data.get("file_content")
    message_id = data.get("message_id")
    if not all(isinstance(value, str) and value for value in (filename, encoded_content, message_id)):
        return {"status": "ignored"}
    try:
        content = base64.b64decode(encoded_content, validate=True)
    except (ValueError, binascii.Error):
        return {"status": "ignored"}
    try:
        await enqueue_live_c2c_file(
            db,
            config=matched_config,
            source_event_id=f"whatsapp:{device_id}:{message_id}",
            filename=filename,
            content=content,
            source_device_id=device_id,
            source_group_jid=data["chat"],
        )
    except (ValueError, RuntimeError) as exc:
        logger.warning("Ignoring invalid Live C2C WhatsApp file event: %s", exc)
        await db.rollback()
        return {"status": "ignored"}
    await db.commit()
    return {"status": "queued"}


async def live_c2c_automation_scheduler():
    if settings.DISABLE_SCHEDULER:
        return
    from app.services.db_service import async_session

    logger.info("Live C2C automation scheduler started")
    while True:
        try:
            async with async_session() as db:
                config_ids = list(
                    (
                        await db.scalars(
                            select(LiveC2CAutomationConfig.id)
                            .where(
                                LiveC2CAutomationConfig.source_type == "gmail",
                                LiveC2CAutomationConfig.is_enabled.is_(True),
                                LiveC2CAutomationConfig.gmail_status == "connected",
                                LiveC2CAutomationConfig.is_deleted.is_(False),
                            )
                            .order_by(LiveC2CAutomationConfig.id)
                        )
                    ).all()
                )
                for config_id in config_ids:
                    try:
                        config = await db.scalar(
                            select(LiveC2CAutomationConfig)
                            .where(
                                LiveC2CAutomationConfig.id == config_id,
                                LiveC2CAutomationConfig.source_type == "gmail",
                                LiveC2CAutomationConfig.is_enabled.is_(True),
                                LiveC2CAutomationConfig.gmail_status == "connected",
                                LiveC2CAutomationConfig.is_deleted.is_(False),
                            )
                            .with_for_update(skip_locked=True)
                        )
                        if config is not None:
                            await poll_gmail_config(db, config)
                    except LiveC2CGmailError as exc:
                        await db.rollback()
                        config = await db.scalar(
                            select(LiveC2CAutomationConfig)
                            .where(
                                LiveC2CAutomationConfig.id == config_id,
                                LiveC2CAutomationConfig.is_deleted.is_(False),
                            )
                            .with_for_update(skip_locked=True)
                        )
                        if config is not None:
                            config.gmail_error = exc.code
                            await db.commit()
                        logger.warning(
                            "Live C2C Gmail poll failed for config %s: %s",
                            config_id,
                            exc.code,
                        )
                    except Exception:
                        await db.rollback()
                        logger.exception(
                            "Live C2C Gmail poll failed for config %s",
                            config_id,
                        )
                await process_pending_live_c2c_files(db, limit=10)
        except Exception:
            logger.exception("Live C2C automation scheduler iteration failed")
        await asyncio.sleep(30)
