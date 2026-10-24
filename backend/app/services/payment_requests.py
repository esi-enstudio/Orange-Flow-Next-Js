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
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
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

# Magic bytes: the extension alone proves nothing, so the content must match.
PROOF_SIGNATURES = {
    ".jpg": (b"\xff\xd8\xff",),
    ".jpeg": (b"\xff\xd8\xff",),
    ".png": (b"\x89PNG\r\n\x1a\n",),
    ".pdf": (b"%PDF-",),
}

# Channels a tenant may claim. Mirrors PAYMENT_METHOD_TYPES plus "manual".
PAYMENT_CHANNELS = ("cash", "bkash", "nagad", "rocket", "bank", "mobilebanking", "manual")

# Channels where the payer must supply a real transaction reference. Cash is
# recorded against the invoice itself, so it does not need one.
REFERENCE_REQUIRED_CHANNELS = ("bkash", "nagad", "rocket", "bank", "mobilebanking")

# Method families: each needs its own evidence fields.
MFS_CHANNELS = ("bkash", "nagad", "rocket", "mobilebanking")
BANK_CHANNELS = ("bank",)
BD_MOBILE_RE = re.compile(r"^01[3-9]\d{8}$")
PAYMENT_DATE_MAX_AGE_DAYS = 90

# A review decision must explain itself to the tenant (and to the auditor).
REASON_MIN_LENGTH = 3
REASON_MAX_LENGTH = 500

# A reference is a claim (never proof), but it must be usable for reconciliation:
# 4-120 chars, printable, no control characters.
REFERENCE_MIN_LENGTH = 4
REFERENCE_MAX_LENGTH = 120
_REFERENCE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._/\-]{3,119}$")
_WHITESPACE_RE = re.compile(r"\s+")

# Payment statuses that already "own" a transaction reference. A rejected
# (failed) payment does not block a corrected resubmission of the same value.
_REFERENCE_CLAIMING_STATUSES = (
    PAYMENT_STATUS_PENDING,
    PAYMENT_STATUS_NEEDS_INFO,
    PAYMENT_STATUS_SUCCEEDED,
    "refunded",
    "partially_refunded",
)

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


