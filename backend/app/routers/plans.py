import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.routers.deps import get_db, has_permission, has_any_permission
from app.schemas.subscription import PlanSchema, PlanUpsert
from app.schemas.pagination import PaginationParams, PaginatedResponse, PaginationMeta
from app.models.subscription import SubscriptionPackage, SubscriptionTier
from app.models.user import User
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/plans", tags=["Plans"])


def _tier_or_none(value: Optional[str]):
    if not value:
        return None
    for tier in SubscriptionTier:
        if tier.value == value.lower():
            return tier
    raise HTTPException(status_code=400, detail=f"Invalid tier: {value}")


@router.get("", response_model=PaginatedResponse)
async def list_plans(
    pagination: PaginationParams = Depends(),
    active_only: Optional[bool] = Query(False, description="Only active plans"),
    include_deleted: Optional[bool] = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_any_permission(["plans.view", "subscription.view", "billing.view"])),
):
    base_query = select(SubscriptionPackage)
    conditions = [SubscriptionPackage.is_deleted == (True if include_deleted else False)]
    if active_only:
        conditions.append(SubscriptionPackage.is_active == True)  # noqa: E712
    if pagination.search:
        p = f"%{pagination.search}%"
        conditions.append(or_(SubscriptionPackage.name.ilike(p), SubscriptionPackage.slug.ilike(p)))

    count_query = select(SubscriptionPackage.id).where(*conditions)
    total = len((await db.execute(count_query)).scalars().all())

    order = SubscriptionPackage.sort_order.asc() if pagination.sort_order == "asc" else SubscriptionPackage.sort_order.desc()
    query = (
        select(SubscriptionPackage)
        .where(*conditions)
        .order_by(order, SubscriptionPackage.id.asc())
        .offset((pagination.page - 1) * pagination.per_page)
        .limit(pagination.per_page)
    )
    result = await db.execute(query)
    plans = result.scalars().all()
    data = [PlanSchema.model_validate(p).model_dump() for p in plans]

    total_pages = max(1, (total + pagination.per_page - 1) // pagination.per_page)
    return PaginatedResponse(
        success=True,
        data=data,
        pagination=PaginationMeta(
            page=pagination.page,
            per_page=pagination.per_page,
            total=total,
            total_pages=total_pages,
            has_next=pagination.page < total_pages,
            has_prev=pagination.page > 1,
        ),
    )


@router.post("", response_model=PlanSchema)
async def create_plan(
    payload: PlanUpsert,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("plans.manage")),
):
    slug = (payload.slug or payload.name.strip().lower().replace(" ", "-")).lower()
    existing = (
        await db.execute(select(SubscriptionPackage).where(
            or_(SubscriptionPackage.slug == slug, SubscriptionPackage.tier == _tier_or_none(payload.tier))
        ))
    ).scalar_one_or_none()
    if existing and not existing.is_deleted:
        raise HTTPException(status_code=409, detail="Plan with this slug or tier already exists")

    plan = SubscriptionPackage(
        name=payload.name,
        slug=slug,
        tier=_tier_or_none(payload.tier),
        duration_days=payload.duration_days or 30,
        price=payload.price_monthly,
        currency=payload.currency,
        billing_interval=payload.billing_interval,
        price_monthly=payload.price_monthly,
        price_yearly=payload.price_yearly,
        trial_days=payload.trial_days,
        description=payload.description,
        features=payload.features,
        feature_flags=payload.feature_flags,
        limits=payload.limits,
        is_active=payload.is_active,
        sort_order=payload.sort_order,
    )
    db.add(plan)
    await db.commit()
    await db.refresh(plan)
    return plan


@router.patch("/{plan_id}", response_model=PlanSchema)
async def update_plan(
    plan_id: int,
    payload: PlanUpsert,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("plans.manage")),
):
    plan = (
        await db.execute(select(SubscriptionPackage).where(
            SubscriptionPackage.id == plan_id,
            SubscriptionPackage.is_deleted == False,  # noqa: E712
        ))
    ).scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    updates = payload.model_dump(exclude_unset=True)
    if "tier" in updates and updates["tier"] is not None:
        tier = _tier_or_none(updates["tier"])
        dup = (await db.execute(select(SubscriptionPackage).where(
            SubscriptionPackage.tier == tier,
            SubscriptionPackage.id != plan_id,
            SubscriptionPackage.is_deleted == False,  # noqa: E712
        ))).scalar_one_or_none()
        if dup:
            raise HTTPException(status_code=409, detail="Another plan already uses this tier")
        plan.tier = tier
        updates.pop("tier")

    for key, value in updates.items():
        if key == "tier":
            continue
        setattr(plan, key, value)
    if payload.price_monthly is not None:
        plan.price = payload.price_monthly
    plan.updated_at = now_naive()
    await db.commit()
    await db.refresh(plan)
    return plan


@router.delete("/{plan_id}")
async def delete_plan(
    plan_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("plans.manage")),
):
    plan = (
        await db.execute(select(SubscriptionPackage).where(
            SubscriptionPackage.id == plan_id,
            SubscriptionPackage.is_deleted == False,  # noqa: E712
        ))
    ).scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    # Soft delete
    plan.is_deleted = True
    plan.deleted_at = now_naive()
    plan.deleted_by = current_user.id
    plan.is_active = False
    await db.commit()
    return {"success": True, "message": "Plan deleted"}