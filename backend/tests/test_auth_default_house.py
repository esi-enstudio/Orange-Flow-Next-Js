"""The super admin's workspace house (``selectedHouse``) is derived from the
first house ``GET /api/auth/me`` returns, so that order must be stable and must
never hand the UI an inactive house — the frontend then filters every list by
``X-House-ID`` and an empty page looks like missing data."""
import pytest

from app.models.role import Role
from app.models.user import User
from app.routers.auth import get_me
from conftest import make_house


@pytest.mark.asyncio
async def test_me_orders_houses_active_first_then_oldest(db):
    oldest = await make_house(db, code="H001", name="Patwary Telecom")
    inactive = await make_house(
        db, code="H002", name="M/S. MODINA STORE", is_active=False
    )
    newer = await make_house(db, code="H003", name="M/s Pawary Telecom")

    role = Role(name="Super Admin")
    db.add(role)
    await db.flush()
    user = User(
        username="root",
        name="Root",
        email="root@example.com",
        hashed_password="x",
        roles=[role],
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    me = await get_me(db=db, current_user=user)

    assert [house.id for house in me.houses] == [oldest.id, newer.id, inactive.id]
