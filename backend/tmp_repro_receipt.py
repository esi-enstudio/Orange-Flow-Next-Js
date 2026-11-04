"""Temporary repro: create a receipt with N serials against real Postgres."""
import asyncio
import os
import time

os.environ["DB_USER"] = "test"
os.environ["DB_PASS"] = "test"
os.environ["DB_HOST"] = "127.0.0.1"
os.environ["DB_PORT"] = "5544"
os.environ["DB_NAME"] = "test_inv"
os.environ.setdefault("SECRET_KEY", "x" * 40)

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from app.models.base import Base  # noqa: E402,F401
import app.models.house  # noqa: E402,F401
import app.models.user  # noqa: E402,F401
import app.models.employee  # noqa: E402,F401
import app.models.product  # noqa: E402,F401
import app.models.role  # noqa: E402,F401
import app.models.stock  # noqa: E402,F401

from app.models.employee import Employee  # noqa: E402
from app.models.house import House  # noqa: E402
from app.models.product import Product  # noqa: E402
from app.schemas.stock import ReceiptCreate, ReceiptLineCreate  # noqa: E402
from app.services import inventory_service as svc  # noqa: E402

URL = "postgresql+asyncpg://test:test@127.0.0.1:5544/test_inv"
N = int(os.environ.get("N", "120000"))


async def main():
    engine = create_async_engine(URL, pool_size=5)
    async with engine.begin() as conn:
        await conn.exec_driver_sql("DROP SCHEMA public CASCADE")
        await conn.exec_driver_sql("CREATE SCHEMA public")
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as db:
        house = House(name="H", code="H1")
        db.add(house)
        await db.flush()
        product = Product(
            product_code="SIM1",
            product_name="SIM",
            category="SIM",
            status="active",
        )
        db.add(product)
        await db.flush()
        product_id = product.id
        house_id = house.id
        await db.commit()

    serials = [f"89880384{1000000000 + i}" for i in range(N)]
    payload = ReceiptCreate(
        supplier="Banglalink",
        lines=[ReceiptLineCreate(product_id=product_id, serials=serials)],
    )
    # instrument phases
    orig_store = svc._store_receipt_serials_pg
    async def timed_store(*a, **k):
        t = time.time()
        await orig_store(*a, **k)
        print(f"  phase store_pg n={len(k['serials'])}: {time.time()-t:.1f}s")
    svc._store_receipt_serials_pg = timed_store
    orig_check = svc._ensure_not_existing_serials
    async def timed_check(*a, **k):
        t = time.time()
        await orig_check(*a, **k)
        print(f"  phase dup_check n={len(a[3])}: {time.time()-t:.1f}s")
    svc._ensure_not_existing_serials = timed_check
    async with Session() as db:
        started = time.time()
        try:
            doc = await svc.create_receipt(db, house_id=house_id, user_id=None, data=payload)
            await db.commit()
            print(f"OK  n={N} doc={doc.id} qty={doc.total_quantity} in {time.time()-started:.1f}s")
        except Exception as exc:  # noqa: BLE001
            await db.rollback()
            print(f"FAIL n={N} in {time.time()-started:.1f}s: {type(exc).__name__}: {exc}")
    await engine.dispose()


asyncio.run(main())
