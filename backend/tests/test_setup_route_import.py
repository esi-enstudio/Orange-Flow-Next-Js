import json

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import func, select

from app.models.activity_log import ActivityLog
from app.models.employee import Employee
from app.models.house import House
from app.models.role import Role
from app.models.route import EmployeeRoute, Route
from app.models.user import User
from app.routers import admin_setup_controller

HEADER = (
    "DISTRIBUTORCODE\tRSOCode\tRso Number\tRouteCode\tROUTENAME\tDESCRIPTION\t"
    "ROUTELENGTH\tSIMSELLING\tAIRTIMESELLING\tSAFRUNNER\tSATURDAY\tSUNDAY\t"
    "MONDAY\tTUESDAY\tWEDNESDAY\tTHURSDAY\tFRIDAY"
)
ROUTE_ROW = (
    "H001\tRSO-1\t01700000001\tH001_ROUTE01\tTest Route\t\t5\t"
    "N\tY\tN\tN\tY\tN\tY\tN\tY\tN"
)


def _client(db):
    app = FastAPI()
    app.include_router(admin_setup_controller.router, prefix="/api")

    async def override_db():
        yield db

    app.dependency_overrides[admin_setup_controller.get_db] = override_db
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
    )


async def _seed_setup_data(db):
    house = House(code="H001", name="Test House", email="house@example.com")
    role = Role(name="Super Admin")
    user = User(
        username="setup-admin",
        hashed_password="x",
        name="Setup Admin",
        status="Active",
    )
    user.roles.append(role)
    employee = Employee(
        house_id=house.id,
        employee_type="rso",
        status="Active",
        dms_code="RSO-1",
        itop_number="01700000001",
        employee_name="Test RSO",
    )
    db.add_all([house, role, user])
    await db.flush()
    employee.house_id = house.id
    db.add(employee)
    await db.commit()
    return house, user


def _events(response: httpx.Response) -> list[dict]:
    return [
        json.loads(line.removeprefix("data: "))
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]


@pytest.mark.asyncio
async def test_setup_route_import_registers_route_and_assigns_active_rso(db, tmp_path, monkeypatch):
    _, admin = await _seed_setup_data(db)
    monkeypatch.chdir(tmp_path)
    body = f"{HEADER}\r\n{ROUTE_ROW}\r\n".encode()

    async with _client(db) as client:
        response = await client.post(
            "/api/admin/setup/import/routes",
            files={"file": ("RouteList.xls", body, "application/vnd.ms-excel")},
        )

    assert response.status_code == 200
    assert _events(response) == [
        {
            "type": "complete",
            "message": "Successfully imported 1 records.",
            "count": 1,
        }
    ]
    route = (
        await db.execute(select(Route).where(Route.code == "H001_ROUTE01"))
    ).scalar_one()
    owner_link = (
        await db.execute(
            select(EmployeeRoute).where(
                EmployeeRoute.route_id == route.id,
                EmployeeRoute.status == "active",
            )
        )
    ).scalar_one()
    assert owner_link.house_id == route.house_id
    owner = await db.get(Employee, owner_link.employee_id)
    assert owner.dms_code == "RSO-1"
    activity = (
        await db.execute(
            select(ActivityLog).where(
                ActivityLog.module == "routes",
                ActivityLog.action == "import",
            )
        )
    ).scalar_one()
    assert activity.user_id == admin.id


@pytest.mark.asyncio
async def test_setup_route_import_reports_invalid_workbook(db, tmp_path, monkeypatch):
    await _seed_setup_data(db)
    monkeypatch.chdir(tmp_path)

    async with _client(db) as client:
        response = await client.post(
            "/api/admin/setup/import/routes",
            files={"file": ("RouteList.xls", b"not a DMS route list")},
        )

    assert response.status_code == 200
    events = _events(response)
    assert len(events) == 1
    assert events[0]["type"] == "error"
    assert "missing column" in events[0]["message"]
    assert await db.scalar(select(func.count(Route.id))) == 0


@pytest.mark.asyncio
async def test_setup_route_import_requires_initialized_super_admin(db, tmp_path, monkeypatch):
    house = House(code="H001", name="Test House", email="house@example.com")
    db.add(house)
    await db.commit()
    monkeypatch.chdir(tmp_path)
    body = f"{HEADER}\r\n{ROUTE_ROW}\r\n".encode()

    async with _client(db) as client:
        response = await client.post(
            "/api/admin/setup/import/routes",
            files={"file": ("RouteList.xls", body, "application/vnd.ms-excel")},
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "System is not initialized"
    assert await db.scalar(select(func.count(Route.id))) == 0
