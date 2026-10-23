from datetime import timedelta

import pytest
from sqlalchemy import select

from app.models.house import House
from app.models.invoice import Invoice
from app.models.subscription import HouseSubscription
from app.services.billing_notifications import build_message
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


async def test_renewal_issued_when_package_is_not_cached(db, house, plan, recorded_notifications):
    """The scheduler runs in a fresh session, so `sub.package` must be eager-loaded.

    Regression: a lazy load on that attribute raised MissingGreenlet
    ("greenlet_spawn has not been called") and aborted the whole billing cycle.
    """
    end = now_naive() + timedelta(days=2)
    await make_sub(db, house.id, plan, trial_days=0, status="active", auto_renew=True, end=end)
    # Drop the identity map so the package is not already resolved in-session,
    # mirroring the scheduler's fresh session.
    db.expunge_all()
    stats = await run_billing_cycle(db)
    assert stats["renewals_issued"] == 1
    assert recorded_notifications == [(house.id, "invoice_issued")]


async def test_billing_message_reads_package_from_fresh_session(db, house, plan):
    """Billing notifications build the plan name from `sub.package`."""
    await make_sub(db, house.id, plan, status="trialing", trial_days=3)
    db.expunge_all()
    fresh_house = (await db.execute(select(House))).scalar_one()
    fresh_sub = (await db.execute(select(HouseSubscription))).scalar_one()
    subject, text = build_message("trial_ending", fresh_house, sub=fresh_sub)
    assert "Basic" in text


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


async def test_renewal_invoice_is_not_duplicated_across_cycles(db, house, plan, recorded_notifications):
    """The renewal invoice must cover the *next* period so the open-invoice
    guard recognises it on the next scheduler run (previously it was issued
    with the current period and re-created every 5 minutes)."""
    end = now_naive() + timedelta(days=2)
    sub = await make_sub(db, house.id, plan, trial_days=0, status="active", auto_renew=True, end=end)

    await run_billing_cycle(db)
    await run_billing_cycle(db)

    invoices = (await db.execute(select(Invoice))).scalars().all()
    assert len(invoices) == 1
    assert invoices[0].billing_period_start == sub.current_period_end
    assert invoices[0].billing_period_end > invoices[0].billing_period_start
    assert recorded_notifications == [(house.id, "invoice_issued")]


async def test_renewal_skipped_when_no_package(db, house, plan, recorded_notifications):
    end = now_naive() + timedelta(days=2)
    sub = await make_sub(db, house.id, plan, trial_days=0, status="active", auto_renew=True, end=end)
    sub.package_id = None
    await db.commit()
    # `package` is eager-loaded now, so drop the identity map to re-read it
    # from the FK value (otherwise the stale, previously loaded plan is reused).
    db.expunge_all()
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


async def test_paid_next_period_invoice_rolls_forward(db, house, plan, recorded_notifications):
    """Legacy safety net: a paid next-period invoice that never rolled the cycle.

    ``mark_invoice_paid`` now rolls the period itself, but historical/manual
    rows may not have. The runner may only roll forward for an invoice whose
    period starts at/after the current period end.
    """
    end = now_naive() - timedelta(days=1)
    start = end - timedelta(days=30)
    sub = await make_sub(
        db, house.id, plan, trial_days=0, status="active", auto_renew=False,
        start=start, end=end,
    )
    old_end = sub.current_period_end
    invoice = await make_invoice(db, sub, plan, status="paid")
    invoice.billing_period_start = old_end
    invoice.billing_period_end = old_end + timedelta(days=30)
    invoice.paid_at = now_naive()
    await db.commit()
    stats = await run_billing_cycle(db)
    assert stats["marked_past_due"] == 0
    await db.refresh(sub)
    assert sub.status == "active"
    assert sub.current_period_end > old_end


async def test_paid_current_period_invoice_does_not_buy_free_month(db, house, plan, recorded_notifications):
    """A paid invoice for the period that already ended must not renew the sub.

    Regression: the old compensation query looked only at ``paid_at`` and
    renewed on *any* paid invoice for the current period, giving a free month.
    """
    end = now_naive() - timedelta(days=1)
    start = end - timedelta(days=30)
    sub = await make_sub(
        db, house.id, plan, trial_days=0, status="active", auto_renew=False,
        start=start, end=end,
    )
    invoice = await make_invoice(db, sub, plan, status="paid")
    invoice.paid_at = now_naive()
    await db.commit()
    stats = await run_billing_cycle(db)
    assert stats["marked_past_due"] == 1
    await db.refresh(sub)
    assert sub.status == "past_due"
    assert sub.current_period_end == end


async def test_trial_end_without_approved_payment_expires(db, house, plan, recorded_notifications):
    """The free tier is the trial: no grace period once it ends unpaid."""
    end = now_naive() - timedelta(days=1)
    sub = await make_sub(
        db, house.id, plan, status="trialing", trial_days=7,
        start=end - timedelta(days=7), end=end,
    )
    stats = await run_billing_cycle(db)
    assert stats["expired"] == 1
    assert stats["marked_past_due"] == 0
    await db.refresh(sub)
    assert sub.status == "expired"
    assert (house.id, "expired") in recorded_notifications


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
    assert stats == {
        "renewals_issued": 0,
        "trial_reminders": 0,
        "marked_past_due": 0,
        "expired": 0,
        "resumed": 0,
        "houses_deactivated": 0,
        "houses_reactivated": 0,
    }


async def test_expired_subscription_deactivates_house(db, house, plan, recorded_notifications):
    grace = now_naive() - timedelta(days=1)
    await make_sub(
        db, house.id, plan, trial_days=0, status="past_due", auto_renew=False,
        grace_period_end=grace,
    )
    stats = await run_billing_cycle(db)
    assert stats["expired"] == 1
    assert stats["houses_deactivated"] == 1
    await db.refresh(house)
    assert house.is_active is False
    assert house.deactivated_for_billing is True


async def test_active_subscription_reactivates_billing_locked_house(db, house, plan, recorded_notifications):
    house.is_active = False
    house.deactivated_for_billing = True
    await db.commit()
    await make_sub(db, house.id, plan, trial_days=0, status="active", auto_renew=False)
    stats = await run_billing_cycle(db)
    assert stats["houses_reactivated"] == 1
    await db.refresh(house)
    assert house.is_active is True
    assert house.deactivated_for_billing is False


async def test_manual_inactive_house_is_not_reactivated(db, house, plan, recorded_notifications):
    house.is_active = False
    house.deactivated_for_billing = False
    await db.commit()
    await make_sub(db, house.id, plan, trial_days=0, status="active", auto_renew=False)
    stats = await run_billing_cycle(db)
    assert stats["houses_reactivated"] == 0
    await db.refresh(house)
    assert house.is_active is False


async def test_house_without_subscription_stays_active(db, house, recorded_notifications):
    stats = await run_billing_cycle(db)
    assert stats["houses_deactivated"] == 0
    await db.refresh(house)
    assert house.is_active is True