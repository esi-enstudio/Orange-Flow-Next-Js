"""House access + plan module guard middleware.

Primary enforcement layer for house-level access control. It runs for every
authenticated `/api` request and checks, in order:

1. **House access gate** — deny-by-default for the whole tenant:
   - house deactivated                     -> `HOUSE_INACTIVE`
   - no subscription record at all         -> `SUBSCRIPTION_REQUIRED`
   - subscription not entitled (expired /
     cancelled / paused / past grace)      -> `SUBSCRIPTION_EXPIRED`
   The 403 body is structured and self-explanatory (`house_id`, `house_name`,
   `plan_name`, `plan_status`, `plan_end_date`, `days_remaining`, `action`) so
   the UI can tell the user exactly why they are blocked.
2. **Plan module gate** — resolves the path to a top-level module key and
   blocks a request when the active house is on a strict plan that excludes
   that module — or, for a plan that grants only some pages of a module,
   excludes the specific page owning the request path (see
   `entitlement.api_path_allowed`).

Design rules (ALSO enforced per-endpoint via `require_plan_module` when needed):

- Super admins bypass both gates entirely (logged for audit).
- Every other role — including a house admin/manager — passes through the plan
  module gate: a tenant admin is a tenant of their own plan, so the plan's
  module list applies to them too. The house access gate applies to them as
  well (an expired plan blocks the product). Billing, plans, profile and
  read-only house views stay reachable so they can renew or pick a plan.
- `settings.BILLING_REQUIRE_PLAN = False` restores the legacy fail-open policy
  (a house with no subscription record keeps full access) for a staged rollout.
- Package-less subscriptions are blocked as "no plan" (deny-by-default); the
  startup migration attaches the explicit `legacy-unlimited` plan instead.
- Base modules (dashboard, todos, administration) are always allowed once the
  house access gate passes.
- Unauthenticated requests are left to the endpoint's own auth checks.
- Auth, billing/subscription/plan management, webhooks, deploys and platform
  admin paths are always allowed.
- Within a leaf-gated module, API paths with no mapped page owner are DENIED
  (secure fail-closed); map new endpoints in `config/modules.py`
  (`LEAF_TO_API_PREFIXES` / `MODULE_SHARED_API_PREFIXES`).
- API paths that are **not in `PATH_TO_MODULE` at all** are denied for strict
  plans (`PLAN_MODULE_UNMAPPED`), so a forgotten mapping can never leak a paid
  module. Unlimited/legacy plans keep working and get a warning instead.
"""

import logging
import time
import uuid
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.responses import JSONResponse

from config.modules import module_for_path, path_is_mapped

logger = logging.getLogger(__name__)

# Blocks repeat on every poll/refresh from a blocked UI. Log each
# (house, code, user, path) at most once per minute so operators can still
# search the event without the log becoming the outage.
_BLOCK_LOG_TTL_SECONDS = 60.0
_recent_block_logs: dict = {}


def _request_id(request) -> str:
    """Correlation id for support: client-supplied or generated per request."""
    rid = request.headers.get("X-Request-ID")
    if rid and 0 < len(rid) <= 64:
        return rid
    return uuid.uuid4().hex[:16]


def _should_log_block(key) -> bool:
    now = time.monotonic()
    if len(_recent_block_logs) > 2048:
        _recent_block_logs.clear()
    last = _recent_block_logs.get(key)
    if last is not None and now - last < _BLOCK_LOG_TTL_SECONDS:
        return False
    _recent_block_logs[key] = now
    return True

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

        request_id = _request_id(request)

        try:
            from app.services.db_service import async_session
            from app.models.user import User
            from app.models.role import Role
            from sqlalchemy import select
            from sqlalchemy.orm import selectinload
            from app.services import entitlement
            from app.utils.access_control import is_super_admin_user

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
                    if _should_log_block(("super_admin_bypass", user.id, path)):
                        logger.info(
                            "billing_event=super_admin_bypass user_id=%s path=%s "
                            "method=%s request_id=%s",
                            user.id, path, request.method, request_id,
                        )
                    return await call_next(request)

                access = await _resolve_house_access(
                    db, request, user, entitlement, request_id
                )
                if isinstance(access, JSONResponse):
                    return access
                house, sub = access

                # Plan-module gating applies to EVERY tenant role, including
                # house admins/managers: the plan they bought defines which
                # modules they may use. Only the super admin bypassed above.
                module = module_for_path(path)
                if module is None and not path_is_mapped(path):
                    # Unknown route: it could belong to any paid module, so a
                    # strict plan must not reach it. Fail closed.
                    if entitlement.allowed_modules(sub) is not None:
                        logger.warning(
                            "billing_event=plan_module_unmapped_denied path=%s "
                            "method=%s user_id=%s house_id=%s request_id=%s",
                            path, request.method, user.id,
                            getattr(house, "id", None), request_id,
                        )
                        return JSONResponse(
                            status_code=403,
                            content={
                                "success": False,
                                "error": {
                                    "code": "PLAN_MODULE_UNMAPPED",
                                    "message": (
                                        "This endpoint is not assigned to any "
                                        "plan module, so your plan cannot grant "
                                        "it. Ask the administrator to map it."
                                    ),
                                    "path": path,
                                    "request_id": request_id,
                                },
                            },
                            headers={"X-Request-ID": request_id},
                        )
                    logger.warning(
                        "billing_event=plan_module_unmapped_allowed path=%s user_id=%s "
                        "request_id=%s (unlimited/legacy plan)",
                        path, user.id, request_id,
                    )
                    return await call_next(request)

                if module is not None and not entitlement.api_path_allowed(
                    sub, module, path
                ):
                    logger.warning(
                        "billing_event=plan_module_denied path=%s module=%s "
                        "user_id=%s house_id=%s request_id=%s",
                        path, module, user.id, getattr(house, "id", None), request_id,
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
                                "request_id": request_id,
                            },
                        },
                        headers={"X-Request-ID": request_id},
                    )
        except Exception as e:  # pragma: no cover - defensive, never break a request
            logger.warning(
                "Plan module guard skipped for %s (request_id=%s): %s",
                path, request_id, e,
            )

        return await call_next(request)