def _normalize_reference(value: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """Return ``(display_reference, dedupe_key)``.

    The dedupe key ignores case and whitespace, so "bk 123" and "BK123" are the
    same real transaction. The display value is what the admin sees.
    """
    cleaned = _clean_text(value, REFERENCE_MAX_LENGTH)
    if not cleaned:
        return None, None
    return cleaned, _WHITESPACE_RE.sub("", cleaned).upper()


def _normalize_mobile(value: Optional[str]) -> Optional[str]:
    """Normalise a BD mobile number to ``01XXXXXXXXX`` (``+880``/``880`` ok)."""
    digits = re.sub(r"\D", "", value or "")
    if digits.startswith("880"):
        digits = "0" + digits[3:]
    return digits or None


def _validate_payment_date(value):
    """A claimed payment date must be a real, recent, non-future date."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        parsed = value.date()
    elif isinstance(value, date):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value)).date()
        except ValueError:
            raise PaymentRequestError(
                "Invalid payment date",
                code="INVALID_PAYMENT_DATE",
                fields={"payment_date": "Use a valid date (YYYY-MM-DD)"},
            )
    today = now_naive().date()
    if parsed > today:
        raise PaymentRequestError(
            "Payment date cannot be in the future",
            code="INVALID_PAYMENT_DATE",
            fields={"payment_date": "Payment date cannot be in the future"},
        )
    if parsed < today - timedelta(days=PAYMENT_DATE_MAX_AGE_DAYS):
        raise PaymentRequestError(
            "Payment date is too old",
            code="INVALID_PAYMENT_DATE",
            fields={
                "payment_date": f"Use a date within the last {PAYMENT_DATE_MAX_AGE_DAYS} days"
            },
        )
    return parsed


def mask_mobile(value: Optional[str]) -> Optional[str]:
    """Mask the middle of a mobile number for non-admin views."""
    if not value:
        return None
    return f"{value[:3]}****{value[-4:]}" if len(value) >= 8 else "****"


def _require_reason(reason: Optional[str]) -> str:
    """A rejection / information request must carry a usable reason."""
    cleaned = _clean_text(reason, REASON_MAX_LENGTH)
    if not cleaned or len(cleaned) < REASON_MIN_LENGTH:
        raise PaymentRequestError(
            "A reason is required for this review action",
            code="REASON_REQUIRED",
            status_code=422,
            fields={"reason": f"Enter at least {REASON_MIN_LENGTH} characters"},
        )
    return cleaned


def _mark_superseded(
    payment: Payment, *, reason: str, superseded_by: Optional[int]
) -> None:
    """Close a request that can no longer fund anything, keeping the trail."""
    meta = dict(payment.payment_meta or {})
    meta["rejection_reason"] = reason
    meta["superseded_by_payment_id"] = superseded_by
    payment.status = PAYMENT_STATUS_FAILED
    payment.payment_meta = meta


async def _reference_owner(db: AsyncSession, normalized: str) -> Optional[Payment]:
    """An existing payment that already claims this transaction reference."""
    return (await db.execute(
        select(Payment)
        .where(
            Payment.transaction_reference_normalized == normalized,
            Payment.status.in_(_REFERENCE_CLAIMING_STATUSES),
            Payment.is_deleted == False,  # noqa: E712
        )
        .order_by(Payment.id.asc())
        .limit(1)
    )).scalar_one_or_none()


def _safe_filename(name: Optional[str]) -> str:
    base = os.path.basename((name or "").replace("\\", "/")).strip()
    base = _CONTROL_CHARS_RE.sub("", base).lstrip(".").strip()
    return (base or "proof")[:180]


def _content_matches_extension(content: bytes, ext: str) -> bool:
    """True when the file's magic bytes match the claimed extension."""
    if ext == ".webp":
        return len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP"
    signatures = PROOF_SIGNATURES.get(ext)
    return bool(signatures) and any(content.startswith(sig) for sig in signatures)


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
    if not _content_matches_extension(content, ext):
        raise PaymentRequestError(
            "The proof file content does not match its type",
            code="INVALID_PROOF_FILE",
            fields={"proof": "Upload a real JPG, PNG, WebP or PDF file"},
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
    sender_number: Optional[str] = None,
    bank_name: Optional[str] = None,
    depositor_name: Optional[str] = None,
    payment_date=None,
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

    # An order is payable only while it is the current open invoice: a newer
    # open invoice replaces it, and a period that ended more than one full
    # billing cycle ago is stale (the tenant has since been re-invoiced).
    if invoice.subscription_id is not None:
        newer = (await db.execute(
            select(Invoice.id).where(
                Invoice.subscription_id == invoice.subscription_id,
                Invoice.id > invoice.id,
                Invoice.status.in_(_PAID_INVOICE_STATUSES),
                Invoice.is_deleted == False,  # noqa: E712
            ).limit(1)
        )).scalar_one_or_none()
        if newer is not None:
            raise PaymentRequestError(
                "A newer invoice replaced this payment order — pay the latest invoice instead",
                code="PAYMENT_ORDER_SUPERSEDED",
                status_code=409,
            )
    if invoice.billing_period_end is not None:
        interval = (
            invoice.subscription.billing_interval if invoice.subscription else "monthly"
        )
        stale_after = subsvc.add_billing_interval(invoice.billing_period_end, interval)
        if now_naive() > stale_after:
            raise PaymentRequestError(
                "This payment order has expired",
                code="PAYMENT_ORDER_EXPIRED",
                status_code=409,
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

    # Method-specific evidence (never require irrelevant fields).
    sender = _normalize_mobile(sender_number)
    bank = _clean_text(bank_name, 120)
    depositor = _clean_text(depositor_name, 120)
    if channel in MFS_CHANNELS:
        if not sender:
            raise PaymentRequestError(
                "The sender mobile number is required for mobile banking",
                code="SENDER_NUMBER_REQUIRED",
                fields={"sender_number": "Enter the number the money was sent from"},
            )
        if not BD_MOBILE_RE.match(sender):
            raise PaymentRequestError(
                "Invalid sender mobile number",
                code="INVALID_SENDER_NUMBER",
                fields={"sender_number": "Use a valid Bangladeshi mobile number (01XXXXXXXXX)"},
            )
    if channel in BANK_CHANNELS:
        if not bank or not depositor:
            raise PaymentRequestError(
                "Bank name and depositor name are required for a bank transfer",
                code="BANK_DETAILS_REQUIRED",
                fields={
                    "bank_name": "Enter the bank name",
                    "depositor_name": "Enter the depositor / account-holder name",
                },
            )
    paid_on = _validate_payment_date(payment_date)

    reference, reference_norm = _normalize_reference(reference)
    if channel in REFERENCE_REQUIRED_CHANNELS and not reference:
        raise PaymentRequestError(
            "A transaction reference is required for this payment method",
            code="REFERENCE_REQUIRED",
            fields={"reference": "Enter the transaction ID / bank reference"},
        )
    if reference is not None and not _REFERENCE_RE.fullmatch(reference):
        raise PaymentRequestError(
            "Invalid transaction reference",
            code="INVALID_REFERENCE",
            fields={
                "reference": (
                    "Use 4-120 letters, digits or . _ / - characters"
                )
            },
        )
    if reference_norm:
        # A reference is only a claim — but one claim must never fund two
        # invoices. Reject the duplicate and keep both submissions auditable.
        owner = await _reference_owner(db, reference_norm)
        if owner is not None:
            raise PaymentRequestError(
                "This transaction reference has already been submitted",
                code="DUPLICATE_TRANSACTION_REFERENCE",
                status_code=409,
                fields={
                    "reference": (
                        "This transaction ID is already attached to another payment. "
                        "Contact support if this is a mistake."
                    )
                },
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
        transaction_reference=reference,
        transaction_reference_normalized=reference_norm,
        paid_at=None,
        payment_meta={
            "method": channel,
            "reference": reference,
            "note": _clean_text(note, 500),
            "sender_number": sender,
            "bank_name": bank,
            "depositor_name": depositor,
            "payment_date": paid_on.isoformat() if paid_on else None,
            "proof_path": proof_path,
            "proof_name": proof_name,
            "submitted_by": submitted_by,
            "submitted_at": now_naive().isoformat(),
        },
    )
    db.add(payment)
    try:
        await db.commit()
    except IntegrityError:
        # The partial unique index caught a concurrent submission of the same
        # reference between our check and the insert.
        await db.rollback()
        raise PaymentRequestError(
            "This transaction reference has already been submitted",
            code="DUPLICATE_TRANSACTION_REFERENCE",
            status_code=409,
            fields={"reference": "This transaction ID is already in use"},
        )
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
    reason = _require_reason(reason)
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


async def _lock_payment_row(db: AsyncSession, payment_id: int) -> None:
    """Serialize review actions on one payment row.

    A bare ``SELECT id ... FOR UPDATE`` avoids locking the eager-loaded joins
    (Postgres refuses ``FOR UPDATE`` on the nullable side of an outer join).
    SQLite ignores the clause, which is fine for the test suite.
    """
    await db.execute(
        select(Payment.id).where(Payment.id == payment_id).with_for_update()
    )


async def _lock_invoice_row(db: AsyncSession, invoice_id: int) -> None:
    await db.execute(
        select(Invoice.id).where(Invoice.id == invoice_id).with_for_update()
    )


async def approve_request(
    db: AsyncSession,
    payment: Payment,
    *,
    approved_by: Optional[int] = None,
    idempotency_key: Optional[str] = None,
    note: Optional[str] = None,
) -> dict:
    """Approve a pending payment and activate the paid period atomically.

    Safety rules (do not relax):
      - the payment row and its invoice are locked before any decision, so two
        concurrent approvals serialize instead of activating twice;
      - the amount is re-verified against the invoice here (never trust the
        submission-time value);
      - a reference that already funded another payment is refused;
      - payment status, invoice status, subscription change log and the paid
        period are committed in one transaction;
      - ``Idempotency-Key`` retries return ``already_approved`` and never
        extend the subscription again.

    Approval time is authoritative: the paid interval starts there (first
    activation) or at the current period end (renewal).
    """
    idempotency_key = _clean_text(idempotency_key, 120)

    # Lock first, then read the authoritative state.
    await _lock_payment_row(db, payment.id)
    await db.refresh(payment)

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

    await _lock_invoice_row(db, invoice.id)
    await db.refresh(invoice)

    if invoice.status == INVOICE_STATUS_PAID:
        # Another payment for this invoice was approved first. This request can
        # no longer fund anything, so close it out of the review queue.
        _mark_superseded(
            payment,
            reason="Invoice was already paid by another approved payment",
            superseded_by=None,
        )
        await db.commit()
        await db.refresh(payment)
        raise PaymentRequestError(
            "This invoice is already paid",
            code="INVOICE_ALREADY_PAID",
            status_code=409,
        )

    expected = _money(invoice.total)
    claimed = _money(payment.amount)
    if abs(claimed - expected) > Decimal("0.01"):
        raise PaymentRequestError(
            f"Payment amount must match the invoice total ({expected} {invoice.currency})",
            code="PAYMENT_AMOUNT_MISMATCH",
            status_code=409,
            fields={
                "amount": (
                    f"Submitted {claimed} {invoice.currency}, invoice total is "
                    f"{expected} {invoice.currency}"
                )
            },
        )

    if payment.transaction_reference_normalized:
        already_used = (await db.execute(
            select(Payment.id).where(
                Payment.transaction_reference_normalized
                == payment.transaction_reference_normalized,
                Payment.id != payment.id,
                Payment.status == PAYMENT_STATUS_SUCCEEDED,
                Payment.is_deleted == False,  # noqa: E712
            )
        )).scalars().first()
        if already_used is not None:
            raise PaymentRequestError(
                "This transaction reference has already been approved on another payment",
                code="DUPLICATE_TRANSACTION_REFERENCE",
                status_code=409,
                fields={"reference": "Reference already approved"},
            )

    approved_at = now_naive()
    meta = dict(payment.payment_meta or {})
    meta.update({
        "approved_by": approved_by,
        "approved_at": approved_at.isoformat(),
        "approval_note": _clean_text(note, 500)
        or "manual payment approved; paid period starts at approval time",
    })
    if idempotency_key:
        meta["approval_idempotency_key"] = idempotency_key
    payment.status = PAYMENT_STATUS_SUCCEEDED
    payment.paid_at = approved_at
    payment.payment_meta = meta

    subscription = await subsvc.mark_invoice_paid(
        db,
        invoice,
        gateway_tran_id=payment.gateway_tran_id,
        changed_via="admin_approval",
        approved_at=approved_at,
        commit=False,
    )
    # Single commit: payment + invoice + subscription + change log together.
    await db.commit()
    await db.refresh(payment)
    await db.refresh(invoice)
    if subscription is not None:
        await db.refresh(subscription)
        await subsvc.sync_house_state(db, subscription.house_id)

    await _render_paid_invoice_pdf(db, invoice, payment)
    logger.info(
        "payment approved: payment=%s invoice=%s house=%s by=%s idempotency_key=%s",
        payment.id, invoice.invoice_no, payment.house_id, approved_by, idempotency_key,
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
    reason = _require_reason(reason)
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
