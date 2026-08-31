import logging
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.deps import get_db, get_house_context, has_any_permission, has_permission
from app.schemas.subscription import SubscriptionSchema, EntitlementsSchema, PlanSchema
from app.models.house import House
from app.models.subscription import (
    HouseSubscription, SubscriptionPackage,
    BILLING_INTERVAL_MONTHLY, BILLING_INTERVAL_YEARLY,
)
from app.models.invoice import Invoice, INVOICE_STATUS_PAID
from app.models.user import User
from app.services import entitlement
from app.services import subscription_service as subsvc
from app.utils.access_control import is_admin_user
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/subscription", tags=["Subscription"])


async def _get_house_id(
    current_user: User,
    house_context: Optional[int],
    require: bool = False,
) -> Optional[int]:
    house_id = await entitlement._house_id_for(current_user, house_context)
    if require and not house_id:
        raise HTTPException(status_code=400, detail="Please select a house first (X-House-ID header required)")
    return house_id


async def _serialize_subscription(sub: Optional[HouseSubscription], house_name: Optional[str] = None) -> Optional[dict]:
    if sub is None:
        return None
    data = SubscriptionSchema.model_validate(sub).model_dump()
    data["effective_status"] = entitlement.effective_status(sub)
    data["package"] = PlanSchema.model_validate(sub.package).model_dump() if sub.package else None
    if house_name:
        data["house_name"] = house_name
    return data


@router.get("/current")
async def current_subscription(
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_any_permission(["subscription.view", "billing.view"])),
):
    """Return the active subscription for the selected house."""
    is_admin = is_admin_user(current_user)
    if is_admin and house_context is None:
        # Admin without house context -> show most recently touched subscription (or none)
        result = await db.execute(
            select(HouseSubscription)
            .options(entitlement._package_loader())
            .where(HouseSubscription.is_deleted == False)  # noqa: E712
            .order_by(HouseSubscription.id.desc())
            .limit(1)
        )
        sub = result.scalars().first()
        return await _serialize_subscription(sub) or {}

    house_id = await _get_house_id(current_user, house_context, require=True)
    sub = await entitlement.get_house_subscription(db, house_id)
    return await _serialize_subscription(sub) or {}


@router.get("/entitlements", response_model=EntitlementsSchema)
async def get_entitlements(
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_any_permission(["subscription.view", "billing.view"])),
):
    """Feature/limit entitlements for the selected house.

    Used by the frontend to hide/disable unavailable features and to
    communicate which plan is required. Backend guards remain authoritative.
    """
    is_admin = is_admin_user(current_user)
    if is_admin and house_context is None:
        result = await db.execute(select(House).order_by(House.id.asc()).limit(1))
        house = result.scalar_one_or_none()
        if not house:
            return EntitlementsSchema(house_id=0, subscribed=False)
        house_id = house.id
    else:
        house_id = await _get_house_id(current_user, house_context, require=True)

    sub = await entitlement.get_house_subscription(db, house_id)
    effective = entitlement.effective_status(sub) if sub else None
    feature_gated = sub is not None and sub.package is not None
    return EntitlementsSchema(
        house_id=house_id,
        subscribed=entitlement.is_entitled(sub),
        status=effective,
        feature_gated=feature_gated,
        features_enabled=(sub.package.feature_flags or list()) if feature_gated else None,
        limits=(sub.package.limits or {}) if feature_gated else None,
        plan=PlanSchema.model_validate(sub.package) if sub and sub.package else None,
        trial_end=sub.trial_end if sub else None,
        grace_period_end=sub.grace_period_end if sub else None,
        next_billing_date=(sub.current_period_end or sub.end_date) if sub else None,
    )


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

class SelectPlanRequest(BaseModel):
    plan_id: Optional[int] = None
    plan_slug: Optional[str] = None
    billing_interval: str = BILLING_INTERVAL_MONTHLY
    trial: bool = True
    auto_renew: bool = True


class ChangePlanRequest(BaseModel):
    plan_id: int
    billing_interval: Optional[str] = None


class ReasonRequest(BaseModel):
    reason: Optional[str] = None
    at_period_end: bool = True
    resume_days: int = 30


