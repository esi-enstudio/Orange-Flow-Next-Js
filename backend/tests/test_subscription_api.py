from datetime import timedelta

import httpx
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.role import Permission, Role
from app.models.invoice import INVOICE_STATUS_PAID
from app.models.user import User
from app.routers import subscriptions
from app.routers.deps import get_current_user, get_db, get_house_context
from app.services.subscription_service import issue_invoice
from app.utils.timezone import now_naive
from conftest import make_house, make_plan, make_sub


def build_client(db, user, house_id=None):
    app = FastAPI()
    app.include_router(subscriptions.router)

    async def override_db():
        yield db

    async def override_user():
        return user

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = override_user
    if house_id is not None:
        async def override_house():
            return house_id

        app.dependency_overrides[get_house_context] = override_house

    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
    )


async def make_renewal_user(db, username, with_permission):
    role = Role(name=f"Role-{username}")
    if with_permission:
        role.permissions.append(Permission(name="subscription.renew"))
    user = User(
        username=username,
        hashed_password="x",
        name=username,
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


async def test_house_member_without_renew_permission_can_issue_expired_plan_invoice(db, house, plan):
    user = await make_renewal_user(db, "renew-permission-test", with_permission=False)
    user.houses.append(house)
    await db.commit()
    await make_sub(
        db, house.id, plan, status="expired",
        end=now_naive() - timedelta(days=30),
    )

    async with build_client(db, user, house.id) as client:
        response = await client.post(
            "/api/v1/subscription/renew",
            headers={"X-House-ID": str(house.id)},
        )

    assert response.status_code == 200, response.text
    assert response.json()["invoice"]["status"] == "issued"


async def test_renew_rejected_until_existing_invoice_is_paid(db, house, plan):
    user = await make_renewal_user(db, "renew-open-invoice-test", with_permission=False)
    user.houses.append(house)
    await db.commit()
    sub = await make_sub(db, house.id, plan, status="expired")
    existing = await issue_invoice(db, sub, plan)

    async with build_client(db, user, house.id) as client:
        blocked = await client.post(
            "/api/v1/subscription/renew",
            headers={"X-House-ID": str(house.id)},
        )

    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "OPEN_INVOICE_EXISTS"
    assert blocked.json()["detail"]["invoice_no"] == existing.invoice_no

    existing.status = INVOICE_STATUS_PAID
    await db.commit()
    async with build_client(db, user, house.id) as client:
        allowed = await client.post(
            "/api/v1/subscription/renew",
            headers={"X-House-ID": str(house.id)},
        )
    assert allowed.status_code == 200, allowed.text


async def test_reactivate_endpoint_requires_subscription_renew_permission(db):
    user = await make_renewal_user(db, "reactivate-permission-test", with_permission=False)
    async with build_client(db, user) as client:
        response = await client.post("/api/v1/subscription/reactivate")

    assert response.status_code == 403


async def test_reactivate_endpoint_rejects_subscription_more_than_three_days_from_expiry(
    db, house, plan
):
    user = await make_renewal_user(db, "reactivate-too-early-test", with_permission=True)
    await make_sub(
        db,
        house.id,
        plan,
        status="active",
        end=now_naive() + timedelta(days=4),
    )
    async with build_client(db, user, house.id) as client:
        response = await client.post(
            "/api/v1/subscription/reactivate",
            headers={"X-House-ID": str(house.id)},
        )

    assert response.status_code == 400
    assert "final three days" in response.json()["detail"]


async def test_reactivate_endpoint_issues_invoice_during_final_three_days(db, house, plan):
    user = await make_renewal_user(db, "reactivate-window-test", with_permission=True)
    await make_sub(
        db,
        house.id,
        plan,
        status="trialing",
        trial_days=7,
        start=now_naive() - timedelta(days=5),
        end=now_naive() + timedelta(days=2),
    )
    async with build_client(db, user, house.id) as client:
        response = await client.post(
            "/api/v1/subscription/reactivate",
            headers={"X-House-ID": str(house.id)},
        )

    assert response.status_code == 200, response.text
    assert response.json()["awaiting_payment"] is True
    assert response.json()["invoice"]["status"] == "issued"
    assert response.json()["subscription"]["can_reactivate"] is True


async def test_expiring_soon_lists_only_assigned_houses_within_three_days(db, plan):
    assigned_house = await make_house(db, code="H002", name="Assigned House")
    other_assigned_house = await make_house(db, code="H003", name="Other Assigned House")
    unassigned_house = await make_house(db, code="H004", name="Unassigned House")
    user = await make_renewal_user(db, "expiry-warning-test", with_permission=False)
    user.houses.extend([assigned_house, other_assigned_house])
    await db.commit()

    await make_sub(
        db, assigned_house.id, plan, status="active",
        end=now_naive() + timedelta(days=2),
    )
    await make_sub(
        db, other_assigned_house.id, plan, status="active",
        end=now_naive() + timedelta(days=4),
    )
    await make_sub(
        db, unassigned_house.id, plan, status="active",
        end=now_naive() + timedelta(days=1),
    )

    async with build_client(db, user) as client:
        response = await client.get("/api/v1/subscription/expiring-soon")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["server_now"]
    assert len(body["data"]) == 1
    assert body["data"][0]["house_id"] == assigned_house.id
    assert body["data"][0]["house_name"] == assigned_house.name
    assert body["data"][0]["plan_name"] == plan.name
    assert body["data"][0]["expires_at"]


async def test_expiring_soon_uses_trial_end_for_trialing_plan(db, plan):
    house = await make_house(db, code="H005", name="Trial House")
    user = await make_renewal_user(db, "trial-expiry-warning-test", with_permission=False)
    user.houses.append(house)
    await db.commit()
    await make_sub(
        db,
        house.id,
        plan,
        status="trialing",
        end=now_naive() + timedelta(days=30),
        trial_days=1,
    )

    async with build_client(db, user) as client:
        response = await client.get("/api/v1/subscription/expiring-soon")

    assert response.status_code == 200, response.text
    assert [item["house_id"] for item in response.json()["data"]] == [house.id]


async def test_expiring_soon_includes_already_expired_plan(db, plan):
    house = await make_house(db, code="H006", name="Expired House")
    user = await make_renewal_user(db, "expired-warning-test", with_permission=False)
    user.houses.append(house)
    await db.commit()
    expiry_date = now_naive() - timedelta(days=30)
    await make_sub(
        db,
        house.id,
        plan,
        status="expired",
        end=expiry_date,
    )

    async with build_client(db, user) as client:
        response = await client.get("/api/v1/subscription/expiring-soon")

    assert response.status_code == 200, response.text
    warning = response.json()["data"][0]
    assert warning["house_id"] == house.id
    assert warning["expired"] is True
    assert warning["expires_at"].startswith(expiry_date.date().isoformat())
