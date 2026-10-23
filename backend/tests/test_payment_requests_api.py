"""HTTP surface for manual payment requests.

Tenant submits (billing.request_payment), admin approves/rejects. Approval is
the only path that activates a plan, and the paid period starts at approval.
"""
import io

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.invoice import INVOICE_STATUS_ISSUED, INVOICE_STATUS_PAID
from app.models.payment import Payment, PAYMENT_STATUS_FAILED, PAYMENT_STATUS_PENDING
from app.models.role import Permission, Role
from app.models.user import User
from app.routers import admin_billing, billing
from app.routers.deps import get_current_user, get_db, get_house_context
from app.services import payment_requests
from app.services.subscription_service import create_subscription, issue_invoice, next_billing_period_start


@pytest.fixture(autouse=True)
def _proof_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(payment_requests, "PROOF_ROOT", str(tmp_path / "proofs"))


async def make_user(
    db,
    role_name: str = "Admin",
    username: str = "pay-admin",
    permissions: list[str] | None = None,
) -> User:
    role = Role(name=role_name)
    if permissions:
        perms = []
        for name in permissions:
            perm = (await db.execute(
                select(Permission).where(Permission.name == name)
            )).scalar_one_or_none()
            if perm is None:
                perm = Permission(name=name)
                db.add(perm)
                await db.flush()
            perms.append(perm)
        role.permissions = perms
    db.add(role)
    user = User(
        username=username,
        hashed_password="x",
        name="Payment Tester",
        status="Active",
    )
    user.roles.append(role)
    db.add(user)
    await db.commit()
    return (await db.execute(
        select(User)
        .options(selectinload(User.roles).selectinload(Role.permissions))
        .where(User.id == user.id)
    )).scalar_one()


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


async def _invoice(db, house, plan):
    sub = await create_subscription(db, house.id, plan, billing_interval="monthly")
    invoice = await issue_invoice(
        db, sub, plan, period_start=next_billing_period_start(sub)
    )
    return sub, invoice


async def test_tenant_submits_payment_request(db, house, plan):
    user = await make_user(
        db, role_name="Manager", username="tenant-manager",
        permissions=["billing.request_payment"],
    )
    _, invoice = await _invoice(db, house, plan)

    async with build_client(billing.router, db, user, house_context=house.id) as client:
        res = await client.post(
            "/api/v1/billing/payments/request",
            data={"invoice_id": str(invoice.id), "method": "bkash", "reference": "BK-77"},
            files={"proof": ("receipt.png", b"png-bytes", "image/png")},
        )

    assert res.status_code == 201, res.text
    body = res.json()["data"]
    assert body["status"] == PAYMENT_STATUS_PENDING
    assert body["reference"] == "BK-77"
    assert body["has_proof"] is True
    await db.refresh(invoice)
    assert invoice.status == INVOICE_STATUS_ISSUED  # not paid by submitting


async def test_tenant_cannot_pay_another_houses_invoice(db, house, plan):
    await make_user(
        db, role_name="Distributor2", username="other-manager",
        permissions=["billing.request_payment"],
    )
    other_house = await _house_for(db)
    _, invoice = await _invoice(db, other_house, plan)
    user = await make_user(
        db, role_name="Distributor", username="my-manager",
        permissions=["billing.request_payment"],
    )

    async with build_client(billing.router, db, user, house_context=house.id) as client:
        res = await client.post(
            "/api/v1/billing/payments/request",
            data={"invoice_id": str(invoice.id), "method": "cash"},
        )

    assert res.status_code == 404


async def _house_for(db):
    # The `house` fixture already exists; create a second one for isolation.
    from conftest import make_house

    return await make_house(db, code="HX9", name="Other House")


async def test_admin_approval_activates_and_starts_period(db, house, plan):
    tenant = await make_user(
        db, role_name="Manager", username="tenant",
        permissions=["billing.request_payment"],
    )
    admin = await make_user(db, role_name="Admin", username="approver")
    sub, invoice = await _invoice(db, house, plan)

    async with build_client(billing.router, db, tenant, house_context=house.id) as client:
        submitted = await client.post(
            "/api/v1/billing/payments/request",
            data={"invoice_id": str(invoice.id), "method": "bank", "reference": "BANK-1"},
        )
    payment_id = submitted.json()["data"]["id"]

    async with build_client(admin_billing.router, db, admin) as client:
        res = await client.post(f"/api/v1/admin/payments/{payment_id}/approve")

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["payment"]["status"] == "succeeded"
    assert body["invoice"]["status"] == INVOICE_STATUS_PAID
    assert body["subscription"]["status"] == "active"

    await db.refresh(sub)
    assert sub.status == "active"
    assert sub.current_period_end > sub.current_period_start


async def test_admin_rejection_leaves_invoice_open(db, house, plan):
    tenant = await make_user(
        db, role_name="Manager", username="tenant2",
        permissions=["billing.request_payment"],
    )
    admin = await make_user(db, role_name="Admin", username="approver2")
    sub, invoice = await _invoice(db, house, plan)

    async with build_client(billing.router, db, tenant, house_context=house.id) as client:
        submitted = await client.post(
            "/api/v1/billing/payments/request",
            data={"invoice_id": str(invoice.id), "method": "cash"},
        )
    payment_id = submitted.json()["data"]["id"]

    async with build_client(admin_billing.router, db, admin) as client:
        res = await client.post(
            f"/api/v1/admin/payments/{payment_id}/reject",
            json={"reason": "Reference missing"},
        )

    assert res.status_code == 200, res.text
    assert res.json()["payment"]["status"] == PAYMENT_STATUS_FAILED
    assert res.json()["payment"]["rejection_reason"] == "Reference missing"
    await db.refresh(invoice)
    await db.refresh(sub)
    assert invoice.status == INVOICE_STATUS_ISSUED
    assert sub.status != "active"


async def test_non_billing_role_cannot_submit(db, house, plan):
    rso = await make_user(db, role_name="RSO", username="rso-user")
    _, invoice = await _invoice(db, house, plan)

    async with build_client(billing.router, db, rso, house_context=house.id) as client:
        res = await client.post(
            "/api/v1/billing/payments/request",
            data={"invoice_id": str(invoice.id), "method": "cash"},
        )

    assert res.status_code == 403


async def test_approve_requires_billing_approve_permission(db, house, plan):
    tenant = await make_user(
        db, role_name="Distributor", username="tenant3",
        permissions=["billing.request_payment"],
    )
    _, invoice = await _invoice(db, house, plan)

    async with build_client(billing.router, db, tenant, house_context=house.id) as client:
        submitted = await client.post(
            "/api/v1/billing/payments/request",
            data={"invoice_id": str(invoice.id), "method": "cash"},
        )
    payment_id = submitted.json()["data"]["id"]

    async with build_client(admin_billing.router, db, tenant) as client:
        res = await client.post(f"/api/v1/admin/payments/{payment_id}/approve")

    assert res.status_code == 403
