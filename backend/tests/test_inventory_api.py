"""HTTP-level checks for /api/v1/inventory (routing, permissions, serialization)."""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.models.employee import Employee
from app.models.house import House
from app.models.product import Product
from app.models.stock import ProductBatch, SerialUnit
from app.routers.deps import get_current_user, get_db
from app.routers.inventory import router


def _user(house: House, permissions=("inventory.view",)):
    return SimpleNamespace(
        id=7,
        name="Inventory Manager",
        status="Active",
        houses=[house],
        roles=[
            SimpleNamespace(
                # A non-admin role so permission checks are actually exercised.
                name="operator",
                permissions=[SimpleNamespace(name=name) for name in permissions],
            )
        ],
        employee_profile=None,
    )


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
    house = House(code="API-H1", name="API House", email="api1@example.com")
    other = House(code="API-H2", name="Other API House", email="api2@example.com")
    db.add_all([house, other])
    await db.flush()
    product = Product(
        product_code="SIM-API-1",
        category="SIM",
        product_name="API SIM",
        status="Active",
    )
    db.add(product)
    await db.flush()
    employee = Employee(
        house_id=house.id,
        dms_code="API-RSO-1",
        employee_name="API RSO",
        employee_type="rso",
        status="Active",
        employee_id="API-RSO-1",
    )
    db.add(employee)
    await db.commit()
    return {"house": house, "other": other, "product": product, "employee": employee}


async def test_receiving_issue_return_flow_over_http(api, db, data):
    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(
        data["house"],
        ("inventory.view", "inventory.receive", "inventory.issue", "inventory.return", "inventory.verify"),
    )
    headers = {"X-House-ID": str(data["house"].id)}

    created = await client.post(
        "/api/v1/inventory/receipts",
        headers=headers,
        json={
            "product_id": data["product"].id,
            "supplier": "Banglalink",
            "invoice_number": "INV-9",
            "expected_quantity": 2,
            "serials": ["APISIM001", "APISIM002"],
        },
    )
    assert created.status_code == 201, created.text
    doc = created.json()["data"]
    assert doc["status"] == "draft"
    assert doc["document_no"].startswith("GRN-")
    assert doc["serials_count"] == 2
    assert len(doc["serials"]) == 2

    # Draft serials are not sellable yet.
    summary = await client.get("/api/v1/inventory/summary", headers=headers)
    assert summary.json()["data"]["house"]["available"] == 0

    posted = await client.post(
        f"/api/v1/inventory/receipts/{doc['id']}/post", headers=headers
    )
    assert posted.status_code == 200, posted.text
    assert posted.json()["data"]["status"] == "posted"

    summary = await client.get("/api/v1/inventory/summary", headers=headers)
    assert summary.json()["data"]["house"]["available"] == 2

    issue = await client.post(
        "/api/v1/inventory/issues",
        headers=headers,
        json={
            "employee_id": data["employee"].id,
            "product_id": data["product"].id,
            "serials": ["APISIM001"],
        },
    )
    assert issue.status_code == 201, issue.text
    issue_doc = issue.json()["data"]
    assert issue_doc["document_no"].startswith("ISS-")
    assert issue_doc["status"] == "posted"

    # Selling/issuing the same serial again must fail with the permission-aware error body.
    duplicate_issue = await client.post(
        "/api/v1/inventory/issues",
        headers=headers,
        json={
            "employee_id": data["employee"].id,
            "product_id": data["product"].id,
            "serials": ["APISIM001"],
        },
    )
    assert duplicate_issue.status_code == 409
    assert duplicate_issue.json()["detail"]["code"] == "SERIAL_NOT_AVAILABLE"

    ret = await client.post(
        "/api/v1/inventory/returns",
        headers=headers,
        json={
            "employee_id": data["employee"].id,
            "product_id": data["product"].id,
            "serials": ["APISIM001"],
        },
    )
    assert ret.status_code == 201, ret.text
    ret_doc = ret.json()["data"]
    assert ret_doc["status"] == "submitted"

    summary = await client.get("/api/v1/inventory/summary", headers=headers)
    assert summary.json()["data"]["house"]["available"] == 1
    assert summary.json()["data"]["house"]["returned"] == 1

    verified = await client.post(
        f"/api/v1/inventory/returns/{ret_doc['id']}/verify",
        headers=headers,
        json={"decisions": [{"serial_number": "APISIM001", "decision": "accept"}]},
    )
    assert verified.status_code == 200, verified.text
    assert verified.json()["data"]["status"] == "verified"

    summary = await client.get("/api/v1/inventory/summary", headers=headers)
    assert summary.json()["data"]["house"]["available"] == 2

    serials = await client.get(
        "/api/v1/inventory/serials", headers=headers, params={"status": "available"}
    )
    assert serials.status_code == 200
    assert serials.json()["pagination"]["total"] == 2

    unit = (
        await db.execute(select(SerialUnit).where(SerialUnit.serial_number == "APISIM001"))
    ).scalar_one()
    history = await client.get(
        f"/api/v1/inventory/serials/{unit.id}/history", headers=headers
    )
    assert history.status_code == 200
    actions = [movement["action"] for movement in history.json()["data"]["movements"]]
    assert actions == ["receive", "issue", "return_request"]


async def test_cross_house_header_is_forbidden(api, db, data):
    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(data["house"])

    response = await client.get(
        "/api/v1/inventory/serials",
        headers={"X-House-ID": str(data["other"].id)},
    )
    assert response.status_code == 403


async def test_missing_permission_is_forbidden(api, db, data):
    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(data["house"], ())

    response = await client.get(
        "/api/v1/inventory/serials",
        headers={"X-House-ID": str(data["house"].id)},
    )
    assert response.status_code == 403


