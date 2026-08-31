"""Billing cycle runner (scheduler).

Periodic background task that moves subscriptions through their billing
lifecycle for the invoice + manual-pay model:

  - issues renewal invoices for auto_renew subs before period end
  - marks active/trialing subs past_due once their period ends unpaid
  - expires subs whose grace period ends unpaid
  - resumes paused subs whose resume_at passed

Uses its own short-lived async sessions; safe to run frequently (5 min).
"""

import asyncio
import logging
from datetime import timedelta
from typing import Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings
from app.models.subscription import HouseSubscription
from app.models.invoice import (
    Invoice, INVOICE_STATUS_ISSUED, INVOICE_STATUS_UNPAID, INVOICE_STATUS_PAID,
)
from app.services.subscription_service import issue_invoice
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

BILLING_INTERVAL_SECONDS = 300  # run every 5 minutes


async def run_billing_cycle(db: AsyncSession) -> dict:
    now = now_naive()
    stats = {"renewals_issued": 0, "trial_reminders": 0, "marked_past_due": 0, "expired": 0, "resumed": 0}

    async def _notify(house_id: int, kind: str, invoice=None, sub=None):
        from app.models.house import House
        from app.services.billing_notifications import notify_house
        house = (await db.execute(select(House).where(House.id == house_id))).scalar_one_or_none()
        if house:
            try:
                await notify_house(db, house, kind, invoice=invoice, sub=sub)
            except Exception as exc:
                logger.warning("notify %s failed for house %s: %s", kind, house_id, exc)

    # ---- 1. auto-renewal invoice issuance -----------------------------------
    cutoff = now + timedelta(days=settings.BILLING_RENEWAL_REMINDER_DAYS)
    result = await db.execute(
        select(HouseSubscription).where(
            HouseSubscription.is_deleted == False,  # noqa: E712
            HouseSubscription.auto_renew == True,  # noqa: E712
            HouseSubscription.status.in_(["active", "trialing"]),
            HouseSubscription.current_period_end <= cutoff,
        )
    )
    subs = result.scalars().all()
    for sub in subs:
        if sub.package is None:
            continue
        # skip if an unpaid invoice for the next period already exists
        has_open = (await db.execute(
            select(func.count(Invoice.id)).where(
                Invoice.subscription_id == sub.id,
                Invoice.billing_period_start >= sub.current_period_end,
                Invoice.status.in_([INVOICE_STATUS_ISSUED, INVOICE_STATUS_UNPAID]),
                Invoice.is_deleted == False,  # noqa: E712
            )
        )).scalar_one()
        if has_open:
            continue
        try:
            invoice = await issue_invoice(
                db, sub, sub.package,
                billing_interval=sub.billing_interval,
                description=f"Renewal - {sub.package.name} ({sub.billing_interval})",
            )
            stats["renewals_issued"] += 1
            await _notify(sub.house_id, "invoice_issued", invoice=invoice, sub=sub)
        except Exception as exc:  # keep going on per-sub failures
            logger.warning("billing: renewal invoice failed for sub %s: %s", sub.id, exc)

    # ---- 1b. trial-ending reminders -----------------------------------------
    trial_cutoff = now + timedelta(days=settings.BILLING_TRIAL_END_REMINDER_DAYS)
    result = await db.execute(
        select(HouseSubscription).where(
            HouseSubscription.is_deleted == False,  # noqa: E712
            HouseSubscription.status == "trialing",
            HouseSubscription.trial_end.is_not(None),
            HouseSubscription.trial_end <= trial_cutoff,
            HouseSubscription.trial_reminder_sent_at.is_(None),
        )
    )
    for sub in result.scalars().all():
        sub.trial_reminder_sent_at = now
        stats["trial_reminders"] += 1
        await _notify(sub.house_id, "trial_ending", sub=sub)

    # ---- 2. past due ---------------------------------------------------------
    result = await db.execute(
        select(HouseSubscription).where(
            HouseSubscription.is_deleted == False,  # noqa: E712
            HouseSubscription.status.in_(["active", "trialing"]),
            HouseSubscription.current_period_end < now,
            HouseSubscription.grace_period_end.is_(None),
        )
    )
    for sub in result.scalars().all():
        paid = (await db.execute(
            select(func.count(Invoice.id)).where(
                Invoice.subscription_id == sub.id,
                Invoice.status == INVOICE_STATUS_PAID,
                Invoice.paid_at >= sub.current_period_start,
            )
        )).scalar_one()
        if paid:
            # paid invoice covers this cycle; roll forward instead of punishing
            from app.services.subscription_service import renew_period
            await renew_period(db, sub, changed_via="scheduler")
            continue
        sub.status = "past_due"
        sub.grace_period_end = now + timedelta(days=settings.BILLING_GRACE_DAYS)
        sub.updated_at = now
        stats["marked_past_due"] += 1
        logger.info("billing: house %s subscription %s -> past_due", sub.house_id, sub.id)
        await _notify(sub.house_id, "past_due", sub=sub)

    # ---- 3. expire past grace period ----------------------------------------
    result = await db.execute(
        select(HouseSubscription).where(
            HouseSubscription.is_deleted == False,  # noqa: E712
            HouseSubscription.status == "past_due",
            HouseSubscription.grace_period_end.is_not(None),
            HouseSubscription.grace_period_end < now,
        )
    )
    for sub in result.scalars().all():
        sub.status = "expired"
        sub.updated_at = now
        stats["expired"] += 1
        logger.info("billing: house %s subscription %s -> expired", sub.house_id, sub.id)
        await _notify(sub.house_id, "expired", sub=sub)

    # ---- 4. resume paused subscriptions -------------------------------------
    result = await db.execute(
        select(HouseSubscription).where(
            HouseSubscription.is_deleted == False,  # noqa: E712
            HouseSubscription.status == "paused",
            HouseSubscription.resume_at.is_not(None),
            HouseSubscription.resume_at < now,
        )
    )
    for sub in result.scalars().all():
        sub.status = "active"
        sub.paused_at = None
        sub.resume_at = None
        sub.updated_at = now
        stats["resumed"] += 1

    await db.commit()
    if any(stats.values()):
        logger.info("billing cycle summary: %s", stats)
    return stats


async def billing_loop():
    from app.services.db_service import async_session
    logger.info("Billing scheduler started (interval=%ss)", BILLING_INTERVAL_SECONDS)
    while True:
        try:
            async with async_session() as session:
                await run_billing_cycle(session)
        except asyncio.CancelledError:
            logger.info("Billing scheduler stopped")
            raise
        except Exception as exc:
            logger.warning("billing cycle error: %s", exc)
        await asyncio.sleep(BILLING_INTERVAL_SECONDS)