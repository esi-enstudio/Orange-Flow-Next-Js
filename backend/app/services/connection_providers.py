"""Per-house external app connection state for the Connections hub.

The hub does not own a second copy of connection state. Each provider reads its
single source of truth:

- WhatsApp: the gateway device resolved by ``resolve_house_wa_target``.
- Telegram: the shared bot binding plus the house's linked chat.
- Gmail: the Live C2C OAuth config (token store) for the house.

Adding a provider means adding one collector here and one presentation entry in
``frontend/src/lib/connectionProviders.ts``.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Awaitable, Callable, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.house import House
from app.models.live_c2c_automation import LiveC2CAutomationConfig
from app.services.live_c2c_gmail_service import get_google_oauth_config
from app.services import telegram_service
from app.services.whatsapp_service_client import (
    WhatsAppServiceError,
    whatsapp_service_client,
)
from app.services.whatsapp_token import resolve_house_wa_target, with_target_token

logger = logging.getLogger(__name__)


class ConnectionStatus:
    CONNECTED = "connected"
    DISCONNECTED = "disconnected"
    NOT_CONFIGURED = "not_configured"
    ERROR = "error"


@dataclass
class HouseConnectionState:
    provider: str
    connected: bool
    status: str
    account: Optional[str] = None
    detail: Optional[str] = None
    reference: Optional[str] = None
    last_connected_at: Optional[str] = None
    error: Optional[str] = None
    used_for: list[str] = field(default_factory=list)
    available: bool = True

    def as_dict(self) -> dict:
        return {
            "provider": self.provider,
            "connected": self.connected,
            "status": self.status,
            "account": self.account,
            "detail": self.detail,
            "reference": self.reference,
            "last_connected_at": self.last_connected_at,
            "error": self.error,
            "used_for": self.used_for,
            "available": self.available,
        }


def _iso(value: datetime | None) -> Optional[str]:
    return value.isoformat() if value else None


async def _whatsapp_state(db: AsyncSession, house: House) -> HouseConnectionState:
    target = await resolve_house_wa_target(db, house)
    holder = target.holder
    account = holder.wa_phone_number if hasattr(holder, "wa_phone_number") else None
    detail = (
        f"Shared device · {holder.name}"
        if target.kind == "connection"
        else "House device"
    )
    state = HouseConnectionState(
        provider="whatsapp",
        connected=False,
        status=ConnectionStatus.NOT_CONFIGURED,
        account=account,
        detail=detail,
        reference=str(holder.id) if target.kind == "connection" else None,
        last_connected_at=_iso(
            getattr(holder, "wa_last_connected_at", None)
        ),
        used_for=["report_delivery"],
    )

    if not target.jwt_token:
        state.error = "WhatsApp is not set up for this house"
        return state

    try:
        status_data = await with_target_token(
            db,
            target,
            lambda token: whatsapp_service_client.get_device_status(token),
        )
    except WhatsAppServiceError as exc:
        state.status = ConnectionStatus.ERROR
        state.error = exc.message
        return state
    except Exception as exc:  # gateway unreachable must not break the page
        logger.warning("WhatsApp status lookup failed for house %s: %s", house.id, exc)
        state.status = ConnectionStatus.ERROR
        state.error = "WhatsApp gateway is unreachable"
        return state

    connected = bool(
        status_data.get("connected", status_data.get("is_connected", False))
    )
    state.connected = connected
    state.status = (
        ConnectionStatus.CONNECTED if connected else ConnectionStatus.DISCONNECTED
    )
    state.account = (
        status_data.get("phone_number")
        or status_data.get("phone")
        or account
    )
    if connected:
        state.last_connected_at = _iso(
            getattr(holder, "wa_last_connected_at", None)
        )
    state.error = None if connected else status_data.get("message")
    return state


async def _telegram_state(db: AsyncSession, house: House) -> HouseConnectionState:
    bot = await telegram_service.resolve_house_tg_bot(db, house)
    state = HouseConnectionState(
        provider="telegram",
        connected=False,
        status=ConnectionStatus.NOT_CONFIGURED,
        used_for=["report_delivery"],
    )
    if bot is None:
        state.error = "No Telegram bot is assigned to this house"
        return state

    state.detail = house.telegram_chat_name or house.telegram_chat_id or bot.name
    state.reference = house.telegram_chat_id
    try:
        me = await telegram_service.get_me(bot.bot_token)
    except telegram_service.TelegramError as exc:
        state.status = ConnectionStatus.ERROR
        state.error = exc.description
        return state
    except Exception as exc:  # pragma: no cover - defensive network guard
        logger.warning("Telegram lookup failed for house %s: %s", house.id, exc)
        state.status = ConnectionStatus.ERROR
        state.error = "Telegram is unreachable"
        return state

    username = me.get("username") or bot.bot_username
    state.account = f"@{username}" if username else bot.name
    if house.telegram_chat_id:
        state.connected = True
        state.status = ConnectionStatus.CONNECTED
        state.detail = house.telegram_chat_name or house.telegram_chat_id
    else:
        state.status = ConnectionStatus.DISCONNECTED
        state.error = "Link a Telegram chat to finish connecting"
    return state


async def _gmail_state(db: AsyncSession, house: House) -> HouseConnectionState:
    oauth_config = await get_google_oauth_config(db)
    state = HouseConnectionState(
        provider="gmail",
        connected=False,
        status=ConnectionStatus.NOT_CONFIGURED,
        account=house.email,
        detail="House Gmail account",
        used_for=["email"],
        available=oauth_config.available,
    )
    if not oauth_config.available:
        state.error = "Gmail is not configured by the administrator"
        return state

    config = await db.scalar(
        select(LiveC2CAutomationConfig).where(
            LiveC2CAutomationConfig.house_id == house.id,
            LiveC2CAutomationConfig.is_deleted.is_(False),
        )
    )
    if config is None:
        return state

    state.account = config.gmail_address or house.email
    state.reference = state.account
    state.error = config.gmail_error
    if (
        config.source_type == "gmail"
        and config.gmail_status == "connected"
        and config.gmail_refresh_token_encrypted
    ):
        state.connected = True
        state.status = ConnectionStatus.CONNECTED
        state.detail = "House Gmail account"
    elif config.gmail_status == "error":
        state.status = ConnectionStatus.ERROR
    else:
        state.status = ConnectionStatus.DISCONNECTED
    return state


_COLLECTORS: tuple[
    tuple[str, Callable[[AsyncSession, House], Awaitable[HouseConnectionState]]],
    ...,
] = (
    ("whatsapp", _whatsapp_state),
    ("telegram", _telegram_state),
    ("gmail", _gmail_state),
)


async def collect_house_connections(
    db: AsyncSession, house: House
) -> list[HouseConnectionState]:
    """Return one state per supported provider for ``house``.

    A provider failure is reported in its own state; it never prevents the
    other cards from rendering.
    """
    states: list[HouseConnectionState] = []
    for provider, collector in _COLLECTORS:
        try:
            states.append(await collector(db, house))
        except Exception as exc:  # pragma: no cover - defensive per-provider guard
            logger.exception("Connection lookup failed for %s house %s", provider, house.id)
            states.append(
                HouseConnectionState(
                    provider=provider,
                    connected=False,
                    status=ConnectionStatus.ERROR,
                    error="Connection status is unavailable",
                )
            )
    return states
