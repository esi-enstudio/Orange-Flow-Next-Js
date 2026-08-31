"""Payment webhook processing.

Flow for each IPN callback (SSlCommerz v4):
  1. Persist the raw event (idempotent by provider+tran_id, unique index).
  2. Verify the gateway signature.
  3. Family the payment attempt by gateway tran_id.
  4. Ask the gateway's Order Validation API — source of truth.
  5. Apply payment + subscription state changes atomically.

The webhook endpoint always returns 200; failures are recorded on the
webhook_event row and reconciled later by the billing runner.
"""

import hashlib
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models.payment import PaymentAttempt, Payment
from app.models.webhook_event import WebhookEvent
from app.services.payment import get_gateway
from app.services.subscription_service import mark_invoice_paid
from app.utils.timezone import now_naive
from config.settings import settings

logger = logging.getLogger(__name__)

IGNORED_WEBHOOK_STATUSES = {"FAILED", "CANCELLED", "CANCELLED_BY_USER", "UNATTEMPTED", "EXPIRED", "INVALID"}
SUCCESS_WEBHOOK_STATUSES = {"VALIDATED", "VALID", "SUCCESS"}


def _event_identity(provider: str, payload: dict) -> str:
    """Stable identity for idempotency: gateway tran_id (tran_id from the
    attempt, or value_a fallback for case where client pays via different flow)."""
    tran_id = payload.get("tran_id") or payload.get("value_a")
    if tran_id:
        return str(tran_id)
    # no tran id at all — hash the payload to still get one stable event
    raw = sorted((k, str(payload.get(k))) for k in payload)
    return hashlib.sha1(repr(raw).encode()).hexdigest()


async def get_or_create_event(
    db: AsyncSession,
    provider: str,
    identity: str,
    method: str,
    payload: dict,
    status_code: int,
    duration_ms: int,
) -> WebhookEvent:
    existing = (await db.execute(
        select(WebhookEvent).where(
            WebhookEvent.provider == provider,
            WebhookEvent.event_id == identity,
        )
    )).scalar_one_or_none()
    if existing:
        return existing

    event = WebhookEvent(
        provider=provider,
        event_id=identity,
        event_type=payload.get("status") or "unknown",
        method=method,
        payload=payload,
        status_code=status_code,
        duration_ms=duration_ms,
        ip_address=None,
        status="received",
    )
    db.add(event)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        existing = (await db.execute(
            select(WebhookEvent).where(
                WebhookEvent.provider == provider,
                WebhookEvent.event_id == identity,
            )
        )).scalar_one_or_none()
        if existing:
            return existing
        raise
    return event


