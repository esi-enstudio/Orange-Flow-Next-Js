"""Shared Telegram bots API.

A distributor (or DMS operator) creates ONE Telegram bot and assigns it to
multiple houses. Each house links its report group by chat_id with a
"test delivery" round-trip. Bots are stateless HTTP clients — no gateway,
no sessions, negligible RAM even with hundreds of houses.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.deps import get_db, has_permission, has_any_permission, get_house_context
from app.models.house import House
from app.models.user import User
from app.models.telegram_bot import TelegramBot, telegram_bot_houses
from app.services import telegram_service
from app.services.telegram_service import TelegramError
from app.utils.activity_logger import log_activity
from app.utils.access_control import is_admin_user
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Telegram Bots"])


# ── Helpers ────────────────────────────────────────────────────────


async def _user_house_ids(current_user: User) -> set[int]:
    return {h.id for h in current_user.houses}


async def _accessible_bot(
    db: AsyncSession,
    bot_id: int,
    current_user: User,
) -> TelegramBot:
    """Load a non-deleted bot and verify the user may see/manage it."""
    res = await db.execute(
        select(TelegramBot).where(
            TelegramBot.id == bot_id,
            TelegramBot.is_deleted == False,  # noqa: E712
        )
    )
    bot = res.scalar_one_or_none()
    if not bot:
        raise HTTPException(status_code=404, detail="Telegram bot not found")

    if is_admin_user(current_user):
        return bot

    user_hids = await _user_house_ids(current_user)
    if not user_hids.intersection(bot.house_ids):
        raise HTTPException(status_code=403, detail="You do not have access to this bot")
    return bot


async def _validate_assignment_houses(
    db: AsyncSession,
    house_ids: list[int],
    current_user: User,
) -> list[House]:
    """All requested houses must exist and be within the user's scope."""
    unique_ids = list(dict.fromkeys(house_ids))
    res = await db.execute(select(House).where(House.id.in_(unique_ids)))
    found = {h.id: h for h in res.scalars().all()}
    missing = [hid for hid in unique_ids if hid not in found]
    if missing:
        raise HTTPException(status_code=404, detail=f"Houses not found: {missing}")

    if not is_admin_user(current_user):
        allowed = await _user_house_ids(current_user)
        forbidden = [hid for hid in unique_ids if hid not in allowed]
        if forbidden:
            raise HTTPException(
                status_code=403,
                detail=f"You do not have access to houses: {forbidden}",
            )
    return [found[hid] for hid in unique_ids]


async def _reject_double_binding(db: AsyncSession, house_ids: list[int], exclude_bot_id: Optional[int]):
    """A house can be assigned to at most one shared bot."""
    if not house_ids:
        return
    res = await db.execute(
        select(telegram_bot_houses.c.house_id, TelegramBot.id, TelegramBot.name)
        .join(
            TelegramBot,
            TelegramBot.id == telegram_bot_houses.c.bot_id,
        )
        .where(
            telegram_bot_houses.c.house_id.in_(house_ids),
            TelegramBot.is_deleted == False,  # noqa: E712
            TelegramBot.id != (exclude_bot_id or -1),
        )
    )
    clash = res.first()
    if clash:
        raise HTTPException(
            status_code=409,
            detail=(
                f"House id {clash[0]} is already assigned to bot "
                f"'{clash[2]}'. Remove it there first."
            ),
        )


def _serialize(bot: TelegramBot) -> dict:
    return {
        "id": bot.id,
        "name": bot.name,
        "bot_username": bot.bot_username,
        "status": bot.status,
        "last_error": bot.last_error,
        "last_verified_at": (
            bot.last_verified_at.isoformat() if bot.last_verified_at else None
        ),
        "created_at": bot.created_at.isoformat() if bot.created_at else None,
        "houses": [
            {
                "id": h.id,
                "name": h.name,
                "code": h.code,
                "telegram_chat_id": h.telegram_chat_id,
                "telegram_chat_name": h.telegram_chat_name,
            }
            for h in bot.houses
        ],
    }


# ── Schemas ────────────────────────────────────────────────────────


class BotCreatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    bot_token: str = Field(min_length=30, max_length=100)
    house_ids: list[int] = Field(min_length=1)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        return v

    @field_validator("bot_token")
    @classmethod
    def _strip_token(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("bot_token is required")
        return v


class BotUpdatePayload(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    bot_token: Optional[str] = Field(default=None, min_length=30, max_length=100)


class BotHousesPayload(BaseModel):
    house_ids: list[int] = Field(min_length=0)


class TestDeliveryPayload(BaseModel):
    house_id: int
    chat_id: str = Field(min_length=1, max_length=64)
    chat_name: Optional[str] = Field(default=None, max_length=200)

    @field_validator("chat_id")
    @classmethod
    def _strip_chat(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("chat_id is required")
        return v


# ── CRUD ───────────────────────────────────────────────────────────


@router.get("/telegram/bots")
async def list_bots(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("telegram.view")),
):
    """List shared Telegram bots visible to the user."""
    query = (
        select(TelegramBot)
        .where(TelegramBot.is_deleted == False)  # noqa: E712
        .order_by(TelegramBot.id)
    )
    res = await db.execute(query)
    bots = res.scalars().all()

    if not is_admin_user(current_user):
        user_hids = await _user_house_ids(current_user)
        bots = [b for b in bots if user_hids.intersection(b.house_ids)]

    return {"success": True, "data": [_serialize(b) for b in bots]}


@router.post("/telegram/bots")
async def create_bot(
    payload: BotCreatePayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("telegram.manage")),
):
    """Register a shared Telegram bot and assign houses to it."""
    houses = await _validate_assignment_houses(db, payload.house_ids, current_user)
    await _reject_double_binding(db, [h.id for h in houses], None)

    try:
        me = await telegram_service.get_me(payload.bot_token)
    except TelegramError as e:
        raise HTTPException(status_code=400, detail=f"Invalid bot token: {e.description}")

    bot = TelegramBot(
        name=payload.name,
        bot_token=payload.bot_token,
        bot_username=me.get("username"),
        status="active",
        last_verified_at=now_naive(),
        created_by=current_user.id,
    )
    bot.houses = houses
    db.add(bot)
    await db.commit()
    await db.refresh(bot)

    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="telegram",
        action="bot.create",
        record_id=bot.id,
        record_identifier=bot.name,
        new_values={
            "name": bot.name,
            "bot_username": bot.bot_username,
            "house_ids": [h.id for h in houses],
        },
        request=request,
        status_code=200,
    )

    return {"success": True, "data": _serialize(bot)}


@router.patch("/telegram/bots/{bot_id}")
async def update_bot(
    bot_id: int,
    payload: BotUpdatePayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("telegram.manage")),
):
    """Rename a bot and/or rotate its token."""
    bot = await _accessible_bot(db, bot_id, current_user)

    old_values: dict = {}
    new_values: dict = {}

    if payload.name is not None and payload.name.strip():
        old_values["name"] = bot.name
        bot.name = payload.name.strip()
        new_values["name"] = bot.name

    if payload.bot_token is not None and payload.bot_token.strip():
        token = payload.bot_token.strip()
        try:
            me = await telegram_service.get_me(token)
        except TelegramError as e:
            raise HTTPException(status_code=400, detail=f"Invalid bot token: {e.description}")
        old_values["bot_username"] = bot.bot_username
        bot.bot_token = token
        bot.bot_username = me.get("username")
        bot.status = "active"
        bot.last_error = None
        bot.last_verified_at = now_naive()
        new_values["bot_username"] = bot.bot_username

    await db.commit()

    if old_values:
        await log_activity(
            db,
            user_id=current_user.id,
            user_name=current_user.name,
            module="telegram",
            action="bot.edit",
            record_id=bot.id,
            record_identifier=bot.name,
            old_values=old_values,
            new_values=new_values,
            request=request,
        )
    return {"success": True, "data": _serialize(bot)}


