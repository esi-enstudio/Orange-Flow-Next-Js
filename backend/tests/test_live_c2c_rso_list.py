import httpx
from fastapi import FastAPI

from app.models.employee import Employee
from app.models.house import House
from app.models.role import Permission, Role
from app.models.user import User
from app.routers import reports
from app.routers.deps import get_current_user, get_db


async def _user_with_permissions(db, house, permissions):
    role = Role(name="Report Viewer")
    for name in permissions:
        permission = Permission(name=name)
        db.add(permission)
        await db.flush()
        role.permissions.append(permission)

    user = User(
        username=f"live-c2c-{len(permissions)}",
        hashed_password="x",
        name="Live C2C Tester",
        status="Active",
    )
    user.roles.append(role)
    user.houses.append(house)
    db.add(user)
    await db.commit()
    return user


def _client(db, user):
    app = FastAPI()
    app.include_router(reports.router)

    async def override_db():
        yield db

    async def override_user():
        return user

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = override_user
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
    )


async def test_live_c2c_rso_list_is_active_and_scoped_to_selected_house(db, house):
    other_house = House(code="C2C-OTHER", name="Other House", email="other@example.com")
    db.add(other_house)
    await db.flush()

    first = Employee(
        house_id=house.id,
        employee_name="Amina",
        dms_code="DMS-02",
        itop_number="01700000002",
        employee_type="rso",
        status="Active",
    )
    second = Employee(
        house_id=house.id,
        employee_name="Babul",
        dms_code="DMS-01",
        itop_number="01700000001",
        employee_type="rso",
        status="Active",
    )
    db.add_all([
        first,
        second,
        Employee(
            house_id=house.id,
            employee_name="Former RSO",
            dms_code="DMS-03",
            employee_type="rso",
            status="Resigned",
        ),
        Employee(
            house_id=house.id,
            employee_name="BP",
            dms_code="DMS-BP",
            employee_type="bp",
            status="Active",
        ),
        Employee(
            house_id=other_house.id,
            employee_name="Foreign RSO",
            dms_code="DMS-OTHER",
            employee_type="rso",
            status="Active",
        ),
    ])
    await db.commit()
    user = await _user_with_permissions(db, house, ("reports.view",))

    async with _client(db, user) as client:
        response = await client.get(
            "/api/itopup-details/live-c2c-rsos",
            headers={"X-House-ID": str(house.id)},
            params={"page": 1, "per_page": 1},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["data"] == [
        {
            "id": second.id,
            "name": "Babul",
            "name_bn": None,
            "dms_code": "DMS-01",
            "itop_number": "01700000001",
        },
    ]
    assert body["pagination"] == {
        "page": 1,
        "per_page": 1,
        "total": 2,
        "total_pages": 2,
        "has_next": True,
        "has_prev": False,
    }

    async with _client(db, user) as client:
        second_page = await client.get(
            "/api/itopup-details/live-c2c-rsos",
            headers={"X-House-ID": str(house.id)},
            params={"page": 2, "per_page": 1},
        )

    assert second_page.status_code == 200
    assert second_page.json()["data"] == [
        {
            "id": first.id,
            "name": "Amina",
            "name_bn": None,
            "dms_code": "DMS-02",
            "itop_number": "01700000002",
        },
    ]


async def test_live_c2c_rso_list_rejects_unassigned_house(db, house):
    other_house = House(code="C2C-FOREIGN", name="Foreign House", email="foreign@example.com")
    db.add(other_house)
    await db.commit()
    user = await _user_with_permissions(db, house, ("itopup.view",))

    async with _client(db, user) as client:
        response = await client.get(
            "/api/itopup-details/live-c2c-rsos",
            headers={"X-House-ID": str(other_house.id)},
        )

    assert response.status_code == 403


async def test_live_c2c_rso_list_allows_either_page_view_permission(db, house):
    user = await _user_with_permissions(db, house, ("reports.view",))

    async with _client(db, user) as client:
        response = await client.get(
            "/api/itopup-details/live-c2c-rsos",
            headers={"X-House-ID": str(house.id)},
        )

    assert response.status_code == 200


async def test_live_c2c_rso_list_allows_itopup_view_permission(db, house):
    user = await _user_with_permissions(db, house, ("itopup.view",))

    async with _client(db, user) as client:
        response = await client.get(
            "/api/itopup-details/live-c2c-rsos",
            headers={"X-House-ID": str(house.id)},
        )

    assert response.status_code == 200
