"""Tenant-submitted manual payments with admin approval.

Flow
----
1. A house selects a plan. The subscription starts on the plan's free tier
   (``trial_days``) and the first paid invoice is issued immediately.
2. The tenant pays offline and submits a payment request — amount, channel,
   reference and an optional proof file. The payment is stored as
   ``pending``; nothing is activated yet.
3. An authorised admin reviews it and either **approves** or **rejects**:
   - approve -> payment ``succeeded``; the invoice is marked paid and
     :func:`subscription_service.mark_invoice_paid` starts the paid period at
     the *approval time* (monthly = 1 month, yearly = 1 year). Session renewals
     extend the existing period instead of discarding paid time.
   - reject -> payment ``failed`` with a reason; the invoice stays open so the
     tenant can submit a corrected request.

The tenant's claimed ``paid_at`` is kept as metadata only — the approval
timestamp is what starts the plan, because that is the moment the payment was
verified.
"""

import logging
import os
import re
import uuid
from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.invoice import (
    Invoice,
    INVOICE_STATUS_ISSUED,
    INVOICE_STATUS_UNPAID,
    INVOICE_STATUS_PAID,
)
from app.models.payment import (
    Payment,
    PAYMENT_STATUS_PENDING,
    PAYMENT_STATUS_SUCCEEDED,
    PAYMENT_STATUS_FAILED,
    PAYMENT_STATUS_NEEDS_INFO,
)
from app.services import subscription_service as subsvc
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

PROOF_ROOT = os.path.join("private_uploads", "payment_proofs")
PROOF_MAX_BYTES = 10 * 1024 * 1024  # 10 MB
PROOF_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}

# Channels a tenant may claim. Mirrors PAYMENT_METHOD_TYPES plus "manual".
PAYMENT_CHANNELS = ("cash", "bkash", "nagad", "rocket", "bank", "mobilebanking", "manual")

_PAID_INVOICE_STATUSES = (INVOICE_STATUS_ISSUED, INVOICE_STATUS_UNPAID)
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x1f\x7f]+")


class PaymentRequestError(Exception):
    """A payment request cannot be submitted/reviewed; routers map this to 4xx."""

    def __init__(
        self,
        message: str,
        code: str = "PAYMENT_REQUEST_ERROR",
        status_code: int = 400,
        fields: Optional[dict] = None,
    ):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.fields = fields


def _money(value) -> Decimal:
    try:
        return Decimal(str(value)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError, TypeError):
        raise PaymentRequestError(
            "Invalid payment amount",
            code="INVALID_PAYMENT_AMOUNT",
            fields={"amount": "Enter a valid amount"},
        )


def _clean_text(value: Optional[str], limit: int) -> Optional[str]:
    if value is None:
        return None
    cleaned = _CONTROL_CHARS_RE.sub("", str(value)).strip()
    return cleaned[:limit] or None


def _safe_filename(name: Optional[str]) -> str:
    base = os.path.basename((name or "").replace("\\", "/")).strip()
    base = _CONTROL_CHARS_RE.sub("", base).lstrip(".").strip()
    return (base or "proof")[:180]


def _ensure_proof_dirs(house_id: int) -> str:
    directory = os.path.join(PROOF_ROOT, str(house_id))
    os.makedirs(directory, exist_ok=True)
    return directory


