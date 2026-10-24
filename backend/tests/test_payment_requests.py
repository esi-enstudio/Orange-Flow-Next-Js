"""Manual payment requests: free tier -> tenant submits -> admin approves.

Rules under test:
  - a plan starts on its free tier only (no free paid month/year),
  - submitting a payment activates nothing,
  - approval starts a first paid period at the approval time (monthly = 1
    month, yearly = 1 year),
  - an early renewal extends the current expiry instead of resetting it,
  - rejection leaves the invoice open for a new request.
"""
import io
from datetime import timedelta
from decimal import Decimal

import pytest
from fastapi import UploadFile

from app.models.invoice import INVOICE_STATUS_ISSUED, INVOICE_STATUS_PAID
from app.models.payment import PAYMENT_STATUS_FAILED, PAYMENT_STATUS_PENDING, PAYMENT_STATUS_SUCCEEDED, PAYMENT_STATUS_NEEDS_INFO
from app.services import payment_requests
from app.services.payment_requests import PaymentRequestError
from app.services.subscription_service import (
    _add_interval,
    create_subscription,
    issue_invoice,
    next_billing_period_start,
)
from app.utils.timezone import now_naive

from conftest import make_sub


@pytest.fixture(autouse=True)
def _proof_dir(tmp_path, monkeypatch):
    """Keep uploaded proofs inside the test run, never in the repo."""
    monkeypatch.setattr(payment_requests, "PROOF_ROOT", str(tmp_path / "proofs"))


async def _first_invoice(db, house, plan, interval="monthly", trial_days=7):
    sub = await create_subscription(
        db, house.id, plan, billing_interval=interval, trial=True
    )
    invoice = await issue_invoice(
        db, sub, plan,
        billing_interval=interval,
        period_start=next_billing_period_start(sub),
    )
    return sub, invoice


# A real PNG header, so the magic-byte check accepts the fixture file.
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


def _proof(content=PNG_BYTES, filename="receipt.png") -> UploadFile:
    return UploadFile(filename=filename, file=io.BytesIO(content))


async def test_plan_starts_on_free_tier_and_invoice_is_for_paid_period(db, house, plan):
    plan.trial_days = 7
    await db.commit()
    sub, invoice = await _first_invoice(db, house, plan)

    assert sub.status == "trialing"
    assert sub.current_period_end == sub.trial_end
    assert invoice.status == INVOICE_STATUS_ISSUED
    assert invoice.billing_period_start == sub.trial_end  # first paid period


async def test_submit_request_creates_pending_payment_without_activating(db, house, plan):
    sub, invoice = await _first_invoice(db, house, plan)

    payment = await payment_requests.submit_request(
        db, invoice,
        house_id=house.id,
        method="bkash",
        reference="BK-9001",
        sender_number="01712345678",
        note="sent from manager number",
        proof=_proof(),
        submitted_by=11,
    )

    assert payment.status == PAYMENT_STATUS_PENDING
    assert payment.paid_at is None
    assert payment.amount == invoice.total
    assert payment.payment_meta["reference"] == "BK-9001"
    assert payment.payment_meta["proof_name"] == "receipt.png"
    assert payment_requests.proof_disk_path(payment)
    await db.refresh(sub)
    assert sub.status == "trialing"  # nothing activated before approval


async def test_duplicate_pending_request_is_rejected(db, house, plan):
    _, invoice = await _first_invoice(db, house, plan)
    await payment_requests.submit_request(db, invoice, house_id=house.id, method="cash")

    with pytest.raises(PaymentRequestError) as exc:
        await payment_requests.submit_request(db, invoice, house_id=house.id, method="cash")
    assert exc.value.code == "PAYMENT_ALREADY_PENDING"
    assert exc.value.status_code == 409


async def test_amount_must_match_invoice(db, house, plan):
    _, invoice = await _first_invoice(db, house, plan)
    with pytest.raises(PaymentRequestError) as exc:
        await payment_requests.submit_request(
            db, invoice, house_id=house.id, method="bank", amount=1
        )
    assert exc.value.code == "PAYMENT_AMOUNT_MISMATCH"


