import logging
import re
from typing import Optional

from sqlalchemy import select

from app.core.otp_manager import otp_manager
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)


def _extract_sender(payload: dict) -> str:
    return (payload.get("from") or payload.get("from_") or payload.get("sender")
            or payload.get("phone") or payload.get("sender_number") or "Unknown")


def _extract_message(payload: dict) -> str:
    return (payload.get("message") or payload.get("body") or payload.get("text")
            or payload.get("msg") or payload.get("sms") or payload.get("content")
            or (f"OTP: {payload['otp_code']}" if payload.get("otp_code") else "")
            or str(payload))


def _extract_otp(payload: dict, message: str) -> Optional[str]:
    for key in ("otp_code", "otp", "code"):
        val = payload.get(key)
        if val is not None:
            digits = re.sub(r"\D", "", str(val))
            if 4 <= len(digits) <= 8:
                return digits
    tokens = re.findall(r"\b(\d{4,6})\b", message)
    if not tokens:
        return None
    if len(tokens) == 1:
        return tokens[0]
    for m in re.finditer(
        r"(otp|one\s?time\s?password|verification\s?code|your\s?code)[^0-9]{0,12}(\d{4,6})",
        message.lower(),
    ):
        return m.group(2)
    return None


def _extract_house_code(payload: dict, message: str, houses: list[dict]) -> Optional[str]:
    for key in ("house_code", "house", "house_name"):
        val = payload.get(key)
        if val:
            v = str(val).strip()
            for h in houses:
                if v.upper() == h["code"]:
                    return h["code"]
                if v.casefold() == h["name"].casefold():
                    return h["code"]
    upper_msg = message.upper()
    for h in houses:
        if h["code"].upper() in upper_msg:
            return h["code"]
    matches = [h["code"] for h in houses if h["name"] and h["name"].casefold() in message.casefold()]
    return matches[0] if len(matches) == 1 else None


async def _load_houses():
    from app.services.db_service import async_session
    from app.models.house import House

    async with async_session() as session:
        result = await session.execute(select(House.id, House.code, House.name))
        return [{"id": rid, "code": code, "name": name} for rid, code, name in result.all()]


async def _persist_otp(otp_code, house, house_code, sender, message):
    from app.services.db_service import async_session
    from app.models.otp import OTP

    async with async_session() as session:
        session.add(OTP(
            house_id=house["id"] if house else None,
            house_code=house_code,
            otp_code=otp_code or "",
            sender=sender,
            message=message[:500],
            received_at=now_naive(),
            is_used=False,
        ))
        await session.commit()


async def ingest_otp_payload(payload: dict) -> dict:
    """Parse an inbound SMS/OTP payload, route it to the correct house, feed the
    OTP pool, persist to the otps table, and bounce it to the local SMS app."""
    sender = _extract_sender(payload)
    message = _extract_message(payload)

    try:
        houses = await _load_houses()
    except Exception as e:
        logger.warning(f"Failed to load houses for OTP routing: {e}")
        houses = []

    otp_code = _extract_otp(payload, message)
    house_code = _extract_house_code(payload, message, houses) if otp_code else None
    house = next((h for h in houses if h["code"] == house_code), None) if house_code else None

    if otp_code and house_code:
        otp_manager.update_otp(otp_code, house_code)
        logger.info(f"🔐 [OTP] Routed OTP {otp_code} -> house {house_code}")
    elif otp_code:
        logger.warning(f"⚠️ [OTP] OTP {otp_code} received but house could not be determined: {message[:120]}")
    else:
        logger.info(f"ℹ️ [SMS] No OTP code detected: {message[:120]}")

    try:
        await _persist_otp(otp_code, house, house_code, sender, message)
    except Exception as e:
        logger.warning(f"Failed to persist OTP to DB: {e}")

    try:
        import aiohttp

        async with aiohttp.ClientSession() as session:
            await session.post("http://host.docker.internal:8080/receive-otp", json=payload, timeout=2)
    except Exception:
        pass

    return {
        "status": "ok",
        "otp_code": otp_code,
        "house_code": house_code,
        "sender": sender,
        "message": message,
    }