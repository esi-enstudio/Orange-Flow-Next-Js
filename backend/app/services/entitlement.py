"""Centralized subscription entitlement service.

Single source of truth for:
  - whether a house has an entitled subscription (active / trialing / past_due-in-grace)
  - which features a plan includes
  - whether a plan limit is exceeded

Routers MUST go through this module instead of scattering raw subscription
checks. FastAPI dependencies: `require_subscription`, `require_feature`.
Admin users and legacy subscribers (no package attached) bypass limits.

Default policy is FAIL-OPEN for legacy houses (existing deployments keep
working). Strict gating can be enabled per feature/plan without code changes.
"""

import logging
from typing import Optional

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.routers.deps import get_db, get_house_context, get_current_user
from app.models.user import User
from app.models.subscription import (
    HouseSubscription,
    SubscriptionPackage,
    SUBSCRIPTION_STATUS_ACTIVE,
    SUBSCRIPTION_STATUS_TRALING,
    SUBSCRIPTION_STATUS_PAST_DUE,
)
from app.utils.access_control import is_admin_user
from app.utils.timezone import now_naive
from config.modules import (
    BASE_MODULES,
    MODULE_LEAF_ROUTES,
    MODULE_SHARED_API_PREFIXES,
    leaf_owners_for_path,
)

logger = logging.getLogger(__name__)

# Statuses that still grant access
_ENTITLED_STATUSES = {
    SUBSCRIPTION_STATUS_ACTIVE,
    SUBSCRIPTION_STATUS_TRALING,
    SUBSCRIPTION_STATUS_PAST_DUE,
}


def _package_loader():
    """selectinload option shared by routers that load subscriptions with plans."""
    return selectinload(HouseSubscription.package)


async def get_house_subscription(
    db: AsyncSession, house_id: int, include_soft_deleted: bool = False
) -> Optional[HouseSubscription]:
    """Return the latest (most recent) subscription for a house."""
    query = (
        select(HouseSubscription)
        .options(selectinload(HouseSubscription.package))
        .where(HouseSubscription.house_id == house_id)
        .order_by(HouseSubscription.id.desc())
    )
    if not include_soft_deleted:
        query = query.where(HouseSubscription.is_deleted == False)  # noqa: E712
    result = await db.execute(query)
    return result.scalars().first()


def effective_status(sub: HouseSubscription, now=None) -> str:
    """Resolve the real-time status considering trial & grace windows."""
    if sub is None:
        return None
    now = now or now_naive()
    status_str = sub.status
    if status_str == SUBSCRIPTION_STATUS_TRALING:
        if sub.trial_end and now > sub.trial_end:
            return SUBSCRIPTION_STATUS_ACTIVE
        return SUBSCRIPTION_STATUS_TRALING
    if status_str == SUBSCRIPTION_STATUS_ACTIVE:
        return SUBSCRIPTION_STATUS_ACTIVE
    if status_str == SUBSCRIPTION_STATUS_PAST_DUE:
        if sub.grace_period_end and now <= sub.grace_period_end:
            return SUBSCRIPTION_STATUS_PAST_DUE
        return "expired"
    return status_str


def is_entitled(sub: Optional[HouseSubscription], now=None) -> bool:
    if sub is None:
        return False
    return effective_status(sub, now) in _ENTITLED_STATUSES


def has_plan_fallback(sub: Optional[HouseSubscription]) -> bool:
    """Legacy subscribers (no package) are treated as fully entitled (fail-open)."""
    return sub is None or sub.package is None


def feature_enabled(sub: Optional[HouseSubscription], feature: str) -> bool:
    """Whether the house's plan allows `feature`. Admin/legacy => True."""
    if has_plan_fallback(sub):
        return True
    flags = sub.package.feature_flags or []
    return feature in flags


def limit_value(sub: Optional[HouseSubscription], limit_key: str) -> Optional[int]:
    """Plan limit value for a house. None => unlimited (legacy/no config)."""
    if has_plan_fallback(sub):
        return None
    limits = sub.package.limits or {}
    value = limits.get(limit_key)
    return int(value) if value is not None else None


def allowed_modules(sub: Optional[HouseSubscription]) -> Optional[list]:
    """Explicit top-level module list granted by the house's plan.

    None => legacy/unrestricted (fail-open). A list => strict gating.
    """
    if has_plan_fallback(sub):
        return None
    modules = sub.package.allowed_modules or []
    return list(modules) if modules else None


def module_enabled(sub: Optional[HouseSubscription], module_key: str) -> bool:
    """Whether the house's plan allows `module_key`.

    Legacy/no-plan subscribers (allowed_modules None) are always allowed,
    matching the fail-open policy. Base modules are always enabled. A module is
    also enabled when the plan grants either the module key itself OR at least
    one of its page-level ("leaf") routes.
    """
    modules = allowed_modules(sub)
    if modules is None:
        return True
    if module_key in BASE_MODULES:
        return True
    if module_key in modules:
        return True
    leaves = MODULE_LEAF_ROUTES.get(module_key, ())
    return any(leaf in modules for leaf in leaves)


