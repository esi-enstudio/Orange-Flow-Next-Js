"""Regression tests for startup seeding.

The package lookup used ``scalar_one_or_none()`` on tier alone. Production keeps
soft-deleted plans, so an archived Basic plus a live Basic made the query return
two rows and aborted the whole seed transaction on every restart.
"""

from decimal import Decimal

from sqlalchemy import select

from app.models.subscription import SubscriptionPackage, SubscriptionTier
from app.utils.timezone import now_naive
from conftest import make_plan
from seed_db import seed_system_data


def _archived(name: str, slug: str, tier: SubscriptionTier) -> SubscriptionPackage:
    return SubscriptionPackage(
        name=name,
        slug=slug,
        tier=tier,
        currency="BDT",
        billing_interval="monthly",
        price_monthly=Decimal("0"),
        price_yearly=Decimal("0"),
        trial_days=0,
        is_active=False,
        is_deleted=True,
        deleted_at=now_naive(),
    )


async def test_seed_tolerates_archived_plan_with_same_tier_as_live_plan(db):
    live = await make_plan(db, name="Basic", slug="basic", tier=SubscriptionTier.BASIC)
    archived = _archived("Basic", "basic", SubscriptionTier.BASIC)
    db.add(archived)
    await db.commit()

    await seed_system_data(db)

    rows = (
        await db.execute(
            select(SubscriptionPackage).where(
                SubscriptionPackage.slug == "basic",
                SubscriptionPackage.is_deleted == False,  # noqa: E712
            )
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].id == live.id
    assert rows[0].price_monthly == Decimal("5000.00")
    assert archived.is_deleted is True


async def test_seed_does_not_resurrect_archived_default_plan(db):
    archived = _archived("Standard", "standard", SubscriptionTier.STANDARD)
    db.add(archived)
    await db.commit()

    await seed_system_data(db)

    live = (
        await db.execute(
            select(SubscriptionPackage).where(
                SubscriptionPackage.slug == "standard",
                SubscriptionPackage.is_deleted == False,  # noqa: E712
            )
        )
    ).scalars().all()
    assert live == []
