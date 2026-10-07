"""Maintenance mode state helpers.

Shared by the public status endpoint (`GET /api/settings/maintenance`) and the
`MaintenanceGuard` middleware. State lives in the single-row `app_settings`
table (Postgres) so it survives backend/frontend restarts during a live
update. Phase derivation:

    off      -> maintenance disabled
    grace    -> enabled, within MAINTENANCE_GRACE_MINUTES of enabled_at
    enforced -> enabled, grace elapsed (non-super-admin traffic is blocked)
"""

import logging
import time
from datetime import timedelta
from typing import Optional

from sqlalchemy import select

from app.models.app_setting import AppSetting
from config.settings import settings
from app.utils.timezone import BST, now, now_naive

logger = logging.getLogger(__name__)

PHASE_OFF = "off"
PHASE_GRACE = "grace"
PHASE_ENFORCED = "enforced"

STATUS_CACHE_TTL = 3.0  # seconds; keeps middleware reads cheap
_status_cache: dict = {"at": 0.0, "status": None}


def grace_minutes() -> int:
    return max(0, int(settings.MAINTENANCE_GRACE_MINUTES))


def compute_phase(enabled: bool, enabled_at) -> str:
    if not enabled:
        return PHASE_OFF
    if enabled_at is None:
        # Enabled without a timestamp (manual DB edit / legacy): enforce now.
        return PHASE_ENFORCED
    if now_naive() >= enabled_at + timedelta(minutes=grace_minutes()):
        return PHASE_ENFORCED
    return PHASE_GRACE


def to_status_dict(setting: Optional[AppSetting]) -> dict:
    enabled = bool(setting and setting.maintenance_enabled)
    enabled_at = setting.maintenance_enabled_at if setting else None
    phase = compute_phase(enabled, enabled_at)
    grace_until = None
    if enabled and enabled_at is not None:
        grace_until = enabled_at.replace(tzinfo=BST) + timedelta(minutes=grace_minutes())
    return {
        "enabled": enabled,
        "phase": phase,
        "message": (setting.maintenance_message if setting else None),
        "grace_minutes": grace_minutes(),
        "grace_until": grace_until.isoformat() if grace_until else None,
        "server_now": now().isoformat(),
    }


async def get_setting(db) -> Optional[AppSetting]:
    result = await db.execute(select(AppSetting).where(AppSetting.id == 1))
    return result.scalar_one_or_none()


async def get_status(db) -> dict:
    """Fresh status read (public endpoint)."""
    return to_status_dict(await get_setting(db))


async def get_status_cached() -> dict:
    """TTL-cached status read for the middleware hot path."""
    ts = time.monotonic()
    if _status_cache["status"] is not None and ts - _status_cache["at"] < STATUS_CACHE_TTL:
        return _status_cache["status"]
    from app.services.db_service import async_session
    async with async_session() as db:
        status = await get_status(db)
    _status_cache["at"] = ts
    _status_cache["status"] = status
    return status


def invalidate_status_cache() -> None:
    _status_cache["at"] = 0.0
    _status_cache["status"] = None