async def enforce_plan_limit(
    db: AsyncSession,
    house_id: int,
    limit_key: str,
    current_count: int,
    raise_on_exceed: bool = True,
) -> tuple:
    """Server-side plan-limit enforcement.

    Returns (allowed, limit, plan_name). Raises 403 when exceeded unless
    `raise_on_exceed` is False (useful for read-only UI status).
    """
    sub = await get_house_subscription(db, house_id)
    limit = limit_value(sub, limit_key)
    if limit is None:
        return True, None, None
    plan_name = sub.package.name if sub.package else "N/A"
    exceeded = current_count >= limit
    if exceeded and raise_on_exceed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"PLAN_LIMIT_EXCEEDED: {limit_key} limit is {limit} "
                f"(currently {current_count}). Upgrade your '{plan_name}' plan."
            ),
        )
    return (not exceeded), limit, plan_name


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------

async def _house_id_for(user: User, house_context: Optional[int]) -> Optional[int]:
    if is_admin_user(user):
        return house_context
    if house_context:
        return house_context
    if user.houses:
        return user.houses[0].id
    return None


async def require_subscription(
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Optional[HouseSubscription]:
    """Gate an endpoint behind an entitled subscription.

    Admin users without an X-House-ID bypass (returns None). Everyone else
    must provide a house they belong to with an entitled subscription.
    """
    if is_admin_user(current_user) and not house_context:
        return None
    house_id = await _house_id_for(current_user, house_context)
    if not house_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please select a house first (X-House-ID header required)",
        )
    sub = await get_house_subscription(db, house_id)
    if sub is None or not is_entitled(sub):
        current = effective_status(sub) if sub else None
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"SUBSCRIPTION_REQUIRED: An active subscription is required "
                f"(current status: {current or 'none'})."
            ),
        )
    return sub


def require_feature(feature: str):
    """Dependency factory: gate an endpoint behind a plan feature flag."""

    async def dep(
        house_context: Optional[int] = Depends(get_house_context),
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        if is_admin_user(current_user) and not house_context:
            return None
        house_id = await _house_id_for(current_user, house_context)
        if not house_id:
            return None
        sub = await get_house_subscription(db, house_id)
        if sub is not None and not feature_enabled(sub, feature):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"FEATURE_REQUIRED: '{feature}' is not included in your "
                    "current plan. Please upgrade to enable this feature."
                ),
            )
        return None

    return dep


# ---------------------------------------------------------------------------
# Plan module gating
# ---------------------------------------------------------------------------

def module_gated(sub: Optional[HouseSubscription], module_key: str) -> bool:
    """True when the house has a strict plan that excludes `module_key`."""
    return allowed_modules(sub) is not None and not module_enabled(sub, module_key)


def api_path_allowed(
    sub: Optional[HouseSubscription], module_key: str, path: str
) -> bool:
    """Per-path page-level API enforcement for plan module access.

    Decision table (checked in order):

    1. Legacy / no-plan / package-less (allowed_modules None)  -> allow
    2. Base modules                                            -> allow
    3. Whole module granted (module key in the set)            -> allow
    4. Module not granted at all (no key, no leaf)             -> deny
    5. Leaf-gated module (only page grants present):
         - shared module-level prefix  -> allow
         - path owned by a granted leaf (longest match) -> allow
         - otherwise                    -> deny (secure fail-closed)
    """
    modules = allowed_modules(sub)
    if modules is None:
        return True
    if module_key in BASE_MODULES:
        return True
    module_set = set(modules)
    if module_key in module_set:
        return True
    leaves = MODULE_LEAF_ROUTES.get(module_key, ())
    granted_leaves = [leaf for leaf in leaves if leaf in module_set]
    if not granted_leaves:
        return False
    for shared in MODULE_SHARED_API_PREFIXES.get(module_key, ()):
        if path.startswith(shared):
            return True
    owners = leaf_owners_for_path(module_key, path)
    if not owners:
        logger.warning(
            "No page owner for %s under leaf-gated module %s — denied",
            path, module_key,
        )
        return False
    return any(owner in module_set for owner in owners)


def require_plan_module(module_key: str):
    """Dependency factory: gate an endpoint behind an explicit plan module.

    Only meaningful for houses on a strict plan (allowed_modules set). Legacy,
    admin-without-house, and base modules bypass. Individual permission checks
    still apply on top.
    """

    async def dep(
        house_context: Optional[int] = Depends(get_house_context),
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        if is_admin_user(current_user) and not house_context:
            return None
        house_id = await _house_id_for(current_user, house_context)
        if not house_id:
            return None
        sub = await get_house_subscription(db, house_id)
        if module_gated(sub, module_key):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "PLAN_MODULE_DISABLED: "
                    f"The '{module_key}' module is not included in your current plan. "
                    "Please contact the administrator to add it."
                ),
            )
        return None

    return dep