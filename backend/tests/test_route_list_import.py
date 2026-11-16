"""DMS route-list import: upsert, ownership matching and idempotency.

The DMS export is a tab-separated text file named ``.xls``. It carries the
route master (name, description, length, weekday plan) and the owning RSO. The
RSO must be matched by ``dms_code`` first because ``itop_number`` is reused
across handovers and a Resigned holder still sits on the same number.
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
from app.routers.routes import router as routes_router

HEADER = (
    "DISTRIBUTORCODE\tRSOCode\tRso Number\tRouteCode\tROUTENAME\tDESCRIPTION\t"
    "ROUTELENGTH\tSIMSELLING\tAIRTIMESELLING\tSAFRUNNER\tSATURDAY\tSUNDAY\t"
    "MONDAY\tTUESDAY\tWEDNESDAY\tTHURSDAY\tFRIDAY"
)
ROW_OWNED = (
    "MYMVAI01\tRS058703\t1409944001\tMYMVAI01_ROUTE0066\tBajitpur Bazar South\t"
    "Bajitpur bazar\t5\tN\tY\tN\tN\tY\tN\tY\tN\tY\tN"
)
# Unknown dms_code -> fall back to the Active employee holding the itop number
ROW_FALLBACK = (
    "MYMVAI01\tRS061088\t1915270102\tMYMVAI01_ROUTE0063\tNew Town\t\t5\t"
    "N\tY\tN\tN\tY\tN\tY\tN\tY\tN"
)


def _user(house, role_name="Distributor", permissions=("routes.import",)):
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


async def _seed(db):
    house = House(code="MYMVAI01", name="Patwary Telecom")
    db.add(house)
    await db.flush()
    db.add_all(
        [
            # Resigned holder of the same itop number: must never win
            Employee(house_id=house.id, dms_code="RS056209", itop_number="1409944001",
                     employee_name="Old Owner", status="Resigned", employee_type="rso"),
            Employee(house_id=house.id, dms_code="RS058703", itop_number="1409944001",
                     employee_name="Active Owner", status="Active", employee_type="rso"),
            Employee(house_id=house.id, dms_code="RS059979", itop_number="1915270102",
                     employee_name="Itop Successor", status="Active", employee_type="rso"),
        ]
    )
    db.add(Route(house_id=house.id, code="MYMVAI01_ROUTE0066"))
    await db.commit()
    return house


async def _upload(client, body):
    return await client.post(
        "/api/routes/import",
        files={"file": ("RouteList.xls", body, "application/vnd.ms-excel")},
    )


@pytest.mark.asyncio
async def test_import_upserts_routes_and_syncs_active_owner(db):
    house = await _seed(db)
    user = _user(house)
    body = f"{HEADER}\r\n{ROW_OWNED}\r\n{ROW_FALLBACK}\r\n".encode()

    async with _client(db, user) as client:
        response = await _upload(client, body)

    assert response.status_code == 200, response.text
    report = response.json()["data"]
    assert report["created"] == 1 and report["updated"] == 1
    assert report["rso_assigned"] == 2 and report["skipped"] == 0

    route = (
        await db.execute(select(Route).where(Route.code == "MYMVAI01_ROUTE0066"))
    ).scalar_one()
    assert route.name == "Bajitpur Bazar South"
    assert route.route_length == 5.0
    assert route.visit_days == ["sunday", "tuesday", "thursday"]

    links = (
        await db.execute(
            select(EmployeeRoute).where(
                EmployeeRoute.route_id == route.id, EmployeeRoute.status == "active"
            )
        )
    ).scalars().all()
    assert len(links) == 1
    owner = await db.get(Employee, links[0].employee_id)
    assert owner.dms_code == "RS058703"

    fallback_route = (
        await db.execute(select(Route).where(Route.code == "MYMVAI01_ROUTE0063"))
    ).scalar_one()
    fallback_link = (
        await db.execute(
            select(EmployeeRoute).where(
                EmployeeRoute.route_id == fallback_route.id,
                EmployeeRoute.status == "active",
            )
        )
    ).scalar_one()
    fallback_owner = await db.get(Employee, fallback_link.employee_id)
    assert fallback_owner.dms_code == "RS059979"

    async with _client(db, user) as client:
        second = await _upload(client, body)

    assert second.status_code == 200, second.text
    repeat = second.json()["data"]
    assert repeat["created"] == 0 and repeat["updated"] == 0
    assert repeat["rso_assigned"] == 0


@pytest.mark.asyncio
async def test_import_requires_permission(db):
    house = await _seed(db)
    async with _client(db, _user(house, permissions=())) as client:
        response = await _upload(client, f"{HEADER}\r\n{ROW_OWNED}\r\n".encode())
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_import_rejects_foreign_house_rows(db):
    house = await _seed(db)
    body = (
        f"{HEADER}\r\n"
        "OTHERHOUSE\tRS058703\t1409944001\tOTHERHOUSE_ROUTE01\tForeign\t\t1\t"
        "N\tN\tN\tN\tN\tN\tN\tN\tN\tN\r\n"
        f"{ROW_OWNED}\r\n"
    ).encode()
    async with _client(db, _user(house)) as client:
        response = await _upload(client, body)

    assert response.status_code == 200, response.text
    report = response.json()["data"]
    assert report["skipped"] == 1 and report["created"] == 0
    assert "not found" in report["errors"][0]
