"""Active-house selection is self-service, tenant-scoped, persisted and audited."""
import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from starlette.requests import Request

from app.models.activity_log import ActivityLog
from app.models.role import Role
from app.models.user import User
from app.routers.auth import SelectedHouseUpdate, get_me, router as auth_router, set_selected_house
from conftest import make_house


def make_request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "PUT",
            "path": "/api/auth/selected-house",
            "headers": [],
            "query_string": b"",
        }
    )


async def make_user(db, username, houses, role_name="Manager", selected_house_id=None):
    role = Role(name=role_name)
    db.add(role)
    await db.flush()
    user = User(
        username=username,
        name=username,
        hashed_password="x",
        roles=[role],
        houses=list(houses),
        selected_house_id=selected_house_id,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest.mark.asyncio
async def test_route_is_wired_and_requires_auth():
    app = FastAPI()
    app.include_router(auth_router)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.put("/api/auth/selected-house", json={"house_id": 1})

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_assigned_house_becomes_active_and_is_audited(db):
    first = await make_house(db, code="H001", name="First House")
    second = await make_house(db, code="H002", name="Second House")
    tenant = await make_user(db, "manager", [first, second], selected_house_id=first.id)

    result = await set_selected_house(
        SelectedHouseUpdate(house_id=second.id), make_request(), db, tenant
    )

    assert result == {"selected_house_id": second.id}
    assert tenant.selected_house_id == second.id
    assert (await get_me(db=db, current_user=tenant)).selected_house_id == second.id

    log = (await db.execute(select(ActivityLog))).scalar_one()
    assert log.module == "auth"
    assert log.action == "edit"
    assert log.record_id == second.id
    assert log.record_identifier == second.name
    assert log.old_values == {"selected_house_id": first.id}
    assert log.new_values == {"selected_house_id": second.id}


@pytest.mark.asyncio
async def test_unassigned_house_is_rejected_without_mutation(db):
    first = await make_house(db, code="H001", name="First House")
    foreign = await make_house(db, code="H002", name="Foreign House")
    tenant = await make_user(db, "manager", [first], selected_house_id=first.id)

    with pytest.raises(HTTPException) as exc:
        await set_selected_house(
            SelectedHouseUpdate(house_id=foreign.id), make_request(), db, tenant
        )

    assert exc.value.status_code == 403
    assert tenant.selected_house_id == first.id
    assert (await db.execute(select(ActivityLog))).scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_unknown_house_is_rejected_without_mutation(db):
    first = await make_house(db, code="H001", name="First House")
    tenant = await make_user(db, "manager", [first], selected_house_id=first.id)

    with pytest.raises(HTTPException) as exc:
        await set_selected_house(
            SelectedHouseUpdate(house_id=99999), make_request(), db, tenant
        )

    assert exc.value.status_code == 403
    assert tenant.selected_house_id == first.id


@pytest.mark.asyncio
async def test_super_admin_can_select_house_without_pivot_row(db):
    assigned = await make_house(db, code="H001", name="Assigned House")
    unassigned = await make_house(db, code="H002", name="Unassigned House")
    admin = await make_user(
        db, "root", [assigned], role_name="Super Admin", selected_house_id=assigned.id
    )

    result = await set_selected_house(
        SelectedHouseUpdate(house_id=unassigned.id), make_request(), db, admin
    )

    assert result == {"selected_house_id": unassigned.id}
    assert admin.selected_house_id == unassigned.id


@pytest.mark.asyncio
async def test_null_resets_to_first_assigned_house(db):
    first = await make_house(db, code="H001", name="First House")
    second = await make_house(db, code="H002", name="Second House")
    tenant = await make_user(db, "manager", [first, second], selected_house_id=second.id)

    result = await set_selected_house(
        SelectedHouseUpdate(house_id=None), make_request(), db, tenant
    )

    assert result == {"selected_house_id": first.id}
    assert tenant.selected_house_id == first.id


@pytest.mark.asyncio
async def test_null_resets_to_first_house_for_super_admin(db):
    first = await make_house(db, code="H001", name="First House")
    second = await make_house(db, code="H002", name="Second House")
    admin = await make_user(
        db, "root", [first, second], role_name="Super Admin", selected_house_id=second.id
    )

    result = await set_selected_house(
        SelectedHouseUpdate(house_id=None), make_request(), db, admin
    )

    assert result == {"selected_house_id": first.id}
    assert admin.selected_house_id == first.id


@pytest.mark.asyncio
async def test_super_admin_with_pivot_rows_gets_all_houses_from_me(db):
    pivot = await make_house(db, code="H001", name="Pivot House")
    extra = await make_house(db, code="H002", name="Extra House")
    admin = await make_user(
        db, "root", [pivot], role_name="Super Admin", selected_house_id=pivot.id
    )

    result = await set_selected_house(
        SelectedHouseUpdate(house_id=extra.id), make_request(), db, admin
    )

    assert result == {"selected_house_id": extra.id}
    me = await get_me(db=db, current_user=admin)
    # /houses/accessible offers every house to a super admin, so /auth/me must
    # list the same set or the UI silently rejects the newly selected house.
    assert extra.id in {house.id for house in me.houses}
    assert me.selected_house_id == extra.id


@pytest.mark.asyncio
async def test_null_reset_for_super_admin_without_pivot_rows(db):
    first = await make_house(db, code="H001", name="First House")
    await make_house(db, code="H002", name="Second House")
    admin = await make_user(db, "root", [], role_name="Super Admin")

    result = await set_selected_house(
        SelectedHouseUpdate(house_id=None), make_request(), db, admin
    )

    assert result == {"selected_house_id": first.id}
    assert admin.selected_house_id == first.id


@pytest.mark.asyncio
async def test_null_reset_prefers_active_house(db):
    inactive = await make_house(db, code="H001", name="Old Inactive", is_active=False)
    active = await make_house(db, code="H002", name="Active House")
    tenant = await make_user(
        db, "manager", [inactive, active], selected_house_id=inactive.id
    )

    result = await set_selected_house(
        SelectedHouseUpdate(house_id=None), make_request(), db, tenant
    )

    assert result == {"selected_house_id": active.id}
    assert tenant.selected_house_id == active.id


@pytest.mark.asyncio
async def test_super_admin_cannot_select_nonexistent_house(db):
    first = await make_house(db, code="H001", name="First House")
    admin = await make_user(
        db, "root", [first], role_name="Super Admin", selected_house_id=first.id
    )

    with pytest.raises(HTTPException) as exc:
        await set_selected_house(
            SelectedHouseUpdate(house_id=99999), make_request(), db, admin
        )

    assert exc.value.status_code == 400
    assert admin.selected_house_id == first.id