@router.put("/telegram/bots/{bot_id}/houses")
async def assign_houses(
    bot_id: int,
    payload: BotHousesPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("telegram.manage")),
):
    """Replace the house assignment list of a bot."""
    bot = await _accessible_bot(db, bot_id, current_user)

    houses = await _validate_assignment_houses(db, payload.house_ids, current_user)
    await _reject_double_binding(db, [h.id for h in houses], bot.id)

    old_ids = sorted(bot.house_ids)
    new_ids = sorted(h.id for h in houses)
    bot.houses = houses
    await db.commit()

    if old_ids != new_ids:
        await log_activity(
            db,
            user_id=current_user.id,
            user_name=current_user.name,
            module="telegram",
            action="bot.assign_houses",
            record_id=bot.id,
            record_identifier=bot.name,
            old_values={"house_ids": old_ids},
            new_values={"house_ids": new_ids},
            request=request,
        )

    return {"success": True, "data": _serialize(bot)}


@router.delete("/telegram/bots/{bot_id}")
async def delete_bot(
    bot_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("telegram.manage")),
):
    """Soft-delete a shared bot and remove its assignments."""
    bot = await _accessible_bot(db, bot_id, current_user)

    bot.is_deleted = True
    bot.deleted_at = now_naive()
    bot.deleted_by = current_user.id
    bot.houses = []
    await db.commit()

    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="telegram",
        action="bot.delete",
        record_id=bot.id,
        record_identifier=bot.name,
        old_values={"name": bot.name},
        request=request,
    )
    return {"success": True, "data": {"status": "deleted"}}


# ── House chat linking ─────────────────────────────────────────────


@router.post("/telegram/test-delivery")
async def test_delivery(
    payload: TestDeliveryPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("telegram.manage")),
):
    """Send a test message to a chat and (on success) link it to the house."""
    # House access check
    house_res = await db.execute(select(House).where(House.id == payload.house_id))
    house = house_res.scalar_one_or_none()
    if not house:
        raise HTTPException(status_code=404, detail="House not found")
    if not is_admin_user(current_user):
        if house.id not in await _user_house_ids(current_user):
            raise HTTPException(status_code=403, detail="You do not have access to this house")

    bot = await telegram_service.resolve_house_tg_bot(db, house)
    if not bot:
        raise HTTPException(
            status_code=400,
            detail="This house is not assigned to any Telegram bot yet.",
        )

    try:
        await telegram_service.send_message(
            token=bot.bot_token,
            chat_id=payload.chat_id,
            text=(
                f"✅ Orange Flow test message\n"
                f"House: {house.name}\n"
                f"Bot: @{bot.bot_username or bot.name}"
            ),
        )
    except TelegramError as e:
        bot.status = "invalid"
        bot.last_error = e.description
        await db.commit()
        raise HTTPException(status_code=502, detail=f"{e.description}")

    old_chat = house.telegram_chat_id
    house.telegram_chat_id = payload.chat_id
    house.telegram_chat_name = payload.chat_name or payload.chat_id
    await db.commit()

    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="telegram",
        action="house.link_chat",
        record_id=house.id,
        record_identifier=house.name,
        old_values={"chat_id": old_chat},
        new_values={"chat_id": payload.chat_id, "bot": bot.name},
        request=request,
    )

    return {
        "success": True,
        "data": {
            "house_id": house.id,
            "chat_id": house.telegram_chat_id,
            "chat_name": house.telegram_chat_name,
            "bot": bot.name,
        },
    }


@router.get("/telegram/status")
async def telegram_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_any_permission(["live_activations.schedule", "reports.whatsapp_share", "telegram.view"])),
    house_context: Optional[int] = Depends(get_house_context),
):
    """Per-house Telegram readiness for schedule modals."""
    if not house_context:
        return {"success": False, "state": "no_house", "error": "Select a house first"}

    house_res = await db.execute(select(House).where(House.id == house_context))
    house = house_res.scalar_one_or_none()
    if not house:
        return {"success": False, "state": "not_found", "error": "House not found"}

    bot = await telegram_service.resolve_house_tg_bot(db, house)
    if not bot:
        return {
            "success": False,
            "state": "no_bot",
            "error": "No Telegram bot assigned to this house",
        }

    try:
        me = await telegram_service.get_me(bot.bot_token)
        return {
            "success": True,
            "state": "ready",
            "bot": {"id": bot.id, "name": bot.name, "username": me.get("username")},
            "chat_id": house.telegram_chat_id,
            "chat_name": house.telegram_chat_name,
        }
    except TelegramError as e:
        bot.status = "invalid"
        bot.last_error = e.description
        await db.commit()
        return {"success": False, "state": "unreachable", "error": e.description}
