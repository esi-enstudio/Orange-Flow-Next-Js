"""Maintenance guard middleware.

When a Super Admin enables maintenance mode and the grace/countdown period has
elapsed (`phase == "enforced"`), every `/api` request is blocked with a
structured 503 `MAINTENANCE` response — except a small platform allowlist
(public status endpoint, login/profile so the app shell can resolve identity,
webhooks) and Super Admin requests (strict role bypass).

The UI side is handled by the Next.js middleware + client MaintenanceContext;
this is the authoritative enforcement layer (frontend filtering is never
trusted).
"""

import logging
import time

from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

# Paths allowed through on ANY method even while enforced: auth endpoints let
# the shell resolve the current user (route handlers keep enforcing their own
# permissions); webhooks are external machine traffic that must not drop data.
ALLOWED_PATHS = frozenset({
    "/api/auth/login",
    "/api/auth/me",
})
ALLOWED_PREFIXES = ("/api/webhook/",)

# Public read-only endpoints allowed while enforced (GET only): the maintenance
# status drives the client countdown/redirect, brand settings let the
# maintenance screen show the app logo/name, and the setup status probe keeps
# AuthProvider from stalling through its retry loop on the maintenance page.
ALLOWED_GET_PATHS = frozenset({
    "/api/settings/maintenance",
    "/api/settings/brand",
    "/api/admin/setup/status",
})

_SUPER_ADMIN_CACHE_TTL = 30.0  # seconds
_super_admin_cache: dict[int, tuple[float, bool]] = {}

_503_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
}


class MaintenanceGuard(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path = request.url.path
        if not path.startswith("/api"):
            # Non-API paths (docs, uploads, static) are not gated here; the UI
            # is gated by the Next.js middleware and client-side guard.
            return await call_next(request)
        if (
            path in ALLOWED_PATHS
            or (path in ALLOWED_GET_PATHS and request.method == "GET")
            or path.startswith(ALLOWED_PREFIXES)
        ):
            return await call_next(request)

        try:
            from app.services.maintenance_service import get_status_cached
            status = await get_status_cached()
        except Exception as e:  # pragma: no cover - defensive, never break requests
            logger.warning("Maintenance guard skipped for %s: %s", path, e)
            return await call_next(request)

        if status.get("phase") != "enforced":
            return await call_next(request)

        if await _is_super_admin_request(request):
            return await call_next(request)

        logger.info("Maintenance blocked: %s %s", request.method, path)
        return JSONResponse(
            status_code=503,
            headers=_503_HEADERS,
            content={
                "success": False,
                "error": {
                    "code": "MAINTENANCE",
                    "error_code": "maintenance_mode",
                    "message": "System is under maintenance. Please try again later.",
                },
            },
        )


async def _is_super_admin_request(request) -> bool:
    auth = request.headers.get("Authorization") or ""
    if not auth.lower().startswith("bearer "):
        return False
    token = auth[7:].strip()

    try:
        from jose import jwt
        from config.settings import settings
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id = int(payload["sub"])
    except Exception:
        return False

    hit = _super_admin_cache.get(user_id)
    ts = time.monotonic()
    if hit is not None and ts - hit[0] < _SUPER_ADMIN_CACHE_TTL:
        return hit[1]

    try:
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload
        from app.services.db_service import async_session
        from app.models.user import User
        from app.models.role import Role
        from app.utils.access_control import is_super_admin_user

        async with async_session() as db:
            user = (await db.execute(
                select(User)
                .options(selectinload(User.roles).selectinload(Role.permissions))
                .where(User.id == user_id)
            )).unique().scalar_one_or_none()
            result = bool(user and is_super_admin_user(user))
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("Maintenance super-admin check failed for user %s: %s", user_id, e)
        return False  # fail closed while enforced

    _super_admin_cache[user_id] = (ts, result)
    return result


def invalidate_super_admin_cache() -> None:
    _super_admin_cache.clear()
