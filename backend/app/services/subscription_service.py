"""Subscription lifecycle state machine.

Single source of truth for subscription state transitions.

State model (house_subscriptions.status):
  trialing  -> active (on first successful payment)
  active    -> past_due (unpaid renewal invoice after period end)
             -> cancelled / expired
  past_due  -> active (payment succeeds within grace) | expired (grace ends)
  cancelled -> reactivated (new cycle) | expired
  expired   -> reactivated (new cycle, via paid reactivation invoice)
  paused    -> resume (active)

Billing model: invoice + manual payment via gateway (no token auto-charge).
"""

import logging
from datetime import timedelta
from decimal import Decimal
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings
from app.models.subscription import (
    HouseSubscription,
    SubscriptionPackage,
    BILLING_INTERVAL_MONTHLY,
    BILLING_INTERVAL_YEARLY,
)
from app.models.invoice import (
    Invoice,
    INVOICE_STATUS_ISSUED,
    INVOICE_STATUS_UNPAID,
    INVOICE_STATUS_PAID,
    INVOICE_STATUS_VOID,
)
from app.models.subscription_change_log import SubscriptionChangeLog
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------

def _add_interval(dt, billing_interval: str):
    if billing_interval == BILLING_INTERVAL_YEARLY:
        return dt.replace(year=dt.year + 1)
    # monthly: add one calendar month, clamped to month length
    if dt.month == 12:
        year, month = dt.year + 1, 1
    else:
        year, month = dt.year, dt.month + 1
    import calendar
    day = min(dt.day, calendar.monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)


def plan_price(plan: SubscriptionPackage, billing_interval: str) -> Decimal:
    if billing_interval == BILLING_INTERVAL_YEARLY:
        return Decimal(plan.price_yearly or 0)
    return Decimal(plan.price_monthly or 0)


def next_invoice_no() -> str:
    from datetime import datetime
    import random
    stamp = datetime.now().strftime("%Y%m%d%H%M%S")
    return f"INV-{stamp}-{random.randrange(1000, 9999)}"


async def _log(
    db: AsyncSession,
    sub: HouseSubscription,
    change_type: str,
    changed_by: Optional[int] = None,
    changed_via: str = "api",
    reason: Optional[str] = None,
    note: Optional[str] = None,
    amount: Optional[Decimal] = None,
    to_plan: Optional[SubscriptionPackage] = None,
    old_status: Optional[str] = None,
    new_status: Optional[str] = None,
    old_period_end=None,
    new_period_end=None,
):
    db.add(SubscriptionChangeLog(
        house_id=sub.house_id,
        subscription_id=sub.id,
        change_type=change_type,
        from_plan_id=sub.package_id,
        to_plan_id=(to_plan.id if to_plan else sub.package_id),
        from_status=old_status or sub.status,
        to_status=new_status or sub.status,
        from_period_end=old_period_end,
        to_period_end=new_period_end,
        amount=amount,
        reason=reason,
        note=note,
        changed_by=changed_by,
        changed_via=changed_via,
    ))


async def set_status(db: AsyncSession, sub: HouseSubscription, new_status: str,
                     changed_by: Optional[int] = None, changed_via: str = "api",
                     reason: Optional[str] = None, change_type: Optional[str] = None):
    old = sub.status
    sub.status = new_status
    sub.updated_at = now_naive()
    await _log(
        db, sub,
        change_type or ("status_changed" if change_type is None else change_type),
        changed_by=changed_by, changed_via=changed_via, reason=reason,
        old_status=old, new_status=new_status,
    )
    await db.commit()
    return sub


# ---------------------------------------------------------------------------
# lifecycle operations
# ---------------------------------------------------------------------------

async def create_subscription(
    db: AsyncSession,
    house_id: int,
    plan: SubscriptionPackage,
    billing_interval: str = BILLING_INTERVAL_MONTHLY,
    changed_by: Optional[int] = None,
    changed_via: str = "api",
    trial: bool = True,
    auto_renew: bool = True,
    gateway: str = settings.PAYMENT_GATEWAY,
) -> HouseSubscription:
    now = now_naive()
    period_start = now
    period_end = _add_interval(now, billing_interval)
    trial_days = plan.trial_days or 0 if trial else 0
    trial_end = period_start + timedelta(days=trial_days) if trial_days else None

    status = "trialing" if trial_days > 0 else "active"

    sub = HouseSubscription(
        house_id=house_id,
        package_id=plan.id,
        status=status,
        start_date=period_start,
        end_date=period_end,
        current_period_start=period_start,
        current_period_end=period_end,
        trial_start=period_start if trial_days else None,
        trial_end=trial_end,
        grace_period_end=None,
        cancel_at_period_end=False,
        auto_renew=auto_renew,
        gateway=gateway,
        billing_interval=billing_interval,
        currency=plan.currency or "BDT",
    )
    db.add(sub)
    await db.flush()
    await _log(db, sub, "created", changed_by=changed_by, changed_via=changed_via,
               old_status=None, new_status=status, to_plan=plan)
    await db.commit()
    await db.refresh(sub)
    return sub


