"""P0: the deny-by-default rollout migration must be safe to run repeatedly.

The migration runs on every application boot (and therefore in every worker).
These tests pin the two properties that make that safe:

1. **Idempotency** — running it twice must never duplicate a subscription.
2. **Legacy handling** — package-less rows are repaired to the explicit
   ``legacy-unlimited`` plan (never left as an implicit free pass), plan-less
   active houses get one explicit grant, and dry-run writes nothing.
"""

from sqlalchemy import func, select

from app.models.subscription import HouseSubscription, SubscriptionPackage
from app.services import db_service
from config.settings import settings
from conftest import make_house, make_plan, make_sub, test_engine


async def _count(db, model) -> int:
    return (await db.execute(select(func.count()).select_from(model))).scalar()


async def test_backfill_is_idempotent(db, house):
    first = await db_service._migrate_billing_fail_closed(db_engine=test_engine)
    assert first["granted_houses"] == 1
    assert first["houses_without_plan"] == [{"id": house.id, "name": house.name}]

    second = await db_service._migrate_billing_fail_closed(db_engine=test_engine)
    # Nothing left to do on the second boot.
    assert second["granted_houses"] == 0
    assert second["houses_without_plan"] == []

    # Exactly one subscription and one legacy plan, despite two runs.
    assert await _count(db, HouseSubscription) == 1
    assert await _count(db, SubscriptionPackage) == 1

    sub = (await db.execute(select(HouseSubscription))).scalars().one()
    assert sub.package_id is not None
    assert sub.status == "active"
    plan = (await db.execute(select(SubscriptionPackage))).scalars().one()
    # The explicit legacy plan is the only "unlimited" signal.
    assert plan.allowed_modules is None
    assert plan.slug == settings.BILLING_LEGACY_PLAN_SLUG


async def test_package_less_rows_are_repaired_not_left_fail_open(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    sub.package_id = None
    await db.commit()

    report = await db_service._migrate_billing_fail_closed(db_engine=test_engine)
    assert report["package_less_subscriptions"] == 1
    assert report["repaired_package_less"] == 1
    assert report["granted_houses"] == 0  # the house already had a row

    db.expunge_all()
    repaired = (await db.execute(select(HouseSubscription))).scalars().one()
    assert repaired.package_id is not None
    assert repaired.package_id != plan.id  # attached to the explicit legacy plan
    legacy = (await db.execute(
        select(SubscriptionPackage).where(SubscriptionPackage.slug == "legacy-unlimited")
    )).scalars().one()
    assert repaired.package_id == legacy.id


async def test_dry_run_writes_nothing(db, house, monkeypatch):
    monkeypatch.setattr(settings, "BILLING_LEGACY_BACKFILL_DRY_RUN", True)

    report = await db_service._migrate_billing_fail_closed(db_engine=test_engine)
    assert report["dry_run"] is True
    assert report["houses_without_plan"] == [{"id": house.id, "name": house.name}]
    assert report["granted_houses"] == 0
    assert await _count(db, HouseSubscription) == 0
    assert await _count(db, SubscriptionPackage) == 0


async def test_disabled_backfill_leaves_house_blocked(db, house, monkeypatch):
    monkeypatch.setattr(settings, "BILLING_LEGACY_BACKFILL", False)

    report = await db_service._migrate_billing_fail_closed(db_engine=test_engine)
    assert report["houses_without_plan"] == [{"id": house.id, "name": house.name}]
    assert report["granted_houses"] == 0
    assert await _count(db, HouseSubscription) == 0


async def test_inactive_house_is_not_granted(db, house):
    house.is_active = False
    await db.commit()

    report = await db_service._migrate_billing_fail_closed(db_engine=test_engine)
    assert report["houses_without_plan"] == []
    assert await _count(db, HouseSubscription) == 0


async def test_existing_subscription_is_never_duplicated(db, house, plan):
    existing = await make_sub(db, house.id, plan, trial_days=0, status="active")

    report = await db_service._migrate_billing_fail_closed(db_engine=test_engine)
    assert report["houses_without_plan"] == []
    assert report["package_less_subscriptions"] == 0
    assert await _count(db, HouseSubscription) == 1
    # No legacy plan is created when no house needs one.
    assert await _count(db, SubscriptionPackage) == 1

    db.expunge_all()
    rows = (await db.execute(select(HouseSubscription))).scalars().all()
    assert [row.id for row in rows] == [existing.id]


async def test_new_subscription_always_links_a_plan(db, house, plan):
    """The legacy exception must never leak into newly created subscriptions."""
    from app.services.subscription_service import create_subscription

    sub = await create_subscription(db, house.id, plan, trial=False)
    assert sub.package_id == plan.id
    assert sub.package_id is not None


async def test_legacy_audit_endpoint_lists_package_less_rows(db, house, plan):
    """Ops must be able to find every anomalous (fail-open) row via the API."""
    from app.routers.admin_billing import admin_list_legacy_subscriptions

    sub = await make_sub(db, house.id, plan, trial_days=0)
    sub.package_id = None
    await db.commit()
    # Drop the identity map so the endpoint re-reads the FK instead of the
    # plan relationship cached on this object.
    db.expunge_all()

    result = await admin_list_legacy_subscriptions(db=db, current_user=None)
    assert result["success"] is True
    assert result["total"] == 1
    assert result["data"][0]["id"] == sub.id
    assert result["data"][0]["plan"] is None
