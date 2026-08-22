"""House device-token lifecycle helpers.

The WhatsApp gateway revokes device JWTs (jwt_version bump on re-login/restart).
Callers use these helpers to transparently regenerate and persist a fresh
token when a stored one is rejected with WA_TOKEN_EXPIRED.
"""
import logging
from typing import Awaitable, Callable, TypeVar

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.house import House
from app.services.whatsapp_service_client import (
    WhatsAppServiceClient,
    WhatsAppServiceError,
)

logger = logging.getLogger(__name__)

T = TypeVar("T")


async def refresh_house_token(db: AsyncSession, house: House) -> str:
    """Regenerate the house's device JWT and persist it. Returns new token."""
    if not house.wa_device_id or not house.wa_device_secret:
        raise WhatsAppServiceError(
            code="WA_NOT_CONFIGURED",
            message="WhatsApp device is not set up for this house",
        )
    client = WhatsAppServiceClient()
    token = await client.regenerate_token(house.wa_device_id, house.wa_device_secret)
    house.wa_jwt_token = token
    await db.commit()
    logger.info(f"WhatsApp token refreshed for house={house.id}")
    return token


async def with_house_token(
    db: AsyncSession,
    house: House,
    fn: Callable[[str], Awaitable[T]],
) -> T:
    """Run fn(jwt_token); on WA_TOKEN_EXPIRED regenerate once and retry."""
    if not house.wa_jwt_token:
        raise WhatsAppServiceError(
            code="WA_NOT_CONFIGURED",
            message="WhatsApp is not connected for this house",
        )
    try:
        return await fn(house.wa_jwt_token)
    except WhatsAppServiceError as e:
        if e.code != "WA_TOKEN_EXPIRED":
            raise
    token = await refresh_house_token(db, house)
    return await fn(token)
