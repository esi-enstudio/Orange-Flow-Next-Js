from datetime import timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.services.entitlement import (
    effective_status,
    enforce_plan_limit,
    feature_enabled,
    get_house_subscription,
    has_plan_fallback,
    is_entitled,
    limit_value,
)
from app.utils.timezone import now_naive

from conftest import make_house, make_plan, make_sub


async def test_get_house_subscription_returns_latest(db, house, plan):
    await make_sub(db, house.id, plan, trial_days=0, status="active")
    await make_sub(db, house.id, plan, trial_days=0, status="cancelled")
    latest = await get_house_subscription(db, house.id)
    assert latest is not None
    assert latest.status == "cancelled"


async def test_get_house_subscription_excludes_soft_deleted(db, house, plan):
    await make_sub(db, house.id, plan, trial_days=0, status="active")
    gone = await make_sub(db, house.id, plan, trial_days=0, status="cancelled")
    gone.is_deleted = True
    await db.commit()
    latest = await get_house_subscription(db, house.id)
    assert latest.status == "active"


async def test_effective_status_trialing_before_end(db, house, plan):
    sub = await make_sub(db, house.id, plan, status="trialing", trial_days=7)
    assert effective_status(sub, now=now_naive()) == "trialing"


async def test_effective_status_trialing_after_end_is_active(db, house, plan):
    sub = await make_sub(db, house.id, plan, status="trialing", trial_days=7)
    past = now_naive() + timedelta(days=10)
    assert effective_status(sub, now=past) == "active"


async def test_effective_status_past_due_within_grace(db, house, plan):
    sub = await make_sub(db, house.id, plan, status="past_due", trial_days=0)
    sub.grace_period_end = now_naive() + timedelta(days=2)
    assert effective_status(sub) == "past_due"


async def test_effective_status_past_due_past_grace_is_expired(db, house, plan):
    sub = await make_sub(db, house.id, plan, status="past_due", trial_days=0)
    sub.grace_period_end = now_naive() - timedelta(days=1)
    assert effective_status(sub) == "expired"


async def test_effective_status_other_statuses_pass_through(db, house, plan):
    for status in ("active", "cancelled", "expired", "paused"):
        sub = await make_sub(db, house.id, plan, status=status, trial_days=0)
        assert effective_status(sub) == status


async def test_is_entitled_matrix(db, house, plan):
    assert is_entitled(None) is False
    active = await make_sub(db, house.id, plan, status="active", trial_days=0)
    assert is_entitled(active) is True
    trialing = await make_sub(db, house.id, plan, status="trialing", trial_days=7)
    assert is_entitled(trialing) is True
    cancelled = await make_sub(db, house.id, plan, status="cancelled", trial_days=0)
    assert is_entitled(cancelled) is False
    paused = await make_sub(db, house.id, plan, status="paused", trial_days=0)
    assert is_entitled(paused) is False
    past_due_ok = await make_sub(db, house.id, plan, status="past_due", trial_days=0)
    past_due_ok.grace_period_end = now_naive() + timedelta(days=1)
    assert is_entitled(past_due_ok) is True


async def test_has_plan_fallback(db, house, plan):
    assert has_plan_fallback(None) is True
    legacy = await make_sub(db, house.id, plan, trial_days=0)
    legacy.package_id = None
    await db.commit()
    assert has_plan_fallback(legacy) is True
    regular = await make_sub(db, house.id, plan, trial_days=0)
    assert has_plan_fallback(regular) is False


async def test_feature_enabled(db, house, plan):
    regular = await make_sub(db, house.id, plan, trial_days=0)
    assert feature_enabled(regular, "reports") is True
    assert feature_enabled(regular, "dms_sync") is False
    legacy = await make_sub(db, house.id, plan, trial_days=0)
    legacy.package_id = None
    await db.commit()
    assert feature_enabled(legacy, "anything") is True


async def test_limit_value(db, house, plan):
    regular = await make_sub(db, house.id, plan, trial_days=0)
    regular.package.limits = {"max_users": 10}
    await db.commit()
    assert limit_value(regular, "max_users") == 10
    assert limit_value(regular, "unknown_key") is None


async def test_enforce_plan_limit_under_limit(db, house, plan):
    await make_sub(db, house.id, plan, trial_days=0)
    plan.limits = {"max_users": 10}
    await db.commit()
    sub = await get_house_subscription(db, house.id)
    allowed, limit, plan_name = await enforce_plan_limit(db, house.id, "max_users", 3)
    assert allowed is True
    assert limit == 10
    assert plan_name == plan.name


async def test_enforce_plan_limit_exceeded_raises(db, house, plan):
    await make_sub(db, house.id, plan, trial_days=0)
    plan.limits = {"max_users": 2}
    await db.commit()
    with pytest.raises(HTTPException) as exc:
        await enforce_plan_limit(db, house.id, "max_users", 2)
    assert exc.value.status_code == 403
    assert "PLAN_LIMIT_EXCEEDED" in exc.value.detail


async def test_enforce_plan_limit_no_limit_passes(db, house, plan):
    plan.limits = {}
    await db.commit()
    allowed, limit, plan_name = await enforce_plan_limit(db, house.id, "max_users", 9999)
    assert allowed is True
    assert limit is None


async def test_make_plan_helpers(db):
    house = await make_house(db, code="HX", name="Helper House")
    plan = await make_plan(db, name="Helper", slug="helper", price_monthly=Decimal("100.00"))
    sub = await make_sub(db, house.id, plan, trial_days=0)
    assert sub.house_id == house.id
    assert str(plan.price_monthly) == "100.00"