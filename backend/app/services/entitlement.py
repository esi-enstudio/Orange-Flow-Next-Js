"""Centralized subscription entitlement service.

Single source of truth for:
  - whether a house has an entitled subscription (active / trialing / past_due-in-grace)
  - which features a plan includes
  - whether a plan limit is exceeded
  - whether a house may use the product at all (`house_access_state`)

Routers MUST go through this module instead of scattering raw subscription
checks. FastAPI dependencies: `require_subscription`, `require_feature`.

Access policy is DENY-BY-DEFAULT:
  - no subscription record   -> SUBSCRIPTION_REQUIRED (blocked)
  - plan expired / cancelled -> SUBSCRIPTION_EXPIRED  (blocked)
  - house deactivated        -> HOUSE_INACTIVE        (blocked)
  - package-less subscription (anomalous legacy row) -> SUBSCRIPTION_REQUIRED
    (blocked + audited; the startup migration attaches the explicit
    ``legacy-unlimited`` plan so the row keeps meaning what it used to mean)
Super admins bypass everything; other admins still lose product access but keep
billing/plans reachable so they can renew. `settings.BILLING_REQUIRE_PLAN`
restores the old fail-open behaviour for a staged rollout.
"""

import logging
import math
from datetime import timedelta
from typing import Optional

from fastapi import Depends, HTTPException, status
from sqlalchemy import inspect as sa_inspect, func, select
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
from config.settings import settings
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

# ---------------------------------------------------------------------------
# House access policy codes (deny-by-default)
# ---------------------------------------------------------------------------
ACCESS_CODE_NO_PLAN = "SUBSCRIPTION_REQUIRED"
ACCESS_CODE_EXPIRED = "SUBSCRIPTION_EXPIRED"
ACCESS_CODE_HOUSE_INACTIVE = "HOUSE_INACTIVE"

