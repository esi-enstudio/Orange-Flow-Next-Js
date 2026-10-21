"""House access + plan module guard middleware.

Primary enforcement layer for house-level access control. It runs for every
authenticated `/api` request and checks, in order:

1. **House billing gate** — the active house must be enabled and its latest
   subscription must be entitled (active / trialing / past-due within grace).
   Expired plans therefore block every user of that house in real time, even
   before the billing scheduler flips `House.is_active` (defense in depth).
2. **Plan module gate** — resolves the path to a top-level module key and
   blocks a request when the active house is on a strict plan that excludes
   that module — or, for a plan that grants only some pages of a module,
   excludes the specific page owning the request path (see
   `entitlement.api_path_allowed`).

Design rules (ALSO enforced per-endpoint via `require_plan_module` when needed):

- Legacy / no-plan / package-less houses are NEVER plan-restricted (fail-open);
  the house billing gate only applies when the house is deactivated or a
  subscription record exists and lost entitlement.
- Base modules (dashboard, todos, administration) are always allowed.
- Super admins bypass both gates entirely. Other admin/manager roles bypass
  only the plan module gate — they are still tenants of their house, so an
  expired subscription blocks them too (they can still open billing and renew).
- Unauthenticated requests are left to the endpoint's own auth checks.
- Auth, house read-only views (so users can see plan status), subscription /
  billing / plan management (so an expired house can renew), webhooks, deploys
  and platform admin paths are always allowed.
- Within a leaf-gated module, API paths with no mapped page owner are DENIED
  (secure fail-closed); map new endpoints in `config/modules.py`
  (`LEAF_TO_API_PREFIXES` / `MODULE_SHARED_API_PREFIXES`).
"""

import logging

from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.responses import JSONResponse

from config.modules import module_for_path

logger = logging.getLogger(__name__)

# Always reachable regardless of house/plan state.
_ALWAYS_EXEMPT_PREFIXES = (
    "/api/auth",
    "/api/v1/subscription",
    "/api/v1/billing",
    "/api/v1/plans",
    "/api/v1/admin",
    "/api/webhook",
    "/api/deploy",
    "/api/health",
)

# Read-only house views stay reachable so users can see why they are blocked
# (plan, expiry, days remaining). Mutations are still gated.
_READ_ONLY_EXEMPT_PREFIXES = ("/api/houses",)

_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def _matches_prefix(path: str, prefix: str) -> bool:
    return path == prefix or path.startswith(prefix + "/")


def _is_exempt(request) -> bool:
    path = request.url.path
    if any(_matches_prefix(path, prefix) for prefix in _ALWAYS_EXEMPT_PREFIXES):
        return True
    if request.method in _SAFE_METHODS and any(
        _matches_prefix(path, prefix) for prefix in _READ_ONLY_EXEMPT_PREFIXES
    ):
        return True
    return False


