import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.deps import get_db, has_permission, get_house_context, require_house_context
from app.models.house import House
from app.models.user import User
from app.services.whatsapp_service_client import (
    whatsapp_service_client,
    WhatsAppServiceError,
)
from app.services.whatsapp_token import with_house_token
from app.utils.activity_logger import log_activity
from app.utils.access_control import is_admin_user
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["WhatsApp Gateway"])


async def _get_house_with_wa(db: AsyncSession, house_id: int) -> House:
    """Load a house and verify it exists."""
    result = await db.execute(select(House).where(House.id == house_id))
    house = result.scalar_one_or_none()
    if not house:
        raise HTTPException(status_code=404, detail="House not found")
    return house


async def _verify_house_access(current_user: User, house_id: int):
    if is_admin_user(current_user):
        return
    user_house_ids = [h.id for h in current_user.houses]
    if house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="You do not have access to this house")


# ── Setup (Admin only) ────────────────────────────────────────────


@router.post("/whatsapp/setup")
async def setup_whatsapp_for_house(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("whatsapp.setup")),
    house_context: int = Depends(require_house_context),
):
    """One-time setup: create API key + device for a house.
    Admin-only operation.
    """
    house = await _get_house_with_wa(db, house_context)

    if house.wa_device_id and house.wa_jwt_token:
        return {
            "success": True,
            "message": "WhatsApp already configured for this house",
            "data": {"device_id": house.wa_device_id, "status": house.wa_status},
        }

    try:
        api_key = await whatsapp_service_client.create_api_key(
            customer_name=f"House-{house.code}-{house.name}",
            customer_email=(house.email or "").strip()
            or f"{(house.code or 'house').lower()}@orange-flow.local",
            customer_phone=(house.poc_mobile or "").strip() or "N/A",
            max_devices=1,
        )
        device_data = await whatsapp_service_client.create_device(
            api_key=api_key,
            device_name=f"{house.code} WhatsApp",
        )
    except WhatsAppServiceError as e:
        raise HTTPException(status_code=502, detail=f"{e.code}: {e.message}")

    house.wa_api_key = api_key
    house.wa_device_id = device_data["device_id"]
    house.wa_device_secret = device_data["device_secret"]
    house.wa_jwt_token = device_data["token"]
    house.wa_status = "disconnected"
    await db.commit()

    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="whatsapp",
        action="whatsapp.setup",
        record_id=house.id,
        record_identifier=f"{house.code} - {house.name}",
        new_values={"device_id": house.wa_device_id},
        request=request,
        status_code=200,
    )

    return {
        "success": True,
        "data": {
            "device_id": house.wa_device_id,
            "status": house.wa_status,
        },
    }


# ── Status ─────────────────────────────────────────────────────────


@router.get("/whatsapp/status")
async def whatsapp_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("whatsapp.view")),
    house_context: Optional[int] = Depends(get_house_context),
):
    """Get WhatsApp connection status for the current house."""
    if not house_context:
        raise HTTPException(status_code=400, detail="Select a house first")

    await _verify_house_access(current_user, house_context)
    house = await _get_house_with_wa(db, house_context)

    if not house.wa_jwt_token:
        return {
            "success": True,
            "connected": False,
            "state": "not_configured",
            "qr": None,
            "error": "WhatsApp not configured. Run setup first.",
        }

    try:
        status_data = await with_house_token(
            db,
            house,
            lambda token: whatsapp_service_client.get_device_status(token),
        )
        connected = status_data.get("connected", status_data.get("is_connected", False))
        # Gateway has no device_jid in /status; is_logged_in == authenticated session
        linked = bool(
            status_data.get("device_jid")
            or status_data.get("is_logged_in")
        )
        state = "connected" if connected else "disconnected"
        qr = status_data.get("qr", None)

        house.wa_status = state
        if connected:
            house.wa_last_connected_at = now_naive()
            house.wa_last_error = None
        await db.commit()

        return {
            "success": True,
            "connected": connected,
            "linked": linked,
            "state": state,
            "qr": qr,
            "phone_number": house.wa_phone_number,
            "last_connected_at": (
                house.wa_last_connected_at.isoformat() if house.wa_last_connected_at else None
            ),
        }
    except WhatsAppServiceError as e:
        house.wa_status = "error"
        house.wa_last_error = e.message
        await db.commit()
        return {
            "success": False,
            "connected": False,
            "state": "error",
            "qr": None,
            "error": e.message,
        }


# ── Connect (QR login) ───────────────────────────────────────────


class PairingCodePayload(BaseModel):
    phone_number: str


@router.post("/whatsapp/connect")
async def connect_whatsapp(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("whatsapp.connect")),
    house_context: int = Depends(require_house_context),
):
    """Start QR login flow for the current house's WhatsApp device."""
    await _verify_house_access(current_user, house_context)
    house = await _get_house_with_wa(db, house_context)

    if not house.wa_jwt_token:
        raise HTTPException(status_code=400, detail="Run WhatsApp setup first")

    house.wa_status = "connecting"
    await db.commit()

    try:
        qr_data = await with_house_token(
            db,
            house,
            lambda token: whatsapp_service_client.login_qr(token),
        )
        return {"success": True, "data": qr_data}
    except WhatsAppServiceError as e:
        house.wa_status = "error"
        house.wa_last_error = e.message
        await db.commit()
        raise HTTPException(status_code=502, detail=f"{e.code}: {e.message}")


