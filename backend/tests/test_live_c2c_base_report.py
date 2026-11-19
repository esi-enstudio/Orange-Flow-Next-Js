import httpx
from datetime import date
from fastapi import FastAPI

from app.models.employee import Employee
from app.models.house import House
from app.models.role import Permission, Role
from app.models.rso_target import RSOTarget
from app.models.user import User
from app.routers import reports
from app.routers.deps import get_current_user, get_db
from app.utils.timezone import now_naive


async def _user_with_permissions(db, house, permissions):
    role = Role(name="Base Report Viewer")
    for name in permissions:
        permission = Permission(name=name)
        db.add(permission)
        await db.flush()
        role.permissions.append(permission)
    user = User(
        username=f"base-report-{len(permissions)}",
        hashed_password="x",
        name="Base Report Tester",
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


def _current_month() -> date:
    today = now_naive().date()
    return date(today.year, today.month, 1)


def _previous_month() -> date:
    first = _current_month()
    if first.month == 1:
        return date(first.year - 1, 12, 1)
    return date(first.year, first.month - 1, 1)


async def test_base_report_lists_active_rsos_with_current_month_targets(db, house):
    other_house = House(code="C2C-OTHER", name="Other House", email="other@example.com")
    db.add(other_house)
    await db.flush()

    babul = Employee(
        house_id=house.id, employee_name="Babul", dms_code="DMS-01",
        itop_number="01700000001", employee_type="rso", status="Active",
    )
    amina = Employee(
        house_id=house.id, employee_name="Amina", dms_code="DMS-02",
        itop_number="01700000002", employee_type="rso", status="Active",
    )
    db.add_all([
        babul,
        amina,
        Employee(
            house_id=house.id, employee_name=None, dms_code="DMS-03",
            itop_number=None, employee_type="rso", status="Active",
        ),
        Employee(
            house_id=house.id, employee_name="Former", dms_code="DMS-04",
            employee_type="rso", status="Resigned",
        ),
        Employee(
            house_id=house.id, employee_name="BP", dms_code="DMS-BP",
            employee_type="bp", status="Active",
        ),
        Employee(
            house_id=other_house.id, employee_name="Foreign", dms_code="DMS-OTHER",
            employee_type="rso", status="Active",
        ),
    ])
    await db.flush()
    db.add_all([
        RSOTarget(
            house_id=house.id, employee_id=babul.id, target_date=_current_month(),
            productivity_c2c_tgt=120.0, productivity_trans_tgt=60.0,
        ),
        RSOTarget(
            house_id=house.id, employee_id=amina.id, target_date=_previous_month(),
            productivity_c2c_tgt=999.0, productivity_trans_tgt=999.0,
        ),
        RSOTarget(
            house_id=other_house.id, employee_id=amina.id, target_date=_current_month(),
            productivity_c2c_tgt=777.0, productivity_trans_tgt=777.0,
        ),
    ])
    await db.commit()
    user = await _user_with_permissions(db, house, ("reports.view",))

    async with _client(db, user) as client:
        response = await client.get(
            "/api/reports/live-c2c/rsos",
            headers={"X-House-ID": str(house.id)},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["target_date"] == _current_month().isoformat()
    assert body["data"]["rows"] == [
        {
            "employee_id": babul.id,
            "house_code": house.code,
            "dms_code": "DMS-01",
            "rso_name": "Babul",
            "rso_itop_number": "01700000001",
            "productivity_c2c_tgt": 120.0,
            "productivity_trans_tgt": 60.0,
        },
        {
            "employee_id": amina.id,
            "house_code": house.code,
            "dms_code": "DMS-02",
            "rso_name": "Amina",
            "rso_itop_number": "01700000002",
            "productivity_c2c_tgt": 0.0,
            "productivity_trans_tgt": 0.0,
        },
        {
            "employee_id": body["data"]["rows"][2]["employee_id"],
            "house_code": house.code,
            "dms_code": "DMS-03",
            "rso_name": "DMS-03",
            "rso_itop_number": None,
            "productivity_c2c_tgt": 0.0,
            "productivity_trans_tgt": 0.0,
        },
    ]


async def test_base_report_returns_empty_list_for_house_with_no_active_rsos(db, house):
    db.add(Employee(
        house_id=house.id, employee_name="Former", dms_code="DMS-OLD",
        employee_type="rso", status="Resigned",
    ))
    await db.commit()
    user = await _user_with_permissions(db, house, ("reports.view",))

    async with _client(db, user) as client:
        response = await client.get(
            "/api/reports/live-c2c/rsos",
            headers={"X-House-ID": str(house.id)},
        )

    assert response.status_code == 200
    assert response.json()["data"]["rows"] == []


async def test_base_report_keeps_rows_with_missing_identity_fields(db, house):
    employee = Employee(
        house_id=house.id, employee_name=None, dms_code=None,
        itop_number=None, employee_type="rso", status="Active",
    )
    db.add(employee)
    await db.commit()
    user = await _user_with_permissions(db, house, ("reports.view",))

    async with _client(db, user) as client:
        response = await client.get(
            "/api/reports/live-c2c/rsos",
            headers={"X-House-ID": str(house.id)},
        )

    assert response.status_code == 200
    assert response.json()["data"]["rows"] == [
        {
            "employee_id": employee.id,
            "house_code": house.code,
            "dms_code": None,
            "rso_name": "",
            "rso_itop_number": None,
            "productivity_c2c_tgt": 0.0,
            "productivity_trans_tgt": 0.0,
        },
    ]


async def test_base_report_requires_report_permission(db, house):
    user = await _user_with_permissions(db, house, ("todos.view",))

    async with _client(db, user) as client:
        response = await client.get(
            "/api/reports/live-c2c/rsos",
            headers={"X-House-ID": str(house.id)},
        )

    assert response.status_code == 403


async def test_base_report_rejects_unassigned_house(db, house):
    other_house = House(code="C2C-FOREIGN", name="Foreign House", email="foreign@example.com")
    db.add(other_house)
    await db.commit()
    user = await _user_with_permissions(db, house, ("itopup.view",))

    async with _client(db, user) as client:
        response = await client.get(
            "/api/reports/live-c2c/rsos",
            headers={"X-House-ID": str(other_house.id)},
        )

    assert response.status_code == 403
