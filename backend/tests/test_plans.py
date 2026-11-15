"""Regression tests for plan creation.

Plan creation used to crash with ``MultipleResultsFound`` (HTTP 500) because
the duplicate check combined ``slug == slug OR tier == tier`` in a single
``scalar_one_or_none()`` query. Custom/legacy plans have ``tier = NULL``, so
any archived plan sharing the requested slug matched a second row. The check
now runs per key against live rows only, matching the partial unique indexes.
"""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.models.subscription import SubscriptionPackage, SubscriptionTier
from app.routers.plans import create_plan, delete_plan
from app.schemas.subscription import PlanUpsert
from app.utils.timezone import now_naive
from conftest import make_plan


def _payload(name: str, slug=None, tier=None) -> PlanUpsert:
    return PlanUpsert(
        name=name,
        slug=slug,
        tier=tier,
        allowed_modules=["/retailers"],
    )


async def test_custom_plan_creation_ignores_null_tier_of_legacy_plan(db):
    await make_plan(db, name="Legacy Unlimited", slug="legacy-unlimited")

    plan = await create_plan(_payload("Starter"), db)

    assert plan.slug == "starter"
    assert plan.tier is None


async def test_archived_slug_does_not_crash_or_block_creation(db):
    await make_plan(db, name="Legacy Unlimited", slug="legacy-unlimited")

    archived = SubscriptionPackage(
        name="Basic",
        slug="basic",
        tier=SubscriptionTier.BASIC,
        currency="BDT",
        billing_interval="monthly",
        price_monthly=0,
        price_yearly=0,
        trial_days=0,
        is_active=False,
        is_deleted=True,
        deleted_at=now_naive(),
    )
    db.add(archived)
    await db.commit()

    plan = await create_plan(_payload("Basic"), db)

    assert plan.slug == "basic"
    assert plan.tier is None


async def test_live_slug_is_still_rejected(db):
    await make_plan(db, name="Starter", slug="starter")

    with pytest.raises(HTTPException) as exc:
        await create_plan(_payload("Starter"), db)

    assert exc.value.status_code == 409


async def test_delete_plan_with_live_subscription_is_rejected(db, house, plan, sub):
    with pytest.raises(HTTPException) as exc:
        await delete_plan(plan.id, db=db, current_user=SimpleNamespace(id=1))

    assert exc.value.status_code == 409
    db.expunge_all()
    archived = await db.get(SubscriptionPackage, plan.id)
    assert archived is not None
    assert archived.is_deleted is False


async def test_delete_unused_plan_soft_deletes_it(db, plan):
    result = await delete_plan(plan.id, db=db, current_user=SimpleNamespace(id=1))

    assert result["success"] is True
    db.expunge_all()
    archived = await db.get(SubscriptionPackage, plan.id)
    assert archived.is_deleted is True
    assert archived.is_active is False
    assert archived.deleted_by == 1
