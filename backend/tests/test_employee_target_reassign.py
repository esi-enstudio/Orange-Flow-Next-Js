"""Employee replacement must hand the monthly target over to the successor.

Reports (activations / recharge / active-lso / active-sso) only read targets
of Active employees. Before this fix a resigned employee's RSO targets stayed
attached to them, so the new employee showed target 0 everywhere even though
the tracker had a target row for that month.
"""
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.models.employee import Employee
from app.models.house import House
from app.models.retailer import Retailer
from app.models.rso_target import RSOTarget
from app.models.activity_log import ActivityLog
from app.routers.deps import get_current_user, get_db
from app.routers.employees import router as employees_router


def _admin(house):
    return SimpleNamespace(
        id=1,
        name="Admin",
        status="Active",
        houses=[house],
        roles=[SimpleNamespace(name="super admin", permissions=[])],
    )


@pytest.mark.asyncio
async def test_reassign_moves_targets_to_successor(db):
    house = House(code="H001", name="Test House")
    db.add(house)
    await db.commit()
    await db.refresh(house)

    old = Employee(
        house_id=house.id, employee_name="Old RSO", dms_code="RS000001",
        employee_id="RSO-0001", employee_type="rso", status="Active",
        itop_number="1900000001", pool_number="1930000001",
    )
    new = Employee(
        house_id=house.id, employee_name="New RSO", dms_code="RS000002",
        employee_id="RSO-0002", employee_type="rso", status="Active",
        itop_number="1900000001", pool_number="1930000001",
    )
    db.add_all([old, new])
    await db.commit()
    await db.refresh(old)
    await db.refresh(new)

    db.add(Retailer(house_id=house.id, retailer_code="R000001", name="Shop", employee_id=old.id))
    db.add(RSOTarget(house_id=house.id, employee_id=old.id, target_date=date(2026, 11, 1), ga=100))
    await db.commit()

    app = FastAPI()
    app.include_router(employees_router)

    async def _get_db():
        yield db

    app.dependency_overrides[get_db] = _get_db
    app.dependency_overrides[get_current_user] = lambda: _admin(house)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(
            f"/api/employees/{old.id}/reassign",
            json={"new_employee_id": new.id, "status": "Resigned"},
        )

    assert res.status_code == 200, res.text
    assert res.json()["targets_transferred"] == 1

    targets = (await db.execute(select(RSOTarget))).scalars().all()
    assert len(targets) == 1
    assert targets[0].employee_id == new.id

    await db.refresh(old)
    assert old.status == "Resigned"


@pytest.mark.asyncio
async def test_reassign_creates_inactive_demo_when_no_active_rso_exists(db):
    house = House(code="H002", name="Demo House")
    db.add(house)
    await db.commit()
    await db.refresh(house)

    old = Employee(
        house_id=house.id,
        employee_name="Former RSO",
        dms_code="RS000010",
        employee_id="RSO-0010",
        employee_type="rso",
        status="Active",
        itop_number="1900000010",
    )
    unrelated_active = Employee(
        house_id=house.id,
        employee_name="Unrelated Active RSO",
        dms_code="RS000011",
        employee_id="RSO-0011",
        employee_type="rso",
        status="Active",
        itop_number="1900000011",
    )
    db.add_all([old, unrelated_active])
    await db.commit()
    await db.refresh(old)

    retailer = Retailer(
        house_id=house.id,
        retailer_code="R000010",
        name="Former RSO Shop",
        employee_id=old.id,
    )
    db.add(retailer)
    await db.commit()

    app = FastAPI()
    app.include_router(employees_router)

    async def _get_db():
        yield db

    app.dependency_overrides[get_db] = _get_db
    app.dependency_overrides[get_current_user] = lambda: _admin(house)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(
            f"/api/employees/{old.id}/reassign",
            json={"create_demo_employee": True, "status": "Resigned"},
        )

    assert res.status_code == 200, res.text
    payload = res.json()
    assert payload["retailers_transferred"] == 1
    assert payload["demo_employee_name"] == "Demo - Formerly Former RSO [RS000010]"

    demo = await db.get(Employee, payload["demo_employee_id"])
    assert demo is not None
    assert demo.house_id == house.id
    assert demo.employee_id == f"DEMO-{old.id}"
    assert demo.employee_type == "rso"
    assert demo.status == "Inactive"

    await db.refresh(old)
    await db.refresh(retailer)
    assert old.status == "Resigned"
    assert retailer.employee_id == demo.id

    log = (
        await db.execute(
            select(ActivityLog).where(
                ActivityLog.action == "reassign_retailers",
                ActivityLog.record_id == old.id,
            )
        )
    ).scalar_one()
    assert log.new_values["demo_employee"] is True
    assert log.new_values["new_employee_id"] == demo.id


@pytest.mark.asyncio
async def test_demo_reassignment_is_rejected_if_active_rso_exists(db):
    house = House(code="H003", name="Successor House")
    db.add(house)
    await db.commit()
    await db.refresh(house)

    old = Employee(
        house_id=house.id,
        employee_name="Former RSO",
        dms_code="RS000020",
        employee_id="RSO-0020",
        employee_type="rso",
        status="Active",
        itop_number="1900000020",
    )
    successor = Employee(
        house_id=house.id,
        employee_name="Active Successor",
        dms_code="RS000021",
        employee_id="RSO-0021",
        employee_type="rso",
        status="Active",
        itop_number="1900000020",
    )
    db.add_all([old, successor])
    await db.commit()
    await db.refresh(old)

    retailer = Retailer(
        house_id=house.id,
        retailer_code="R000020",
        name="Successor House Shop",
        employee_id=old.id,
    )
    db.add(retailer)
    await db.commit()

    app = FastAPI()
    app.include_router(employees_router)

    async def _get_db():
        yield db

    app.dependency_overrides[get_db] = _get_db
    app.dependency_overrides[get_current_user] = lambda: _admin(house)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(
            f"/api/employees/{old.id}/reassign",
            json={"create_demo_employee": True, "status": "Resigned"},
        )

    assert res.status_code == 409, res.text
    await db.refresh(old)
    await db.refresh(retailer)
    assert old.status == "Active"
    assert retailer.employee_id == old.id
    employees = (await db.execute(select(Employee))).scalars().all()
    assert len(employees) == 2
