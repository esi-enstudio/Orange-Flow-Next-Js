import json
from datetime import timedelta

import pytest
from fastapi.responses import JSONResponse
from starlette.requests import Request

from app.middleware.plan_module_guard import PlanModuleGuard
from app.models.role import Role
from app.models.user import User
from app.routers.deps import create_access_token
from app.utils.timezone import now_naive

from conftest import TestSession, make_sub


@pytest.fixture
def use_test_db(monkeypatch):
    from app.services import db_service

    monkeypatch.setattr(db_service, "async_session", TestSession)


async def make_user(db, role_name: str, house) -> User:
    role = Role(name=role_name)
    db.add(role)
    user = User(
        username=f"guard-{role_name.replace(' ', '-').lower()}",
        hashed_password="x",
        name="Guard Test",
        status="Active",
    )
    user.roles.append(role)
    user.houses.append(house)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


def make_request(path: str, method: str = "GET", user_id: int | None = None):
    headers = []
    if user_id is not None:
        token = create_access_token({"sub": str(user_id)})
        headers.append((b"authorization", f"Bearer {token}".encode()))
    return Request(
        {
            "type": "http",
            "method": method,
            "path": path,
            "headers": headers,
            "query_string": b"",
        }
    )


async def test_guard_blocks_expired_house(use_test_db, db, house, plan):
    await make_sub(
        db, house.id, plan, trial_days=0, status="past_due",
        grace_period_end=now_naive() - timedelta(days=1),
    )
    user = await make_user(db, "RSO", house)
    called = False

    async def call_next(request):
        nonlocal called
        called = True
        return JSONResponse({"ok": True})

    response = await PlanModuleGuard(None).dispatch(
        make_request("/api/employees", user_id=user.id), call_next
    )
    assert response.status_code == 403
    body = json.loads(response.body)
    assert body["error"]["code"] == "SUBSCRIPTION_EXPIRED"
    assert called is False


async def test_guard_allows_active_house(use_test_db, db, house, plan):
    await make_sub(db, house.id, plan, trial_days=0, status="active")
    user = await make_user(db, "RSO", house)

    async def call_next(request):
        return JSONResponse({"ok": True})

    response = await PlanModuleGuard(None).dispatch(
        make_request("/api/employees", user_id=user.id), call_next
    )
    assert response.status_code == 200
    assert json.loads(response.body)["ok"] is True


async def test_guard_keeps_house_list_readable(use_test_db, db, house, plan):
    await make_sub(
        db, house.id, plan, trial_days=0, status="past_due",
        grace_period_end=now_naive() - timedelta(days=1),
    )
    user = await make_user(db, "RSO", house)

    async def call_next(request):
        return JSONResponse({"ok": True})

    response = await PlanModuleGuard(None).dispatch(
        make_request("/api/houses", user_id=user.id), call_next
    )
    assert response.status_code == 200


async def test_guard_lets_super_admins_through(use_test_db, db, house, plan):
    await make_sub(
        db, house.id, plan, trial_days=0, status="past_due",
        grace_period_end=now_naive() - timedelta(days=1),
    )
    user = await make_user(db, "Super Admin", house)

    async def call_next(request):
        return JSONResponse({"ok": True})

    response = await PlanModuleGuard(None).dispatch(
        make_request("/api/employees", user_id=user.id), call_next
    )
    assert response.status_code == 200


async def test_guard_blocks_house_manager_of_expired_house(use_test_db, db, house, plan):
    await make_sub(
        db, house.id, plan, trial_days=0, status="past_due",
        grace_period_end=now_naive() - timedelta(days=1),
    )
    user = await make_user(db, "House Manager", house)

    async def call_next(request):
        raise AssertionError("must not reach the endpoint")

    response = await PlanModuleGuard(None).dispatch(
        make_request("/api/employees", user_id=user.id), call_next
    )
    assert response.status_code == 403
    assert json.loads(response.body)["error"]["code"] == "SUBSCRIPTION_EXPIRED"


async def test_guard_blocks_inactive_house(use_test_db, db, house):
    house.is_active = False
    await db.commit()
    user = await make_user(db, "RSO", house)

    async def call_next(request):
        raise AssertionError("must not reach the endpoint")

    response = await PlanModuleGuard(None).dispatch(
        make_request("/api/employees", user_id=user.id), call_next
    )
    assert response.status_code == 403
    assert json.loads(response.body)["error"]["code"] == "HOUSE_INACTIVE"


async def test_guard_blocks_house_without_subscription(use_test_db, db, house):
    """Deny-by-default: no subscription record means no product access."""
    user = await make_user(db, "RSO", house)

    async def call_next(request):
        raise AssertionError("must not reach the endpoint")

    response = await PlanModuleGuard(None).dispatch(
        make_request("/api/employees", user_id=user.id), call_next
    )
    assert response.status_code == 403
    body = json.loads(response.body)["error"]
    assert body["code"] == "SUBSCRIPTION_REQUIRED"
    assert body["house_id"] == house.id
    assert body["house_name"] == house.name
    assert body["action"] == "select_plan"


async def test_guard_lets_super_admin_through_without_any_plan(use_test_db, db, house):
    """The platform admin must always be able to assign a plan."""
    user = await make_user(db, "Super Admin", house)

    async def call_next(request):
        return JSONResponse({"ok": True})

    response = await PlanModuleGuard(None).dispatch(
        make_request("/api/employees", user_id=user.id), call_next
    )
    assert response.status_code == 200