async def _get_plan(db: AsyncSession, plan_id: Optional[int], plan_slug: Optional[str]) -> SubscriptionPackage:
    query = select(SubscriptionPackage).where(
        SubscriptionPackage.is_deleted == False,  # noqa: E712
        SubscriptionPackage.is_active == True,  # noqa: E712
    )
    if plan_id:
        query = query.where(SubscriptionPackage.id == plan_id)
    elif plan_slug:
        query = query.where(SubscriptionPackage.slug == plan_slug)
    else:
        raise HTTPException(status_code=400, detail="plan_id or plan_slug is required")
    plan = (await db.execute(query)).scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found or inactive")
    return plan


async def _get_subscription_for_house(db: AsyncSession, house_id: int) -> HouseSubscription:
    sub = await entitlement.get_house_subscription(db, house_id)
    if not sub:
        raise HTTPException(status_code=404, detail="No subscription found for this house")
    return sub


def _invoice_payload(invoice: Invoice) -> dict:
    return {
        "id": invoice.id,
        "invoice_no": invoice.invoice_no,
        "amount": float(invoice.amount),
        "tax": float(invoice.tax),
        "total": float(invoice.total),
        "currency": invoice.currency,
        "status": invoice.status,
        "billing_period_start": invoice.billing_period_start,
        "billing_period_end": invoice.billing_period_end,
        "due_date": invoice.due_date,
        "description": invoice.description,
    }


@router.post("/select")
async def select_plan(
    payload: SelectPlanRequest,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("subscription.create")),
):
    """Subscribe a house to a plan. Creates the subscription + first invoice."""
    if payload.billing_interval not in (BILLING_INTERVAL_MONTHLY, BILLING_INTERVAL_YEARLY):
        raise HTTPException(status_code=400, detail="Invalid billing interval")
    house_id = await _get_house_id(current_user, house_context, require=True)
    plan = await _get_plan(db, payload.plan_id, payload.plan_slug)

    # Find any existing subscription for this house. If it's cancelled/expired,
    # this select acts as a reactivation rather than a brand-new subscription.
    existing = await entitlement.get_house_subscription(db, house_id)
    if existing and existing.status in ("active", "trialing", "past_due"):
        raise HTTPException(
            status_code=409,
            detail="House already has an active subscription. Use change-plan or cancel first.",
        )

    sub = await subsvc.create_subscription(
        db, house_id=house_id, plan=plan,
        billing_interval=payload.billing_interval,
        changed_by=current_user.id, trial=payload.trial, auto_renew=payload.auto_renew,
    )
    invoice = await subsvc.issue_invoice(db, sub, plan, billing_interval=payload.billing_interval)
    return {
        "success": True,
        "subscription": await _serialize_subscription(sub),
        "invoice": _invoice_payload(invoice),
    }


@router.post("/change-plan")
async def change_plan(
    payload: ChangePlanRequest,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("subscription.upgrade")),
):
    house_id = await _get_house_id(current_user, house_context, require=True)
    sub = await _get_subscription_for_house(db, house_id)
    if sub.status not in ("active", "trialing"):
        raise HTTPException(status_code=400, detail=f"Cannot change plan from status '{sub.status}'")
    plan = await _get_plan(db, payload.plan_id, None)
    if payload.billing_interval and payload.billing_interval in (BILLING_INTERVAL_MONTHLY, BILLING_INTERVAL_YEARLY):
        sub.billing_interval = payload.billing_interval
    result = await subsvc.upgrade_or_downgrade(db, sub, plan, changed_by=current_user.id)
    invoice_payload = _invoice_payload(result["prorated_invoice"]) if result.get("prorated_invoice") else None
    return {
        "success": True,
        "applied": result["applied"],
        "is_upgrade": result["is_upgrade"],
        "prorated_invoice": invoice_payload,
        "subscription": await _serialize_subscription(await entitlement.get_house_subscription(db, house_id)),
    }


