"""Plan module guard middleware.

Primary enforcement layer for plan-based module access. It runs for every
`/api` request, resolves the path to a top-level module key, and blocks a
request when the active house is on a strict plan that excludes that module —
or, for a plan that grants only some pages of a module, excludes the specific
page owning the request path (see `entitlement.api_path_allowed`).

Design rules (ALSO enforced per-endpoint via `require_plan_module` when needed):

- Legacy / no-plan / package-less houses are NEVER restricted (fail-open).
- Base modules (dashboard, todos, administration) are always allowed.
- Admin users bypass module gating entirely.
- Unauthenticated requests are left to the endpoint's own auth checks.
- Unmapped / platform paths (auth, billing, plans, webhooks, uploads, helpers)
  are always allowed; unmapped unknowns are allowed with a warning so new
  endpoints are never silently broken. The parity test
  (`backend/tests/test_plan_modules_parity.py`) ensures nav pages get mapped.
- Within a leaf-gated module, API paths with no mapped page owner are DENIED
  (secure fail-closed); map new endpoints in `config/modules.py`
  (`LEAF_TO_API_PREFIXES` / `MODULE_SHARED_API_PREFIXES`).
"""

import logging

from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.responses import JSONResponse

from config.modules import module_for_path

logger = logging.getLogger(__name__)


class PlanModuleGuard(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path = request.url.path
        if not path.startswith("/api"):
            return await call_next(request)

        module = module_for_path(path)
        if module is None:
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
            from app.utils.access_control import is_admin_user

            async with async_session() as db:
                user = (await db.execute(
                    select(User).options(
                        selectinload(User.roles).selectinload(Role.permissions),
                        selectinload(User.houses),
                    ).where(User.id == _user_id_from_token(token))
                )).unique().scalar_one_or_none()

                if user is None:
                    return await call_next(request)

                # Admins bypass module restrictions entirely.
                if is_admin_user(user):
                    return await call_next(request)

                house_context = request.headers.get("X-House-ID")
                house_id = None
                if user.houses:
                    house_id = user.houses[0].id
                if house_context:
                    try:
                        house_id = int(house_context)
                    except (TypeError, ValueError):
                        house_id = None
                if not house_id:
                    return await call_next(request)

                sub = await entitlement.get_house_subscription(db, house_id)
                if not entitlement.api_path_allowed(sub, module, path):
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


def _user_id_from_token(token: str):
    from jose import jwt, JWTError
    from config.settings import settings
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        sub = payload.get("sub")
        return int(sub) if sub else None
    except (JWTError, ValueError, TypeError):
        return None