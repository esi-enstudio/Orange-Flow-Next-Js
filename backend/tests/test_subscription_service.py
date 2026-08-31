from datetime import timedelta
from decimal import Decimal

from app.models.invoice import INVOICE_STATUS_ISSUED, INVOICE_STATUS_PAID
from app.models.subscription_change_log import SubscriptionChangeLog
from app.services.subscription_service import (
    activate,
    cancel,
    create_subscription,
    issue_invoice,
    mark_invoice_paid,
    pause,
    plan_price,
    reactivate,
    renew_period,
    resume,
    set_status,
    upgrade_or_downgrade,
)
from app.utils.timezone import now_naive
from config.settings import settings

from conftest import make_house, make_invoice, make_plan, make_sub


async def _logs(db) -> list:
    from sqlalchemy import select

    rows = (await db.execute(select(SubscriptionChangeLog).order_by(SubscriptionChangeLog.id))).scalars().all()
    return list(rows)


# ----------------------------------------------------------------------
# creation / invoice basics
# ----------------------------------------------------------------------

async def test_create_subscription_trial(db, house, plan):
    sub = await create_subscription(db, house.id, plan, trial=True, auto_renew=True)
    assert sub.status == "trialing"
    assert sub.trial_end is not None
    assert sub.house_id == house.id
    assert sub.package_id == plan.id
    assert sub.current_period_end > sub.current_period_start
    assert sub.auto_renew is True
    logs = await _logs(db)
    assert logs[-1].change_type == "created"
    assert logs[-1].to_status == "trialing"


async def test_create_subscription_no_trial(db, house, plan):
    sub = await create_subscription(db, house.id, plan, trial=False)
    assert sub.status == "active"
    assert sub.trial_end is None


async def test_plan_price(db, plan):
    assert plan_price(plan, "monthly") == Decimal("5000.00")
    assert plan_price(plan, "yearly") == Decimal("50000.00")