async def issue_invoice(
    db: AsyncSession,
    sub: HouseSubscription,
    plan: SubscriptionPackage,
    billing_interval: Optional[str] = None,
    description: Optional[str] = None,
    due_days: Optional[int] = None,
) -> Invoice:
    period = billing_interval or sub.billing_interval
    amount = plan_price(plan, period)
    tax = round(amount * Decimal(settings.BILLING_TAX_PERCENT) / Decimal(100), 2)
    total = amount + tax
    due = now_naive() + timedelta(days=(due_days if due_days is not None else settings.BILLING_GRACE_DAYS))

    invoice = Invoice(
        house_id=sub.house_id,
        subscription_id=sub.id,
        invoice_no=next_invoice_no(),
        billing_period_start=sub.current_period_start,
        billing_period_end=sub.current_period_end,
        due_date=due,
        amount=amount,
        tax=tax,
        total=total,
        currency=sub.currency or plan.currency or "BDT",
        status=INVOICE_STATUS_ISSUED,
        description=description or f"{plan.name} subscription ({period})",
    )
    db.add(invoice)
    await db.commit()
    await db.refresh(invoice)
    return invoice


async def upgrade_or_downgrade(
    db: AsyncSession,
    sub: HouseSubscription,
    new_plan: SubscriptionPackage,
    changed_by: Optional[int] = None,
    changed_via: str = "api",
) -> dict:
    """Change plan. Upgrades are immediate with a prorated delta invoice;
    downgrades apply immediately (pricing effective on the next invoice)."""
    if sub.package_id == new_plan.id:
        return {"applied": False, "message": "Already on this plan", "invoice": None}

    old_price = plan_price(sub.package, sub.billing_interval) if sub.package else Decimal(0)
    new_price = plan_price(new_plan, sub.billing_interval)
    is_upgrade = new_price >= old_price
    prev_status = sub.status

    old_period_end = sub.current_period_end
    sub.package_id = new_plan.id
    sub.currency = new_plan.currency or "BDT"
    sub.updated_at = now_naive()

    invoice = None
    delta = Decimal(0)
    if is_upgrade and old_price > 0 and sub.current_period_end:
        # prorate the price difference over the remaining days of this period
        now = now_naive()
        period_span = (sub.current_period_end - sub.current_period_start).days or 30
        remaining = max(0, (sub.current_period_end - now).days)
        delta = round((new_price - old_price) * Decimal(remaining) / Decimal(period_span), 2)
        if delta > 0:
            invoice = Invoice(
                house_id=sub.house_id,
                subscription_id=sub.id,
                invoice_no=next_invoice_no(),
                billing_period_start=now,
                billing_period_end=sub.current_period_end,
                due_date=now + timedelta(days=settings.BILLING_GRACE_DAYS),
                amount=delta,
                tax=Decimal(0),
                total=delta,
                currency=sub.currency or "BDT",
                status=INVOICE_STATUS_ISSUED,
                description=f"{new_plan.name} upgrade proration",
            )
            db.add(invoice)

    await _log(
        db, sub,
        "upgraded" if is_upgrade else "downgraded",
        changed_by=changed_by, changed_via=changed_via,
        old_status=prev_status, new_status=sub.status,
        to_plan=new_plan, old_period_end=old_period_end,
        new_period_end=sub.current_period_end,
        amount=delta or None,
        reason="immediate prorated" if invoice else "applied at next renewal",
    )
    await db.commit()
    if invoice:
        await db.refresh(invoice)
    return {"applied": True, "is_upgrade": is_upgrade, "prorated_invoice": invoice}


async def renew_period(
    db: AsyncSession,
    sub: HouseSubscription,
    changed_via: str = "api",
) -> HouseSubscription:
    """Roll the billing period forward (after a successful renewal payment)."""
    now = now_naive()
    old_end = sub.current_period_end
    sub.current_period_start = old_end
    sub.current_period_end = _add_interval(old_end, sub.billing_interval)
    sub.end_date = sub.current_period_end
    sub.status = "active"
    sub.cancel_at_period_end = False
    sub.grace_period_end = None
    sub.cancelled_at = None
    sub.updated_at = now
    await _log(db, sub, "renewed", changed_via=changed_via,
               old_status="past_due", new_status="active",
               old_period_end=old_end, new_period_end=sub.current_period_end)
    await db.commit()
    await db.refresh(sub)
    return sub


