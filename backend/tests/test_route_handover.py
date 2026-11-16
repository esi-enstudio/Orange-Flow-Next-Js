"""RSO resigning must hand routes over, never leave them silently owned.

The route guard mirrors the retailer and supervisor-team handoff: an RSO that
still owns routes cannot be resigned from the employee form, and the dedicated
reassign endpoint moves ownership to an Active successor while keeping history.
"""
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.models.employee import Employee
from app.models.house import House
from app.models.route import EmployeeRoute, Route
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


async def _setup(db):
    house = House(code="H001", name="Test House")
    db.add(house)
    await db.commit()
    await db.refresh(house)
    outgoing = Employee(
        house_id=house.id,
        employee_name="Outgoing RSO",
        dms_code="RS000001",
        employee_id="RSO-0001",
        employee_type="rso",
        status="Active",
        itop_number="1900000001",
    )
    successor = Employee(
        house_id=house.id,
        employee_name="Successor RSO",
        dms_code="RS000002",
        employee_id="RSO-0002",
        employee_type="rso",
        status="Active",
        itop_number="1900000001",
    )
    db.add_all([outgoing, successor])
    await db.flush()
    route = Route(house_id=house.id, code="H001_ROUTE0001")
    db.add(route)
    await db.flush()
    db.add(
        EmployeeRoute(
            house_id=house.id,
            employee_id=outgoing.id,
            route_id=route.id,
            status="active",
        )
    )
    await db.commit()
    return house, outgoing, successor, route


def _client(db, house):
    app = FastAPI()
    app.include_router(employees_router)

    async def _get_db():
        yield db

    app.dependency_overrides[get_db] = _get_db
    app.dependency_overrides[get_current_user] = lambda: _admin(house)
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_route_count_lists_owned_routes(db):
    house, outgoing, _, route = await _setup(db)
    async with _client(db, house) as client:
        res = await client.get(f"/api/employees/{outgoing.id}/route-count")
    assert res.status_code == 200, res.text
    assert res.json() == {"count": 1, "routes": [route.code]}


async def test_resigning_an_rso_with_routes_is_blocked(db):
    house, outgoing, _, route = await _setup(db)
    async with _client(db, house) as client:
        res = await client.put(
            f"/api/employees/{outgoing.id}",
            json={
                "house_id": house.id,
                "employee_type": "rso",
                "employee_name": outgoing.employee_name,
                "dms_code": outgoing.dms_code,
                "status": "Resigned",
            },
        )
    assert res.status_code == 422, res.text
    assert "route" in res.json()["detail"].lower()

    await db.refresh(outgoing)
    assert outgoing.status == "Active"
    owner = (
        await db.execute(
            select(EmployeeRoute).where(
                EmployeeRoute.route_id == route.id,
                EmployeeRoute.status == "active",
            )
        )
    ).scalar_one()
    assert owner.employee_id == outgoing.id


async def test_reassign_routes_moves_ownership_and_keeps_history(db):
    house, outgoing, successor, route = await _setup(db)
    async with _client(db, house) as client:
        res = await client.post(
            f"/api/employees/{outgoing.id}/reassign-routes",
            json={"new_employee_id": successor.id, "status": "Resigned"},
        )
    assert res.status_code == 200, res.text
    assert res.json()["transferred"] == 1

    links = (
        await db.execute(select(EmployeeRoute).where(EmployeeRoute.route_id == route.id))
    ).scalars().all()
    assert len(links) == 2
    active = [link for link in links if link.status == "active"]
    assert len(active) == 1 and active[0].employee_id == successor.id
    assert active[0].reason == "transfer"
    closed = [link for link in links if link.status == "inactive"]
    assert closed[0].employee_id == outgoing.id
    assert closed[0].reason == "resign"

    await db.refresh(outgoing)
    assert outgoing.status == "Resigned"


async def test_reassign_routes_rejects_inactive_or_cross_house_target(db):
    house, outgoing, successor, _ = await _setup(db)
    successor.status = "Resigned"
    await db.commit()

    async with _client(db, house) as client:
        res = await client.post(
            f"/api/employees/{outgoing.id}/reassign-routes",
            json={"new_employee_id": successor.id, "status": "Resigned"},
        )
    assert res.status_code == 422

    other_house = House(code="H002", name="Other")
    db.add(other_house)
    await db.flush()
    outsider = Employee(
        house_id=other_house.id,
        employee_name="Other House RSO",
        employee_id="RSO-9999",
        employee_type="rso",
        status="Active",
    )
    db.add(outsider)
    await db.commit()

    async with _client(db, house) as client:
        res = await client.post(
            f"/api/employees/{outgoing.id}/reassign-routes",
            json={"new_employee_id": outsider.id, "status": "Resigned"},
        )
    assert res.status_code == 422


async def test_retailer_reassign_also_moves_routes(db):
    """The existing resign-and-reassign flow must not leave routes behind."""
    from app.models.retailer import Retailer

    house, outgoing, successor, route = await _setup(db)
    db.add(
        Retailer(
            house_id=house.id,
            retailer_code="R000001",
            name="Shop",
            employee_id=outgoing.id,
        )
    )
    await db.commit()

    async with _client(db, house) as client:
        res = await client.post(
            f"/api/employees/{outgoing.id}/reassign",
            json={"new_employee_id": successor.id, "status": "Resigned"},
        )
    assert res.status_code == 200, res.text
    assert res.json()["routes_transferred"] == 1

    active = (
        await db.execute(
            select(EmployeeRoute).where(
                EmployeeRoute.route_id == route.id,
                EmployeeRoute.status == "active",
            )
        )
    ).scalar_one()
    assert active.employee_id == successor.id
