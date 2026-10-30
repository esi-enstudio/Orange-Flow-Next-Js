"""HTTP checks for /api/v1/finance (permissions, workflow, house scoping)."""

from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.models.employee import Employee
from app.models.finance import CashTransaction
from app.models.house import House
from app.models.itopup_balance import ITopUpBalance
from app.routers.deps import get_current_user, get_db
from app.routers.finance import router

ALL_PERMS = (
    "finance.view",
    "finance.expense_create",
    "finance.expense_approve",
    "finance.expense_pay",
    "finance.receipt_create",
    "finance.cash_entry",
    "finance.cash_reverse",
    "finance.closing_submit",
    "finance.closing_approve",
    "finance.closing_reopen",
    "itopup_balance.view",
    "itopup_balance.create",
    "itopup_balance.verify",
)


def _user(house, permissions=ALL_PERMS):
    return SimpleNamespace(
        id=11,
        name="Finance Tester",
        status="Active",
        houses=[house],
        roles=[
            SimpleNamespace(
                name="accountant",
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
    house = House(code="FA-H1", name="Finance API House", email="fa1@example.com")
    other = House(code="FA-H2", name="Other Finance API House", email="fa2@example.com")
    db.add_all([house, other])
    await db.flush()

    rso = Employee(
        house_id=house.id,
        dms_code="FA-RSO-1",
        employee_name="API RSO",
        employee_type="rso",
        status="Active",
        employee_id="FA-RSO-1",
    )
    db.add(rso)
    await db.commit()
    return {"house": house, "other": other, "rso": rso}


async def test_expense_approve_pay_lands_in_cashbook(api, db, data):
    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(data["house"])
    headers = {"X-House-ID": str(data["house"].id)}

    created = await client.post(
        "/api/v1/finance/expenses",
        headers=headers,
        json={
            "description": "Office rent",
            "amount": 1500,
            "source": "house",
            "business_date": "2026-10-29",
        },
    )
    assert created.status_code == 201, created.text
    expense = created.json()["data"]
    assert expense["status"] == "pending"
    assert expense["amount"] == 1500.0

    paid_too_early = await client.post(
        f"/api/v1/finance/expenses/{expense['id']}/pay", headers=headers, json={}
    )
    assert paid_too_early.status_code == 400

    approved = await client.post(
        f"/api/v1/finance/expenses/{expense['id']}/approve", headers=headers
    )
    assert approved.status_code == 200, approved.text

    paid = await client.post(
        f"/api/v1/finance/expenses/{expense['id']}/pay",
        headers=headers,
        json={"reference": "V-100"},
    )
    assert paid.status_code == 200, paid.text
    assert paid.json()["data"]["status"] == "paid"

    book = await client.get(
        "/api/v1/finance/cashbook/daily", headers=headers, params={"date": "2026-10-29"}
    )
    assert book.status_code == 200, book.text
    payload = book.json()["data"]
    assert payload["cash_out"] == 1500.0
    assert payload["expected_cash"] == -1500.0
    assert payload["transactions"][0]["source_type"] == "expense"

    listed = await client.get(
        "/api/v1/finance/expenses", headers=headers, params={"status": "paid"}
    )
    assert listed.json()["pagination"]["total"] == 1


async def test_expense_requires_create_permission(api, db, data):
    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(
        data["house"], permissions=("finance.view",)
    )
    response = await client.post(
        "/api/v1/finance/expenses",
        headers={"X-House-ID": str(data["house"].id)},
        json={"description": "Fuel", "amount": 10},
    )
    assert response.status_code == 403


async def test_cross_house_finance_requests_are_forbidden(api, db, data):
    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(data["house"])
    response = await client.get(
        "/api/v1/finance/expenses", headers={"X-House-ID": str(data["other"].id)}
    )
    assert response.status_code == 403


async def test_closing_workflow_blocks_entries_until_reopened(api, db, data):
    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(data["house"])
    headers = {"X-House-ID": str(data["house"].id)}

    submitted = await client.post(
        "/api/v1/finance/daily-closings",
        headers=headers,
        json={"business_date": "2026-10-29", "counted_cash": 0},
    )
    assert submitted.status_code == 201, submitted.text
    closing_id = submitted.json()["data"]["id"]
    assert submitted.json()["data"]["status"] == "submitted"

    approved = await client.post(
        f"/api/v1/finance/daily-closings/{closing_id}/approve", headers=headers
    )
    assert approved.status_code == 200, approved.text

    blocked = await client.post(
        "/api/v1/finance/expenses",
        headers=headers,
        json={"description": "Late bill", "amount": 25, "business_date": "2026-10-29"},
    )
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "DATE_CLOSED"

    reopened = await client.post(
        f"/api/v1/finance/daily-closings/{closing_id}/reopen",
        headers=headers,
        json={"reason": "Missed bill"},
    )
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["data"]["status"] == "reopened"

    allowed = await client.post(
        "/api/v1/finance/expenses",
        headers=headers,
        json={"description": "Late bill", "amount": 25, "business_date": "2026-10-29"},
    )
    assert allowed.status_code == 201, allowed.text


async def test_topup_transfer_moves_balance_and_entries_are_verifiable(api, db, data):
    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(data["house"])
    headers = {"X-House-ID": str(data["house"].id)}
    db.add(
        ITopUpBalance(
            house_id=data["house"].id, employee_id=None, balance=Decimal("5000.00")
        )
    )
    await db.commit()

    transfer = await client.post(
        "/api/v1/finance/itopup/transfers",
        headers=headers,
        json={"to_employee_id": data["rso"].id, "amount": 2000, "movement": "morning"},
    )
    assert transfer.status_code == 201, transfer.text

    balances = await client.get("/api/v1/finance/itopup/balances", headers=headers)
    assert balances.status_code == 200, balances.text
    rso_row = next(
        row for row in balances.json()["data"] if row["employee_id"] == data["rso"].id
    )
    assert rso_row["balance"] == 2000.0

    entry = await client.post(
        "/api/v1/finance/itopup/entries",
        headers=headers,
        json={
            "employee_id": data["rso"].id,
            "business_date": "2026-10-29",
            "entry_type": "usage",
            "amount": 500,
        },
    )
    assert entry.status_code == 201, entry.text
    entry_id = entry.json()["data"]["id"]

    verified = await client.post(
        f"/api/v1/finance/itopup/entries/{entry_id}/verify",
        headers=headers,
        json={"verified_amount": 480},
    )
    assert verified.status_code == 200, verified.text
    assert verified.json()["data"]["discrepancy"] == -20.0

    reconciliation = await client.get(
        "/api/v1/finance/itopup/reconciliation",
        headers=headers,
        params={"date": "2026-10-29"},
    )
    assert reconciliation.status_code == 200, reconciliation.text
    holder = reconciliation.json()["data"]["holders"][0]
    assert holder["used"] == 500.0
    assert holder["closing_balance"] == 1500.0

    balance_row = (
        await db.execute(
            select(ITopUpBalance).where(ITopUpBalance.employee_id == data["rso"].id)
        )
    ).scalar_one()
    assert float(balance_row.balance) == 1500.0


async def test_receipt_and_cash_entry_over_http(api, db, data):
    app, client = api
    app.dependency_overrides[get_current_user] = lambda: _user(data["house"])
    headers = {"X-House-ID": str(data["house"].id)}

    receipt = await client.post(
        "/api/v1/finance/receipts",
        headers=headers,
        json={
            "receipt_type": "Old due",
            "amount": 700,
            "payment_method": "cash",
            "business_date": "2026-10-29",
        },
    )
    assert receipt.status_code == 201, receipt.text

    cash = await client.post(
        "/api/v1/finance/cash/entries",
        headers=headers,
        json={
            "direction": "out",
            "amount": 200,
            "description": "Transport",
            "business_date": "2026-10-29",
        },
    )
    assert cash.status_code == 201, cash.text
    tx_id = cash.json()["data"]["id"]

    reversal = await client.post(
        f"/api/v1/finance/cash/transactions/{tx_id}/reverse",
        headers=headers,
        json={"reason": "Wrong entry"},
    )
    assert reversal.status_code == 200, reversal.text

    assert (
        await db.execute(
            select(func.count(CashTransaction.id)).where(
                CashTransaction.reversal_of == tx_id
            )
        )
    ).scalar() == 1