async def test_approval_starts_monthly_period_at_approval_time(db, house, plan):
    sub, invoice = await _first_invoice(db, house, plan)
    payment = await payment_requests.submit_request(
        db, invoice, house_id=house.id, method="cash"
    )

    before = now_naive()
    result = await payment_requests.approve_request(db, payment, approved_by=1)
    after = now_naive()

    assert result["already_approved"] is False
    await db.refresh(payment)
    await db.refresh(invoice)
    await db.refresh(sub)

    assert payment.status == PAYMENT_STATUS_SUCCEEDED
    assert payment.paid_at is not None
    assert invoice.status == INVOICE_STATUS_PAID
    assert sub.status == "active"
    assert before - timedelta(seconds=5) <= sub.current_period_start <= after + timedelta(seconds=5)
    assert sub.current_period_end == _add_interval(sub.current_period_start, "monthly")
    # Invoice/PDF periods follow the purchased period (not the free tier).
    assert invoice.billing_period_start == sub.current_period_start
    assert invoice.billing_period_end == sub.current_period_end
    assert invoice.pdf_path


async def test_approval_starts_yearly_period(db, house, plan):
    plan.price_yearly = 50000
    await db.commit()
    sub, invoice = await _first_invoice(db, house, plan, interval="yearly")

    payment = await payment_requests.submit_request(
        db, invoice, house_id=house.id, method="bank", reference="BANK-YEAR-1",
        bank_name="Dutch-Bangla Bank", depositor_name="Test House",
    )
    await payment_requests.approve_request(db, payment, approved_by=1)
    await db.refresh(sub)

    assert sub.billing_interval == "yearly"
    assert sub.current_period_end == _add_interval(sub.current_period_start, "yearly")
    assert sub.current_period_end.year == sub.current_period_start.year + 1


async def test_early_renewal_extends_current_expiry(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0, status="active")
    # A prior paid invoice makes this a renewal, not a first activation.
    prior = await issue_invoice(db, sub, plan)
    prior.status = INVOICE_STATUS_PAID
    await db.commit()

    old_end = sub.current_period_end
    renewal = await issue_invoice(db, sub, plan, period_start=next_billing_period_start(sub))
    payment = await payment_requests.submit_request(
        db, renewal, house_id=house.id, method="cash"
    )
    await payment_requests.approve_request(db, payment, approved_by=1)
    await db.refresh(sub)

    assert sub.status == "active"
    assert sub.current_period_start == old_end
    assert sub.current_period_end == _add_interval(old_end, sub.billing_interval)


async def test_rejection_keeps_invoice_open(db, house, plan):
    sub, invoice = await _first_invoice(db, house, plan)
    payment = await payment_requests.submit_request(
        db, invoice, house_id=house.id, method="cash"
    )

    rejected = await payment_requests.reject_request(
        db, payment, rejected_by=2, reason="Reference not found"
    )

    assert rejected.status == PAYMENT_STATUS_FAILED
    assert rejected.payment_meta["rejection_reason"] == "Reference not found"
    await db.refresh(invoice)
    await db.refresh(sub)
    assert invoice.status == INVOICE_STATUS_ISSUED
    assert sub.status == "trialing"

    # A corrected request can be submitted for the same invoice.
    again = await payment_requests.submit_request(
        db, invoice, house_id=house.id, method="bkash", reference="BK-2",
        sender_number="01712345678",
    )
    assert again.status == PAYMENT_STATUS_PENDING


async def test_direct_admin_payment_supersedes_a_pending_request(db, house, plan):
    """Recording the money directly must not leave an approvable duplicate."""
    from app.services.manual_payment import pay_invoice_manually

    _, invoice = await _first_invoice(db, house, plan)
    pending = await payment_requests.submit_request(
        db, invoice, house_id=house.id, method="cash"
    )

    await pay_invoice_manually(db, invoice, recorded_by=1)

    await db.refresh(pending)
    assert pending.status == PAYMENT_STATUS_FAILED
    assert pending.payment_meta["rejection_reason"].startswith("Invoice was paid directly")


async def test_approving_a_rejected_payment_is_refused(db, house, plan):
    _, invoice = await _first_invoice(db, house, plan)
    payment = await payment_requests.submit_request(
        db, invoice, house_id=house.id, method="cash"
    )
    await payment_requests.reject_request(db, payment, rejected_by=2, reason="no match")

    with pytest.raises(PaymentRequestError) as exc:
        await payment_requests.approve_request(db, payment, approved_by=1)
    assert exc.value.code == "PAYMENT_NOT_PENDING"


