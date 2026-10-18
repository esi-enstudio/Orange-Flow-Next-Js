"""System-managed (auto) retailer markings.

A marking whose `RetailerMarking.auto_source` is set is rebuilt from employee data
instead of being assigned by hand: its active assignments always mirror the
retailers whose `retailer_code` equals the `assisted_retailer_code` of an **Active**
employee of the matching type.

    auto_source = "bp_assisted"  -> Active employees with employee_type "bp"
    auto_source = "rso_assisted" -> Active employees with employee_type "rso"

Rules (see AGENTS.md "Retailer↔Employee Attribution Rules"):
- Assisted-code ownership beats every other link, so `retailer_code` is matched
  against `employees.assisted_retailer_code` directly (never by itop_number).
- Only Active owners keep a marking. When the owner resigns/goes inactive (or its
  type changes) the marking is removed from that assisted-code retailer, because
  the assisted code keeps living in the retailers table.
- Manual assign/unassign is rejected for auto markings at the router level; rows
  written here carry a system marker in `remarks` and `assigned_by = NULL`.

The sync runs from every place employee data can change (employee create / update /
delete, employee Excel import, retailer Excel import), once at startup, and on
demand from the markings page ("Sync Now").
"""

import logging
from typing import Any, Optional, Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.retailer import Retailer
from app.models.retailer_marking import RetailerMarking, RetailerMarkingAssignment
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

# auto_source -> employee_type whose assisted codes the marking mirrors.
AUTO_SOURCES: dict[str, str] = {
    "bp_assisted": "bp",
    "rso_assisted": "rso",
}

# Human label per auto source (kept in sync with the frontend dropdown).
AUTO_SOURCE_LABELS: dict[str, str] = {
    "bp_assisted": "BP assisted code",
    "rso_assisted": "RSO assisted code",
}


def auto_source_employee_type(auto_source: Optional[str]) -> Optional[str]:
    """Employee type an auto source mirrors, or None when the source is unknown."""
    if not auto_source:
        return None
    return AUTO_SOURCES.get(auto_source.strip().lower())


def is_auto_managed(marking: Optional[RetailerMarking]) -> bool:
    """True when the marking's assignments are owned by the auto sync."""
    return bool(marking and auto_source_employee_type(marking.auto_source))


def _scope_house_ids(house_ids: Optional[Sequence[int]]) -> Optional[list[int]]:
    if house_ids is None:
        return None
    ids = [int(h) for h in house_ids if h is not None]
    # An empty scope means "no house" -> nothing to sync instead of "all houses".
    return ids


async def _expected_retailer_ids(
    db: AsyncSession,
    employee_type: str,
    house_ids: Optional[list[int]],
) -> set[int]:
    """Retailers whose code is the assisted code of an Active employee of the type."""
    query = (
        select(Retailer.id)
        .join(Employee, Employee.assisted_retailer_code == Retailer.retailer_code)
        .where(
            func.lower(func.coalesce(Employee.employee_type, "")) == employee_type,
            func.lower(func.coalesce(Employee.status, "")) == "active",
            Employee.assisted_retailer_code.isnot(None),
            Employee.assisted_retailer_code != "",
        )
    )
    if house_ids is not None:
        if not house_ids:
            return set()
        query = query.where(Retailer.house_id.in_(house_ids))
    result = await db.execute(query)
    return {row[0] for row in result.all()}


async def _active_assignments(
    db: AsyncSession,
    marking_id: int,
    house_ids: Optional[list[int]],
) -> list[RetailerMarkingAssignment]:
    query = (
        select(RetailerMarkingAssignment)
        .join(Retailer, Retailer.id == RetailerMarkingAssignment.retailer_id)
        .where(
            RetailerMarkingAssignment.marking_id == marking_id,
            RetailerMarkingAssignment.status == "active",
        )
    )
    if house_ids is not None:
        if not house_ids:
            return []
        query = query.where(Retailer.house_id.in_(house_ids))
    result = await db.execute(query)
    return list(result.scalars().all())


async def sync_auto_markings(
    db: AsyncSession,
    *,
    house_ids: Optional[Sequence[int]] = None,
) -> dict[str, Any]:
    """Rebuild every active auto marking and store the difference.

    `house_ids` narrows the sync to retailers of those houses (used by the manual
    endpoint with an X-House-ID context); None syncs every house.
    """
    scope = _scope_house_ids(house_ids)
    if scope is not None and not scope:
        return {"markings": [], "added": 0, "removed": 0}

    markings = (
        await db.execute(
            select(RetailerMarking)
            .where(
                RetailerMarking.auto_source.in_(list(AUTO_SOURCES)),
                RetailerMarking.status == "active",
                RetailerMarking.is_deleted == False,  # noqa: E712
            )
            .order_by(RetailerMarking.id)
        )
    ).scalars().all()

    now = now_naive()
    summary: dict[str, Any] = {"markings": [], "added": 0, "removed": 0}

    for marking in markings:
        employee_type = auto_source_employee_type(marking.auto_source)
        if not employee_type:
            continue
        label = AUTO_SOURCE_LABELS.get(marking.auto_source, marking.auto_source)

        expected = await _expected_retailer_ids(db, employee_type, scope)
        active_rows = await _active_assignments(db, marking.id, scope)
        active_ids = {row.retailer_id for row in active_rows}

        to_add = sorted(expected - active_ids)
        to_remove = sorted(active_ids - expected)

        for retailer_id in to_add:
            db.add(
                RetailerMarkingAssignment(
                    retailer_id=retailer_id,
                    marking_id=marking.id,
                    status="active",
                    effective_from=now,
                    effective_to=None,
                    assigned_by=None,  # system, not a user
                    assigned_at=now,
                    remarks=f"Auto: {label}",
                )
            )

        remove_set = set(to_remove)
        for row in active_rows:
            if row.retailer_id not in remove_set:
                continue
            row.status = "inactive"
            row.effective_to = now
            row.removed_by = None  # system, not a user
            row.removed_at = now
            row.remarks = f"Auto removed: no longer an Active {label}"

        summary["markings"].append(
            {
                "id": marking.id,
                "name": marking.name,
                "code": marking.code,
                "auto_source": marking.auto_source,
                "added": len(to_add),
                "removed": len(to_remove),
                "active_total": len(expected),
            }
        )
        summary["added"] += len(to_add)
        summary["removed"] += len(to_remove)

    await db.commit()
    return summary


async def run_auto_marking_sync(
    db: AsyncSession,
    *,
    house_ids: Optional[Sequence[int]] = None,
) -> Optional[dict[str, Any]]:
    """Best-effort wrapper for the write paths: never raises, never blocks a save.

    Returns the sync summary, or None when the sync failed (the caller's own
    transaction has already been committed by then, so a rollback only discards
    the sync's partial work).
    """
    try:
        return await sync_auto_markings(db, house_ids=house_ids)
    except Exception as exc:  # pragma: no cover - defensive
        await db.rollback()
        logger.warning("Auto marking sync failed: %s", exc, exc_info=True)
        return None
