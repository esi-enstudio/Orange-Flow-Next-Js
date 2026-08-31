import os
from decimal import Decimal

os.environ.setdefault("DB_USER", "test")
os.environ.setdefault("DB_PASS", "test")
os.environ.setdefault("DB_HOST", "localhost")
os.environ.setdefault("DB_PORT", "5432")
os.environ.setdefault("DB_NAME", "test_billing")
os.environ.setdefault(
    "SECRET_KEY",
    "test-secret-key-0123456789abcdef0123456789abcdef",
)

from datetime import timedelta  # noqa: E402

import pytest_asyncio  # noqa: E402
from sqlalchemy.dialects.postgresql import JSONB  # noqa: E402,F401
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402
from sqlalchemy.ext.compiler import compiles  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(type_, compiler, **kw):
    """Some unrelated models (commission) use postgresql.JSONB; on SQLite the
    type has no renderer. Compile it as plain JSON so create_all works."""
    return "JSON"

# Register all relevant models on Base.metadata before create_all.
from app.models.base import Base  # noqa: E402,F401
from app.models.house import House  # noqa: E402,F401
from app.models.role import Role  # noqa: E402,F401
from app.models.user import User  # noqa: E402,F401
from app.models.subscription import (  # noqa: E402,F401
    HouseSubscription,
    SubscriptionPackage,
    SubscriptionRenewal,
)
from app.models.invoice import Invoice  # noqa: E402,F401
from app.models.payment import Payment, PaymentAttempt, Refund  # noqa: E402,F401
from app.models.webhook_event import WebhookEvent  # noqa: E402,F401
from app.models.subscription_change_log import SubscriptionChangeLog  # noqa: E402,F401

from config.settings import settings  # noqa: E402
from app.utils.timezone import now_naive  # noqa: E402

# In-memory SQLite with a single shared connection (StaticPool) keeps the
# schema and all test data on one connection for the whole session.
test_engine = create_async_engine(
    "sqlite+aiosqlite://",
    poolclass=StaticPool,
    connect_args={"check_same_thread": False},
)
TestSession = async_sessionmaker(test_engine, expire_on_commit=False)


@pytest_asyncio.fixture(autouse=True)
async def _clean():
    """Idempotent schema + full wipe before each test.

    In-memory SQLite with one shared connection (StaticPool), so tables
    persist across tests; we delete all rows before each test for isolation.
    """
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for table in reversed(Base.metadata.sorted_tables):
            await conn.execute(table.delete())
    yield


@pytest_asyncio.fixture
async def db():
    async with TestSession() as session:
        yield session


async def make_house(db, **overrides) -> House:
    kwargs = {
        "code": "H001",
        "name": "Test House",
        "email": "house@example.com",
    }
    kwargs.update(overrides)
    house = House(**kwargs)
    db.add(house)
    await db.commit()
    await db.refresh(house)
    return house


async def make_plan(
    db,
    name="Basic",
    slug="basic",
    price_monthly=Decimal("5000.00"),
    price_yearly=Decimal("50000.00"),
    trial_days=7,
    billing_interval="monthly",
    feature_flags=None,
    limits=None,
    **overrides,
) -> SubscriptionPackage:
    plan = SubscriptionPackage(
        name=name,
        slug=slug,
        currency="BDT",
        billing_interval=billing_interval,
        price_monthly=Decimal(price_monthly),
        price_yearly=Decimal(price_yearly),
        trial_days=trial_days,
        is_active=True,
        feature_flags=feature_flags or ["reports"],
        limits=limits or {},
        **overrides,
    )
    db.add(plan)
    await db.commit()
    await db.refresh(plan)
    return plan


async def make_sub(
    db,
    house_id,
    plan,
    status="active",
    billing_interval="monthly",
    start=None,
    end=None,
    auto_renew=True,
    trial_days=0,
    **overrides,
) -> HouseSubscription:
    from app.services.subscription_service import _add_interval

    start = start or now_naive()
    end = end or _add_interval(start, billing_interval)
    sub = HouseSubscription(
        house_id=house_id,
        package_id=plan.id,
        status=status,
        start_date=start,
        end_date=end,
        current_period_start=start,
        current_period_end=end,
        trial_start=start if trial_days else None,
        trial_end=(start + timedelta(days=trial_days)) if trial_days else None,
        auto_renew=auto_renew,
        gateway=settings.PAYMENT_GATEWAY,
        billing_interval=billing_interval,
        currency="BDT",
        **overrides,
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)
    return sub


async def make_invoice(db, sub, plan, status="issued", amount=None, **overrides) -> Invoice:
    from app.services.subscription_service import plan_price

    period = sub.billing_interval
    total = amount if amount is not None else plan_price(plan, period)
    invoice = Invoice(
        house_id=sub.house_id,
        subscription_id=sub.id,
        invoice_no=f"INV-TEST-{sub.id}-{now_naive().microsecond}",
        billing_period_start=sub.current_period_start,
        billing_period_end=sub.current_period_end,
        due_date=now_naive() + timedelta(days=settings.BILLING_GRACE_DAYS),
        amount=total,
        tax=Decimal("0.00"),
        total=total,
        currency="BDT",
        status=status,
        description="Test invoice",
        **overrides,
    )
    db.add(invoice)
    await db.commit()
    await db.refresh(invoice)
    return invoice


async def make_attempt(db, invoice, **overrides) -> PaymentAttempt:
    attempt = PaymentAttempt(
        house_id=invoice.house_id,
        invoice_id=invoice.id,
        subscription_id=invoice.subscription_id,
        amount=invoice.total,
        currency="BDT",
        gateway="sslcommerz",
        gateway_tran_id=overrides.pop("gateway_tran_id", f"TRAN-{invoice.id}-{now_naive().microsecond}"),
        status="initiated",
        **overrides,
    )
    db.add(attempt)
    await db.commit()
    await db.refresh(attempt)
    return attempt


@pytest_asyncio.fixture
async def house(db):
    return await make_house(db)


@pytest_asyncio.fixture
async def plan(db):
    return await make_plan(db)


@pytest_asyncio.fixture
async def sub(db, house, plan):
    return await make_sub(db, house.id, plan, trial_days=0, status="active")


@pytest_asyncio.fixture
async def invoice(db, sub, plan):
    return await make_invoice(db, sub, plan)