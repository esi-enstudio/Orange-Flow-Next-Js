"""Cash / offline payment recording.

This is the authoritative path for a deployment that does not use a hosted
payment gateway. An authorised admin records money actually received; the
invoice is marked paid and the subscription is activated or renewed by
:func:`subscription_service.mark_invoice_paid`.

Design rules:
  - Never trust a redirect/query param: only this server-side record activates
    a plan.
  - An open invoice is reused; if none exists, an invoice for the period the
    payment buys is issued (``next_billing_period_start``).
  - The recorded amount must match the invoice total (no partial payments yet).
  - The synthetic gateway transaction id is deterministic
    (``CASH-<invoice_no>``), so re-clicking "record payment" is idempotent and
    the unique ``(gateway, gateway_tran_id)`` constraint is a second guard.
"""

import logging
import re
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.invoice import (
    Invoice,
    INVOICE_STATUS_ISSUED,
    INVOICE_STATUS_PAID,
    INVOICE_STATUS_UNPAID,
    INVOICE_STATUS_VOID,
)
from app.models.payment import (
    Payment,
    PAYMENT_STATUS_SUCCEEDED,
    PAYMENT_STATUS_PENDING,
    PAYMENT_STATUS_FAILED,
)
from app.models.subscription import HouseSubscription
from app.services import subscription_service as subsvc
from app.utils.timezone import now_naive, to_bst_naive

logger = logging.getLogger(__name__)

CASH_GATEWAY = "cash"
MANUAL_GATEWAY = "manual"


class ManualPaymentError(Exception):
    """A cash payment cannot be recorded; the router maps this to HTTP 4xx."""

    def __init__(
        self,
        message: str,
        code: str = "MANUAL_PAYMENT_ERROR",
        status_code: int = 400,
        fields: Optional[dict] = None,
    ):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.fields = fields


def _as_money(value) -> Decimal:
    try:
        return Decimal(str(value)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError, TypeError):
        raise ManualPaymentError(
            "Invalid payment amount",
            code="INVALID_PAYMENT_AMOUNT",
            fields={"amount": "Enter a valid amount"},
        )


