from datetime import date
from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from openpyxl import Workbook, load_workbook
from sqlalchemy import select

from conftest import TestSession
from app.models.employee import Employee
from app.models.house import House
from app.models.rso_target import RSOTarget
from app.models.user import User
from app.routers.deps import get_current_user, get_db
from app.routers import targets
from app.schemas.rso_target import RSOTargetCreate, RSOTargetUpdate
from app.services.Automation import target_excel


def _write_rso_workbook(path, rows, include_productivity=True):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "RSO Target"
    headers = ["HOUSE_CODE", "RSO_CODE"]
    if include_productivity:
        headers.extend(["Productivity C2C Tgt", "Productivity trans.Tgt"])
    sheet.append(headers)
    for row in rows:
        sheet.append(row)
    workbook.save(path)


async def _make_house_and_rso(db, code="RSO001"):
    house = House(code="H001", name="Test House", email="house@example.com")
    db.add(house)
    await db.flush()
    employee = Employee(
        house_id=house.id,
        employee_type="RSO",
        status="Active",
        dms_code=code,
        employee_name="Test RSO",
    )
    db.add(employee)
    await db.commit()
    return house, employee


@pytest.mark.asyncio
async def test_import_preserves_productivity_values_and_defaults_new_rows(
    db, tmp_path, monkeypatch
):
    _, first_rso = await _make_house_and_rso(db)
    second_rso = Employee(
        house_id=first_rso.house_id,
        employee_type="RSO",
        status="Active",
        dms_code="RSO002",
        employee_name="Second RSO",
    )
    db.add(second_rso)
    await db.commit()
    monkeypatch.setattr(target_excel, "async_session", TestSession)

    with_values = tmp_path / "with_productivity.xlsx"
    _write_rso_workbook(with_values, [["H001", "RSO001", 12.5, 7.25]])
    count, error = await target_excel.process_target_excel_unified(
        str(with_values), date(2026, 11, 1)
    )
    assert (count, error) == (1, None)

    without_values = tmp_path / "without_productivity.xlsx"
    _write_rso_workbook(
        without_values,
        [["H001", "RSO001"], ["H001", "RSO002"]],
        include_productivity=False,
    )
    count, error = await target_excel.process_target_excel_unified(
        str(without_values), date(2026, 11, 1)
    )
    assert (count, error) == (2, None)

    records = (
        await db.execute(select(RSOTarget).order_by(RSOTarget.employee_id))
    ).scalars().all()
    first, second = records
    assert first.productivity_c2c_tgt == pytest.approx(12.5)
    assert first.productivity_trans_tgt == pytest.approx(7.25)
    assert second.productivity_c2c_tgt == 0
    assert second.productivity_trans_tgt == 0


@pytest.mark.asyncio
async def test_rso_target_create_and_update_persist_productivity_values(db):
    _, rso = await _make_house_and_rso(db)

    created = await targets.create_rso_target(
        RSOTargetCreate(
            employee_id=rso.id,
            target_date="2026-11-01",
            productivity_c2c_tgt=1.5,
            productivity_trans_tgt=2.75,
        ),
        db,
        current_user=None,
        house_id=None,
    )
    assert created.productivity_c2c_tgt == pytest.approx(1.5)
    assert created.productivity_trans_tgt == pytest.approx(2.75)

    updated = await targets.update_rso_target(
        created.id,
        RSOTargetUpdate(
            productivity_c2c_tgt=3.25,
            productivity_trans_tgt=4.5,
        ),
        db,
        current_user=None,
    )
    assert updated.productivity_c2c_tgt == pytest.approx(3.25)
    assert updated.productivity_trans_tgt == pytest.approx(4.5)


@pytest.mark.asyncio
async def test_rso_target_list_serializes_records_with_employee_user(db):
    house, rso = await _make_house_and_rso(db)
    rso.user = User(
        username="rso-login",
        hashed_password="x",
        name="RSO Login",
    )
    await db.commit()
    target = await targets.create_rso_target(
        RSOTargetCreate(employee_id=rso.id, target_date="2026-11-01"),
        db,
        current_user=None,
        house_id=None,
    )
    current_user = SimpleNamespace(
        houses=[house],
        roles=[
            SimpleNamespace(
                name="Admin",
                permissions=[SimpleNamespace(name="targets.view")],
            )
        ],
    )
    app = FastAPI()
    app.include_router(targets.router)

    async def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: current_user

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.get("/api/rso-targets")
        detail_response = await client.get(f"/api/rso-targets/{target.id}")

    assert response.status_code == 200
    assert response.json()["data"][0]["employee"]["user"]["name"] == "RSO Login"
    assert detail_response.status_code == 200
    assert detail_response.json()["employee"]["user"]["name"] == "RSO Login"


@pytest.mark.asyncio
async def test_rso_sample_and_export_include_productivity_headers_and_values():
    sample = load_workbook(BytesIO(target_excel.generate_rso_target_sample_bytes()))
    sample_rows = list(sample.active.iter_rows(values_only=True))
    sample_headers = sample_rows[0]
    c2c_index = sample_headers.index("Productivity C2C Tgt")
    trans_index = sample_headers.index("Productivity trans.Tgt")
    assert sample_rows[1][c2c_index] == pytest.approx(1.5)
    assert sample_rows[1][trans_index] == pytest.approx(2.75)

    record = SimpleNamespace(
        employee_id=10,
        supervisor_id=20,
        house=SimpleNamespace(code="H001"),
        ev_secondary=100.0,
        sc_secondary=80.0,
        total_recharge=180.0,
        ga=15,
        sso=2,
        lso=1,
        bso=1,
        ddso=1,
        dsso=2,
        dso=1,
        dlso=1,
        service_route="Route A",
        market_type="OSDO",
        thana_name="Thana A",
        target_date=date(2026, 11, 1),
        productivity_c2c_tgt=3.5,
        productivity_trans_tgt=4.25,
    )
    exported = load_workbook(
        BytesIO(await target_excel.export_rso_targets_excel([record]))
    )
    export_rows = list(exported.active.iter_rows(values_only=True))
    export_headers = export_rows[0]
    assert export_rows[1][export_headers.index("Productivity C2C Tgt")] == pytest.approx(
        3.5
    )
    assert export_rows[1][export_headers.index("Productivity trans.Tgt")] == pytest.approx(
        4.25
    )
