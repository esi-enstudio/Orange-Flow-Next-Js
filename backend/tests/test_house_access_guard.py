import json
from datetime import timedelta
from types import SimpleNamespace

from starlette.requests import Request

from app.middleware.plan_module_guard import (
    _is_exempt,
    _resolve_house_access,
)
from app.services import entitlement
from app.utils.timezone import now_naive

from conftest import make_house, make_plan, make_sub


def make_request(path="/api/employees", method="GET", house_id=None):
    headers = []
    if house_id is not None:
        headers.append((b"x-house-id", str(house_id).encode()))
    return Request(
        {
            "type": "http",
            "method": method,
            "path": path,
            "headers": headers,
            "query_string": b"",
        }
    )


def error_code(response) -> str:
    return json.loads(response.body)["error"]["code"]


async def test_active_subscription_allows_access(db, house, plan):
    await make_sub(db, house.id, plan, trial_days=0, status="active")
    result = await _resolve_house_access(
        db, make_request(), SimpleNamespace(houses=[house]), entitlement
    )
    resolved_house, sub = result
    assert resolved_house.id == house.id
    assert sub is not None


async def test_expired_subscription_blocks(db, house, plan):
    await make_sub(
        db, house.id, plan, trial_days=0, status="past_due",
        grace_period_end=now_naive() - timedelta(days=1),
    )
    result = await _resolve_house_access(
        db, make_request(), SimpleNamespace(houses=[house]), entitlement
    )
    assert result.status_code == 403
    assert error_code(result) == "SUBSCRIPTION_EXPIRED"


async def test_active_status_past_period_grace_blocks(db, house, plan):
    await make_sub(
        db, house.id, plan, trial_days=0, status="active",
        end=now_naive() - timedelta(days=30),
    )
    result = await _resolve_house_access(
        db, make_request(), SimpleNamespace(houses=[house]), entitlement
    )
    assert result.status_code == 403
    assert error_code(result) == "SUBSCRIPTION_EXPIRED"


async def test_active_status_within_grace_allows(db, house, plan):
    await make_sub(
        db, house.id, plan, trial_days=0, status="active",
        end=now_naive() - timedelta(days=1),
    )
    result = await _resolve_house_access(
        db, make_request(), SimpleNamespace(houses=[house]), entitlement
    )
    resolved_house, _ = result
    assert resolved_house.id == house.id


async def test_inactive_house_blocks(db, house):
    house.is_active = False
    await db.commit()
    result = await _resolve_house_access(
        db, make_request(), SimpleNamespace(houses=[house]), entitlement
    )
    assert result.status_code == 403
    assert error_code(result) == "HOUSE_INACTIVE"


async def test_header_house_must_belong_to_user(db, house):
    result = await _resolve_house_access(
        db, make_request(house_id=house.id + 100), SimpleNamespace(houses=[house]), entitlement
    )
    assert result.status_code == 403
    assert error_code(result) == "HOUSE_ACCESS_DENIED"


async def test_multi_house_without_header_uses_valid_house(db, house, plan):
    other = await make_house(db, code="H2", name="Other House")
    await make_sub(
        db, other.id, plan, trial_days=0, status="past_due",
        grace_period_end=now_naive() - timedelta(days=1),
    )
    await make_sub(db, house.id, plan, trial_days=0, status="active")

    result = await _resolve_house_access(
        db, make_request(), SimpleNamespace(houses=[other, house]), entitlement
    )
    resolved_house, sub = result
    assert resolved_house.id == house.id
    assert sub.house_id == house.id


async def test_all_houses_blocked_blocks(db, house, plan):
    other = await make_house(db, code="H2", name="Other House")
    for h in (house, other):
        await make_sub(
            db, h.id, plan, trial_days=0, status="past_due",
            grace_period_end=now_naive() - timedelta(days=1),
        )
    result = await _resolve_house_access(
        db, make_request(), SimpleNamespace(houses=[house, other]), entitlement
    )
    assert result.status_code == 403
    assert error_code(result) == "SUBSCRIPTION_EXPIRED"


async def test_house_without_subscription_blocks(db, house):
    """Deny-by-default: a house with no plan is no longer a legacy free pass."""
    result = await _resolve_house_access(
        db, make_request(), SimpleNamespace(houses=[house]), entitlement
    )
    assert result.status_code == 403
    assert error_code(result) == "SUBSCRIPTION_REQUIRED"
    body = json.loads(result.body)["error"]
    assert body["house_id"] == house.id
    assert body["house_name"] == house.name
    assert body["action"] == "select_plan"
    assert "No plan is assigned" in body["message"]


async def test_block_payload_is_self_explanatory(db, house, plan):
    """The 403 body must explain *why*: plan name, expiry and next action."""
    await make_sub(
        db, house.id, plan, trial_days=0, status="active",
        end=now_naive() - timedelta(days=30),
    )
    result = await _resolve_house_access(
        db, make_request(), SimpleNamespace(houses=[house]), entitlement
    )
    body = json.loads(result.body)["error"]
    assert body["code"] == "SUBSCRIPTION_EXPIRED"
    assert body["plan_name"] == plan.name
    assert body["plan_end_date"] is not None
    assert body["days_remaining"] == 0
    assert body["action"] == "renew"


async def test_staged_rollout_flag_restores_legacy_fail_open(db, house, monkeypatch):
    """BILLING_REQUIRE_PLAN=false is the documented escape hatch."""
    monkeypatch.setattr(
        entitlement.settings, "BILLING_REQUIRE_PLAN", False, raising=False
    )
    result = await _resolve_house_access(
        db, make_request(), SimpleNamespace(houses=[house]), entitlement
    )
    resolved_house, sub = result
    assert resolved_house.id == house.id
    assert sub is None


def test_read_only_house_paths_are_exempt():
    assert _is_exempt(make_request(path="/api/houses", method="GET")) is True
    assert _is_exempt(make_request(path="/api/houses/1", method="GET")) is True
    assert _is_exempt(make_request(path="/api/houses", method="POST")) is False
    assert _is_exempt(make_request(path="/api/v1/subscription/current")) is True
    assert _is_exempt(make_request(path="/api/auth/me")) is True
    assert _is_exempt(make_request(path="/api/employees")) is False
