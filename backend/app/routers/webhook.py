import logging
from fastapi import APIRouter, Request
from typing import Dict, Any

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/webhook", tags=["Webhook"])

async def _extract_payload(request: Request) -> Dict[str, Any]:
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        return await request.json()
    elif "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
        form = await request.form()
        return dict(form)
    else:
        try:
            return await request.json()
        except Exception:
            try:
                form = await request.form()
                return dict(form)
            except Exception:
                body = await request.body()
                return {"raw": body.decode("utf-8", errors="replace")}

@router.post("/sms")
async def receive_sms(request: Request):
    payload = await _extract_payload(request)
    sender = (payload.get("from") or payload.get("from_") or payload.get("sender")
              or payload.get("phone") or payload.get("sender_number") or "Unknown")
    message = (payload.get("message") or payload.get("body") or payload.get("text")
               or payload.get("msg") or payload.get("sms") or payload.get("content") or str(payload))
    logger.info("=" * 60)
    logger.info(f"📩 SMS Received — From: {sender}")
    logger.info(f"📝 Message: {message}")
    logger.info(f"📦 Full Payload: {payload}")
    logger.info("=" * 60)
    return {"status": "ok", "message": "SMS received"}

@router.post("/otp")
async def receive_otp(request: Request):
    payload = await _extract_payload(request)
    sender = (payload.get("from") or payload.get("from_") or payload.get("sender")
              or payload.get("phone") or payload.get("sender_number") or "Unknown")
    message = (payload.get("message") or payload.get("body") or payload.get("text")
               or payload.get("msg") or payload.get("sms") or payload.get("content") or str(payload))
    logger.info("=" * 60)
    logger.info(f"🔐 OTP Received — From: {sender}")
    logger.info(f"🔑 OTP/Message: {message}")
    logger.info(f"📦 Full Payload: {payload}")
    logger.info("=" * 60)
    return {"status": "ok", "message": "OTP received"}
