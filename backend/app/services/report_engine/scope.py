"""Data-permission scope for report engine queries.

Resolves the set of retailers a user may see inside one house, as a SQLAlchemy
condition on `Retailer`. The same scope is applied to achievement, target sum,
summary and export so they all agree.

Role resolution mirrors `app/utils/access_control.py` but builds async-safe SQL
conditions instead of applying them on a sync session.
"""
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.house import House
from app.models.retailer import Retailer
from app.models.supervisor_assignment import SupervisorRSOAssignment
from app.models.user import User
from app.utils.access_control import ADMIN_ROLE_NAMES


@dataclass(frozen=True)
class DataScope:
    unrestricted: bool
    condition: Any | None  # SQLAlchemy condition on Retailer; None when unrestricted
    scope_note: str | None   # human-readable description for the UI / audit log


ADMIN_ROLE_KEYS = frozenset({r.lower() for r in ADMIN_ROLE_NAMES})


async def resolve_data_scope(
    db: AsyncSession, *, user: User, house_id: int
) -> DataScope:
    role_names = {r.name.lower() for r in (user.roles or [])}

    # 1. Admin / manager / house manager → everything in the house.
    if role_names & ADMIN_ROLE_KEYS:
        return DataScope(
            unrestricted=True,
            condition=None,
            scope_note=f"house {house_id}: all retailers (admin/manager)",
        )

    emp = user.employee_profile

    # 2. Supervisor → retailers owned by team members.
    if emp is not None and "supervisor" in role_names:
        member_ids = select(SupervisorRSOAssignment.member_employee_id).where(
            SupervisorRSOAssignment.supervisor_employee_id == emp.id,
            SupervisorRSOAssignment.house_id == house_id,
        )
        return DataScope(
            unrestricted=False,
            condition=Retailer.employee_id.in_(member_ids),
            scope_note=f"supervisor {emp.id}: team retailers",
        )

    # 3. RSO / BP / other employee → own retailers only.
    if emp is not None:
        return DataScope(
            unrestricted=False,
            condition=Retailer.employee_id == emp.id,
            scope_note=f"employee {emp.id}: own retailers",
        )

    # 4. Retailer user → that retailer only.
    if user.phone_number:
        retailer = await db.execute(
            select(Retailer.id).where(
                Retailer.contact_no == user.phone_number,
                Retailer.house_id == house_id,
            )
        )
        rid = retailer.scalar_one_or_none()
        if rid is not None:
            return DataScope(
                unrestricted=False,
                condition=Retailer.id == rid,
                scope_note=f"retailer {rid}: own record",
            )

    # 5. No match → fail closed.
    return DataScope(
        unrestricted=False,
        condition=Retailer.id.is_(None),
        scope_note=f"house {house_id}: no scope matched",
    )
