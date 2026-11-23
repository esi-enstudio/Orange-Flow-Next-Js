"""Routes API: validation, ownership rules and tenant isolation.

A route is house-scoped reference data. These tests pin the boundaries that
protect it: the code must carry the house prefix, only an Active RSO from the
same house may own it, a route still in use cannot be deleted, and a tenant can
never address another house's routes through the header or a body id.
"""
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.models.employee import Employee
from app.models.house import House
from app.models.retailer import Retailer
from app.models.route import EmployeeRoute, RetailerRoute, Route
from app.routers.deps import get_current_user, get_db
from app.routers.routes import router as routes_router


def _user(house, role_name="Admin", permissions=()):
    return SimpleNamespace(
        id=1,
        name="Tester",
        status="Active",
        houses=[house],
        roles=[
            SimpleNamespace(
                name=role_name,
                permissions=[SimpleNamespace(name=p) for p in permissions],
            )
        ],
    )


def _client(db, user):
    app = FastAPI()
    app.include_router(routes_router)

    async def _get_db():
        yield db

    app.dependency_overrides[get_db] = _get_db
    app.dependency_overrides[get_current_user] = lambda: user
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _house(db, code, name="House"):
    house = House(code=code, name=name)
    db.add(house)
    await db.commit()
    await db.refresh(house)
    return house


async def _rso(db, house, name="RSO", status="Active"):
    employee = Employee(
        house_id=house.id,
        employee_name=name,
        employee_id=name.replace(" ", ""),
        employee_type="rso",
        status=status,
    )
    db.add(employee)
    await db.commit()
    await db.refresh(employee)
    return employee


async def test_create_route_requires_house_prefix(db):
    house = await _house(db, "MYMVAI01")
    user = _user(house)
    async with _client(db, user) as client:
        res = await client.post("/api/routes", json={"code": "MYMVAI02_ROUTE01"})
        assert res.status_code == 422, res.text

        res = await client.post("/api/routes", json={"code": "MYMVAI01_ROUTE0066"})
        assert res.status_code == 201, res.text
        assert res.json()["data"]["code"] == "MYMVAI01_ROUTE0066"

        # Duplicate registration is a conflict, not a second row.
        res = await client.post("/api/routes", json={"code": "MYMVAI01_ROUTE0066"})
        assert res.status_code == 409


async def test_create_route_rejects_malformed_code(db):
    house = await _house(db, "MYMVAI01")
    async with _client(db, _user(house)) as client:
        res = await client.post("/api/routes", json={"code": "3 Days Route"})
    assert res.status_code == 400


async def test_edit_route_updates_all_route_details(db):
    house = await _house(db, "MYMVAI01")
    route = Route(
        house_id=house.id,
        code="MYMVAI01_ROUTE0001",
        name="Old Name",
        description="Old description",
        route_length=2.5,
        visit_days=["saturday"],
    )
    db.add(route)
    await db.commit()
    await db.refresh(route)

    async with _client(db, _user(house)) as client:
        res = await client.patch(
            f"/api/routes/{route.id}",
            json={
                "name": "New Name",
                "description": "Updated description",
                "route_length": 12.75,
                "visit_days": ["monday", "friday", "monday"],
                "is_active": False,
            },
        )

    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["name"] == "New Name"
    assert data["description"] == "Updated description"
    assert data["route_length"] == 12.75
    assert data["visit_days"] == ["monday", "friday"]
    assert data["is_active"] is False


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ({"route_length": -1}, "non-negative number"),
        ({"route_length": True}, "non-negative number"),
        ({"visit_days": ["funday"]}, "valid weekdays"),
        ({"is_active": "false"}, "boolean"),
        ({"code": "MYMVAI01_ROUTE0002"}, "cannot be changed"),
    ],
)
async def test_edit_route_rejects_invalid_or_immutable_values(db, payload, message):
    house = await _house(db, "MYMVAI01")
    route = Route(house_id=house.id, code="MYMVAI01_ROUTE0001")
    db.add(route)
    await db.commit()
    await db.refresh(route)

    async with _client(db, _user(house)) as client:
        res = await client.patch(f"/api/routes/{route.id}", json=payload)

    assert res.status_code == 400, res.text
    assert message in res.json()["detail"]


