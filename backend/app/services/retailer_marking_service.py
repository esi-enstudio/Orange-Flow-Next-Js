from typing import Optional, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.retailer import Retailer
from app.models.retailer_marking import RetailerMarking, RetailerMarkingAssignment
from app.models.employee import Employee


async def get_active_retailer_ids_for_markings(
    db: AsyncSession,
    house_id: int,
    marking_names: Sequence[str],
) -> set[int]:
    """Return retailer ids (within a house) that currently hold any of the given
    markings (matched against marking name/code).
    """
    if not marking_names:
        return set()
    query = (
        select(RetailerMarkingAssignment.retailer_id)
        .join(RetailerMarkingAssignment.marking)
        .join(RetailerMarkingAssignment.retailer)
        .where(
            RetailerMarking.name.in_(list(marking_names)),
            RetailerMarkingAssignment.status == "active",
            Retailer.house_id == house_id,
        )
    )
    res = await db.execute(query)
    return {row[0] for row in res.all()}


async def get_active_retailer_ids_for_marking(
    db: AsyncSession,
    house_id: int,
    marking_name: str,
) -> set[int]:
    return await get_active_retailer_ids_for_markings(db, house_id, [marking_name])


async def get_retailer_markings_map(
    db: AsyncSession,
    retailer_ids: Sequence[int],
    only_active: bool = True,
) -> dict[int, list[str]]:
    """Map retailer_id -> list of marking names (de-normalized for display)."""
    if not retailer_ids:
        return {}
    query = (
        select(RetailerMarkingAssignment.retailer_id, RetailerMarking.name)
        .join(RetailerMarkingAssignment.marking)
        .where(RetailerMarkingAssignment.retailer_id.in_(list(retailer_ids)))
        .order_by(RetailerMarking.name)
    )
    if only_active:
        query = query.where(RetailerMarkingAssignment.status == "active")
    res = await db.execute(query)
    result: dict[int, list[str]] = {}
    for rid, name in res.all():
        result.setdefault(rid, []).append(name)
    return result


async def get_active_markings(db: AsyncSession) -> list[RetailerMarking]:
    """All active markings, ordered by name. Global across houses."""
    res = await db.execute(
        select(RetailerMarking)
        .where(RetailerMarking.status == "active")
        .order_by(RetailerMarking.name)
    )
    return list(res.scalars().all())


async def get_marking_id_by_name(db: AsyncSession, name: str) -> Optional[int]:
    row = (
        await db.execute(
            select(RetailerMarking.id).where(RetailerMarking.name == name)
        )
    ).scalar_one_or_none()
    return int(row) if row is not None else None


async def get_employee_owned_retailer_ids(
    db: AsyncSession,
    house_id: int,
    employee_roles: Optional[Sequence[str]] = None,
) -> set[int]:
    """Return retailer ids (within a house) that belong to employees of the given
    roles (or any role when `employee_roles` is None).

    A retailer counts as employee-owned when:
      - `retailer.retailer_code` equals an employee's `assisted_retailer_code`, or
      - `retailer.employee_id` points to one of those employees.

    These ids must never be filtered out by tag-based exclusions — an employee's own
    assisted-code / owned shop always counts for them (assisted-code ownership takes
    priority).
    """
    if not employee_roles:
        return set()
    role_cond = Employee.employee_type.in_(list(employee_roles))
    q = (
        select(Retailer.id)
        .join(Employee, Retailer.employee_id == Employee.id)
        .where(
            Employee.house_id == house_id,
            Employee.status == "Active",
            role_cond,
        )
    )
    res = await db.execute(q)
    linked = {row[0] for row in res.all()}

    q2 = (
        select(Retailer.id)
        .join(Employee, Retailer.retailer_code == Employee.assisted_retailer_code)
        .where(
            Employee.house_id == house_id,
            Employee.status == "Active",
            role_cond,
            Employee.assisted_retailer_code != None,
            Employee.assisted_retailer_code != "",
        )
    )
    res2 = await db.execute(q2)
    owned = {row[0] for row in res2.all()}

    return linked | owned