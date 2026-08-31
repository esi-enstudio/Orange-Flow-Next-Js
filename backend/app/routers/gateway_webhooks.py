"""Public payment-gateway webhook endpoints.

SSLCommerz IPN posts here. Always answer 200 so the gateway retries nothing;
hard failures are recorded on webhook_events and reconciled by the billing runner.
"""

import json
import logging
import time

from fastapi import APIRouter, Body, HTTPException, Request

from app.services import webhook_service
from app.services.db_service import async_session
from config.settings import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/webhook/gateway", tags=["Webhooks"])

GATEWAY_PROVIDER = "sslcommerz"


@router.post(f"/{GATEWAY_PROVIDER}")
async def sslcommerz_webhook(request: Request):
    started = time.time()
    try:
        body = await request.body()
        payload = json.loads(body.decode("utf-8", errors="replace"))
    except Exception:
        payload = {}
    duration_ms = int((time.time() - started) * 1000)

    try:
        async with async_session() as session:
            result = await webhook_service.process_ipn(
                session, GATEWAY_PROVIDER, payload,
                duration_ms=duration_ms,
                ip_address=request.client.host if request.client else None,
            )
        logger.info("SSLCommerz IPN processed: reason=%s", result.get("reason"))
    except Exception as exc:  # never let a webhook crash escalate
        logger.exception("SSLCommerz IPN handler error")
        try:
            async with async_session() as session:
                event = await webhook_service.get_or_create_event(
                    session, GATEWAY_PROVIDER, f"error-{int(time.time() * 1000)}",
                    "POST", payload, 500, duration_ms,
                )
                event.status = "error"
                event.error_message = str(exc)[:500]
                await session.commit()
        except Exception:
            logger.exception("webhook error recording failed")

    return {"success": True, "received": True}


@router.post("/sslcommerz/mock")
async def sslcommerz_mock_webhook(payload: dict = Body(...)):
    """Simulate an SSLCommerz IPN. Only available in dry-run mode (E2E tests)."""
    if not settings.BILLING_INVOICE_DRY_RUN:
        raise HTTPException(status_code=404, detail="Mock webhook is disabled")
    async with async_session() as session:
        result = await webhook_service.process_ipn(
            session, GATEWAY_PROVIDER, payload,
            duration_ms=5, ip_address="127.0.0.1",
            skip_signature_check=True,
        )
    return {"success": True, **result}