async def _store_proof(house_id: int, proof: UploadFile) -> tuple[str, str]:
    """Persist an uploaded proof file; returns ``(relative_path, display_name)``."""
    display_name = _safe_filename(proof.filename)
    ext = os.path.splitext(display_name)[1].lower()
    if ext not in PROOF_EXTENSIONS:
        raise PaymentRequestError(
            "Unsupported proof file type",
            code="INVALID_PROOF_FILE",
            fields={"proof": "Upload a JPG, PNG, WebP or PDF file"},
        )
    content = await proof.read(PROOF_MAX_BYTES + 1)
    if not content:
        raise PaymentRequestError(
            "The proof file is empty",
            code="INVALID_PROOF_FILE",
            fields={"proof": "Upload a non-empty file"},
        )
    if len(content) > PROOF_MAX_BYTES:
        raise PaymentRequestError(
            "Proof file is too large",
            code="PROOF_FILE_TOO_LARGE",
            fields={"proof": "Maximum size is 10 MB"},
        )
    directory = _ensure_proof_dirs(house_id)
    filename = f"{uuid.uuid4().hex}{ext}"
    full_path = os.path.join(directory, filename)
    with open(full_path, "wb") as fh:
        fh.write(content)
    return full_path, display_name


def proof_disk_path(payment: Payment) -> Optional[str]:
    """Absolute path of a stored proof, or None when absent/outside the root."""
    meta = payment.payment_meta or {}
    stored = meta.get("proof_path")
    if not stored:
        return None
    root = os.path.abspath(PROOF_ROOT)
    path = os.path.abspath(stored)
    if os.path.commonpath([root, path]) != root or not os.path.isfile(path):
        return None
    return path


async def pending_payment_for_invoice(
    db: AsyncSession, invoice_id: int
) -> Optional[Payment]:
    return (await db.execute(
        select(Payment)
        .where(
            Payment.invoice_id == invoice_id,
            Payment.status == PAYMENT_STATUS_PENDING,
            Payment.is_deleted == False,  # noqa: E712
        )
        .order_by(Payment.id.desc())
        .limit(1)
    )).scalar_one_or_none()


async def _info_requested_for_invoice(
    db: AsyncSession, invoice_id: int
) -> Optional[Payment]:
    return (await db.execute(
        select(Payment)
        .where(
            Payment.invoice_id == invoice_id,
            Payment.status == PAYMENT_STATUS_NEEDS_INFO,
            Payment.is_deleted == False,  # noqa: E712
        )
        .order_by(Payment.id.desc())
        .limit(1)
    )).scalar_one_or_none()