async def test_approval_is_idempotent(db, house, plan):
    sub, invoice = await _first_invoice(db, house, plan)
    payment = await payment_requests.submit_request(
        db, invoice, house_id=house.id, method="cash"
    )
    await payment_requests.approve_request(db, payment, approved_by=1)
    await db.refresh(sub)
    end_after_first = sub.current_period_end

    second = await payment_requests.approve_request(db, payment, approved_by=1)
    await db.refresh(sub)

    assert second["already_approved"] is True
    assert sub.current_period_end == end_after_first


async def test_duplicate_transaction_reference_is_rejected(db, house, plan):
    """The same real transaction may never back two invoices."""
    _, first_invoice = await _first_invoice(db, house, plan)
    await payment_requests.submit_request(
        db, first_invoice, house_id=house.id, method="bkash", reference="BK 12345",
        sender_number="01712345678",
    )

    _, second_invoice = await _first_invoice(db, house, plan)
    with pytest.raises(PaymentRequestError) as exc:
        # Case/whitespace-insensitive: "bk12345" is the same reference.
        await payment_requests.submit_request(
            db, second_invoice, house_id=house.id, method="bkash", reference="bk12345",
            sender_number="01712345678",
        )

    assert exc.value.code == "DUPLICATE_TRANSACTION_REFERENCE"
    assert exc.value.status_code == 409
    assert "reference" in (exc.value.fields or {})


async def test_reference_is_required_for_mobile_banking_and_bank(db, house, plan):
    _, invoice = await _first_invoice(db, house, plan)
    for channel in ("bkash", "nagad", "rocket", "bank", "mobilebanking"):
        with pytest.raises(PaymentRequestError) as exc:
            await payment_requests.submit_request(
                db, invoice, house_id=house.id, method=channel,
                sender_number="01712345678",
                bank_name="Dutch-Bangla Bank",
                depositor_name="Test House",
            )
        assert exc.value.code == "REFERENCE_REQUIRED"


async def test_mfs_requires_a_valid_sender_number(db, house, plan):
    _, invoice = await _first_invoice(db, house, plan)

    with pytest.raises(PaymentRequestError) as exc:
        await payment_requests.submit_request(
            db, invoice, house_id=house.id, method="bkash", reference="BK-7788"
        )
    assert exc.value.code == "SENDER_NUMBER_REQUIRED"

    with pytest.raises(PaymentRequestError) as exc:
        await payment_requests.submit_request(
            db, invoice, house_id=house.id, method="bkash", reference="BK-7788",
            sender_number="0171234",
        )
    assert exc.value.code == "INVALID_SENDER_NUMBER"

    # +880 prefix and stray spaces are normalised to 01XXXXXXXXX.
    payment = await payment_requests.submit_request(
        db, invoice, house_id=house.id, method="bkash", reference="BK-7788",
        sender_number="+880 1712345678",
    )
    assert payment.payment_meta["sender_number"] == "01712345678"


async def test_bank_requires_bank_and_depositor_details(db, house, plan):
    _, invoice = await _first_invoice(db, house, plan)
    with pytest.raises(PaymentRequestError) as exc:
        await payment_requests.submit_request(
            db, invoice, house_id=house.id, method="bank", reference="BANK-77"
        )
    assert exc.value.code == "BANK_DETAILS_REQUIRED"
    assert set((exc.value.fields or {}).keys()) == {"bank_name", "depositor_name"}


async def test_payment_date_cannot_be_in_the_future(db, house, plan):
    _, invoice = await _first_invoice(db, house, plan)
    with pytest.raises(PaymentRequestError) as exc:
        await payment_requests.submit_request(
            db, invoice, house_id=house.id, method="cash",
            payment_date=(now_naive() + timedelta(days=1)).date(),
        )
    assert exc.value.code == "INVALID_PAYMENT_DATE"


async def test_stale_payment_order_is_rejected(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0, status="active")
    start = now_naive() - timedelta(days=200)
    invoice = await issue_invoice(
        db, sub, plan, period_start=start, period_end=start + timedelta(days=30)
    )

    with pytest.raises(PaymentRequestError) as exc:
        await payment_requests.submit_request(
            db, invoice, house_id=house.id, method="cash"
        )
    assert exc.value.code == "PAYMENT_ORDER_EXPIRED"
    assert exc.value.status_code == 409


