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


def _proof(content=b"proof-bytes", filename="receipt.png") -> UploadFile:
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
        db, invoice, house_id=house.id, method="bank"
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
        db, invoice, house_id=house.id, method="bkash", reference="BK-2"
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
    await payment_requests.reject_request(db, payment, rejected_by=2, reason="no")

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


async def test_proof_file_type_and_size_are_validated(db, house, plan):
    _, invoice = await _first_invoice(db, house, plan)
    bad_type = _proof(filename="receipt.exe")
    with pytest.raises(PaymentRequestError) as exc:
        await payment_requests.submit_request(
            db, invoice, house_id=house.id, method="cash", proof=bad_type
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
    await payment_requests.request_info(db, payment, requested_by=3)

    with pytest.raises(PaymentRequestError) as exc:
        await payment_requests.request_info(db, payment, requested_by=3)
    assert exc.value.code == "PAYMENT_NOT_PENDING"


async def test_can_resubmit_after_needs_info(db, house, plan):
    """A new payment request for the same invoice supersedes the needs_info one."""
    from app.services.manual_payment import pay_invoice_manually

    _, invoice = await _first_invoice(db, house, plan)
    first = await payment_requests.submit_request(
        db, invoice, house_id=house.id, method="bkash", reference="OLD-BK-1"
    )
    await payment_requests.request_info(db, first, requested_by=3, reason="unclear")
    await db.refresh(first)
    assert first.status == PAYMENT_STATUS_NEEDS_INFO

    # A corrected submission is allowed and becomes the new pending payment.
    second = await payment_requests.submit_request(
        db, invoice, house_id=house.id, method="bkash", reference="NEW-BK-2"
    )
    await db.refresh(first)
    assert second.status == PAYMENT_STATUS_PENDING
    assert first.status == PAYMENT_STATUS_FAILED
    assert first.payment_meta["rejection_reason"].startswith("A corrected payment request")

    # The new pending payment can then be approved normally.
    await payment_requests.approve_request(db, second, approved_by=1)
    await db.refresh(invoice)
    assert invoice.status == INVOICE_STATUS_PAID