def _normalise_paid_at(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    # Project convention: every persisted timestamp is naive BST.
    return to_bst_naive(value) if value.tzinfo is not None else value


async def open_invoice_for(
    db: AsyncSession, subscription_id: int
) -> Optional[Invoice]:
    """Oldest unpaid invoice for a subscription, if any."""
    result = await db.execute(
        select(Invoice)
        .where(
            Invoice.subscription_id == subscription_id,
            Invoice.status.in_([INVOICE_STATUS_ISSUED, INVOICE_STATUS_UNPAID]),
            Invoice.is_deleted == False,  # noqa: E712
        )
        .order_by(Invoice.due_date.asc(), Invoice.id.asc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _existing_payment(db: AsyncSession, invoice_id: int) -> Optional[Payment]:
    result = await db.execute(
        select(Payment)
        .where(
            Payment.invoice_id == invoice_id,
            Payment.status == PAYMENT_STATUS_SUCCEEDED,
            Payment.is_deleted == False,  # noqa: E712
        )
        .order_by(Payment.id.asc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _generate_paid_invoice_pdf(db: AsyncSession, invoice: Invoice, payment: Optional[Payment]):
    """Render and store the invoice PDF once the payment is recorded.

    Best effort by design: a PDF failure must never undo a recorded payment.
    Returns the (possibly re-loaded) invoice/payment so the caller never sees an
    expired instance after a rollback.
    """
    invoice_id = invoice.id
    payment_id = payment.id if payment is not None else None
    try:
        from app.services import invoice_pdf

        pdf_bytes = invoice_pdf.build_invoice_pdf(invoice, payment=payment)
        stored_path = invoice_pdf.store_invoice_pdf(invoice, pdf_bytes)
        if stored_path:
            invoice.pdf_path = stored_path
            invoice.pdf_generated_at = now_naive()
            await db.commit()
        return invoice, payment
    except Exception as exc:
        logger.warning("invoice PDF generation failed (invoice id=%s): %s", invoice_id, exc)
        try:
            await db.rollback()
        except Exception:
            pass
        fresh_invoice = await db.get(Invoice, invoice_id)
        fresh_payment = await db.get(Payment, payment_id) if payment_id else None
        return fresh_invoice or invoice, fresh_payment or payment


async def pay_invoice_manually(
    db: AsyncSession,
    invoice: Invoice,
    *,
    amount=None,
    gateway: str = CASH_GATEWAY,
    reference: Optional[str] = None,
    note: Optional[str] = None,
    paid_at: Optional[datetime] = None,
    recorded_by: Optional[int] = None,
    tran_id: Optional[str] = None,
) -> dict:
    """Record an offline payment against one invoice.

    Returns ``{"invoice", "subscription", "payment", "already_paid"}``.
    Raises :class:`ManualPaymentError` on validation failures.
    """
    if invoice.status == INVOICE_STATUS_PAID:
        payment = await _existing_payment(db, invoice.id)
        return {
            "invoice": invoice,
            "subscription": invoice.subscription,
            "payment": payment,
            "already_paid": True,
        }
    if invoice.status == INVOICE_STATUS_VOID:
        raise ManualPaymentError(
            "This invoice is void and cannot be paid",
            code="INVOICE_VOID",
            status_code=409,
        )

    expected = _as_money(invoice.total)
    paid = expected if amount is None else _as_money(amount)
    if paid <= 0:
        raise ManualPaymentError(
            "Payment amount must be greater than zero",
            code="INVALID_PAYMENT_AMOUNT",
            fields={"amount": "Amount must be greater than zero"},
        )
    if abs(paid - expected) > Decimal("0.01"):
        raise ManualPaymentError(
            f"Payment amount must match the invoice total ({expected} {invoice.currency})",
            code="PAYMENT_AMOUNT_MISMATCH",
            fields={"amount": f"Invoice total is {expected} {invoice.currency}"},
        )

    paid_at = _normalise_paid_at(paid_at)
    now = now_naive()
    if paid_at is not None and paid_at > now + timedelta(minutes=5):
        raise ManualPaymentError(
            "Payment date cannot be in the future",
            code="INVALID_PAID_AT",
            fields={"paid_at": "Payment date cannot be in the future"},
        )

    tran_id = tran_id or f"CASH-{invoice.invoice_no}"
    payment = Payment(
        house_id=invoice.house_id,
        invoice_id=invoice.id,
        subscription_id=invoice.subscription_id,
        amount=paid,
        currency=invoice.currency,
        status=PAYMENT_STATUS_SUCCEEDED,
        gateway=gateway,
        gateway_tran_id=tran_id,
        paid_at=paid_at or now,
        payment_meta={
            "method": gateway,
            "reference": reference,
            "note": note,
            "recorded_by": recorded_by,
        },
    )
    db.add(payment)
    try:
        await db.flush()
    except IntegrityError:
        # A concurrent request already recorded this invoice. Treat the second
        # click as idempotent instead of creating a duplicate payment.
        await db.rollback()
        fresh = (await db.execute(
            select(Invoice).where(Invoice.id == invoice.id)
        )).scalar_one_or_none()
        if fresh is None:
            raise
        existing = await _existing_payment(db, fresh.id)
        return {
            "invoice": fresh,
            "subscription": fresh.subscription,
            "payment": existing,
            "already_paid": True,
        }

    subscription = await subsvc.mark_invoice_paid(
        db,
        invoice,
        gateway_tran_id=tran_id,
        changed_via="admin_cash" if gateway == CASH_GATEWAY else "admin",
    )
    # A direct admin recording supersedes any tenant request still waiting on
    # this invoice; leaving it pending would let it be approved twice.
    superseded = (await db.execute(
        select(Payment).where(
            Payment.invoice_id == invoice.id,
            Payment.id != payment.id,
            Payment.status == PAYMENT_STATUS_PENDING,
            Payment.is_deleted == False,  # noqa: E712
        )
    )).scalars().all()
    for pending in superseded:
        meta = dict(pending.payment_meta or {})
        meta["superseded_by_payment_id"] = payment.id
        meta["rejection_reason"] = "Invoice was paid directly by an administrator"
        pending.status = PAYMENT_STATUS_FAILED
        pending.payment_meta = meta
    if superseded:
        await db.commit()
    await db.refresh(payment)
    invoice, payment = await _generate_paid_invoice_pdf(db, invoice, payment)
    logger.info(
        "manual payment recorded: invoice=%s house=%s amount=%s gateway=%s by=%s",
        invoice.invoice_no, invoice.house_id, paid, gateway, recorded_by,
    )
    return {
        "invoice": invoice,
        "subscription": subscription,
        "payment": payment,
        "already_paid": False,
    }


async def record_cash_payment(
    db: AsyncSession,
    sub: HouseSubscription,
    *,
    amount=None,
    reference: Optional[str] = None,
    note: Optional[str] = None,
    paid_at: Optional[datetime] = None,
    recorded_by: Optional[int] = None,
    idempotency_key: Optional[str] = None,
) -> dict:
    """Record cash received for a subscription, issuing an invoice if needed.

    The invoice that is paid is either:
      - the oldest open invoice (the normal case), or
      - a new invoice for ``next_billing_period_start(sub)`` — the current
        period end for an active/trialing plan, or ``now`` when the plan has
        already lapsed.

    ``idempotency_key`` makes a retried request (same key) return the original
    payment instead of buying another period.
    """
    if sub.package is None:
        raise ManualPaymentError(
            "This subscription has no plan assigned. Attach a plan first.",
            code="SUBSCRIPTION_NO_PLAN",
            status_code=409,
        )

    tran_id = None
    safe_key = re.sub(r"[^A-Za-z0-9_-]", "", idempotency_key or "")[:40]
    if safe_key:
        tran_id = f"CASH-S{sub.id}-{safe_key}"
        existing = (await db.execute(
            select(Payment).where(
                Payment.gateway == CASH_GATEWAY,
                Payment.gateway_tran_id == tran_id,
                Payment.is_deleted == False,  # noqa: E712
            )
        )).scalar_one_or_none()
        if existing:
            invoice = (await db.execute(
                select(Invoice).where(Invoice.id == existing.invoice_id)
            )).scalar_one_or_none()
            return {
                "invoice": invoice,
                "subscription": invoice.subscription if invoice else sub,
                "payment": existing,
                "already_paid": True,
            }

    invoice = await open_invoice_for(db, sub.id)
    if invoice is None:
        invoice = await subsvc.issue_invoice(
            db,
            sub,
            sub.package,
            billing_interval=sub.billing_interval,
            description=f"Cash payment - {sub.package.name} ({sub.billing_interval})",
            period_start=subsvc.next_billing_period_start(sub),
        )

    return await pay_invoice_manually(
        db,
        invoice,
        amount=amount,
        gateway=CASH_GATEWAY,
        reference=reference,
        note=note,
        paid_at=paid_at,
        recorded_by=recorded_by,
        tran_id=tran_id,
    )
