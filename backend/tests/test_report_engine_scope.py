"""Data-permission scope tests for the report engine."""
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.models.employee import Employee
from app.models.house import House
from app.models.retailer import Retailer
from app.models.role import Role
from app.models.supervisor_assignment import SupervisorRSOAssignment
from app.models.user import User
from app.services.report_engine.scope import ADMIN_ROLE_KEYS, resolve_data_scope


async def _make_user(
    db,
    *,
    username: str,
    house: House,
    role_name: str = "Manager",
    phone_number: str | None = None,
    employee: Employee | None = None,
) -> User:
    role = Role(name=role_name)
    db.add(role)
    user = User(
        username=username,
        hashed_password="x",
        name="Scope Test",
        status="Active",
        phone_number=phone_number,
    )
    user.roles.append(role)
    user.houses.append(house)
    if employee is not None:
        employee.user = user
        db.add(employee)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    # employee_profile is lazily loaded; production loads it via selectinload in
    # get_current_user, so mirror that here for tests that pass an employee.
    from sqlalchemy.orm import selectinload

    result = await db.execute(
        select(User).options(selectinload(User.employee_profile)).where(User.id == user.id)
    )
    return result.scalar_one()


async def _count_retailers(db, house, scope, employee_map) -> int:
    cond = scope.condition
    if scope.unrestricted or cond is None:
        q = select(Retailer).where(Retailer.house_id == house.id)
    else:
        q = select(Retailer).where(Retailer.house_id == house.id).where(cond)
    result = await db.execute(q)
    return len(result.scalars().all())


async def test_manager_is_unrestricted(db, house):
    r1 = Retailer(house_id=house.id, retailer_code="R1", name="One")
    r2 = Retailer(house_id=house.id, retailer_code="R2", name="Two")
    db.add_all([r1, r2])
    await db.commit()

    user = await _make_user(db, username="mgr", house=house, role_name="House Manager")
    scope = await resolve_data_scope(db, user=user, house_id=house.id)

    assert scope.unrestricted is True
    assert scope.condition is None
    assert "house" in (scope.scope_note or "")
    assert await _count_retailers(db, house, scope, {}) == 2


async def test_admin_is_unrestricted(db, house):
    user = await _make_user(db, username="adm", house=house, role_name="Admin")
    scope = await resolve_data_scope(db, user=user, house_id=house.id)
    assert scope.unrestricted is True


async def test_supervisor_sees_only_team_retailers(db, house):
    sup_emp = Employee(
        house_id=house.id, employee_name="Sup", dms_code="SUP1",
        employee_type="supervisor", status="Active",
    )
    member_emp = Employee(
        house_id=house.id, employee_name="Mem", dms_code="MEM1",
        employee_type="rso", status="Active",
    )
    outsider_emp = Employee(
        house_id=house.id, employee_name="Out", dms_code="OUT1",
        employee_type="rso", status="Active",
    )
    db.add_all([sup_emp, member_emp, outsider_emp])
    await db.commit()
    await db.refresh(sup_emp)
    await db.refresh(member_emp)
    await db.refresh(outsider_emp)

    r_member = Retailer(house_id=house.id, retailer_code="RM", name="Member Shop", employee_id=member_emp.id)
    r_outsider = Retailer(house_id=house.id, retailer_code="RO", name="Outsider Shop", employee_id=outsider_emp.id)
    db.add_all([r_member, r_outsider])
    await db.commit()

    link = SupervisorRSOAssignment(
        supervisor_employee_id=sup_emp.id, member_employee_id=member_emp.id,
        house_id=house.id,
    )
    db.add(link)
    await db.commit()

    user = await _make_user(
        db, username="sup", house=house, role_name="Supervisor", employee=sup_emp,
    )
    scope = await resolve_data_scope(db, user=user, house_id=house.id)

    assert scope.unrestricted is False
    assert scope.condition is not None
    assert await _count_retailers(db, house, scope, {}) == 1


async def test_rso_sees_only_own_retailers(db, house):
    rso_emp = Employee(
        house_id=house.id, employee_name="RSO", dms_code="RSO1",
        employee_type="rso", status="Active",
    )
    other_emp = Employee(
        house_id=house.id, employee_name="Other", dms_code="OTH1",
        employee_type="rso", status="Active",
    )
    db.add_all([rso_emp, other_emp])
    await db.commit()
    await db.refresh(rso_emp)
    await db.refresh(other_emp)

    r_own = Retailer(house_id=house.id, retailer_code="RO1", name="Own Shop", employee_id=rso_emp.id)
    r_other = Retailer(house_id=house.id, retailer_code="RO2", name="Other Shop", employee_id=other_emp.id)
    db.add_all([r_own, r_other])
    await db.commit()

    user = await _make_user(db, username="rso", house=house, role_name="RSO", employee=rso_emp)
    scope = await resolve_data_scope(db, user=user, house_id=house.id)

    assert scope.unrestricted is False
    assert await _count_retailers(db, house, scope, {}) == 1


async def test_retailer_user_sees_own_record(db, house):
    emp = Employee(
        house_id=house.id, employee_name="Retailer User", dms_code="RET1",
        employee_type="retailer", status="Active",
    )
    db.add(emp)
    await db.commit()
    await db.refresh(emp)

    ret = Retailer(
        house_id=house.id, retailer_code="RET1C", name="Retailer Shop",
        contact_no="01700000001", employee_id=emp.id,
    )
    db.add(ret)
    other = Retailer(house_id=house.id, retailer_code="RET2C", name="Other Shop")
    db.add(other)
    await db.commit()

    user = await _make_user(
        db, username="retuser", house=house, role_name="Retailer",
        phone_number="01700000001",
    )
    scope = await resolve_data_scope(db, user=user, house_id=house.id)

    assert scope.unrestricted is False
    assert await _count_retailers(db, house, scope, {}) == 1


async def test_unknown_user_is_fail_closed(db, house):
    Retailer(house_id=house.id, retailer_code="R1", name="One")
    await db.commit()

    user = await _make_user(
        db, username="unknown", house=house, role_name="Sales",
    )
    scope = await resolve_data_scope(db, user=user, house_id=house.id)

    assert scope.unrestricted is False
    assert await _count_retailers(db, house, scope, {}) == 0


async def test_cross_house_scope_not_applied(db, house):
    other_house = House(code="H002", name="Other House", email="other@example.com")
    db.add(other_house)
    await db.commit()
    await db.refresh(other_house)

    Retailer(house_id=other_house.id, retailer_code="OR1", name="Other House Shop")
    await db.commit()

    user = await _make_user(db, username="mgr2", house=house, role_name="House Manager")
    scope = await resolve_data_scope(db, user=user, house_id=house.id)
    assert scope.unrestricted is True
    assert await _count_retailers(db, house, scope, {}) == 0


def test_admin_role_keys_are_nonempty():
    assert "manager" in ADMIN_ROLE_KEYS
    assert "house_manager" in ADMIN_ROLE_KEYS
