"""HTTP-level checks for /api/v1/inventory (routing, permissions, serialization)."""

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models.employee import Employee
from app.models.house import House
from app.models.product import Product
from app.models.stock import ProductBatch, SerialUnit, StockDocument
from app.routers.deps import get_current_user, get_db
from app.routers import inventory as inventory_router
from app.routers.inventory import router


def _user(house: House, permissions=("inventory.view",), role_name="operator"):
    return SimpleNamespace(
        id=7,
        name="Inventory Manager",
        status="Active",
        houses=[house],
        roles=[
            SimpleNamespace(
                # A non-admin role so permission checks are actually exercised.
                name=role_name,
                permissions=[SimpleNamespace(name=name) for name in permissions],
            )
        ],
        employee_profile=None,
    )


@pytest.fixture
async def api(db):
    inventory_router._receipt_jobs.clear()
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
        itop_number="1915270101",
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
    assert "serials" not in doc
    serial_page = await client.get(
        f"/api/v1/inventory/receipts/{doc['id']}/serials",
        headers=headers,
        params={"page": 1, "per_page": 1},
    )
    assert serial_page.status_code == 200
    assert len(serial_page.json()["data"]) == 1
    assert serial_page.json()["pagination"]["total"] == 2

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


async def test_100k_receiving_is_queued_then_posted_over_http(api, db, data, monkeypatch):
    app, client = api
    monkeypatch.setattr(
        inventory_router,
        "async_session",
        async_sessionmaker(db.bind, expire_on_commit=False),
    )
    app.dependency_overrides[get_current_user] = lambda: _user(
        data["house"], ("inventory.view", "inventory.receive")
    )
    headers = {"X-House-ID": str(data["house"].id)}
    serials = [f"APISIM{index:08d}" for index in range(100000)]

    created = await client.post(
        "/api/v1/inventory/receipts",
        headers=headers,
        json={
            "expected_quantity": len(serials),
            "lines": [{"product_id": data["product"].id, "serials": serials}],
        },
    )
    assert created.status_code == 202, created.text
    job = created.json()["job"]
    assert job["operation"] == "create"
    assert job["status"] in {"queued", "running"}
    assert job["quantity"] == len(serials)
    await asyncio.gather(*list(inventory_router._receipt_job_tasks))

    jobs = await client.get("/api/v1/inventory/receipts/jobs", headers=headers)
    completed_job = next(
        row for row in jobs.json()["data"] if row["job_id"] == job["job_id"]
    )
    assert completed_job["status"] == "completed"
    assert completed_job["document_no"]

    posted = await client.post(
        f"/api/v1/inventory/receipts/{completed_job['record_id']}/post",
        headers=headers,
    )
    assert posted.status_code == 200, posted.text
    assert posted.json()["data"]["status"] == "posted"


async def test_large_draft_delete_is_queued_and_house_scoped(api, db, data, monkeypatch):
    app, client = api
    monkeypatch.setattr(
        inventory_router,
        "async_session",
        async_sessionmaker(db.bind, expire_on_commit=False),
    )
    monkeypatch.setattr(inventory_router, "RECEIPT_BACKGROUND_THRESHOLD", 1)
    headers = {"X-House-ID": str(data["house"].id)}
    app.dependency_overrides[get_current_user] = lambda: _user(
        data["house"], ("inventory.view", "inventory.receive")
    )
    created = await client.post(
        "/api/v1/inventory/receipts",
        headers=headers,
        json={"product_id": data["product"].id, "serials": ["APIQUE001"]},
    )
    assert created.status_code == 202, created.text
    create_job = created.json()["job"]
    await asyncio.gather(*list(inventory_router._receipt_job_tasks))
    assert inventory_router._receipt_jobs[create_job["job_id"]]["status"] == "completed"
    receipt_id = inventory_router._receipt_jobs[create_job["job_id"]]["doc_id"]

    app.dependency_overrides[get_current_user] = lambda: _user(
        data["house"], ("inventory.delete.permanent",), role_name="admin"
    )
    deleted = await client.delete(f"/api/v1/inventory/receipts/{receipt_id}", headers=headers)
    assert deleted.status_code == 202, deleted.text
    delete_job = deleted.json()["job"]
    assert delete_job["operation"] == "delete"
    assert delete_job["record_id"] == receipt_id
    await asyncio.gather(*list(inventory_router._receipt_job_tasks))

    status_response = await client.get(
        "/api/v1/inventory/receipts/jobs", headers=headers
    )
    completed_delete = next(
        job
        for job in status_response.json()["data"]
        if job["job_id"] == delete_job["job_id"]
    )
    assert completed_delete["status"] == "completed"
    assert await db.get(StockDocument, receipt_id) is None


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


