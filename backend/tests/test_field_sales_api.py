"""HTTP checks for /api/v1/sales (permissions, workflow, serialization)."""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.models.employee import Employee
from app.models.house import House
from app.models.product import Product
from app.models.retailer import Retailer
from app.models.stock import SerialUnit
from app.routers.deps import get_current_user, get_db
from app.routers.field_sales import router
from app.routers.inventory import router as inventory_router
from app.schemas.stock import IssueCreate, ReceiptCreate
from app.services import inventory_service as inv

ALL_SALES_PERMS = (
    "field_sales.view",
    "field_sales.create",
    "field_sales.edit",
    "field_sales.submit",
    "field_sales.approve",
    "field_sales.reject",
)


def _user(house, permissions=ALL_SALES_PERMS, employee=None):
    return SimpleNamespace(
        id=11,
        name="Sales Tester",
        status="Active",
        houses=[house],
        roles=[
            SimpleNamespace(
                name="operator",
                permissions=[SimpleNamespace(name=name) for name in permissions],
            )
        ],
        employee_profile=employee,
    )


@pytest.fixture
async def api(db):
    app = FastAPI()
    app.include_router(router)
    app.include_router(inventory_router)

    async def _get_db():
        yield db

    app.dependency_overrides[get_db] = _get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield app, client


@pytest.fixture
async def data(db):
    house = House(code="FS-H1", name="Field Sales House", email="fs1@example.com")
    other = House(code="FS-H2", name="Other Field House", email="fs2@example.com")
    db.add_all([house, other])
    await db.flush()

    product = Product(
        product_code="SIM-FS-1", category="SIM", product_name="FS SIM", status="Active"
    )
    retailer = Retailer(house_id=house.id, retailer_code="R-FS-1", name="FS Retailer")
    employee = Employee(
        house_id=house.id,
        dms_code="FS-RSO-1",
        employee_name="FS RSO",
        employee_type="rso",
        status="Active",
        employee_id="FS-RSO-1",
    )
    db.add_all([product, retailer, employee])
    await db.commit()

    receipt = await inv.create_receipt(
        db,
        house_id=house.id,
        user_id=1,
        data=ReceiptCreate(product_id=product.id, serials=["FSSIM001", "FSSIM002"]),
    )
    await db.commit()
    await inv.post_receipt(db, house_id=house.id, doc_id=receipt.id, user_id=1)
    await db.commit()
    await inv.issue_stock(
        db,
        house_id=house.id,
        user_id=1,
        data=IssueCreate(
            employee_id=employee.id, product_id=product.id, serials=["FSSIM001", "FSSIM002"]
        ),
    )
    await db.commit()

    return {
        "house": house,
        "other": other,
        "product": product,
        "retailer": retailer,
        "employee": employee,
    }


def _payload(data, serials=("FSSIM001",), submit=True):
    return {
        "employee_id": data["employee"].id,
        "retailer_id": data["retailer"].id,
        "submit": submit,
        "payment_status": "cash",
        "items": [
            {
                "product_id": data["product"].id,
                "serials": list(serials),
                "unit_price": 55,
            }
        ],
    }


async def test_sale_create_submit_approve_over_http(api, db, data):
    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(data["house"])
    headers = {"X-House-ID": str(data["house"].id)}

    created = await client.post("/api/v1/sales", headers=headers, json=_payload(data))
    assert created.status_code == 201, created.text
    sale = created.json()["data"]
    assert sale["status"] == "submitted"
    assert sale["sale_no"].startswith("SAL-")
    assert sale["total_quantity"] == 1
    assert sale["total_amount"] == 55.0
    assert sale["lines"][0]["serials"][0]["serial_number"] == "FSSIM001"

    listed = await client.get("/api/v1/sales", headers=headers, params={"status": "submitted"})
    assert listed.status_code == 200
    assert listed.json()["pagination"]["total"] == 1

    approved = await client.post(
        f"/api/v1/sales/{sale['id']}/approve", headers=headers
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["data"]["status"] == "approved"

    sold = (
        await db.execute(
            select(func.count(SerialUnit.id)).where(SerialUnit.status == "sold")
        )
    ).scalar()
    assert sold == 1

    dashboard = await client.get("/api/v1/sales/dashboard", headers=headers)
    assert dashboard.status_code == 200
    assert dashboard.json()["data"]["scope"] == "house"
    assert dashboard.json()["data"]["today"]["sold_units"] == 1


async def test_field_user_cannot_approve_own_sale(api, db, data):
    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(
        data["house"],
        employee=SimpleNamespace(id=data["employee"].id, employee_type="rso"),
    )
    headers = {"X-House-ID": str(data["house"].id)}

    created = await client.post("/api/v1/sales", headers=headers, json=_payload(data))
    assert created.status_code == 201, created.text
    sale_id = created.json()["data"]["id"]

    approved = await client.post(f"/api/v1/sales/{sale_id}/approve", headers=headers)
    assert approved.status_code == 403
    assert "cannot approve your own" in approved.json()["detail"]

    # A field user only ever sees their own sales.
    other = await client.post(
        "/api/v1/sales",
        headers=headers,
        json=_payload(data, serials=("FSSIM002",)),
    )
    assert other.status_code == 201, other.text


async def test_sales_require_create_permission(api, db, data):
    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(
        data["house"], permissions=("field_sales.view",)
    )
    response = await client.post(
        "/api/v1/sales",
        headers={"X-House-ID": str(data["house"].id)},
        json=_payload(data),
    )
    assert response.status_code == 403


async def test_cross_house_sales_are_forbidden(api, db, data):
    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(data["house"])
    response = await client.get(
        "/api/v1/sales", headers={"X-House-ID": str(data["other"].id)}
    )
    assert response.status_code == 403


async def test_reject_requires_reason(api, db, data):
    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(data["house"])
    headers = {"X-House-ID": str(data["house"].id)}

    created = await client.post("/api/v1/sales", headers=headers, json=_payload(data))
    sale_id = created.json()["data"]["id"]

    bad = await client.post(
        f"/api/v1/sales/{sale_id}/reject", headers=headers, json={"reason": "x"}
    )
    assert bad.status_code == 422

    rejected = await client.post(
        f"/api/v1/sales/{sale_id}/reject",
        headers=headers,
        json={"reason": "Wrong retailer"},
    )
    assert rejected.status_code == 200
    assert rejected.json()["data"]["status"] == "rejected"

    assigned = (
        await db.execute(
            select(func.count(SerialUnit.id)).where(SerialUnit.status == "assigned")
        )
    ).scalar()
    sold = (
        await db.execute(
            select(func.count(SerialUnit.id)).where(SerialUnit.status == "sold")
        )
    ).scalar()
    assert assigned == 2
    assert sold == 0
