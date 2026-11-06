import httpx
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.role import Role
from app.models.user import User
from app.routers import subscriptions
from app.routers.deps import get_current_user, get_db


async def test_renew_endpoint_requires_subscription_renew_permission(db):
    role = Role(name="RSO")
    user = User(
        username="renew-permission-test",
        hashed_password="x",
        name="Renew Permission Test",
        status="Active",
    )
    user.roles.append(role)
    db.add(user)
    await db.commit()
    user = (await db.execute(
        select(User)
        .options(selectinload(User.roles).selectinload(Role.permissions))
        .where(User.id == user.id)
    )).scalar_one()

    app = FastAPI()
    app.include_router(subscriptions.router)

    async def override_db():
        yield db

    async def override_user():
        return user

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = override_user

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.post("/api/v1/subscription/renew")

    assert response.status_code == 403