async def test_superseded_payment_order_is_rejected(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0, status="active")
    old_invoice = await issue_invoice(db, sub, plan)
    # A newer open invoice for the same subscription replaces the old order.
    await issue_invoice(
        db, sub, plan, period_start=next_billing_period_start(sub)
    )

    with pytest.raises(PaymentRequestError) as exc:
        await payment_requests.submit_request(
            db, old_invoice, house_id=house.id, method="cash"
        )
    assert exc.value.code == "PAYMENT_ORDER_SUPERSEDED"
    assert exc.value.status_code == 409


async def test_cash_submission_needs_no_reference(db, house, plan):
    _, invoice = await _first_invoice(db, house, plan)
    payment = await payment_requests.submit_request(
        db, invoice, house_id=house.id, method="cash"
    )
    assert payment.status == PAYMENT_STATUS_PENDING
    assert payment.transaction_reference_normalized is None


async def test_rejected_reference_can_be_resubmitted(db, house, plan):
    """A rejected claim releases the reference for a corrected submission."""
    _, invoice = await _first_invoice(db, house, plan)
    first = await payment_requests.submit_request(
        db, invoice, house_id=house.id, method="bkash", reference="BK-5555",
        sender_number="01712345678",
    )
    await payment_requests.reject_request(db, first, rejected_by=2, reason="not found")

    again = await payment_requests.submit_request(
        db, invoice, house_id=house.id, method="bkash", reference="bk-5555",
        sender_number="01712345678",
    )
    assert again.status == PAYMENT_STATUS_PENDING
    assert again.transaction_reference_normalized == "BK-5555"


async def test_approval_reverifies_amount_against_invoice(db, house, plan):
    """A submission-time amount is not trusted at approval time."""
    _, invoice = await _first_invoice(db, house, plan)
    payment = await payment_requests.submit_request(
        db, invoice, house_id=house.id, method="cash"
    )
    payment.amount = Decimal(invoice.total) - Decimal("500.00")
    await db.commit()

    with pytest.raises(PaymentRequestError) as exc:
        await payment_requests.approve_request(db, payment, approved_by=1)
    assert exc.value.code == "PAYMENT_AMOUNT_MISMATCH"
    await db.refresh(invoice)
    assert invoice.status == INVOICE_STATUS_ISSUED


async def test_second_payment_for_a_paid_invoice_is_closed_and_refused(db, house, plan):
    """A concurrent second request cannot activate the plan twice."""
    from app.models.payment import Payment as PaymentModel

    sub, invoice = await _first_invoice(db, house, plan)
    first = await payment_requests.submit_request(
        db, invoice, house_id=house.id, method="cash"
    )
    await payment_requests.approve_request(db, first, approved_by=1)
    await db.refresh(sub)
    end_after_first = sub.current_period_end

    # Simulates a row that was already pending when the invoice got paid.
    duplicate = PaymentModel(
        house_id=house.id,
        invoice_id=invoice.id,
        subscription_id=invoice.subscription_id,
        amount=invoice.total,
        currency=invoice.currency,
        status=PAYMENT_STATUS_PENDING,
        gateway="cash",
        gateway_tran_id="REQ-duplicate-row-1",
    )
    db.add(duplicate)
    await db.commit()
    await db.refresh(duplicate)

    with pytest.raises(PaymentRequestError) as exc:
        await payment_requests.approve_request(db, duplicate, approved_by=1)
    assert exc.value.code == "INVOICE_ALREADY_PAID"

    await db.refresh(duplicate)
    await db.refresh(sub)
    assert duplicate.status == PAYMENT_STATUS_FAILED
    assert duplicate.payment_meta["rejection_reason"].startswith("Invoice was already paid")
    assert sub.current_period_end == end_after_first


async def test_approval_idempotency_key_retry_never_extends_twice(db, house, plan):
    sub, invoice = await _first_invoice(db, house, plan)
    payment = await payment_requests.submit_request(
        db, invoice, house_id=house.id, method="cash"
    )

    first = await payment_requests.approve_request(
        db, payment, approved_by=1, idempotency_key="approve-key-1"
    )
    await db.refresh(sub)
    end_after_first = sub.current_period_end

    second = await payment_requests.approve_request(
        db, payment, approved_by=1, idempotency_key="approve-key-1"
    )
    await db.refresh(sub)

    assert first["already_approved"] is False
    assert second["already_approved"] is True
    assert sub.current_period_end == end_after_first
    await db.refresh(payment)
    assert payment.payment_meta["approval_idempotency_key"] == "approve-key-1"


