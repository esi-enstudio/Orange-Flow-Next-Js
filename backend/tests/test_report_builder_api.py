"""HTTP contract tests for the registry-driven report builder."""

import httpx
import pytest
from fastapi import FastAPI
from datetime import date
from io import BytesIO
from openpyxl import load_workbook
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.activation import Activation
from app.models.employee import Employee
from app.models.house import House
from app.models.retailer import Retailer
from app.models.role import Permission, Role
from app.models.route import Route
from app.models.user import User
from app.routers import report_builder
from app.routers.deps import get_current_user, get_db, require_house_context
from config.settings import settings


async def _user(db, house, *, role_name="Manager", permissions=("report_builder.view",)):
    role = Role(name=role_name)
    for name in permissions:
        permission = (await db.execute(
            select(Permission).where(Permission.name == name)
        )).scalar_one_or_none()
        if permission is None:
            permission = Permission(name=name)
            db.add(permission)
            await db.flush()
        role.permissions.append(permission)

    user = User(
        username=f"report-builder-{role_name.lower()}",
        hashed_password="x",
        name="Report Builder Tester",
        status="Active",
    )
    user.roles.append(role)
    user.houses.append(house)
    db.add(user)
    await db.commit()
    return (await db.execute(
        select(User)
        .options(
            selectinload(User.roles).selectinload(Role.permissions),
            selectinload(User.houses),
            selectinload(User.employee_profile),
        )
        .where(User.id == user.id)
    )).scalar_one()


def _client(db, user, house_id):
    app = FastAPI()
    app.include_router(report_builder.router)

    async def override_db():
        yield db

    async def override_user():
        return user

    async def override_house():
        return house_id

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = override_user
    app.dependency_overrides[require_house_context] = override_house
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
    )


def _query(**overrides):
    body = {
        "metric": "ga_activation",
        "date_from": "2026-11-01",
        "date_to": "2026-11-30",
        "group_by": ["rso"],
        "target": {"source": "none"},
        "page": 1,
        "per_page": 50,
    }
    body.update(overrides)
    return body


async def test_options_and_query_use_public_contract(db, house):
    user = await _user(db, house)
    employee = Employee(
        house_id=house.id, employee_name="Rahim", dms_code="R001",
        employee_type="rso", status="Active",
    )
    db.add(employee)
    await db.flush()
    retailer = Retailer(
        house_id=house.id, retailer_code="RET-1", name="Shop 1",
        employee_id=employee.id,
    )
    db.add(retailer)
    await db.flush()
    db.add(Activation(
        house_id=house.id,
        retailer_id=retailer.id,
        retailer_code=retailer.retailer_code,
        activation_date=date(2026, 11, 17),
        employee_id=employee.id,
    ))
    await db.commit()

    async with _client(db, user, house.id) as client:
        options = await client.get("/api/v1/report-builder/options")
        query = await client.post("/api/v1/report-builder/query", json=_query())

    assert options.status_code == 200
    option_body = options.json()
    assert {"metrics", "dimensions", "matrix", "statuses", "export_sync_max_rows"} <= option_body.keys()
    for metric in option_body["metrics"]:
        assert set(option_body["matrix"][metric["key"]]) == set(metric["target_sources"])
        for source, dimensions in option_body["matrix"][metric["key"]].items():
            assert source in {"house", "custom", "none"}
            assert set(dimensions) <= {d["key"] for d in option_body["dimensions"]}

    assert query.status_code == 200, query.text
    body = query.json()
    assert body["success"] is True
    assert body["data"][0]["label"] == "Rahim"
    assert body["summary"]["achievement"] == 1
    assert body["pagination"]["total"] == 1
    assert "all_rows" not in body


async def test_filter_options_are_searchable_and_house_scoped(db, house):
    user = await _user(db, house)
    other_house = House(code="RB-FILTER-OTHER", name="Other House", email="filter@example.com")
    db.add(other_house)
    await db.flush()
    db.add_all([
        Retailer(
            house_id=house.id, retailer_code="FILTER-KEEP",
            name="Matching In-House Shop",
        ),
        Retailer(
            house_id=other_house.id, retailer_code="FILTER-OTHER",
            name="Matching Other Shop",
        ),
    ])
    await db.commit()

    async with _client(db, user, house.id) as client:
        response = await client.get(
            "/api/v1/report-builder/filter-options",
            params={"type": "retailer", "search": "Matching"},
        )

    assert response.status_code == 200
    assert response.json() == [{
        "id": (await db.execute(
            select(Retailer.id).where(Retailer.retailer_code == "FILTER-KEEP")
        )).scalar_one(),
        "label": "Matching In-House Shop",
        "sublabel": "FILTER-KEEP",
    }]