@router.post("/cancel")
async def cancel_subscription(
    payload: ReasonRequest,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("subscription.cancel")),
):
    house_id = await _get_house_id(current_user, house_context, require=True)
    sub = await _get_subscription_for_house(db, house_id)
    if sub.status in ("cancelled", "expired"):
        raise HTTPException(status_code=400, detail=f"Subscription is already '{sub.status}'")
    await subsvc.cancel(db, sub, changed_by=current_user.id, at_period_end=payload.at_period_end)
    return {"success": True, "subscription": await _serialize_subscription(await entitlement.get_house_subscription(db, house_id))}


@router.post("/reactivate")
async def reactivate_subscription(
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("subscription.edit")),
):
    house_id = await _get_house_id(current_user, house_context, require=True)
    sub = await _get_subscription_for_house(db, house_id)
    if sub.status not in ("cancelled", "expired"):
        raise HTTPException(status_code=400, detail=f"Cannot reactivate from status '{sub.status}'. Use change-plan instead.")
    await subsvc.reactivate(db, sub, changed_by=current_user.id)
    invoice = await subsvc.issue_invoice(db, sub, sub.package)
    return {
        "success": True,
        "subscription": await _serialize_subscription(await entitlement.get_house_subscription(db, house_id)),
        "invoice": _invoice_payload(invoice),
    }


@router.post("/pause")
async def pause_subscription(
    payload: ReasonRequest,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("subscription.edit")),
):
    house_id = await _get_house_id(current_user, house_context, require=True)
    sub = await _get_subscription_for_house(db, house_id)
    if sub.status != "active":
        raise HTTPException(status_code=400, detail=f"Cannot pause from status '{sub.status}'")
    await subsvc.pause(db, sub, changed_by=current_user.id, resume_days=payload.resume_days)
    return {"success": True, "subscription": await _serialize_subscription(await entitlement.get_house_subscription(db, house_id))}


@router.post("/resume")
async def resume_subscription(
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("subscription.edit")),
):
    house_id = await _get_house_id(current_user, house_context, require=True)
    sub = await _get_subscription_for_house(db, house_id)
    if sub.status != "paused":
        raise HTTPException(status_code=400, detail=f"Cannot resume from status '{sub.status}'")
    await subsvc.resume(db, sub, changed_by=current_user.id)
    return {"success": True, "subscription": await _serialize_subscription(await entitlement.get_house_subscription(db, house_id))}


@router.post("/renew")
async def renew_subscription(
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("subscription.renew")),
):
    """Issue the next renewal invoice for manual payment."""
    house_id = await _get_house_id(current_user, house_context, require=True)
    sub = await _get_subscription_for_house(db, house_id)
    if sub.status not in ("active", "trialing", "past_due"):
        raise HTTPException(status_code=400, detail=f"Cannot renew from status '{sub.status}'")
    if not sub.package:
        raise HTTPException(status_code=400, detail="Subscription has no plan assigned")
    invoice = await subsvc.issue_invoice(db, sub, sub.package, billing_interval=sub.billing_interval)
    return {"success": True, "invoice": _invoice_payload(invoice)}


@router.get("/history")
async def subscription_history(
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_any_permission(["subscription.view", "billing.view"])),
):
    """Audit trail of subscription changes for the selected house."""
    from app.models.subscription_change_log import SubscriptionChangeLog
    from sqlalchemy.orm import selectinload
    house_id = await _get_house_id(current_user, house_context, require=True)
    result = await db.execute(
        select(SubscriptionChangeLog)
        .options(
            selectinload(SubscriptionChangeLog.from_plan),
            selectinload(SubscriptionChangeLog.to_plan),
        )
        .where(SubscriptionChangeLog.house_id == house_id)
        .order_by(SubscriptionChangeLog.id.desc())
        .limit(100)
    )
    logs = result.scalars().all()
    return {
        "success": True,
        "data": [{
            "id": l.id,
            "change_type": l.change_type,
            "from_status": l.from_status,
            "to_status": l.to_status,
            "from_plan": l.from_plan.name if l.from_plan else None,
            "to_plan": l.to_plan.name if l.to_plan else None,
            "amount": float(l.amount) if l.amount is not None else None,
            "reason": l.reason,
            "note": l.note,
            "changed_via": l.changed_via,
            "created_at": l.created_at,
        } for l in logs],
    }