class PlanModuleGuard(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path = request.url.path
        if not path.startswith("/api"):
            return await call_next(request)
        if _is_exempt(request):
            return await call_next(request)

        auth = request.headers.get("Authorization")
        token = None
        if auth and auth.lower().startswith("bearer "):
            token = auth[7:].strip()
        if not token:
            return await call_next(request)

        try:
            from app.services.db_service import async_session
            from app.models.user import User
            from app.models.role import Role
            from sqlalchemy import select
            from sqlalchemy.orm import selectinload
            from app.services import entitlement
            from app.utils.access_control import is_admin_user, is_super_admin_user

            async with async_session() as db:
                user = (await db.execute(
                    select(User).options(
                        selectinload(User.roles).selectinload(Role.permissions),
                        selectinload(User.houses),
                    ).where(User.id == _user_id_from_token(token))
                )).unique().scalar_one_or_none()

                if user is None:
                    return await call_next(request)

                # Only the platform super admin bypasses house billing. House
                # managers/admins belong to the tenant and must be blocked when
                # their house's subscription expires (billing stays reachable).
                if is_super_admin_user(user):
                    return await call_next(request)

                access = await _resolve_house_access(db, request, user, entitlement)
                if isinstance(access, JSONResponse):
                    return access
                house_id, sub = access

                # Existing plan-module gating keeps treating managers as admins.
                if is_admin_user(user):
                    return await call_next(request)

                module = module_for_path(path)
                if module is not None and not entitlement.api_path_allowed(
                    sub, module, path
                ):
                    logger.info(
                        "Plan module denied: path=%s module=%s user=%s house_id=%s",
                        path, module, user.id, house_id,
                    )
                    return JSONResponse(
                        status_code=403,
                        content={
                            "success": False,
                            "error": {
                                "code": "PLAN_MODULE_DISABLED",
                                "message": (
                                    f"The '{module}' module (or the requested page "
                                    "within it) is not included in your current "
                                    "plan. Please contact your administrator to "
                                    "enable it."
                                ),
                                "required_module": module,
                                "path": path,
                            },
                        },
                    )
        except Exception as e:  # pragma: no cover - defensive, never break a request
            logger.warning("Plan module guard skipped for %s: %s", path, e)

        return await call_next(request)


def _house_block_reason(house, sub, entitlement) -> str | None:
    """Why the house is unavailable to a non-admin user (None = allowed)."""
    if not house.is_active:
        return "HOUSE_INACTIVE"
    if sub is not None and not entitlement.is_entitled(sub):
        return "SUBSCRIPTION_EXPIRED"
    return None


def _blocked_response(reason: str, house_id: int, sub, entitlement) -> JSONResponse:
    status = entitlement.effective_status(sub) if sub is not None else None
    if reason == "SUBSCRIPTION_EXPIRED":
        message = (
            "This house's subscription has expired. Renew the plan to restore "
            "access for all of its users."
        )
    else:
        message = (
            "This house is deactivated. Contact your administrator to restore "
            "access."
        )
    return JSONResponse(
        status_code=403,
        content={
            "success": False,
            "error": {
                "code": reason,
                "message": message,
                "house_id": house_id,
                "plan_status": status,
            },
        },
    )


async def _resolve_house_access(db, request, user, entitlement):
    """Return `(house_id, subscription)` for plan checks or a 403 response.

    Resolution order:
    - `X-House-ID` header when present (must belong to the user; the house must
      be active with an entitled subscription).
    - Otherwise the user's houses: exactly one house -> that house; multiple
      houses -> the first usable one (all-expired users are blocked).
    """
    houses = list(user.houses)
    houses_by_id = {house.id: house for house in houses}
    sub_map = await entitlement.get_latest_subscriptions_for_houses(
        db, list(houses_by_id.keys())
    )

    header = request.headers.get("X-House-ID")
    if header:
        try:
            requested = int(header)
        except (TypeError, ValueError):
            # Endpoint dependency will reject malformed headers.
            return (None, None)
        house = houses_by_id.get(requested)
        if house is None:
            return JSONResponse(
                status_code=403,
                content={
                    "success": False,
                    "error": {
                        "code": "HOUSE_ACCESS_DENIED",
                        "message": "You do not have access to this house.",
                        "house_id": requested,
                    },
                },
            )
        sub = sub_map.get(requested)
        reason = _house_block_reason(house, sub, entitlement)
        if reason:
            return _blocked_response(reason, requested, sub, entitlement)
        return (requested, sub)

    if not houses:
        return (None, None)

    first_blocked = None
    for house in houses:
        sub = sub_map.get(house.id)
        reason = _house_block_reason(house, sub, entitlement)
        if reason is None:
            return (house.id, sub)
        if first_blocked is None:
            first_blocked = (house, sub, reason)

    house, sub, reason = first_blocked
    return _blocked_response(reason, house.id, sub, entitlement)


def _user_id_from_token(token: str):
    from jose import jwt, JWTError
    from config.settings import settings
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        sub = payload.get("sub")
        return int(sub) if sub else None
    except (JWTError, ValueError, TypeError):
        return None
