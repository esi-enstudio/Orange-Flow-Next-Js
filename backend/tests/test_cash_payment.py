"""Cash / offline billing must work with no payment gateway configured.

Covers the authoritative manual-payment service: open-invoice reuse,
next-period issuance, amount validation, idempotency and lapsed renewals.
"""

import os
from datetime import timedelta
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.models.invoice import Invoice, INVOICE_STATUS_PAID
from app.models.payment import Payment, PAYMENT_STATUS_SUCCEEDED
from app.models.subscription import HouseSubscription
from app.services import manual_payment
from app.services.manual_payment import ManualPaymentError, record_cash_payment
from app.utils.timezone import now_naive

from conftest import make_invoice, make_sub


async def _count(db, model) -> int:
    return (await db.execute(select(func.count(model.id)))).scalar_one()


async def test_cash_payment_pays_open_invoice(db, house, plan, sub):
    invoice = await make_invoice(db, sub, plan)

    result = await record_cash_payment(db, sub, recorded_by=7)

    assert result["already_paid"] is False
    assert result["invoice"].id == invoice.id
    assert result["invoice"].status == INVOICE_STATUS_PAID
    payment = result["payment"]
    assert payment.gateway == "cash"
    assert payment.status == PAYMENT_STATUS_SUCCEEDED
    assert payment.amount == invoice.total
    assert payment.gateway_tran_id == f"CASH-{invoice.invoice_no}"
    assert await _count(db, Payment) == 1

    # A completed manual payment produces the paid invoice PDF.
    await db.refresh(invoice)
    assert invoice.pdf_path
    assert invoice.pdf_generated_at is not None
    assert os.path.exists(invoice.pdf_path)


async def test_cash_payment_activates_trialing_subscription(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=7, status="trialing")
    await make_invoice(db, sub, plan)

    await record_cash_payment(db, sub)

    await db.refresh(sub)
    assert sub.status == "active"


async def test_cash_payment_issues_next_period_invoice(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    old_end = sub.current_period_end

    result = await record_cash_payment(db, sub)

    invoice = result["invoice"]
    assert invoice.billing_period_start == old_end
    assert invoice.billing_period_end > old_end
    assert invoice.status == INVOICE_STATUS_PAID
    await db.refresh(sub)
    assert sub.current_period_start == old_end
    assert sub.current_period_end == invoice.billing_period_end
    assert sub.status == "active"


async def test_cash_payment_amount_mismatch_is_rejected(db, house, plan, sub):
    invoice = await make_invoice(db, sub, plan)

    with pytest.raises(ManualPaymentError) as exc:
        await record_cash_payment(db, sub, amount=100)

    assert exc.value.code == "PAYMENT_AMOUNT_MISMATCH"
    assert exc.value.status_code == 400
    await db.refresh(invoice)
    assert invoice.status != INVOICE_STATUS_PAID
    assert await _count(db, Payment) == 0


async def test_cash_payment_accepts_explicit_matching_amount(db, house, plan, sub):
    invoice = await make_invoice(db, sub, plan)

    result = await record_cash_payment(db, sub, amount=float(invoice.total))

    assert result["payment"].amount == Decimal(str(invoice.total)).quantize(Decimal("0.01"))


async def test_cash_payment_idempotency_key_prevents_second_period(db, house, plan, sub):
    first = await record_cash_payment(db, sub, idempotency_key="modal-abc-123")
    second = await record_cash_payment(db, sub, idempotency_key="modal-abc-123")

    assert second["already_paid"] is True
    assert second["payment"].id == first["payment"].id
    assert await _count(db, Payment) == 1
    assert await _count(db, Invoice) == 1


async def test_pay_invoice_manually_is_idempotent(db, house, plan, sub):
    invoice = await make_invoice(db, sub, plan)

    first = await manual_payment.pay_invoice_manually(db, invoice)
    second = await manual_payment.pay_invoice_manually(db, invoice)

    assert second["already_paid"] is True
    assert second["payment"].id == first["payment"].id
    assert await _count(db, Payment) == 1


async def test_cash_payment_lapsed_subscription_starts_now(db, house, plan):
    end = now_naive() - timedelta(days=40)
    start = end - timedelta(days=30)
    sub = await make_sub(
        db, house.id, plan, trial_days=0, status="expired",
        start=start, end=end,
    )
    before = now_naive()

    result = await record_cash_payment(db, sub)

    assert result["invoice"].billing_period_start >= before - timedelta(seconds=5)
    await db.refresh(sub)
    assert sub.status == "active"
    assert sub.current_period_end > before
    assert sub.current_period_end > sub.current_period_start


async def test_cash_payment_rejects_package_less_subscription(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    sub.package_id = None
    await db.commit()
    db.expunge_all()
    sub = (await db.execute(select(HouseSubscription))).scalar_one()

    with pytest.raises(ManualPaymentError) as exc:
        await record_cash_payment(db, sub)

    assert exc.value.code == "SUBSCRIPTION_NO_PLAN"
    assert exc.value.status_code == 409


async def test_cash_payment_rejects_future_paid_at(db, house, plan, sub):
    await make_invoice(db, sub, plan)

    with pytest.raises(ManualPaymentError) as exc:
        await record_cash_payment(db, sub, paid_at=now_naive() + timedelta(days=2))

    assert exc.value.code == "INVALID_PAID_AT"
    assert exc.value.fields and "paid_at" in exc.value.fields
