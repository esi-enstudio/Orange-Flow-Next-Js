import logging
from fastapi import APIRouter, Request
from typing import Dict, Any

from app.core.otp_ingest import ingest_otp_payload

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
@router.post("/otp")
async def receive_sms_or_otp(request: Request):
    payload = await _extract_payload(request)
    result = await ingest_otp_payload(payload)
    logger.info("=" * 60)
    logger.info(f"📩 Webhook Payload: {payload}")
    logger.info(f"🔑 Routed OTP: {result.get('otp_code')} for house: {result.get('house_code')}")
    logger.info("=" * 60)
    return {"status": "ok", "message": "received"}