async def test_assign_requires_active_rso_from_same_house(db):
    house = await _house(db, "MYMVAI01")
    other = await _house(db, "MYMVAI02")
    route = Route(house_id=house.id, code="MYMVAI01_ROUTE0001")
    db.add(route)
    await db.commit()
    await db.refresh(route)

    outsider = await _rso(db, other, "Outside RSO")
    resigned = await _rso(db, house, "Resigned RSO", status="Resigned")
    active = await _rso(db, house, "Active RSO")

    async with _client(db, _user(house)) as client:
        res = await client.post(
            f"/api/routes/{route.id}/assign-rso", json={"employee_id": outsider.id}
        )
        assert res.status_code == 422

        res = await client.post(
            f"/api/routes/{route.id}/assign-rso", json={"employee_id": resigned.id}
        )
        assert res.status_code == 422

        res = await client.post(
            f"/api/routes/{route.id}/assign-rso", json={"employee_id": active.id}
        )
        assert res.status_code == 200, res.text

    owner = (
        await db.execute(
            select(EmployeeRoute).where(
                EmployeeRoute.route_id == route.id,
                EmployeeRoute.status == "active",
            )
        )
    ).scalar_one()
    assert owner.employee_id == active.id


async def test_one_active_owner_per_route_and_history_is_kept(db):
    house = await _house(db, "MYMVAI01")
    route = Route(house_id=house.id, code="MYMVAI01_ROUTE0001")
    db.add(route)
    await db.commit()
    await db.refresh(route)
    first = await _rso(db, house, "First RSO")
    second = await _rso(db, house, "Second RSO")

    async with _client(db, _user(house)) as client:
        for employee in (first, second):
            res = await client.post(
                f"/api/routes/{route.id}/assign-rso", json={"employee_id": employee.id}
            )
            assert res.status_code == 200, res.text

    links = (
        await db.execute(select(EmployeeRoute).where(EmployeeRoute.route_id == route.id))
    ).scalars().all()
    active = [link for link in links if link.status == "active"]
    assert len(active) == 1 and active[0].employee_id == second.id
    assert len(links) == 2


async def test_delete_blocked_while_route_is_in_use(db):
    house = await _house(db, "MYMVAI01")
    route = Route(house_id=house.id, code="MYMVAI01_ROUTE0001")
    db.add(route)
    await db.flush()
    retailer = Retailer(house_id=house.id, retailer_code="R1", name="Shop")
    db.add(retailer)
    await db.flush()
    db.add(
        RetailerRoute(
            retailer_id=retailer.id, route_id=route.id, status="active", is_primary=True
        )
    )
    await db.commit()

    async with _client(db, _user(house)) as client:
        res = await client.delete(f"/api/routes/{route.id}")
    assert res.status_code == 409, res.text


async def test_permanent_delete_removes_route_and_retailer_links(db):
    house = await _house(db, "MYMVAI01")
    route = Route(house_id=house.id, code="MYMVAI01_ROUTE0001")
    db.add(route)
    await db.flush()
    retailer = Retailer(house_id=house.id, retailer_code="R1", name="Shop")
    rso = await _rso(db, house, "Active RSO")
    db.add(retailer)
    await db.flush()
    db.add_all(
        [
            EmployeeRoute(
                house_id=house.id,
                employee_id=rso.id,
                route_id=route.id,
                status="active",
            ),
            RetailerRoute(
                retailer_id=retailer.id,
                route_id=route.id,
                status="active",
                is_primary=True,
            ),
        ]
    )
    await db.commit()

    user = _user(house, permissions=["routes.delete.permanent"])
    async with _client(db, user) as client:
        res = await client.delete(
            f"/api/routes/permanent/{route.id}",
            headers={"X-House-ID": str(house.id)},
        )

    assert res.status_code == 200, res.text
    assert (await db.get(Route, route.id)) is None
    retailer_links = (
        await db.execute(select(RetailerRoute).where(RetailerRoute.route_id == route.id))
    ).scalars().all()
    rso_links = (
        await db.execute(select(EmployeeRoute).where(EmployeeRoute.route_id == route.id))
    ).scalars().all()
    assert retailer_links == []
    assert rso_links == []


async def test_tenant_cannot_address_another_house(db):
    house = await _house(db, "MYMVAI01")
    other = await _house(db, "MYMVAI02")
    manager = _user(house, role_name="Manager", permissions=["routes.view"])

    async with _client(db, manager) as client:
        res = await client.get("/api/routes", headers={"X-House-ID": str(other.id)})
        assert res.status_code == 403, res.text


async def test_view_permission_is_required(db):
    house = await _house(db, "MYMVAI01")
    viewer = _user(house, role_name="viewer", permissions=[])
    async with _client(db, viewer) as client:
        res = await client.get("/api/routes")
    assert res.status_code == 403
