from datetime import timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.services.entitlement import (
    ACCESS_CODE_EXPIRED,
    ACCESS_CODE_HOUSE_INACTIVE,
    ACCESS_CODE_NO_PLAN,
    access_block_payload,
    allowed_modules,
    effective_status,
    enforce_plan_limit,
    feature_enabled,
    get_house_subscription,
    get_latest_subscriptions_for_houses,
    house_access_state,
    is_entitled,
    is_package_less,
    limit_value,
    subscription_summary,
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


async def test_effective_status_trialing_after_end_is_expired(db, house, plan):
    """The free tier is the trial: after it ends there is no paid time left."""
    sub = await make_sub(db, house.id, plan, status="trialing", trial_days=7)
    past = now_naive() + timedelta(days=10)
    assert effective_status(sub, now=past) == "expired"


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


async def test_is_package_less(db, house, plan):
    # A missing subscription is NOT a package-less row: it means "no plan".
    assert is_package_less(None) is False
    legacy = await make_sub(db, house.id, plan, trial_days=0)
    legacy.package_id = None
    await db.commit()
    # `package` is eager-loaded, so re-read it from the FK value instead of
    # reusing the plan cached on the identity-mapped object.
    db.expunge_all()
    legacy = await get_house_subscription(db, house.id)
    assert is_package_less(legacy) is True
    regular = await make_sub(db, house.id, plan, trial_days=0)
    assert is_package_less(regular) is False


async def test_feature_enabled(db, house, plan):
    regular = await make_sub(db, house.id, plan, trial_days=0)
    assert feature_enabled(regular, "reports") is True
    assert feature_enabled(regular, "dms_sync") is False
    legacy = await make_sub(db, house.id, plan, trial_days=0)
    legacy.package_id = None
    await db.commit()
    # Same reason: reload the subscription so `package` follows package_id.
    db.expunge_all()
    legacy = await get_house_subscription(db, house.id)
    # Package-less is a data defect, not an unlimited free pass.
    assert feature_enabled(legacy, "anything") is False


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
    await make_sub(db, house.id, plan, trial_days=0)
    plan.limits = {}
    await db.commit()
    sub = await get_house_subscription(db, house.id)
    allowed, limit, plan_name = await enforce_plan_limit(db, house.id, "max_users", 9999)
    assert allowed is True
    assert limit is None


async def test_make_plan_helpers(db):
    house = await make_house(db, code="HX", name="Helper House")
    plan = await make_plan(db, name="Helper", slug="helper", price_monthly=Decimal("100.00"))
    sub = await make_sub(db, house.id, plan, trial_days=0)
    assert sub.house_id == house.id
    assert str(plan.price_monthly) == "100.00"


async def test_subscription_summary_active_plan(db, house, plan):
    end = now_naive() + timedelta(days=5, hours=1)
    await make_sub(db, house.id, plan, trial_days=0, status="active", end=end)
    sub = await get_house_subscription(db, house.id)
    summary = subscription_summary(sub)
    assert summary["plan_name"] == plan.name
    assert summary["plan_slug"] == plan.slug
    assert summary["plan_status"] == "active"
    assert summary["plan_days_remaining"] == 6  # ceil(5d 1h)
    assert summary["plan_is_valid"] is True
    assert summary["plan_billing_interval"] == "monthly"


async def test_subscription_summary_none_and_expired(db, house, plan):
    empty = subscription_summary(None)
    assert empty["plan_status"] is None
    assert empty["plan_days_remaining"] is None
    assert empty["plan_is_valid"] is None

    sub = await make_sub(
        db, house.id, plan, trial_days=0, status="expired",
        end=now_naive() - timedelta(days=1),
    )
    summary = subscription_summary(sub)
    assert summary["plan_status"] == "expired"
    assert summary["plan_days_remaining"] == 0
    assert summary["plan_is_valid"] is False


async def test_get_latest_subscriptions_for_houses_bulk(db, house, plan):
    other = await make_house(db, code="H2", name="Other House")
    await make_sub(db, house.id, plan, status="active")
    await make_sub(db, house.id, plan, status="expired")
    await make_sub(db, other.id, plan, status="active")

    latest = await get_latest_subscriptions_for_houses(db, [house.id, other.id])
    assert latest[house.id].status == "expired"
    assert latest[other.id].status == "active"
    assert await get_latest_subscriptions_for_houses(db, []) == {}


# ---------------------------------------------------------------------------
# Deny-by-default house access policy
# ---------------------------------------------------------------------------

async def test_house_access_state_matrix(db, house, plan):
    # No subscription at all -> blocked (this is the rollout behaviour change).
    assert house_access_state(house, None) == ACCESS_CODE_NO_PLAN

    active = await make_sub(db, house.id, plan, trial_days=0, status="active")
    assert house_access_state(house, active) is None

    expired = await make_sub(
        db, house.id, plan, trial_days=0, status="expired",
        end=now_naive() - timedelta(days=1),
    )
    assert house_access_state(house, expired) == ACCESS_CODE_EXPIRED

    house.is_active = False
    await db.commit()
    # Deactivation wins over a perfectly valid plan.
    assert house_access_state(house, active) == ACCESS_CODE_HOUSE_INACTIVE


async def test_expired_plan_wins_over_billing_deactivation(db, house, plan):
    """`house_lifecycle` flips is_active off when a plan expires. The user must
    still be told to renew, not to "contact the administrator"."""
    expired = await make_sub(
        db, house.id, plan, trial_days=0, status="expired",
        end=now_naive() - timedelta(days=1),
    )
    house.is_active = False
    house.deactivated_for_billing = True
    await db.commit()
    assert house_access_state(house, expired) == ACCESS_CODE_EXPIRED
    # No subscription at all + deactivated house still reports the hard block.
    assert house_access_state(house, None) == ACCESS_CODE_HOUSE_INACTIVE


async def test_house_access_state_staged_rollout(house, monkeypatch):
    monkeypatch.setattr(
        "app.services.entitlement.settings.BILLING_REQUIRE_PLAN", False, raising=False
    )
    assert house_access_state(house, None) is None


async def test_access_block_payload_names_house_and_plan(db, house, plan):
    sub = await make_sub(
        db, house.id, plan, trial_days=0, status="expired",
        end=now_naive() - timedelta(days=3),
    )
    assert house_access_state(house, sub) == ACCESS_CODE_EXPIRED
    payload = access_block_payload(house, sub, ACCESS_CODE_EXPIRED)

    assert payload["code"] == ACCESS_CODE_EXPIRED
    assert payload["action"] == "renew"
    assert payload["house_id"] == house.id
    assert payload["house_name"] == house.name
    assert payload["house_code"] == house.code
    assert payload["plan_name"] == plan.name
    assert payload["plan_status"] == "expired"
    assert payload["days_remaining"] == 0
    assert house.name in payload["message"]
    assert house.code in payload["message"]


async def test_access_block_payload_without_plan(house):
    payload = access_block_payload(house, None, ACCESS_CODE_NO_PLAN)
    assert payload["action"] == "select_plan"
    assert payload["house_code"] == house.code
    assert payload["plan_name"] is None
    assert payload["plan_status"] is None
    assert payload["days_remaining"] is None
    assert "No plan is assigned" in payload["message"]
    assert house.code in payload["message"]


async def test_no_plan_grants_no_modules(db, house, plan):
    """`allowed_modules(None)` must be an empty grant list, not "unrestricted"."""
    assert allowed_modules(None) == []
    assert feature_enabled(None, "reports") is False
    assert limit_value(None, "max_users") == 0

    legacy = await make_sub(db, house.id, plan, trial_days=0)
    legacy.package_id = None
    await db.commit()
    db.expunge_all()
    legacy = await get_house_subscription(db, house.id)
    # Package-less rows are a defect: they grant nothing until repaired.
    assert allowed_modules(legacy) == []
    assert feature_enabled(legacy, "reports") is False
    assert limit_value(legacy, "max_users") == 0
    assert house_access_state(house, legacy) == ACCESS_CODE_NO_PLAN


async def test_period_end_is_exclusive_and_grace_follows(db, house, plan):
    """Canonical boundary: a plan covers `[start, end)`, grace `[end, end+grace)`.

    At exactly `current_period_end` the paid period is over; the house is not
    blocked yet because the grace window keeps it `past_due` (entitled).
    """
    from config.settings import settings

    end = now_naive()
    sub = await make_sub(
        db, house.id, plan, start=end - timedelta(days=30), end=end, trial_days=0
    )

    assert effective_status(sub, now=end - timedelta(microseconds=1)) == "active"
    assert effective_status(sub, now=end) == "past_due"

    grace_end = end + timedelta(days=settings.BILLING_GRACE_DAYS)
    assert (
        effective_status(sub, now=grace_end - timedelta(microseconds=1))
        == "past_due"
    )
    assert effective_status(sub, now=grace_end) == "expired"
    assert is_entitled(sub, now=grace_end) is False


async def test_trial_end_is_exclusive(db, house, plan):
    start = now_naive() - timedelta(days=1)
    trial_end = start + timedelta(days=1)
    sub = await make_sub(
        db,
        house.id,
        plan,
        status="trialing",
        start=start,
        end=trial_end + timedelta(days=30),
        trial_days=1,
    )
    assert sub.trial_end == trial_end

    assert effective_status(sub, now=trial_end - timedelta(microseconds=1)) == "trialing"
    # At the exact trial end the free tier is over; only an approved payment
    # can make the subscription active again.
    assert effective_status(sub, now=trial_end) == "expired"


async def test_past_due_grace_period_end_is_exclusive(db, house, plan):
    now = now_naive()
    sub = await make_sub(
        db,
        house.id,
        plan,
        status="past_due",
        start=now - timedelta(days=10),
        end=now - timedelta(days=1),
        trial_days=0,
    )
    sub.grace_period_end = now
    assert effective_status(sub, now=now - timedelta(microseconds=1)) == "past_due"
    assert effective_status(sub, now=now) == "expired"


def test_timezone_helpers_are_bangladesh_time():
    """BST is UTC+6; expired checks must never mix UTC and BST naive values."""
    from app.utils.timezone import now_naive, utc_now

    delta = (now_naive() - utc_now().replace(tzinfo=None)) - timedelta(hours=6)
    assert abs(delta.total_seconds()) < 5