async def test_issue_invoice_defaults(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    invoice = await issue_invoice(db, sub, plan)
    assert invoice.status == INVOICE_STATUS_ISSUED
    assert invoice.total == Decimal("5000.00")
    assert invoice.invoice_no.startswith("INV-")
    assert invoice.house_id == house.id
    assert invoice.due_date is not None


async def test_issue_invoice_applies_tax(db, house, plan, monkeypatch):
    monkeypatch.setattr(settings, "BILLING_TAX_PERCENT", 5)
    sub = await make_sub(db, house.id, plan, trial_days=0)
    invoice = await issue_invoice(db, sub, plan)
    assert invoice.amount == Decimal("5000.00")
    assert invoice.tax == Decimal("250.00")
    assert invoice.total == Decimal("5250.00")


# ----------------------------------------------------------------------
# plan changes
# ----------------------------------------------------------------------

async def test_upgrade_creates_proration(db, house, plan):
    cheap = await make_plan(db, name="Cheap", slug="cheap", price_monthly=Decimal("1000.00"))
    expensive = await make_plan(db, name="Expensive", slug="expensive", price_monthly=Decimal("10000.00"))
    sub = await make_sub(db, house.id, cheap, trial_days=0)
    result = await upgrade_or_downgrade(db, sub, expensive)
    assert result["applied"] is True
    assert result["is_upgrade"] is True
    assert result["prorated_invoice"] is not None
    assert sub.package_id == expensive.id
    assert sub.status == "active"


async def test_downgrade_no_immediate_invoice(db, house, plan):
    cheap = await make_plan(db, name="Cheap", slug="cheap2", price_monthly=Decimal("1000.00"))
    expensive = await make_plan(db, name="Expensive", slug="expensive2", price_monthly=Decimal("10000.00"))
    sub = await make_sub(db, house.id, expensive, trial_days=0)
    result = await upgrade_or_downgrade(db, sub, cheap)
    assert result["applied"] is True
    assert result["is_upgrade"] is False
    assert result["prorated_invoice"] is None
    assert sub.package_id == cheap.id


async def test_change_to_same_plan(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    result = await upgrade_or_downgrade(db, sub, plan)
    assert result["applied"] is False


# ----------------------------------------------------------------------
# lifecycle transitions
# ----------------------------------------------------------------------

async def test_cancel_at_period_end(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    await cancel(db, sub, at_period_end=True)
    assert sub.cancel_at_period_end is True
    assert sub.auto_renew is False
    assert sub.status == "active"


async def test_cancel_immediate(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    await cancel(db, sub, at_period_end=False)
    assert sub.status == "cancelled"
    assert sub.cancelled_at is not None
    assert sub.cancel_at_period_end is False


async def test_reactivate(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0, status="cancelled")
    await reactivate(db, sub)
    assert sub.status == "active"
    assert sub.cancelled_at is None
    assert sub.cancel_at_period_end is False
    assert sub.current_period_start is not None
    logs = await _logs(db)
    assert logs[-1].change_type == "reactivated"


async def test_pause_and_resume(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    await pause(db, sub, resume_days=10)
    assert sub.status == "paused"
    assert sub.resume_at is not None
    await resume(db, sub)
    assert sub.status == "active"
    assert sub.paused_at is None
    assert sub.resume_at is None


async def test_set_status(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    await set_status(db, sub, "cancelled", reason="manual")
    assert sub.status == "cancelled"
    logs = await _logs(db)
    assert logs[-1].change_type in ("status_changed", "cancelled")


async def test_activate_from_trialing(db, house, plan):
    sub = await make_sub(db, house.id, plan, status="trialing", trial_days=7)
    await activate(db, sub)
    assert sub.status == "active"
    assert sub.grace_period_end is None
    logs = await _logs(db)
    assert logs[-1].change_type == "activated"


async def test_renew_period_rolls_forward(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0, status="past_due")
    old_end = sub.current_period_end
    await renew_period(db, sub)
    assert sub.current_period_end > old_end
    assert sub.current_period_start == old_end
    assert sub.status == "active"
    assert sub.grace_period_end is None
    assert sub.cancel_at_period_end is False


# ----------------------------------------------------------------------
# mark_invoice_paid
# ----------------------------------------------------------------------

async def test_mark_invoice_paid_activates(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0, status="trialing")
    invoice = await make_invoice(db, sub, plan)
    assert invoice.status == INVOICE_STATUS_ISSUED
    result = await mark_invoice_paid(db, invoice, gateway_tran_id="TRAN-PAID-1", changed_via="webhook")
    assert result.id == sub.id
    assert invoice.status == INVOICE_STATUS_PAID
    assert invoice.paid_at is not None
    assert invoice.gateway_tran_id == "TRAN-PAID-1"
    sub = result
    assert sub.status == "active"


async def test_mark_invoice_paid_renews(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    old_end = sub.current_period_end
    invoice = await make_invoice(db, sub, plan)
    invoice.billing_period_start = sub.current_period_end
    await db.commit()
    result = await mark_invoice_paid(db, invoice, gateway_tran_id="TRAN-RENEW-1", changed_via="webhook")
    assert result.status == "active"
    assert result.current_period_end > old_end
    assert result.current_period_start == old_end


async def test_mark_invoice_paid_idempotent(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    invoice = await make_invoice(db, sub, plan)
    first = await mark_invoice_paid(db, invoice, gateway_tran_id="TRAN-1", changed_via="webhook")
    assert invoice.status == INVOICE_STATUS_PAID
    logs_after_first = len(await _logs(db))
    second = await mark_invoice_paid(db, invoice, gateway_tran_id="TRAN-1", changed_via="webhook")
    assert second.id == first.id
    assert len(await _logs(db)) == logs_after_first


async def test_mark_invoice_paid_no_sub(db, house, plan):
    from app.services.subscription_service import next_invoice_no
    from app.models.invoice import Invoice

    invoice = Invoice(
        house_id=house.id,
        invoice_no=next_invoice_no(),
        amount=Decimal("100.00"),
        tax=Decimal("0.00"),
        total=Decimal("100.00"),
        currency="BDT",
        status=INVOICE_STATUS_ISSUED,
    )
    db.add(invoice)
    await db.commit()
    await db.refresh(invoice)
    result = await mark_invoice_paid(db, invoice)
    assert invoice.status == INVOICE_STATUS_PAID
    assert result is None