# Suggested next step for the frontend, keyed by block code.
ACCESS_ACTION_BY_CODE = {
    ACCESS_CODE_NO_PLAN: "select_plan",
    ACCESS_CODE_EXPIRED: "renew",
    ACCESS_CODE_HOUSE_INACTIVE: "contact_admin",
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


async def get_latest_subscriptions_for_houses(
    db: AsyncSession, house_ids: list[int]
) -> dict[int, HouseSubscription]:
    """Bulk-load the latest subscription per house (single query).

    Used by list endpoints to avoid an N+1 query per house. Houses without a
    subscription are absent from the returned mapping.
    """
    if not house_ids:
        return {}
    latest_ids = (
        select(func.max(HouseSubscription.id))
        .where(
            HouseSubscription.is_deleted == False,  # noqa: E712
            HouseSubscription.house_id.in_(house_ids),
        )
        .group_by(HouseSubscription.house_id)
        .scalar_subquery()
    )
    result = await db.execute(
        select(HouseSubscription)
        .options(selectinload(HouseSubscription.package))
        .where(HouseSubscription.id.in_(latest_ids))
    )
    return {sub.house_id: sub for sub in result.scalars().all()}


def subscription_summary(sub: Optional[HouseSubscription], now=None) -> dict:
    """Plan/expiry summary for API responses (houses list, switchers).

    `plan_days_remaining` is ceil() so a plan with hours left shows "1 day"
    instead of "0 days"; a plan that already ended returns 0.
    """
    now = now or now_naive()
    if sub is None:
        return {
            "plan_name": None,
            "plan_slug": None,
            "plan_status": None,
            "plan_end_date": None,
            "plan_days_remaining": None,
            "plan_billing_interval": None,
            "plan_is_valid": None,
        }
    status = effective_status(sub, now)
    end_date = sub.current_period_end or sub.end_date
    days_remaining = None
    if end_date is not None:
        remaining_seconds = (end_date - now).total_seconds()
        days_remaining = (
            max(0, math.ceil(remaining_seconds / 86400))
            if remaining_seconds > 0
            else 0
        )
    # `package` may be unloaded (e.g. a fresh object); never trigger a lazy
    # load inside async code. Callers that need the name eager-load it.
    package = None
    try:
        if "package" not in sa_inspect(sub).unloaded:
            package = sub.package
    except Exception:  # pragma: no cover - detached instances
        package = None
    return {
        "plan_name": package.name if package else None,
        "plan_slug": package.slug if package else None,
        "plan_status": status,
        "plan_end_date": end_date,
        "plan_days_remaining": days_remaining,
        "plan_billing_interval": sub.billing_interval,
        "plan_is_valid": is_entitled(sub, now),
    }


def effective_status(sub: HouseSubscription, now=None) -> str:
    """Resolve the real-time status considering trial & grace windows.

    Expiry boundary (canonical, do not change silently):
      - A billing period covers the half-open interval ``[start, end)``.
      - At exactly ``current_period_end`` the period is OVER (``now >= end``).
      - The grace window covers ``[end, end + BILLING_GRACE_DAYS)`` and reports
        ``past_due`` (still entitled).
      - After the grace window the subscription is ``expired`` (blocked).
      - Trial covers ``[trial_start, trial_end)`` the same way.

    All timestamps are naive Bangladesh Standard Time (``now_naive()``); the
    comparison never mixes UTC and BST, so a plan cannot expire hours early or
    late because of a timezone conversion.
    """
    if sub is None:
        return None
    now = now or now_naive()
    status_str = sub.status
    if status_str == SUBSCRIPTION_STATUS_TRALING:
        if sub.trial_end and now >= sub.trial_end:
            return SUBSCRIPTION_STATUS_ACTIVE
        return SUBSCRIPTION_STATUS_TRALING
    if status_str == SUBSCRIPTION_STATUS_ACTIVE:
        # Real-time expiry: the scheduler normally flips an overdue period to
        # past_due, but access must not depend on its 5-minute tick. Treat the
        # configured grace window after the period end as past_due.
        period_end = sub.current_period_end or sub.end_date
        if period_end is not None and now >= period_end:
            grace_end = period_end + timedelta(days=settings.BILLING_GRACE_DAYS)
            if now < grace_end:
                return SUBSCRIPTION_STATUS_PAST_DUE
            return "expired"
        return SUBSCRIPTION_STATUS_ACTIVE
    if status_str == SUBSCRIPTION_STATUS_PAST_DUE:
        if sub.grace_period_end and now < sub.grace_period_end:
            return SUBSCRIPTION_STATUS_PAST_DUE
        return "expired"
    return status_str


def is_entitled(sub: Optional[HouseSubscription], now=None) -> bool:
    if sub is None:
        return False
    return effective_status(sub, now) in _ENTITLED_STATUSES


def house_access_state(house, sub: Optional[HouseSubscription], now=None) -> Optional[str]:
    """Decide whether a house may use the product at all.

    Returns `None` when access is granted, otherwise one of the `ACCESS_CODE_*`
    strings.

    Order matters, because the billing lifecycle deactivates a house when its
    plan expires. Checking entitlement first means an expired plan reports
    "renew your plan" (actionable) instead of the generic "contact your
    administrator", while a *manually* deactivated house with a valid plan
    still reports HOUSE_INACTIVE.
    """
    if is_package_less(sub):
        # A subscription row with no plan is a data defect, not a free pass.
        # It must be repaired (startup migration) or given a real plan.
        return ACCESS_CODE_NO_PLAN
    if sub is not None and not is_entitled(sub, now):
        return ACCESS_CODE_EXPIRED
    if house is not None and not getattr(house, "is_active", True):
        return ACCESS_CODE_HOUSE_INACTIVE
    if sub is None:
        if settings.BILLING_REQUIRE_PLAN:
            return ACCESS_CODE_NO_PLAN
        return None  # staged rollout: legacy fail-open
    return None


def access_block_payload(house, sub, code: str, now=None) -> dict:
    """Structured, self-explanatory body for a blocked house (HTTP 403).

    The frontend localises `code`; `message` is an English fallback that names
    the house, the plan and the expiry so a screenshot alone explains the block.
    """
    now = now or now_naive()
    package_less = is_package_less(sub)
    plan = sub.package if (sub is not None and sub.package is not None) else None
    status = effective_status(sub, now) if (sub is not None and not package_less) else None
    end_date = (
        (sub.current_period_end or sub.end_date)
        if (sub is not None and not package_less)
        else None
    )

    days_remaining = None
    if end_date is not None:
        remaining_seconds = (end_date - now).total_seconds()
        days_remaining = max(0, math.ceil(remaining_seconds / 86400)) if remaining_seconds > 0 else 0

    house_id = getattr(house, "id", None)
    house_name = getattr(house, "name", None)
    label = f'"{house_name}"' if house_name else "This house"

    if code == ACCESS_CODE_HOUSE_INACTIVE:
        message = (
            f"{label} is deactivated. Contact your administrator to restore access."
        )
    elif code == ACCESS_CODE_NO_PLAN:
        message = (
            f"No plan is assigned to {label}. An administrator must choose a plan "
            "before its users can use the system."
        )
    else:
        message = (
            f"The subscription for {label} is not active (status: {status or 'none'}). "
            "Renew the plan to restore access for its users."
        )

    return {
        "code": code,
        "message": message,
        "action": ACCESS_ACTION_BY_CODE.get(code, "contact_admin"),
        "house_id": house_id,
        "house_name": house_name,
        "plan_status": status,
        "plan_name": plan.name if plan is not None else None,
        "plan_end_date": end_date.isoformat() if end_date is not None else None,
        "days_remaining": days_remaining,
    }


def is_package_less(sub: Optional[HouseSubscription]) -> bool:
    """A subscription row that references no plan at all (data defect).

    Distinct from "no subscription row" (`sub is None`): both are denied, but
    only this one is repairable by the startup migration. It is **not** a free
    pass — an old row left package-less must never grant unrestricted access.
    """
    return sub is not None and sub.package is None


def feature_enabled(sub: Optional[HouseSubscription], feature: str) -> bool:
    """Whether the house's plan allows `feature`. No plan => nothing included."""
    if sub is None or is_package_less(sub):
        return False
    flags = sub.package.feature_flags or []
    return feature in flags


def limit_value(sub: Optional[HouseSubscription], limit_key: str) -> Optional[int]:
    """Plan limit value for a house.

    `None` => unlimited (explicitly configured legacy plan). `0` => no plan at
    all (or a package-less row), so every quota is exhausted.
    """
    if sub is None or is_package_less(sub):
        return 0
    limits = sub.package.limits or {}
    value = limits.get(limit_key)
    return int(value) if value is not None else None


def allowed_modules(sub: Optional[HouseSubscription]) -> Optional[list]:
    """Explicit module/page grants from the house's plan.

    Returns:
      - `[]`   : no grants at all (no subscription / package-less row)
      - `None` : plan intentionally grants every module (unlimited/legacy)
      - `list` : strict plan, only these keys/leaves (+ always-on base modules)
    """
    if sub is None or is_package_less(sub):
        # Deny-by-default: a house without a real plan gets no module grants.
        return []
    modules = sub.package.allowed_modules
    if modules is None:
        # NULL is the only "unlimited" signal, and it must be explicit.
        return None
    # An explicit list — including an empty one — is strict. `[]` grants no
    # modules (base modules stay available), never "everything".
    return list(modules)


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
        if sub is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "SUBSCRIPTION_REQUIRED: An active subscription is required "
                    "to use this feature."
                ),
            )
        if not feature_enabled(sub, feature):
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