from datetime import timedelta

import pytest
from sqlalchemy import select

from app.models.invoice import Invoice
from app.services.billing_runner import run_billing_cycle
from app.utils.timezone import now_naive

from conftest import make_house, make_invoice, make_plan, make_sub


@pytest.fixture
def recorded_notifications(monkeypatch):
    calls = []

    async def fake_notify(db, house, kind, invoice=None, sub=None):
        calls.append((house.id, kind))
        return {"sent": {}}

    monkeypatch.setattr("app.services.billing_notifications.notify_house", fake_notify)
    return calls


async def test_renewal_invoice_issued_before_period_end(db, house, plan, recorded_notifications):
    end = now_naive() + timedelta(days=2)
    sub = await make_sub(db, house.id, plan, trial_days=0, status="active", auto_renew=True, end=end)
    stats = await run_billing_cycle(db)
    assert stats["renewals_issued"] == 1
    invoices = (await db.execute(select(Invoice))).scalars().all()
    assert len(invoices) == 1
    assert invoices[0].subscription_id == sub.id
    assert invoices[0].description.startswith("Renewal")
    assert recorded_notifications == [(house.id, "invoice_issued")]


async def test_renewal_skipped_when_open_invoice_exists(db, house, plan, recorded_notifications):
    end = now_naive() + timedelta(days=2)
    sub = await make_sub(db, house.id, plan, trial_days=0, status="active", auto_renew=True, end=end)
    invoice = await make_invoice(db, sub, plan)
    invoice.billing_period_start = sub.current_period_end
    invoice.status = "issued"
    await db.commit()
    stats = await run_billing_cycle(db)
    assert stats["renewals_issued"] == 0
    invoices = (await db.execute(select(Invoice))).scalars().all()
    assert len(invoices) == 1


async def test_renewal_skipped_when_no_package(db, house, plan, recorded_notifications):
    end = now_naive() + timedelta(days=2)
    sub = await make_sub(db, house.id, plan, trial_days=0, status="active", auto_renew=True, end=end)
    sub.package_id = None
    await db.commit()
    stats = await run_billing_cycle(db)
    assert stats["renewals_issued"] == 0


async def test_trial_reminder_sent_once(db, house, plan, recorded_notifications):
    sub = await make_sub(db, house.id, plan, status="trialing", trial_days=1, auto_renew=True)
    stats = await run_billing_cycle(db)
    assert stats["trial_reminders"] == 1
    await db.refresh(sub)
    assert sub.trial_reminder_sent_at is not None
    assert recorded_notifications == [(house.id, "trial_ending")]
    # second run must not resend
    stats = await run_billing_cycle(db)
    assert stats["trial_reminders"] == 0


async def test_marked_past_due_after_period_end(db, house, plan, recorded_notifications):
    end = now_naive() - timedelta(days=1)
    sub = await make_sub(db, house.id, plan, trial_days=0, status="active", auto_renew=False, end=end)
    stats = await run_billing_cycle(db)
    assert stats["marked_past_due"] == 1
    await db.refresh(sub)
    assert sub.status == "past_due"
    assert sub.grace_period_end is not None
    assert recorded_notifications == [(house.id, "past_due")]


async def test_paid_invoice_avoids_past_due_and_renews(db, house, plan, recorded_notifications):
    end = now_naive() - timedelta(days=1)
    sub = await make_sub(db, house.id, plan, trial_days=0, status="active", auto_renew=False, end=end)
    old_end = sub.current_period_end
    invoice = await make_invoice(db, sub, plan, status="paid")
    invoice.paid_at = now_naive()
    await db.commit()
    stats = await run_billing_cycle(db)
    assert stats["marked_past_due"] == 0
    await db.refresh(sub)
    assert sub.status == "active"
    assert sub.current_period_end > old_end


async def test_expire_past_grace(db, house, plan, recorded_notifications):
    grace = now_naive() - timedelta(days=1)
    sub = await make_sub(
        db, house.id, plan, trial_days=0, status="past_due", auto_renew=False,
        grace_period_end=grace,
    )
    stats = await run_billing_cycle(db)
    assert stats["expired"] == 1
    await db.refresh(sub)
    assert sub.status == "expired"
    assert recorded_notifications == [(house.id, "expired")]


async def test_resume_paused(db, house, plan, recorded_notifications):
    resume_at = now_naive() - timedelta(hours=1)
    sub = await make_sub(
        db, house.id, plan, trial_days=0, status="paused", auto_renew=False,
        resume_at=resume_at, paused_at=now_naive() - timedelta(days=2),
    )
    stats = await run_billing_cycle(db)
    assert stats["resumed"] == 1
    await db.refresh(sub)
    assert sub.status == "active"
    assert sub.resume_at is None
    assert sub.paused_at is None


async def test_full_cycle_stats_empty_when_nothing_due(db, house, plan, recorded_notifications):
    sub = await make_sub(db, house.id, plan, trial_days=0, status="active", auto_renew=False)
    stats = await run_billing_cycle(db)
    assert stats == {"renewals_issued": 0, "trial_reminders": 0, "marked_past_due": 0, "expired": 0, "resumed": 0}