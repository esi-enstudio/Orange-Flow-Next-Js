"""HTTP-level checks for the cash-first billing surface.

The important guarantees live above the service layer:
  - recording cash requires the billing permission,
  - the response/record is authoritative (no gateway needed),
  - hosted checkout is refused cleanly when online payments are disabled.
"""

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import func, select

from app.models.payment import Payment
from app.models.role import Role
from app.models.user import User
from app.routers import admin_billing, billing
from app.routers.deps import get_current_user, get_db, get_house_context

from conftest import make_invoice


async def make_user(db, role_name: str = "Admin", username: str = "cash-admin") -> User:
    role = Role(name=role_name)
    db.add(role)
    user = User(
        username=username,
        hashed_password="x",
        name="Cash Tester",
        status="Active",
    )
    user.roles.append(role)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


def build_client(router, db, user, house_context=None) -> httpx.AsyncClient:
    app = FastAPI()
    app.include_router(router)

    async def override_db():
        yield db

    async def override_user():
        return user

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = override_user

    if house_context is not None:
        async def override_house():
            return house_context

        app.dependency_overrides[get_house_context] = override_house

    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
    )


async def test_cash_endpoint_records_payment_without_gateway(db, house, plan, sub):
    user = await make_user(db)
    async with build_client(admin_billing.router, db, user) as client:
        res = await client.post(
            f"/api/v1/admin/subscriptions/{sub.id}/cash-payment",
            json={"reference": "CASH-RCPT-1", "note": "received at office", "idempotency_key": "api-test-1"},
        )

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["success"] is True
    assert body["already_paid"] is False
    assert body["invoice"]["status"] == "paid"
    assert body["subscription"]["status"] == "active"
    assert await (await db.execute(select(func.count(Payment.id)))).scalar_one() == 1


async def test_cash_endpoint_is_idempotent_with_key(db, house, plan, sub):
    user = await make_user(db)
    async with build_client(admin_billing.router, db, user) as client:
        first = await client.post(
            f"/api/v1/admin/subscriptions/{sub.id}/cash-payment",
            json={"idempotency_key": "double-click"},
        )
        second = await client.post(
            f"/api/v1/admin/subscriptions/{sub.id}/cash-payment",
            json={"idempotency_key": "double-click"},
        )

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert second.json()["already_paid"] is True
    assert second.json()["payment_id"] == first.json()["payment_id"]
    assert await (await db.execute(select(func.count(Payment.id)))).scalar_one() == 1


async def test_cash_endpoint_requires_permission(db, house, plan, sub):
    user = await make_user(db, role_name="RSO", username="cash-rso")
    async with build_client(admin_billing.router, db, user) as client:
        res = await client.post(
            f"/api/v1/admin/subscriptions/{sub.id}/cash-payment",
            json={},
        )

    assert res.status_code == 403


async def test_cash_endpoint_rejects_amount_mismatch(db, house, plan, sub):
    user = await make_user(db)
    await make_invoice(db, sub, plan)
    async with build_client(admin_billing.router, db, user) as client:
        res = await client.post(
            f"/api/v1/admin/subscriptions/{sub.id}/cash-payment",
            json={"amount": 100},
        )

    assert res.status_code == 400
    detail = res.json()["detail"]
    assert detail["code"] == "PAYMENT_AMOUNT_MISMATCH"
    assert detail["fields"]


async def test_checkout_is_refused_when_online_payments_disabled(db, house, plan, sub):
    user = await make_user(db)
    invoice = await make_invoice(db, sub, plan)
    async with build_client(billing.router, db, user, house_context=house.id) as client:
        res = await client.post(f"/api/v1/billing/invoices/{invoice.id}/checkout")

    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["code"] == "ONLINE_PAYMENT_DISABLED"


async def test_billing_overview_exposes_payment_mode(db, house, plan, sub):
    user = await make_user(db)
    async with build_client(billing.router, db, user, house_context=house.id) as client:
        res = await client.get("/api/v1/billing/overview")

    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["online_payments_enabled"] is False
    assert data["payment_gateway"] == "none"
    assert data["cash_payments_enabled"] is True
