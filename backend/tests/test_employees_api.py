"""HTTP checks for employee DMS-code conflict handling."""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.models.employee import Employee
from app.models.house import House
from app.models.retailer import Retailer  # noqa: F401 - register metadata
from app.models.retailer_marking import RetailerMarking, RetailerMarkingAssignment  # noqa: F401
from app.routers.deps import get_current_user, get_db
from app.routers.employees import router


def _user(house):
    return SimpleNamespace(
        id=1,
        name="Employee Tester",
        status="Active",
        houses=[house],
        roles=[SimpleNamespace(name="Admin", permissions=[])],
        employee_profile=None,
    )


def _payload(house_id: int, dms_code: str = "RS050979") -> dict:
    return {
        "house_id": house_id,
        "status": "Active",
        "employee_type": "rso",
        "dms_code": dms_code,
        "itop_number": "1411312026",
        "joining_date": "2026-01-01",
        "employee_name": "New RSO",
    }


@pytest.fixture
async def api(db):
    app = FastAPI()
    app.include_router(router)

    async def _get_db():
        yield db

    app.dependency_overrides[get_db] = _get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield app, client


@pytest.fixture
async def data(db):
    house = House(code="EMP-H1", name="Employee House", email="emp1@example.com")
    other = House(code="EMP-H2", name="Other Employee House", email="emp2@example.com")
    db.add_all([house, other])
    await db.flush()
    employee = Employee(
        house_id=other.id,
        dms_code="RS050979",
        employee_name="Api Ahmed Sumon",
        employee_type="rso",
        status="Suspended",
        employee_id="RSO-0033",
        itop_number="1411312026",
    )
    db.add(employee)
    await db.commit()
    return {"house": house, "other": other, "employee": employee}


async def test_duplicate_dms_code_in_other_house_is_reported_with_identity(api, db, data):
    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(data["house"])

    response = await client.post("/api/employees", json=_payload(data["house"].id))

    assert response.status_code == 422
    field_error = response.json()["detail"][0]
    assert field_error["loc"] == ["body", "dms_code"]
    assert field_error["error_code"] == "dms_code_exists"
    assert field_error["employee"] == {
        "name": "Api Ahmed Sumon",
        "status": "Suspended",
        "house": "Other Employee House",
    }
    assert "Api Ahmed Sumon" in field_error["msg"]
    assert "Suspended" in field_error["msg"]
    assert "Other Employee House" in field_error["msg"]


async def test_duplicate_dms_code_check_is_case_insensitive(api, db, data):
    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(data["house"])

    response = await client.post(
        "/api/employees", json=_payload(data["house"].id, dms_code="  rs050979  ")
    )

    assert response.status_code == 422
    assert "Api Ahmed Sumon" in response.json()["detail"][0]["msg"]


async def test_update_with_case_only_dms_code_change_does_not_conflict_with_self(api, db, data):
    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(data["other"])
    employee = data["employee"]

    response = await client.put(
        f"/api/employees/{employee.id}",
        json=_payload(data["other"].id, dms_code="rs050979"),
    )

    assert response.status_code == 200, response.text
    assert response.json()["dms_code"] == "rs050979"


async def test_update_with_removed_document_does_not_fail(api, db, data):
    from sqlalchemy import select

    from app.models.employee_document import EmployeeDocument

    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(data["other"])
    employee = data["employee"]
    doc = EmployeeDocument(
        employee_id=employee.id,
        house_id=employee.house_id,
        doc_type="nid",
        file_name="nid.pdf",
        storage_path="1/1/nid.pdf",
    )
    db.add(doc)
    await db.commit()

    response = await client.put(
        f"/api/employees/{employee.id}",
        json={**_payload(data["other"].id, dms_code="rs050979"), "remove_document_ids": [doc.id]},
    )

    assert response.status_code == 200, response.text
    await db.refresh(doc)
    assert doc.is_deleted is True
    assert (await db.execute(select(EmployeeDocument).where(EmployeeDocument.id == doc.id))).scalar_one().is_deleted


async def test_create_and_update_persist_bangla_fields(api, db, data):
    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(data["house"])
    bangla = {
        "employee_name_bn": "মোঃ করিম",
        "fathers_name_bn": "মোঃ রহিম",
        "mothers_name_bn": "মোছাঃ রহিমা",
        "nid_bn": "১২৩৪৫৬৭৮৯০",
        "present_address_bn": "বাজিতপুর, কিশোরগঞ্জ",
        "permanent_address_bn": "কিশোরগঞ্জ সদর",
    }

    created = await client.post(
        "/api/employees",
        json={**_payload(data["house"].id, dms_code="RS050981"), **bangla},
    )
    assert created.status_code == 200, created.text
    emp_id = created.json()["id"]
    assert {key: created.json()[key] for key in bangla} == bangla

    updated = await client.put(
        f"/api/employees/{emp_id}",
        json={
            **_payload(data["house"].id, dms_code="RS050981"),
            **bangla,
            "employee_name_bn": "মোঃ করিম উদ্দিন",
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["employee_name_bn"] == "মোঃ করিম উদ্দিন"
    assert updated.json()["present_address_bn"] == "বাজিতপুর, কিশোরগঞ্জ"