async def submit_request(
    db: AsyncSession,
    invoice: Invoice,
    *,
    house_id: int,
    amount=None,
    method: str = "manual",
    reference: Optional[str] = None,
    note: Optional[str] = None,
    proof: Optional[UploadFile] = None,
    submitted_by: Optional[int] = None,
) -> Payment:
    """Create a pending payment for an invoice. No activation happens here."""
    if invoice.house_id != house_id:
        raise PaymentRequestError("Invoice not found", code="INVOICE_NOT_FOUND", status_code=404)
    if invoice.status == INVOICE_STATUS_PAID:
        raise PaymentRequestError(
            "This invoice is already paid", code="INVOICE_ALREADY_PAID", status_code=409
        )
    if invoice.status not in _PAID_INVOICE_STATUSES:
        raise PaymentRequestError(
            "This invoice cannot be paid", code="INVOICE_NOT_PAYABLE", status_code=409
        )

    existing = await pending_payment_for_invoice(db, invoice.id)
    needs_info = await _info_requested_for_invoice(db, invoice.id)
    if existing is not None:
        raise PaymentRequestError(
            "A payment for this invoice is already awaiting approval",
            code="PAYMENT_ALREADY_PENDING",
            status_code=409,
        )

    # Supersedes a payment that an admin flagged as needing more info: the
    # customer's corrected submission makes the old one void, and the invoice
    # remains open under the new pending request.
    if needs_info is not None:
        meta = dict(needs_info.payment_meta or {})
        meta["rejection_reason"] = "A corrected payment request was submitted"
        meta["superseded_by_payment_id"] = None  # set after the new payment commits
        needs_info.status = PAYMENT_STATUS_FAILED
        needs_info.payment_meta = meta
        db.add(needs_info)

    expected = _money(invoice.total)
    claimed = expected if amount is None else _money(amount)
    if claimed <= 0:
        raise PaymentRequestError(
            "Payment amount must be greater than zero",
            code="INVALID_PAYMENT_AMOUNT",
            fields={"amount": "Amount must be greater than zero"},
        )
    if abs(claimed - expected) > Decimal("0.01"):
        raise PaymentRequestError(
            f"Payment amount must match the invoice total ({expected} {invoice.currency})",
            code="PAYMENT_AMOUNT_MISMATCH",
            fields={"amount": f"Invoice total is {expected} {invoice.currency}"},
        )

    channel = (method or "manual").strip().lower()
    if channel not in PAYMENT_CHANNELS:
        raise PaymentRequestError(
            "Unsupported payment method",
            code="INVALID_PAYMENT_METHOD",
            fields={"method": f"Use one of: {', '.join(PAYMENT_CHANNELS)}"},
        )

    proof_path = None
    proof_name = None
    if proof is not None:
        proof_path, proof_name = await _store_proof(house_id, proof)

    payment = Payment(
        house_id=house_id,
        invoice_id=invoice.id,
        subscription_id=invoice.subscription_id,
        amount=claimed,
        currency=invoice.currency,
        status=PAYMENT_STATUS_PENDING,
        gateway=channel,
        gateway_tran_id=f"REQ-{uuid.uuid4().hex[:24]}",
        paid_at=None,
        payment_meta={
            "method": channel,
            "reference": _clean_text(reference, 120),
            "note": _clean_text(note, 500),
            "proof_path": proof_path,
            "proof_name": proof_name,
            "submitted_by": submitted_by,
            "submitted_at": now_naive().isoformat(),
        },
    )
    db.add(payment)
    await db.commit()
    await db.refresh(payment)
    logger.info(
        "payment request submitted: payment=%s invoice=%s house=%s by=%s",
        payment.id, invoice.invoice_no, house_id, submitted_by,
    )

    # Point the superseded needs_info payment at the new request.
    if needs_info is not None:
        nm = dict(needs_info.payment_meta or {})
        nm["superseded_by_payment_id"] = payment.id
        needs_info.payment_meta = nm
        db.add(needs_info)
        await db.commit()
        await db.refresh(needs_info)
    return payment


async def _render_paid_invoice_pdf(db: AsyncSession, invoice: Invoice, payment: Payment) -> None:
    """Attach the paid invoice PDF. Best effort — never undoes an approval."""
    try:
        from app.services import invoice_pdf

        pdf_bytes = invoice_pdf.build_invoice_pdf(invoice, payment=payment)
        stored = invoice_pdf.store_invoice_pdf(invoice, pdf_bytes)
        if stored:
            invoice.pdf_path = stored
            invoice.pdf_generated_at = now_naive()
            await db.commit()
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("payment approval PDF failed (invoice=%s): %s", invoice.id, exc)


async def _set_info_requested(
    db: AsyncSession, payment: Payment, *, requested_by=None, reason: Optional[str] = None
) -> Payment:
    """Mark a pending payment as needing more info (reviewer -> customer)."""
    if payment.status != PAYMENT_STATUS_PENDING:
        raise PaymentRequestError(
            "Only a pending payment can be flagged for more information",
            code="PAYMENT_NOT_PENDING",
            status_code=409,
        )
    reason = _clean_text(reason, 500)
    meta = dict(payment.payment_meta or {})
    meta.update({
        "info_requested_by": requested_by,
        "info_requested_at": now_naive().isoformat(),
        "info_request_reason": reason,
    })
    payment.status = PAYMENT_STATUS_NEEDS_INFO
    payment.payment_meta = meta
    await db.commit()
    await db.refresh(payment)
    logger.info(
        "payment needs_info: payment=%s invoice=%s house=%s by=%s",
        payment.id, payment.invoice_id, payment.house_id, requested_by,
    )
    return payment


