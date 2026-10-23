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

from sqlalchemy import func, select
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

# Sentinel for _log(): distinguishes "not provided" from an explicit None.
_UNSET = object()


async def _sync_house_state(db: AsyncSession, house_id: int) -> None:
    """Keep House.is_active in sync after a subscription transition.

    Failures here must never break the billing operation itself (the scheduler
    performs a full reconciliation sweep every cycle anyway).
    """
    try:
        from app.services.house_lifecycle import sync_house_billing_state

        await sync_house_billing_state(db, [house_id])
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("house billing sync failed for house %s: %s", house_id, exc)


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
    from_plan_id=_UNSET,
    old_status: Optional[str] = None,
    new_status: Optional[str] = None,
    old_period_end=None,
    new_period_end=None,
):
    db.add(SubscriptionChangeLog(
        house_id=sub.house_id,
        subscription_id=sub.id,
        change_type=change_type,
        # Callers that already moved sub.package_id pass the previous plan id
        # explicitly, otherwise the audit row would log the new plan as "from".
        from_plan_id=sub.package_id if from_plan_id is _UNSET else from_plan_id,
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
    await _sync_house_state(db, sub.house_id)
    return sub


# ---------------------------------------------------------------------------
# lifecycle operations
# ---------------------------------------------------------------------------

async def provision_house_default_plan(
    db: AsyncSession,
    house_id: int,
    changed_by: Optional[int] = None,
) -> Optional[HouseSubscription]:
    """Give a newly created house its starting plan.

    Deny-by-default means a plan-less house is locked out, so house creation
    should not leave one in that state when a default plan is configured
    (`settings.BILLING_DEFAULT_PLAN_SLUG`). Never raises: house creation must
    not fail because the billing catalogue is empty — the access gate then
    reports "no plan assigned" and an admin can pick one.
    """
    slug = (settings.BILLING_DEFAULT_PLAN_SLUG or "").strip()
    if not slug:
        return None
    try:
        plan = (await db.execute(
            select(SubscriptionPackage).where(
                SubscriptionPackage.slug == slug,
                SubscriptionPackage.is_deleted == False,  # noqa: E712
                SubscriptionPackage.is_active == True,  # noqa: E712
            )
        )).scalar_one_or_none()
        if plan is None:
            logger.warning(
                "Default plan slug '%s' not found; house %s starts without a plan",
                slug, house_id,
            )
            return None
        return await create_subscription(
            db,
            house_id=house_id,
            plan=plan,
            changed_by=changed_by,
            changed_via="house_create",
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(
            "Failed to provision default plan for house %s: %s", house_id, exc
        )
        return None


async def create_subscription(
    db: AsyncSession,
    house_id: int,
    plan: SubscriptionPackage,
    billing_interval: str = BILLING_INTERVAL_MONTHLY,
    changed_by: Optional[int] = None,
    changed_via: str = "api",
    trial: bool = True,
    auto_renew: bool = True,
) -> HouseSubscription:
    """Start a plan on its free tier.

    The plan's ``trial_days`` *is* the initial validity: the subscription is
    ``trialing`` only for that many days and owns no paid time yet. Without a
    free tier the house is blocked (``expired``) until an admin approves its
    first payment — a plan never starts with a free paid period.

    Paid access always begins at the payment approval time (see
    :func:`mark_invoice_paid`), not at plan selection.
    """
    now = now_naive()
    trial_days = max(0, plan.trial_days or 0) if trial else 0
    period_start = now
    if trial_days > 0:
        period_end = now + timedelta(days=trial_days)
        trial_start = now
        trial_end = period_end
        status = "trialing"
    else:
        # No free tier: no access until a payment is approved.
        period_end = now
        trial_start = None
        trial_end = None
        status = "expired"

    sub = HouseSubscription(
        house_id=house_id,
        package_id=plan.id,
        status=status,
        start_date=period_start,
        end_date=period_end,
        current_period_start=period_start,
        current_period_end=period_end,
        trial_start=trial_start,
        trial_end=trial_end,
        grace_period_end=None,
        cancel_at_period_end=False,
        auto_renew=auto_renew,
        billing_interval=billing_interval,
        currency=plan.currency or "BDT",
    )
    db.add(sub)
    await db.flush()
    await _log(db, sub, "created", changed_by=changed_by, changed_via=changed_via,
               old_status=None, new_status=status, to_plan=plan)
    await db.commit()
    await db.refresh(sub)
    await _sync_house_state(db, sub.house_id)
    return sub


def next_billing_period_start(sub: HouseSubscription):
    """Start of the period the next payment should buy.

    - Active/trialing with time left: the current period end (advance renewal).
    - Past-due/expired/paused: now, so the tenant is not charged for a period
      that already elapsed (a backdated renewal would leave them expired).
    """
    now = now_naive()
    end = sub.current_period_end
    return end if end and end > now else now


async def issue_invoice(
    db: AsyncSession,
    sub: HouseSubscription,
    plan: SubscriptionPackage,
    billing_interval: Optional[str] = None,
    description: Optional[str] = None,
    due_days: Optional[int] = None,
    period_start=None,
    period_end=None,
) -> Invoice:
    """Create an invoice for a subscription.

    Without explicit period bounds the invoice covers the subscription's
    *current* period (used when a new subscription is created). Renewal callers
    must pass ``period_start=next_billing_period_start(sub)`` so the invoice
    covers the period the payment actually buys — otherwise the billing runner
    would re-issue the same "renewal" invoice forever and paying it would not
    roll the cycle.
    """
    period = billing_interval or sub.billing_interval
    if period_start is not None:
        start = period_start
        end = period_end or _add_interval(start, period)
    else:
        start = sub.current_period_start or now_naive()
        end = period_end or sub.current_period_end or _add_interval(start, period)
    if end <= start:
        raise ValueError("Invoice period_end must be after period_start")

    amount = plan_price(plan, period)
    tax = round(amount * Decimal(settings.BILLING_TAX_PERCENT) / Decimal(100), 2)
    total = amount + tax
    due = now_naive() + timedelta(days=(due_days if due_days is not None else settings.BILLING_GRACE_DAYS))

    invoice = Invoice(
        house_id=sub.house_id,
        subscription_id=sub.id,
        invoice_no=next_invoice_no(),
        billing_period_start=start,
        billing_period_end=end,
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
    old_plan_id = sub.package_id

    old_period_end = sub.current_period_end
    sub.package_id = new_plan.id
    # Keep the (eager-loaded) relationship in sync with the FK, otherwise the
    # old plan stays cached on this instance for the rest of the session.
    sub.package = new_plan
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
        to_plan=new_plan, from_plan_id=old_plan_id,
        old_period_end=old_period_end,
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
    period_start=None,
    period_end=None,
) -> HouseSubscription:
    """Roll the billing period forward (after a successful renewal payment).

    ``period_start``/``period_end`` come from the paid invoice so the cycle
    moves to exactly the period that was bought. Without them the next period
    starts at the current period end, clamped to ``now`` so a long-lapsed
    subscription does not buy a period that is already over.
    """
    now = now_naive()
    old_end = sub.current_period_end
    old_status = sub.status
    if period_start is not None:
        start = period_start
        end = period_end if period_end and period_end > start else _add_interval(start, sub.billing_interval)
    else:
        start = old_end if old_end and old_end > now else now
        end = _add_interval(start, sub.billing_interval)
    if end <= start:
        raise ValueError("Renewal period_end must be after period_start")

    sub.current_period_start = start
    sub.current_period_end = end
    sub.end_date = end
    sub.status = "active"
    sub.cancel_at_period_end = False
    sub.grace_period_end = None
    sub.cancelled_at = None
    sub.updated_at = now
    await _log(db, sub, "renewed", changed_via=changed_via,
               old_status=old_status, new_status="active",
               old_period_end=old_end, new_period_end=end)
    await db.commit()
    await db.refresh(sub)
    await _sync_house_state(db, sub.house_id)
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
    await _sync_house_state(db, sub.house_id)
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
    await _sync_house_state(db, sub.house_id)
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
    await _sync_house_state(db, sub.house_id)
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
    await _sync_house_state(db, sub.house_id)
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
    await _sync_house_state(db, sub.house_id)
    return sub


async def mark_invoice_paid(
    db: AsyncSession,
    invoice: Invoice,
    gateway_tran_id: Optional[str] = None,
    changed_via: str = "webhook",
    approved_at=None,
):
    """Server-side authoritative invoice payment + subscription activation.

    The paid period is decided here, not by the invoice's provisional dates:

    - **First paid activation** starts at the approval time, so the free tier
      is never silently extended by an invoice issued weeks earlier.
    - **Renewal** extends from the current period end (unused paid time is
      never lost); if that end already passed, it starts at the approval time.

    The invoice is refreshed to the period the payment actually bought, so the
    invoice, PDF and subscription always agree. ``approved_at`` defaults to
    now (Bangladesh Standard Time) and is the *admin approval* timestamp.
    """
    if invoice.status == INVOICE_STATUS_PAID:
        return invoice.subscription  # idempotent when already paid
    paid_at = now_naive() if approved_at is None else approved_at
    invoice.status = INVOICE_STATUS_PAID
    invoice.paid_at = paid_at
    if gateway_tran_id:
        invoice.gateway_tran_id = gateway_tran_id

    sub = invoice.subscription
    if sub is None:
        # standalone/manual invoice (no attached subscription): just mark paid
        await db.commit()
        return None

    prior_paid = (await db.execute(
        select(func.count(Invoice.id)).where(
            Invoice.subscription_id == sub.id,
            Invoice.id != invoice.id,
            Invoice.status == INVOICE_STATUS_PAID,
            Invoice.is_deleted == False,  # noqa: E712
        )
    )).scalar_one()
    is_renewal = bool(prior_paid) or sub.status in ("active", "past_due")

    if is_renewal and sub.current_period_end and sub.current_period_end > paid_at:
        period_start = sub.current_period_end
    else:
        period_start = paid_at
    period_end = _add_interval(period_start, sub.billing_interval)

    # The invoice was issued at plan selection with a provisional period; the
    # approved payment buys exactly [period_start, period_end).
    invoice.billing_period_start = period_start
    invoice.billing_period_end = period_end

    old_status = sub.status
    old_end = sub.current_period_end
    sub.current_period_start = period_start
    sub.current_period_end = period_end
    sub.end_date = period_end
    sub.status = "active"
    sub.cancel_at_period_end = False
    sub.cancelled_at = None
    sub.cancelled_by = None
    sub.grace_period_end = None
    sub.updated_at = now_naive()
    await _log(
        db, sub,
        "renewed" if is_renewal else "activated",
        changed_via=changed_via,
        old_status=old_status,
        new_status="active",
        old_period_end=old_end,
        new_period_end=period_end,
        amount=invoice.total,
    )
    await db.commit()
    await db.refresh(sub)
    await _sync_house_state(db, sub.house_id)
    return sub