from datetime import timedelta

import httpx
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.role import Permission, Role
from app.models.user import User
from app.routers import subscriptions
from app.routers.deps import get_current_user, get_db, get_house_context
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


async def test_renew_endpoint_requires_subscription_renew_permission(db):
    user = await make_renewal_user(db, "renew-permission-test", with_permission=False)
    async with build_client(db, user) as client:
        response = await client.post("/api/v1/subscription/renew")

    assert response.status_code == 403


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