async def request_info(
    db: AsyncSession,
    payment: Payment,
    *,
    requested_by: Optional[int] = None,
    reason: Optional[str] = None,
) -> Payment:
    """Transition a pending payment to the NEEDS_INFO state.

    The customer is expected to resubmit a corrected payment request for the
    same invoice (handled by the router), which creates a new pending payment
    and supersedes this one. The invoice itself stays open.
    """
    return await _set_info_requested(db, payment, requested_by=requested_by, reason=reason)


async def approve_request(
    db: AsyncSession,
    payment: Payment,
    *,
    approved_by: Optional[int] = None,
) -> dict:
    """Approve a pending payment and activate the paid period.

    Approval time is authoritative: the paid interval starts there (first
    activation) or at the current period end (renewal). Repeated approvals are
    idempotent.
    """
    if payment.status == PAYMENT_STATUS_SUCCEEDED:
        return {
            "payment": payment,
            "invoice": payment.invoice,
            "subscription": payment.invoice.subscription if payment.invoice else None,
            "already_approved": True,
        }
    if payment.status != PAYMENT_STATUS_PENDING and payment.status != PAYMENT_STATUS_NEEDS_INFO:
        raise PaymentRequestError(
            "Only a pending payment can be approved",
            code="PAYMENT_NOT_PENDING",
            status_code=409,
        )

    invoice = payment.invoice
    if invoice is None:
        raise PaymentRequestError("Invoice not found", code="INVOICE_NOT_FOUND", status_code=404)
    if invoice.status == INVOICE_STATUS_PAID:
        raise PaymentRequestError(
            "This invoice is already paid", code="INVOICE_ALREADY_PAID", status_code=409
        )

    approved_at = now_naive()
    meta = dict(payment.payment_meta or {})
    meta.update({
        "approved_by": approved_by,
        "approved_at": approved_at.isoformat(),
        "approval_note": "manual payment approved; paid period starts at approval time",
    })
    payment.status = PAYMENT_STATUS_SUCCEEDED
    payment.paid_at = approved_at
    payment.payment_meta = meta

    subscription = await subsvc.mark_invoice_paid(
        db,
        invoice,
        gateway_tran_id=payment.gateway_tran_id,
        changed_via="admin_approval",
        approved_at=approved_at,
    )
    await db.refresh(payment)
    await _render_paid_invoice_pdf(db, invoice, payment)
    logger.info(
        "payment approved: payment=%s invoice=%s house=%s by=%s",
        payment.id, invoice.invoice_no, payment.house_id, approved_by,
    )
    return {
        "payment": payment,
        "invoice": invoice,
        "subscription": subscription,
        "already_approved": False,
    }


async def reject_request(
    db: AsyncSession,
    payment: Payment,
    *,
    rejected_by: Optional[int] = None,
    reason: Optional[str] = None,
) -> Payment:
    """Reject a pending payment; the invoice stays open for a new request."""
    if payment.status != PAYMENT_STATUS_PENDING:
        raise PaymentRequestError(
            "Only a pending payment can be rejected",
            code="PAYMENT_NOT_PENDING",
            status_code=409,
        )
    reason = _clean_text(reason, 500)
    meta = dict(payment.payment_meta or {})
    meta.update({
        "rejected_by": rejected_by,
        "rejected_at": now_naive().isoformat(),
        "rejection_reason": reason,
    })
    payment.status = PAYMENT_STATUS_FAILED
    payment.payment_meta = meta
    await db.commit()
    await db.refresh(payment)
    logger.info(
        "payment rejected: payment=%s invoice=%s house=%s by=%s",
        payment.id, payment.invoice_id, payment.house_id, rejected_by,
    )
    return payment


async def get_payment_for_house(
    db: AsyncSession, payment_id: int, house_id: int
) -> Optional[Payment]:
    return (await db.execute(
        select(Payment).where(
            Payment.id == payment_id,
            Payment.house_id == house_id,
            Payment.is_deleted == False,  # noqa: E712
        )
    )).scalar_one_or_none()
