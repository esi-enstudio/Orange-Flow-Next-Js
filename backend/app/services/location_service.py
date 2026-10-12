"""Helpers for employee live-location tracking.

Kept separate from the router so the scheduler can reuse the history-retention
pruner without importing HTTP concerns.
"""

import logging
from datetime import timedelta
from typing import Optional

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.employee_location import EmployeeLocation
from app.models.user import User
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

# An employee is considered "online" when their last ping is within this window.
# The macro pings every 5 minutes, so 15 minutes tolerates a couple of missed
# cycles (poor signal, device doze) without flapping to offline.
LOCATION_ONLINE_MINUTES = 15

# Append-only history older than this is pruned by the scheduler.
LOCATION_HISTORY_RETENTION_DAYS = 30

# Movement-trail thinning to keep 30-day history manageable (macro may ping
# every few seconds). A point is persisted only if the employee moved at least
# this many metres, or this many minutes passed since the last saved point.
LOCATION_MIN_MOVE_METERS = 15.0
LOCATION_HEARTBEAT_MINUTES = 5.0


async def resolve_employee(db: AsyncSession, identifier: str) -> Optional[Employee]:
    """Resolve a device-supplied identifier to an employee.

    Accepts (case-insensitive) any of the employee's business identifiers or the
    linked user's username/email so the macro stays easy to configure.
    """
    ident = (identifier or "").strip().lower()
    if not ident:
        return None

    stmt = (
        select(Employee)
        .where(
            or_(
                func.lower(Employee.employee_id) == ident,
                func.lower(Employee.dms_code) == ident,
                func.lower(Employee.itop_number) == ident,
                func.lower(Employee.personal_number) == ident,
                func.lower(Employee.pool_number) == ident,
                func.lower(Employee.assisted_retailer_code) == ident,
                func.lower(Employee.sr_no) == ident,
            )
        )
        .limit(1)
    )
    emp = (await db.execute(stmt)).scalars().first()
    if emp:
        return emp

    # Fallback: match the linked user account (username / email).
    user_stmt = (
        select(Employee)
        .join(User, Employee.user_id == User.id)
        .where(
            or_(
                func.lower(User.username) == ident,
                func.lower(User.email) == ident,
            )
        )
        .limit(1)
    )
    return (await db.execute(user_stmt)).scalars().first()


async def cleanup_old_locations(db: AsyncSession, days: Optional[int] = None) -> int:
    """Delete history rows older than the retention window. Returns row count."""
    retention = days or LOCATION_HISTORY_RETENTION_DAYS
    cutoff = now_naive() - timedelta(days=retention)
    result = await db.execute(
        delete(EmployeeLocation).where(EmployeeLocation.recorded_at < cutoff)
    )
    await db.commit()
    return result.rowcount or 0


async def cleanup_old_locations_task(days: Optional[int] = None) -> int:
    """Scheduler entry point — opens its own DB session."""
    from app.services.db_service import async_session

    try:
        async with async_session() as db:
            removed = await cleanup_old_locations(db, days)
            if removed:
                logger.info("🧹 [Location] Pruned %s old location pings", removed)
            return removed
    except Exception as exc:  # pragma: no cover - never break the scheduler
        logger.warning("[Location] Retention cleanup failed: %s", exc)
        return 0