def _house_block_reason(house, sub, entitlement) -> str | None:
    """Why the house is unavailable to a non-admin user (None = allowed).

    Delegates to `entitlement.house_access_state`, the single source of truth
    for the deny-by-default policy (no plan / expired / deactivated).
    """
    return entitlement.house_access_state(house, sub)


def _blocked_response(code: str, house, sub, entitlement, request_id: str = "") -> JSONResponse:
    """Structured 403 that explains the block in enough detail to act on it."""
    payload = entitlement.access_block_payload(house, sub, code)
    if request_id:
        payload["request_id"] = request_id
    return JSONResponse(
        status_code=403,
        content={"success": False, "error": payload},
        headers={"X-Request-ID": request_id} if request_id else None,
    )


async def _resolve_house_access(db, request, user, entitlement, request_id: str = ""):
    """Return `(house, subscription)` for plan checks or a 403 response.

    Resolution order:
    - `X-House-ID` header when present (must belong to the user; the house must
      be active and its latest subscription entitled).
    - Otherwise the user's houses: the first usable one wins. When every house
      is blocked the first block reason is returned so the message is stable.
    - Users with no houses resolve to `(None, None)`: there is no tenant to
      gate, and the module gate keeps them on base modules only.
    """
    houses = list(user.houses)
    houses_by_id = {house.id: house for house in houses}
    sub_map = await entitlement.get_latest_subscriptions_for_houses(
        db, list(houses_by_id.keys())
    )

    def _log_block(house, sub, code):
        user_id = getattr(user, "id", None)
        key = ("house_block", user_id, getattr(house, "id", None), code)
        if _should_log_block(key):
            payload = entitlement.access_block_payload(house, sub, code)
            logger.warning(
                "billing_event=house_access_blocked house_id=%s house_name=%s "
                "code=%s plan_status=%s plan_name=%s plan_end_date=%s user_id=%s "
                "method=%s request_id=%s",
                payload.get("house_id"), payload.get("house_name"), code,
                payload.get("plan_status"), payload.get("plan_name"),
                payload.get("plan_end_date"), user_id,
                getattr(request, "method", None), request_id,
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
            user_id = getattr(user, "id", None)
            if _should_log_block(("house_denied", user_id, requested)):
                logger.warning(
                    "billing_event=house_access_denied house_id=%s user_id=%s "
                    "method=%s request_id=%s",
                    requested, user_id, getattr(request, "method", None), request_id,
                )
            return JSONResponse(
                status_code=403,
                content={
                    "success": False,
                    "error": {
                        "code": "HOUSE_ACCESS_DENIED",
                        "message": "You do not have access to this house.",
                        "action": "contact_admin",
                        "house_id": requested,
                        "request_id": request_id,
                    },
                },
                headers={"X-Request-ID": request_id} if request_id else None,
            )
        sub = sub_map.get(requested)
        reason = _house_block_reason(house, sub, entitlement)
        if reason:
            _log_block(house, sub, reason)
            return _blocked_response(reason, house, sub, entitlement, request_id)
        return (house, sub)

    if not houses:
        return (None, None)

    first_blocked = None
    for house in houses:
        sub = sub_map.get(house.id)
        reason = _house_block_reason(house, sub, entitlement)
        if reason is None:
            return (house, sub)
        if first_blocked is None:
            first_blocked = (house, sub, reason)

    house, sub, reason = first_blocked
    _log_block(house, sub, reason)
    return _blocked_response(reason, house, sub, entitlement, request_id)


def _user_id_from_token(token: str):
    from jose import jwt, JWTError
    from config.settings import settings
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        sub = payload.get("sub")
        return int(sub) if sub else None
    except (JWTError, ValueError, TypeError):
        return None