@router.post("/whatsapp/connect/pairing")
async def connect_whatsapp_pairing(
    payload: PairingCodePayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("whatsapp.connect")),
    house_context: int = Depends(require_house_context),
):
    """Login with phone number pairing code (alternative to QR)."""
    await _verify_house_access(current_user, house_context)
    house = await _get_house_with_wa(db, house_context)

    if not house.wa_jwt_token:
        raise HTTPException(status_code=400, detail="Run WhatsApp setup first")

    house.wa_status = "connecting"
    await db.commit()

    try:
        result = await with_house_token(
            db,
            house,
            lambda token: whatsapp_service_client.login_pairing_code(
                token, payload.phone_number
            ),
        )
        return {"success": True, "data": result}
    except WhatsAppServiceError as e:
        house.wa_status = "error"
        house.wa_last_error = e.message
        await db.commit()
        raise HTTPException(status_code=502, detail=f"{e.code}: {e.message}")


# ── Groups ─────────────────────────────────────────────────────────


@router.get("/whatsapp/groups")
async def whatsapp_groups(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("whatsapp.view")),
    house_context: Optional[int] = Depends(get_house_context),
):
    """Get WhatsApp groups for the current house's device."""
    if not house_context:
        raise HTTPException(status_code=400, detail="Select a house first")

    await _verify_house_access(current_user, house_context)
    house = await _get_house_with_wa(db, house_context)

    if not house.wa_jwt_token:
        return {"success": True, "data": []}

    try:
        groups = await with_house_token(
            db,
            house,
            lambda token: whatsapp_service_client.get_groups(token),
        )
        return {"success": True, "data": groups}
    except WhatsAppServiceError as e:
        raise HTTPException(status_code=503, detail=f"{e.code}: {e.message}")


# ── Disconnect ─────────────────────────────────────────────────────


@router.post("/whatsapp/disconnect")
async def disconnect_whatsapp(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("whatsapp.disconnect")),
    house_context: int = Depends(require_house_context),
):
    """Disconnect WhatsApp for the current house."""
    await _verify_house_access(current_user, house_context)
    house = await _get_house_with_wa(db, house_context)

    if not house.wa_jwt_token:
        raise HTTPException(status_code=400, detail="WhatsApp not configured")

    try:
        await with_house_token(
            db,
            house,
            lambda token: whatsapp_service_client.disconnect_device(token),
        )
    except WhatsAppServiceError:
        pass

    old_status = house.wa_status
    house.wa_status = "disconnected"
    house.wa_last_error = None
    await db.commit()

    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="whatsapp",
        action="whatsapp.disconnect",
        record_id=house.id,
        record_identifier=f"{house.code} - {house.name}",
        old_values={"wa_status": old_status},
        new_values={"wa_status": "disconnected"},
        request=request,
    )

    return {"success": True, "data": {"status": "disconnected"}}


# ── Reconnect ──────────────────────────────────────────────────────


@router.post("/whatsapp/reconnect")
async def reconnect_whatsapp(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("whatsapp.connect")),
    house_context: int = Depends(require_house_context),
):
    """Reconnect a disconnected device."""
    await _verify_house_access(current_user, house_context)
    house = await _get_house_with_wa(db, house_context)

    if not house.wa_jwt_token:
        raise HTTPException(status_code=400, detail="WhatsApp not configured")

    async def _reconnect(token: str):
        status_data = await whatsapp_service_client.get_device_status(token)
        if not (status_data.get("device_jid") or status_data.get("is_logged_in")):
            raise HTTPException(
                status_code=400,
                detail=(
                    "This device has never been linked to WhatsApp. "
                    "Use Connect to scan the QR code first."
                ),
            )
        await whatsapp_service_client.reconnect_device(token)

    try:
        await with_house_token(db, house, _reconnect)
        house.wa_status = "connecting"
        await db.commit()
        return {"success": True, "data": {"status": "connecting"}}
    except WhatsAppServiceError as e:
        raise HTTPException(status_code=502, detail=f"{e.code}: {e.message}")


# ── Reset (Admin only) ────────────────────────────────────────────


@router.post("/whatsapp/reset")
async def reset_whatsapp(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("whatsapp.setup")),
    house_context: int = Depends(require_house_context),
):
    """Reset WhatsApp: disconnect, delete device, and re-run setup."""
    await _verify_house_access(current_user, house_context)
    house = await _get_house_with_wa(db, house_context)

    if house.wa_device_id:
        try:
            await whatsapp_service_client.delete_device(house.wa_device_id)
        except WhatsAppServiceError:
            pass

    house.wa_api_key = None
    house.wa_device_id = None
    house.wa_device_secret = None
    house.wa_jwt_token = None
    house.wa_status = "disconnected"
    house.wa_last_error = None
    house.wa_phone_number = None
    house.wa_last_connected_at = None
    await db.commit()

    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="whatsapp",
        action="whatsapp.reset",
        record_id=house.id,
        record_identifier=f"{house.code} - {house.name}",
        request=request,
    )

    return {"success": True, "data": {"status": "reset", "message": "Run setup again to create new device"}}