async def activate(db: AsyncSession, sub: HouseSubscription, changed_via: str = "webhook"):
    """Activate/mark-paid a subscription (first payment or within-grace payment)."""
    old_status = sub.status
    sub.status = "active"
    sub.grace_period_end = None
    sub.updated_at = now_naive()
    change_type = "activated" if old_status in ("trialing",) else \
        ("reactivated" if old_status in ("cancelled", "expired") else "activated")
    await _log(db, sub, change_type, changed_via=changed_via,
               old_status=old_status, new_status="active")
    await db.commit()
    await db.refresh(sub)
    return sub


async def cancel(
    db: AsyncSession,
    sub: HouseSubscription,
    changed_by: Optional[int] = None,
    at_period_end: bool = True,
    changed_via: str = "api",
):
    now = now_naive()
    if at_period_end:
        sub.cancel_at_period_end = True
        sub.auto_renew = False
        await _log(db, sub, "cancelled", changed_by=changed_by, changed_via=changed_via,
                   reason="cancel at period end", new_status=sub.status)
    else:
        old = sub.status
        sub.status = "cancelled"
        sub.cancelled_at = now
        sub.cancelled_by = changed_by
        sub.cancel_at_period_end = False
        await _log(db, sub, "cancelled", changed_by=changed_by, changed_via=changed_via,
                   old_status=old, new_status="cancelled", reason="immediate cancellation")
    sub.updated_at = now
    await db.commit()
    await db.refresh(sub)
    return sub


async def reactivate(
    db: AsyncSession,
    sub: HouseSubscription,
    changed_by: Optional[int] = None,
    changed_via: str = "api",
):
    """Start a fresh billing cycle for a previously cancelled/expired subscription."""
    now = now_naive()
    old_status = sub.status
    sub.status = "active"
    sub.cancel_at_period_end = False
    sub.cancelled_at = None
    sub.cancelled_by = None
    sub.grace_period_end = None
    sub.current_period_start = now
    sub.current_period_end = _add_interval(now, sub.billing_interval)
    sub.start_date = now
    sub.end_date = sub.current_period_end
    sub.updated_at = now
    await _log(db, sub, "reactivated", changed_by=changed_by, changed_via=changed_via,
               old_status=old_status, new_status="active",
               old_period_end=None, new_period_end=sub.current_period_end)
    await db.commit()
    await db.refresh(sub)
    return sub


async def pause(
    db: AsyncSession,
    sub: HouseSubscription,
    changed_by: Optional[int] = None,
    changed_via: str = "api",
    resume_days: int = 30,
):
    old = sub.status
    sub.status = "paused"
    sub.paused_at = now_naive()
    sub.resume_at = now_naive() + timedelta(days=resume_days)
    sub.updated_at = now_naive()
    await _log(db, sub, "paused", changed_by=changed_by, changed_via=changed_via,
               old_status=old, new_status="paused", reason=f"auto-resume in {resume_days}d")
    await db.commit()
    await db.refresh(sub)
    return sub


async def resume(
    db: AsyncSession,
    sub: HouseSubscription,
    changed_by: Optional[int] = None,
    changed_via: str = "api",
):
    old = sub.status
    sub.status = "active"
    sub.paused_at = None
    sub.resume_at = None
    sub.updated_at = now_naive()
    await _log(db, sub, "resumed", changed_by=changed_by, changed_via=changed_via,
               old_status=old, new_status="active")
    await db.commit()
    await db.refresh(sub)
    return sub


async def mark_invoice_paid(
    db: AsyncSession,
    invoice: Invoice,
    gateway_tran_id: Optional[str] = None,
    changed_via: str = "webhook",
):
    """Server-side authoritative invoice payment + subscription activation.

    If the paid invoice covers a period after the current one, the
    subscription cycle is rolled forward (renewal); otherwise the
    subscription is simply activated.
    """
    if invoice.status == INVOICE_STATUS_PAID:
        return invoice.subscription  # idempotent when already paid
    now = now_naive()
    invoice.status = INVOICE_STATUS_PAID
    invoice.paid_at = now
    if gateway_tran_id:
        invoice.gateway_tran_id = gateway_tran_id

    sub = invoice.subscription
    if sub is None:
        # standalone/manual invoice (no attached subscription): just mark paid
        await db.commit()
        return None
    is_renewal = bool(
        sub
        and sub.current_period_end
        and invoice.billing_period_start
        and invoice.billing_period_start >= sub.current_period_end
    )
    if is_renewal:
        sub = await renew_period(db, sub, changed_via=changed_via)
    else:
        sub = await activate(db, sub, changed_via=changed_via)
    await db.commit()
    return sub