async def test_proof_file_type_and_size_are_validated(db, house, plan):
    _, invoice = await _first_invoice(db, house, plan)
    bad_type = _proof(filename="receipt.exe")
    with pytest.raises(PaymentRequestError) as exc:
        await payment_requests.submit_request(
            db, invoice, house_id=house.id, method="cash", proof=bad_type
        )
    assert exc.value.code == "INVALID_PROOF_FILE"


async def test_proof_content_must_match_the_extension(db, house, plan):
    """A .png upload whose bytes are not a PNG is refused (no polyglots)."""
    _, invoice = await _first_invoice(db, house, plan)
    with pytest.raises(PaymentRequestError) as exc:
        await payment_requests.submit_request(
            db, invoice, house_id=house.id, method="cash",
            proof=_proof(content=b"%PDF-1.4 not really a png"),
        )
    assert exc.value.code == "INVALID_PROOF_FILE"


async def test_request_info_moves_pending_to_needs_info(db, house, plan):
    _, invoice = await _first_invoice(db, house, plan)
    payment = await payment_requests.submit_request(
        db, invoice, house_id=house.id, method="cash"
    )

    flagged = await payment_requests.request_info(
        db, payment, requested_by=3, reason="Receipt is blurry"
    )

    assert flagged.status == PAYMENT_STATUS_NEEDS_INFO
    assert flagged.payment_meta["info_requested_by"] == 3
    assert flagged.payment_meta["info_request_reason"] == "Receipt is blurry"
    # Invoice must stay open for a resubmit.
    await db.refresh(invoice)
    assert invoice.status == INVOICE_STATUS_ISSUED


async def test_request_info_cannot_re_flag_non_pending(db, house, plan):
    _, invoice = await _first_invoice(db, house, plan)
    payment = await payment_requests.submit_request(
        db, invoice, house_id=house.id, method="cash"
    )
    await payment_requests.request_info(db, payment, requested_by=3, reason="blurry")

    with pytest.raises(PaymentRequestError) as exc:
        await payment_requests.request_info(db, payment, requested_by=3, reason="blurry")
    assert exc.value.code == "PAYMENT_NOT_PENDING"


async def test_reject_and_request_info_require_a_reason(db, house, plan):
    _, first_invoice = await _first_invoice(db, house, plan)
    payment = await payment_requests.submit_request(
        db, first_invoice, house_id=house.id, method="cash"
    )

    for action in (payment_requests.reject_request, payment_requests.request_info):
        with pytest.raises(PaymentRequestError) as exc:
            await action(db, payment, reason="  ")
        assert exc.value.code == "REASON_REQUIRED"
        assert exc.value.status_code == 422
        assert "reason" in (exc.value.fields or {})

    # The payment is untouched by the failed attempts.
    await db.refresh(payment)
    assert payment.status == PAYMENT_STATUS_PENDING


async def test_can_resubmit_after_needs_info(db, house, plan):
    """A new payment request for the same invoice supersedes the needs_info one."""
    from app.services.manual_payment import pay_invoice_manually

    _, invoice = await _first_invoice(db, house, plan)
    first = await payment_requests.submit_request(
        db, invoice, house_id=house.id, method="bkash", reference="OLD-BK-1",
        sender_number="01712345678",
    )
    await payment_requests.request_info(db, first, requested_by=3, reason="unclear")
    await db.refresh(first)
    assert first.status == PAYMENT_STATUS_NEEDS_INFO

    # A corrected submission is allowed and becomes the new pending payment.
    second = await payment_requests.submit_request(
        db, invoice, house_id=house.id, method="bkash", reference="NEW-BK-2",
        sender_number="01712345678",
    )
    await db.refresh(first)
    assert second.status == PAYMENT_STATUS_PENDING
    assert first.status == PAYMENT_STATUS_FAILED
    assert first.payment_meta["rejection_reason"].startswith("A corrected payment request")

    # The new pending payment can then be approved normally.
    await payment_requests.approve_request(db, second, approved_by=1)
    await db.refresh(invoice)
    assert invoice.status == INVOICE_STATUS_PAID