@pytest.mark.parametrize(
    ("body", "error_code"),
    [
        (_query(house_id=1), "HOUSE_ID_IN_BODY"),
        (_query(group_by=["rso", "date"]), "GROUP_BY_MULTI_UNSUPPORTED"),
        (_query(group_by=[]), "VALIDATION_ERROR"),
        (_query(metric="unknown"), "VALIDATION_ERROR"),
        (_query(metric="c2s", target={"source": "house"}), "TARGET_SOURCE_UNAVAILABLE_FOR_METRIC"),
        (_query(target={"source": "custom", "percent": 50}), "VALIDATION_ERROR"),
    ],
)
async def test_invalid_queries_return_structured_422(db, house, body, error_code):
    user = await _user(db, house)
    async with _client(db, user, house.id) as client:
        response = await client.post("/api/v1/report-builder/query", json=body)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == error_code


async def test_filter_reference_from_another_house_is_forbidden(db, house):
    user = await _user(db, house)
    other_house = House(code="RB-OTHER", name="Other House", email="other@example.com")
    db.add(other_house)
    await db.flush()
    other_retailer = Retailer(
        house_id=other_house.id, retailer_code="RB-OTHER-1", name="Other Shop"
    )
    other_employee = Employee(
        house_id=other_house.id, employee_name="Other Employee",
        employee_type="rso", status="Active",
    )
    other_route = Route(
        house_id=other_house.id, code="RB-OTHER-ROUTE", name="Other Route"
    )
    db.add_all([other_retailer, other_employee, other_route])
    await db.commit()

    async with _client(db, user, house.id) as client:
        retailer_response = await client.post(
            "/api/v1/report-builder/query",
            json=_query(filters={"retailer_ids": [other_retailer.id]}),
        )
        employee_response = await client.post(
            "/api/v1/report-builder/query",
            json=_query(filters={"employee_ids": [other_employee.id]}),
        )
        supervisor_response = await client.post(
            "/api/v1/report-builder/query",
            json=_query(filters={"supervisor_ids": [other_employee.id]}),
        )
        route_response = await client.post(
            "/api/v1/report-builder/query",
            json=_query(filters={"route_codes": [other_route.code]}),
        )

    for response in (
        retailer_response, employee_response, supervisor_response, route_response,
    ):
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "CROSS_HOUSE_REFERENCE"


async def test_report_and_filter_options_require_view_permission(db, house):
    user = await _user(db, house, role_name="RSO", permissions=())
    async with _client(db, user, house.id) as client:
        query = await client.post("/api/v1/report-builder/query", json=_query())
        options = await client.get("/api/v1/report-builder/options")

    assert query.status_code == 403
    assert options.status_code == 403


async def test_export_returns_excel_and_enforces_grouped_row_limit(db, house, monkeypatch):
    user = await _user(
        db, house, permissions=("report_builder.view", "report_builder.export")
    )
    employee = Employee(
        house_id=house.id, employee_name="Rahim", dms_code="R001",
        employee_type="rso", status="Active",
    )
    db.add(employee)
    await db.flush()
    retailer = Retailer(
        house_id=house.id, retailer_code="RET-1", name="Shop 1",
        employee_id=employee.id,
    )
    db.add(retailer)
    await db.flush()
    db.add(Activation(
        house_id=house.id, retailer_id=retailer.id, retailer_code=retailer.retailer_code,
        activation_date=date(2026, 11, 17), employee_id=employee.id,
    ))
    await db.commit()
    async with _client(db, user, house.id) as client:
        exported = await client.post("/api/v1/report-builder/export", json=_query())
        assert exported.status_code == 200, exported.text
        assert exported.headers["content-type"].startswith(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
        workbook = load_workbook(BytesIO(exported.content), read_only=True)
        assert workbook.active["A1"].value == "Metric"

        second_employee = Employee(
            house_id=house.id, employee_name="Karim", dms_code="R002",
            employee_type="rso", status="Active",
        )
        db.add(second_employee)
        await db.flush()
        second_retailer = Retailer(
            house_id=house.id, retailer_code="RET-2", name="Shop 2",
            employee_id=second_employee.id,
        )
        db.add(second_retailer)
        await db.flush()
        db.add(Activation(
            house_id=house.id, retailer_id=second_retailer.id,
            retailer_code=second_retailer.retailer_code,
            activation_date=date(2026, 11, 17), employee_id=second_employee.id,
        ))
        await db.commit()

        monkeypatch.setattr(settings, "REPORT_EXPORT_SYNC_MAX_ROWS", 1)
        oversized = await client.post("/api/v1/report-builder/export", json=_query())

    assert oversized.status_code == 422
    assert oversized.json()["error"]["code"] == "EXPORT_TOO_LARGE"


async def test_export_requires_both_view_and_export_permissions(db, house):
    user = await _user(db, house, role_name="RSO", permissions=("report_builder.export",))
    async with _client(db, user, house.id) as client:
        response = await client.post("/api/v1/report-builder/export", json=_query())

    assert response.status_code == 403