async def test_receiving_requires_receive_permission(api, db, data):
    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(data["house"])

    response = await client.post(
        "/api/v1/inventory/receipts",
        headers={"X-House-ID": str(data["house"].id)},
        json={"product_id": data["product"].id, "serials": ["APISIM900"]},
    )
    assert response.status_code == 403


async def test_multi_product_receipt_keeps_one_line_and_batch_per_product(api, db, data):
    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(
        data["house"], ("inventory.view", "inventory.receive")
    )
    headers = {"X-House-ID": str(data["house"].id)}

    scratch = Product(
        product_code="SC-API-1",
        category="Scratch Card",
        product_name="API Scratch",
        status="Active",
    )
    db.add(scratch)
    await db.flush()

    created = await client.post(
        "/api/v1/inventory/receipts",
        headers=headers,
        json={
            "supplier": "Banglalink",
            "invoice_number": "INV-MULTI",
            "lines": [
                {
                    "product_id": data["product"].id,
                    "serials": ["APISIM101", "APISIM102"],
                    "unit_cost": 10,
                    "face_value": 20,
                },
                {
                    "product_id": scratch.id,
                    "serials": ["APISC001"],
                    "unit_cost": 5,
                    "face_value": 10,
                },
            ],
        },
    )
    assert created.status_code == 201, created.text
    doc = created.json()["data"]
    assert doc["product_count"] == 2
    assert doc["serials_count"] == 3
    assert doc["total_quantity"] == 3
    # Batch numbers are generated by the server from the unique voucher number.
    assert doc["batch_number"] == doc["document_no"]
    assert [line["product_id"] for line in doc["lines"]] == [data["product"].id, scratch.id]
    assert [line["quantity"] for line in doc["lines"]] == [2, 1]
    assert [line["unit_cost"] for line in doc["lines"]] == [10, 5]
    assert [line["face_value"] for line in doc["lines"]] == [20, 10]

    posted = await client.post(
        f"/api/v1/inventory/receipts/{doc['id']}/post", headers=headers
    )
    assert posted.status_code == 200, posted.text
    assert posted.json()["data"]["status"] == "posted"

    summary = await client.get(
        "/api/v1/inventory/summary",
        headers=headers,
        params={"product_id": scratch.id},
    )
    assert summary.json()["data"]["house"]["available"] == 1

    batches = (
        await db.execute(
            select(ProductBatch).where(ProductBatch.house_id == data["house"].id)
        )
    ).scalars().all()
    assert {batch.product_id for batch in batches} == {data["product"].id, scratch.id}
    assert {batch.quantity for batch in batches} == {1, 2}
    assert {batch.product_id: float(batch.unit_cost) for batch in batches} == {
        data["product"].id: 10,
        scratch.id: 5,
    }
    assert {batch.product_id: float(batch.face_value) for batch in batches} == {
        data["product"].id: 20,
        scratch.id: 10,
    }
    # Both products share the voucher's auto batch number.
    assert {batch.batch_number for batch in batches} == {doc["batch_number"]}


async def test_receipt_list_counts_serials_without_lazy_load(api, db, data):
    """The list endpoint must not lazy-load ``doc.serial_lines`` (MissingGreenlet).

    A fresh request gets a fresh session, so nothing is pre-loaded. ``expunge_all``
    reproduces that: without a SQL-side count the serializer would issue a lazy
    load outside the greenlet and the request would fail with a 500.
    """
    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(
        data["house"], ("inventory.view", "inventory.receive")
    )
    headers = {"X-House-ID": str(data["house"].id)}

    created = await client.post(
        "/api/v1/inventory/receipts",
        headers=headers,
        json={"product_id": data["product"].id, "serials": ["APILST001", "APILST002", "APILST003"]},
    )
    assert created.status_code == 201, created.text
    doc_id = created.json()["data"]["id"]

    db.expunge_all()

    listed = await client.get("/api/v1/inventory/receipts", headers=headers)
    assert listed.status_code == 200, listed.text
    rows = listed.json()["data"]
    assert listed.json()["pagination"]["total"] == 1
    assert rows[0]["id"] == doc_id
    assert rows[0]["serials_count"] == 3
    # Detail-only payload stays out of the list.
    assert "serials" not in rows[0]


async def test_receipt_batch_number_is_auto_generated_and_unique(api, db, data):
    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(
        data["house"], ("inventory.view", "inventory.receive")
    )
    headers = {"X-House-ID": str(data["house"].id)}

    batch_numbers = []
    for index in range(2):
        created = await client.post(
            "/api/v1/inventory/receipts",
            headers=headers,
            json={
                "product_id": data["product"].id,
                "serials": [f"APISIM-AUTO-{index}"],
            },
        )
        assert created.status_code == 201, created.text
        doc = created.json()["data"]
        assert doc["batch_number"] == doc["document_no"]
        assert doc["batch_number"]
        batch_numbers.append(doc["batch_number"])

    assert len(set(batch_numbers)) == 2


async def test_multi_product_receipt_rejects_duplicate_serial_across_products(api, db, data):
    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(
        data["house"], ("inventory.view", "inventory.receive")
    )
    headers = {"X-House-ID": str(data["house"].id)}

    scratch = Product(
        product_code="SC-API-2",
        category="Scratch Card",
        product_name="API Scratch 2",
        status="Active",
    )
    db.add(scratch)
    await db.flush()

    response = await client.post(
        "/api/v1/inventory/receipts",
        headers=headers,
        json={
            "lines": [
                {"product_id": data["product"].id, "serials": ["APIDUP001"]},
                {"product_id": scratch.id, "serials": ["APIDUP001"]},
            ],
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "VALIDATION_ERROR"