async def test_receipt_permanent_delete_requires_permission(api, data):
    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(
        data["house"], ("inventory.view", "inventory.receive")
    )
    headers = {"X-House-ID": str(data["house"].id)}
    created = await client.post(
        "/api/v1/inventory/receipts",
        headers=headers,
        json={"product_id": data["product"].id, "serials": ["APIDEL001"]},
    )
    assert created.status_code == 201, created.text

    deleted = await client.delete(
        f"/api/v1/inventory/receipts/{created.json()['data']['id']}",
        headers=headers,
    )
    assert deleted.status_code == 403
    app.dependency_overrides[get_current_user] = lambda: _user(
        data["house"], ("inventory.delete.permanent",)
    )
    non_admin_delete = await client.delete(
        f"/api/v1/inventory/receipts/{created.json()['data']['id']}",
        headers=headers,
    )
    assert non_admin_delete.status_code == 403


async def test_permanent_delete_removes_draft_and_rejects_posted_receipts(api, db, data):
    app, client = api
    headers = {"X-House-ID": str(data["house"].id)}
    app.dependency_overrides[get_current_user] = lambda: _user(
        data["house"], ("inventory.view", "inventory.receive")
    )
    created = await client.post(
        "/api/v1/inventory/receipts",
        headers=headers,
        json={"product_id": data["product"].id, "serials": ["APIDEL002"]},
    )
    assert created.status_code == 201, created.text
    draft_id = created.json()["data"]["id"]

    app.dependency_overrides[get_current_user] = lambda: _user(
        data["house"], ("inventory.delete.permanent",), role_name="admin"
    )
    deleted = await client.delete(f"/api/v1/inventory/receipts/{draft_id}", headers=headers)
    assert deleted.status_code == 204, deleted.text
    assert await db.get(StockDocument, draft_id) is None
    assert (
        await db.execute(select(SerialUnit).where(SerialUnit.serial_number == "APIDEL002"))
    ).scalar_one_or_none() is None

    app.dependency_overrides[get_current_user] = lambda: _user(
        data["house"], ("inventory.view", "inventory.receive")
    )
    posted_create = await client.post(
        "/api/v1/inventory/receipts",
        headers=headers,
        json={"product_id": data["product"].id, "serials": ["APIDEL003"]},
    )
    posted_id = posted_create.json()["data"]["id"]
    posted = await client.post(f"/api/v1/inventory/receipts/{posted_id}/post", headers=headers)
    assert posted.status_code == 200

    app.dependency_overrides[get_current_user] = lambda: _user(
        data["house"], ("inventory.delete.permanent",), role_name="admin"
    )
    rejected = await client.delete(f"/api/v1/inventory/receipts/{posted_id}", headers=headers)
    assert rejected.status_code == 409


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
                },
                {
                    "product_id": scratch.id,
                    "serials": ["APISC001"],
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


async def test_receipt_serial_page_and_product_search(api, db, data):
    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(
        data["house"], ("inventory.view", "inventory.receive")
    )
    headers = {"X-House-ID": str(data["house"].id)}

    products = [
        Product(
            product_code=f"SIM-SEARCH-{index:02d}",
            category="SIM",
            product_name=f"Search SIM {index:02d}",
            status="Active",
        )
        for index in range(8)
    ]
    db.add_all(products)
    await db.commit()

    response = await client.get(
        "/api/v1/inventory/products",
        headers=headers,
        params={"search": "SIM-SEARCH", "limit": 3},
    )
    assert response.status_code == 200
    assert len(response.json()["data"]) == 3

    receipt = await client.post(
        "/api/v1/inventory/receipts",
        headers=headers,
        json={
            "product_id": data["product"].id,
            "serials": ["APIPAGE001", "APIPAGE002", "APIPAGE003"],
        },
    )
    assert receipt.status_code == 201
    doc_id = receipt.json()["data"]["id"]
    detail = await client.get(f"/api/v1/inventory/receipts/{doc_id}", headers=headers)
    assert detail.status_code == 200
    assert "serials" not in detail.json()["data"]
    assert detail.json()["data"]["serials_count"] == 3

    page = await client.get(
        f"/api/v1/inventory/receipts/{doc_id}/serials",
        headers=headers,
        params={"page": 2, "per_page": 2},
    )
    assert page.status_code == 200
    assert [row["serial_number"] for row in page.json()["data"]] == ["APIPAGE003"]
    assert page.json()["pagination"]["has_prev"] is True


async def test_product_lookup_reports_available_stock_and_filters_in_stock_only(api, db, data):
    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(
        data["house"], ("inventory.view", "inventory.receive", "inventory.issue")
    )
    headers = {"X-House-ID": str(data["house"].id)}

    stocked = Product(
        product_code="SIM-QTY-01",
        category="SIM",
        product_name="Stocked SIM",
        status="Active",
    )
    empty = Product(
        product_code="SIM-QTY-EMPTY",
        category="SIM",
        product_name="Empty SIM",
        status="Active",
    )
    db.add_all([stocked, empty])
    await db.flush()

    receipt = await client.post(
        "/api/v1/inventory/receipts",
        headers=headers,
        json={
            "product_id": stocked.id,
            "serials": ["QTYAPI0001", "QTYAPI0002", "QTYAPI0003", "QTYAPI0004"],
        },
    )
    assert receipt.status_code == 201, receipt.text
    posted = await client.post(
        f"/api/v1/inventory/receipts/{receipt.json()['data']['id']}/post", headers=headers
    )
    assert posted.status_code == 200, posted.text

    everything = await client.get(
        "/api/v1/inventory/products",
        headers=headers,
        params={"search": "SIM-QTY"},
    )
    assert everything.status_code == 200
    quantities = {row["product_code"]: row["available_qty"] for row in everything.json()["data"]}
    assert quantities["SIM-QTY-01"] == 4
    assert quantities["SIM-QTY-EMPTY"] == 0

    in_stock = await client.get(
        "/api/v1/inventory/products",
        headers=headers,
        params={"search": "SIM-QTY", "in_stock_only": True},
    )
    assert in_stock.status_code == 200
    rows = in_stock.json()["data"]
    assert [row["product_code"] for row in rows] == ["SIM-QTY-01"]
    assert rows[0]["available_qty"] == 4

    # Issuing a serial removes it from the house's available stock right away.
    issued = await client.post(
        "/api/v1/inventory/issues",
        headers=headers,
        json={
            "employee_id": data["employee"].id,
            "lines": [{"product_id": stocked.id, "serials": ["QTYAPI0001"]}],
        },
    )
    assert issued.status_code == 201, issued.text

    after_issue = await client.get(
        "/api/v1/inventory/products",
        headers=headers,
        params={"search": "SIM-QTY", "in_stock_only": True},
    )
    assert after_issue.status_code == 200
    assert after_issue.json()["data"][0]["available_qty"] == 3


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


async def test_multi_product_issue_creates_one_line_per_product(api, db, data):
    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(
        data["house"],
        ("inventory.view", "inventory.receive", "inventory.issue"),
    )
    headers = {"X-House-ID": str(data["house"].id)}

    scratch = Product(
        product_code="SC-API-ISSUE",
        category="Scratch Card",
        product_name="API Scratch Issue",
        status="Active",
    )
    db.add(scratch)
    await db.flush()

    received = await client.post(
        "/api/v1/inventory/receipts",
        headers=headers,
        json={
            "lines": [
                {"product_id": data["product"].id, "serials": ["APIISS001", "APIISS002"]},
                {"product_id": scratch.id, "serials": ["APIISS003"]},
            ],
        },
    )
    assert received.status_code == 201, received.text
    receipt_id = received.json()["data"]["id"]
    posted = await client.post(
        f"/api/v1/inventory/receipts/{receipt_id}/post", headers=headers
    )
    assert posted.status_code == 200, posted.text

    issued = await client.post(
        "/api/v1/inventory/issues",
        headers=headers,
        json={
            "employee_id": data["employee"].id,
            "lines": [
                {"product_id": data["product"].id, "serials": ["APIISS001", "APIISS002"]},
                {"product_id": scratch.id, "serials": ["APIISS003"]},
            ],
        },
    )
    assert issued.status_code == 201, issued.text
    doc = issued.json()["data"]
    assert doc["status"] == "posted"
    assert doc["product_count"] == 2
    assert doc["serials_count"] == 3
    assert doc["total_quantity"] == 3
    assert [line["product_id"] for line in doc["lines"]] == [data["product"].id, scratch.id]
    assert [line["quantity"] for line in doc["lines"]] == [2, 1]

    detail = await client.get(f"/api/v1/inventory/issues/{doc['id']}", headers=headers)
    assert detail.status_code == 200, detail.text
    payload = detail.json()["data"]
    serial_products = {
        row["serial_number"]: row["product_id"] for row in payload["serials"]
    }
    assert serial_products == {
        "APIISS001": data["product"].id,
        "APIISS002": data["product"].id,
        "APIISS003": scratch.id,
    }
    assert {row["status_after"] for row in payload["serials"]} == {"assigned"}

    # Serial rows carry the holder's identity so the UI can show the RSO iTop
    # number (BPs show their pool number instead).
    assigned_serials = await client.get(
        "/api/v1/inventory/serials", headers=headers, params={"status": "assigned"}
    )
    assert assigned_serials.status_code == 200
    assigned_rows = assigned_serials.json()["data"]
    assert {row["employee_type"] for row in assigned_rows} == {"rso"}
    assert {row["itop_number"] for row in assigned_rows} == {"1915270101"}

    summary = await client.get(
        "/api/v1/inventory/summary",
        headers=headers,
        params={"product_id": scratch.id},
    )
    house_summary = summary.json()["data"]["house"]
    assert house_summary["available"] == 0
    assert house_summary["assigned"] == 1


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
