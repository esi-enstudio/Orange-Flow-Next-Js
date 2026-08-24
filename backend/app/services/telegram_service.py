"""Telegram Bot API client and house→bot resolution.

Telegram bots are stateless: one token serves unlimited chats via plain
HTTPS calls, so a single shared httpx.AsyncClient handles every house with
negligible memory footprint — no gateway process needed.
"""
import logging
from typing import Any, Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.house import House
from app.models.telegram_bot import TelegramBot

logger = logging.getLogger(__name__)

API_BASE = "https://api.telegram.org"
REQUEST_TIMEOUT = 30.0

# Shared connection pool for every bot call in the process
_client: Optional[httpx.AsyncClient] = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=REQUEST_TIMEOUT)
    return _client


class TelegramError(Exception):
    """Telegram API returned an error."""

    def __init__(self, description: str, code: int = 400):
        self.description = description
        self.code = code
        super().__init__(description)


async def _call(method: str, token: str, payload: Optional[dict] = None) -> dict:
    """Invoke a Bot API method and unwrap the standard {ok, result} envelope."""
    url = f"{API_BASE}/bot{token}/{method}"
    try:
        resp = await _get_client().post(url, json=payload or {})
        data = resp.json()
    except Exception as e:
        raise TelegramError(f"Telegram service unreachable: {e}", code=503)
    if not data.get("ok"):
        raise TelegramError(data.get("description", "Unknown Telegram error"))
    return data.get("result", {})


async def get_me(token: str) -> dict:
    """Validate a bot token; returns the bot profile (id/username)."""
    return await _call("getMe", token)


async def send_message(token: str, chat_id: str, text: str) -> dict:
    return await _call("sendMessage", token, {"chat_id": chat_id, "text": text})


async def send_photo(
    token: str,
    chat_id: str,
    image_bytes: bytes,
    caption: str = "",
) -> dict:
    """Upload a PNG report to a chat/group/channel."""
    files = {"photo": ("report.png", image_bytes, "image/png")}
    data = {"chat_id": str(chat_id)}
    if caption:
        data["caption"] = caption
    url = f"{API_BASE}/bot{token}/sendPhoto"
    try:
        resp = await _get_client().post(url, data=data, files=files)
        payload = resp.json()
    except Exception as e:
        raise TelegramError(f"Telegram service unreachable: {e}", code=503)
    if not payload.get("ok"):
        raise TelegramError(payload.get("description", "Unknown Telegram error"))
    return payload.get("result", {})


async def resolve_house_tg_bot(db: AsyncSession, house: House) -> Optional[TelegramBot]:
    """Binding first: the house's assigned shared bot (oldest binding wins).

    There is no per-house legacy fallback for Telegram — bots are created
    centrally and bound to houses.
    """
    res = await db.execute(
        select(TelegramBot)
        .join(TelegramBot.houses)
        .where(
            House.id == house.id,
            TelegramBot.is_deleted == False,  # noqa: E712
        )
        .order_by(TelegramBot.id)
        .limit(1)
    )
    return res.scalar_one_or_none()


async def close_client() -> None:
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None
