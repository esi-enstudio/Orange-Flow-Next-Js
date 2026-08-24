"""WhatsApp device-token lifecycle helpers.

Supports two credential holders:
- ``WhatsappConnection`` (shared device assigned to many houses) — preferred
- ``House`` legacy per-house device columns — fallback

The WhatsApp gateway revokes device JWTs (jwt_version bump on re-login/restart).
Callers use these helpers to transparently regenerate and persist a fresh
token when a stored one is rejected with WA_TOKEN_EXPIRED.
"""
import logging
from typing import Awaitable, Callable, Optional, TypeVar

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.house import House
from app.models.whatsapp_connection import WhatsappConnection, whatsapp_connection_houses
from app.services.whatsapp_service_client import (
    WhatsAppServiceClient,
    WhatsAppServiceError,
)

logger = logging.getLogger(__name__)

T = TypeVar("T")


class WaTarget:
    """Uniform view over the two credential holders (connection or house)."""

    def __init__(self, holder: WhatsappConnection | House):
        self.holder = holder
        self.kind = "connection" if isinstance(holder, WhatsappConnection) else "house"

    @property
    def jwt_token(self) -> Optional[str]:
        return self.holder.wa_jwt_token

    @property
    def device_id(self) -> Optional[str]:
        return self.holder.wa_device_id

    @property
    def device_secret(self) -> Optional[str]:
        return self.holder.wa_device_secret

    @property
    def label(self) -> str:
        if self.kind == "connection":
            return f"connection:{self.holder.name}"
        return f"house:{self.holder.code}"

    def _set_token(self, token: str) -> None:
        self.holder.wa_jwt_token = token


async def resolve_house_wa_target(db: AsyncSession, house: House) -> Optional[WaTarget]:
    """Resolve the WhatsApp credential holder for a house.

    Priority: an active shared connection binding first; otherwise the
    house's own legacy per-house device.
    """
    res = await db.execute(
        select(WhatsappConnection)
        .join(
            whatsapp_connection_houses,
            WhatsappConnection.id == whatsapp_connection_houses.c.connection_id,
        )
        .where(
            whatsapp_connection_houses.c.house_id == house.id,
            WhatsappConnection.is_deleted == False,  # noqa: E712
        )
        .order_by(WhatsappConnection.id)
        .limit(1)
    )
    conn = res.scalar_one_or_none()
    if conn is not None:
        return WaTarget(conn)
    return WaTarget(house)


async def refresh_target_token(db: AsyncSession, target: WaTarget) -> str:
    """Regenerate the target's device JWT and persist it. Returns new token."""
    if not target.device_id or not target.device_secret:
        raise WhatsAppServiceError(
            code="WA_NOT_CONFIGURED",
            message="WhatsApp device is not set up",
        )
    client = WhatsAppServiceClient()
    token = await client.regenerate_token(target.device_id, target.device_secret)
    target._set_token(token)
    await db.commit()
    logger.info(f"WhatsApp token refreshed for {target.label}")
    return token


async def with_target_token(
    db: AsyncSession,
    target: WaTarget,
    fn: Callable[[str], Awaitable[T]],
) -> T:
    """Run fn(jwt_token); on WA_TOKEN_EXPIRED regenerate once and retry."""
    if not target.jwt_token:
        raise WhatsAppServiceError(
            code="WA_NOT_CONFIGURED",
            message="WhatsApp is not connected",
        )
    try:
        return await fn(target.jwt_token)
    except WhatsAppServiceError as e:
        if e.code != "WA_TOKEN_EXPIRED":
            raise
    token = await refresh_target_token(db, target)
    return await fn(token)


# ── Legacy single-holder helpers (kept for backwards compatibility) ──


async def refresh_house_token(db: AsyncSession, house: House) -> str:
    """Regenerate the house's device JWT and persist it. Returns new token."""
    return await refresh_target_token(db, WaTarget(house))


async def with_house_token(
    db: AsyncSession,
    house: House,
    fn: Callable[[str], Awaitable[T]],
) -> T:
    """Run fn(jwt_token); on WA_TOKEN_EXPIRED regenerate once and retry."""
    return await with_target_token(db, WaTarget(house), fn)