async def process_ipn(
    db: AsyncSession,
    provider: str,
    payload: dict,
    *,
    duration_ms: int,
    ip_address: Optional[str] = None,
    signature: Optional[dict] = None,
    skip_signature_check: bool = False,
) -> dict:
    gateway = get_gateway(provider)
    if gateway is None:
        event = await get_or_create_event(db, provider, f"unknown-provider-{len(payload)}", "POST", payload, 501, duration_ms)
        event.status = "failed"
        event.status_code = 501
        await db.commit()
        return {"processed": False, "reason": "unknown_provider"}

    identity = _event_identity(provider, payload)
    event = await get_or_create_event(db, provider, identity, "POST", payload, 200, duration_ms)
    if ip_address:
        event.ip_address = ip_address

    if event.status == "processed":
        await db.commit()
        return {"processed": True, "reason": "duplicate"}

    # 2. signature check (best-effort; Order Validation is authoritative)
    sig_ok = None
    if not skip_signature_check and hasattr(gateway, "verify_signature"):
        try:
            sig_ok = gateway.verify_signature(payload)
        except Exception:  # signature verification must never break processing
            logger.exception("webhook signature verification crashed")
            sig_ok = False
    if sig_ok is False:
        event.status = "failed"
        event.reason = "signature_mismatch"
        event.status_code = 400
        await db.commit()
        return {"processed": False, "reason": "signature_mismatch"}
    if sig_ok is True:
        event.signature_valid = True

    # 3. find the payment attempt tunnel
    tran_id = payload.get("tran_id") or payload.get("value_a")
    attempt = None
    if tran_id:
        attempt = (await db.execute(
            select(PaymentAttempt).where(PaymentAttempt.gateway_tran_id == str(tran_id))
        )).scalar_one_or_none()

    webhook_status = str(payload.get("status") or "").upper()

    if not attempt:
        event.status = "processed"
        event.reason = "unknown_transaction"
        event.processing_note = f"no payment attempt for tran_id={tran_id}"
        await db.commit()
        return {"processed": True, "reason": "unknown_transaction"}

    if webhook_status in IGNORED_WEBHOOK_STATUSES:
        attempt.status = "failed"
        attempt.error_reason = f"gateway status {webhook_status}"
        event.status = "processed"
        event.reason = "ignored"
        await db.commit()
        return {"processed": True, "reason": "ignored"}

    if webhook_status in SUCCESS_WEBHOOK_STATUSES or sig_ok:
        # 4. authoritative server-side validation
        validation = await gateway.validate_transaction(
            val_id=payload.get("val_id"),
            tran_id=tran_id,
            amount=attempt.amount,
            currency=attempt.currency,
        )
        if not validation.get("valid"):
            attempt.status = "failed"
            attempt.error_reason = f"order validation failed: {validation.get('status')} {validation.get('data', {}).get('error', '')}"
            event.status = "failed"
            event.reason = "validation_failed"
            event.status_code = 400
            await db.commit()
            return {"processed": False, "reason": "validation_failed"}

        returned_amount = validation["data"].get("amount")
        # protect against double-entry if the payment row already exists
        duplicate = (await db.execute(
            select(Payment).where(
                Payment.gateway == "sslcommerz",
                Payment.gateway_tran_id == str(tran_id),
            )
        )).scalar_one_or_none()
        if duplicate:
            # re-apply invoice paid state (idempotent)
            await mark_invoice_paid(db, duplicate.invoice, gateway_tran_id=str(tran_id), changed_via="webhook")
            attempt.status = "success"
            event.status = "processed"
            event.reason = "duplicate_payment_already_applied"
            await db.commit()
            return {"processed": True, "reason": "duplicate_payment_already_applied"}

        payment = Payment(
            house_id=attempt.house_id,
            invoice_id=attempt.invoice_id,
            subscription_id=attempt.subscription_id,
            amount=attempt.amount,
            currency=attempt.currency,
            gateway=provider,
            gateway_tran_id=str(tran_id),
            gateway_val_id=payload.get("val_id"),
            status="succeeded",
            card_type=payload.get("card_type"),
            paid_at=now_naive(),
            payment_meta=gateway.sanitize_payload(payload) if hasattr(gateway, "sanitize_payload") else payload,
        )
        db.add(payment)
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()
            # treat as idempotent duplication — re-fetch and confirm invoice state
            dup = (await db.execute(
                select(Payment).where(
                    Payment.gateway == "sslcommerz",
                    Payment.gateway_tran_id == str(tran_id),
                )
            )).scalar_one_or_none()
            if dup:
                await mark_invoice_paid(db, dup.invoice, gateway_tran_id=str(tran_id), changed_via="webhook")
            event = (await db.execute(
                select(WebhookEvent).where(
                    WebhookEvent.provider == provider,
                    WebhookEvent.event_id == identity,
                )
            )).scalar_one()
            attempt.status = "success"
            event.status = "processed"
            event.reason = "duplicate_payment_already_applied"
            await db.commit()
            return {"processed": True, "reason": "duplicate_payment_already_applied"}

        attempt.status = "success"
        attempt.completed_at = now_naive()
        attempt.response_meta = gateway.sanitize_payload(payload) if hasattr(gateway, "sanitize_payload") else payload

        await mark_invoice_paid(db, attempt.invoice, gateway_tran_id=str(tran_id), changed_via="webhook")

        # notify house (email/whatsapp/telegram) — best effort
        try:
            from app.models.house import House
            house = (await db.execute(select(House).where(House.id == attempt.house_id))).scalar_one_or_none()
            if house:
                from app.services.billing_notifications import notify_house
                await notify_house(db, house, "payment_succeeded",
                                   invoice=attempt.invoice, sub=attempt.invoice.subscription)
        except Exception as exc:
            logger.warning("webhook payment notification failed: %s", exc)

        event.status = "processed"
        event.reason = "payment_confirmed"
        event.processing_note = f"amount={returned_amount}"
    else:
        attempt.status = "failed"
        attempt.error_reason = f"unexpected gateway status {webhook_status}"
        event.status = "processed"
        event.reason = "unprocessed"
        event.processing_note = webhook_status

    await db.commit()
    return {"processed": True, "reason": event.reason}