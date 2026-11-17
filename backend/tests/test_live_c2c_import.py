from io import BytesIO

import httpx
from fastapi import FastAPI
from openpyxl import Workbook
from pyxlsb.worksheet import Cell
from sqlalchemy import select

from app.models.activity_log import ActivityLog
from app.models.employee import Employee
from app.models.house import House
from app.models.live_c2c import LiveC2CRow
from app.models.role import Permission, Role
from app.models.retailer import Retailer
from app.models.route import RetailerRoute, Route
from app.models.user import User
from app.routers import reports
from app.routers.deps import get_current_user, get_db
from app.services import live_c2c_service


def test_xlsb_sheet_listing_and_parser(monkeypatch):
    class FakeWorksheet:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return None

        def rows(self):
            return iter(
                [
                    [
                        Cell(0, 0, "From Msisdn"),
                        Cell(0, 1, "To Msisdn"),
                        Cell(0, 2, "Modified ON"),
                        Cell(0, 3, "Transfer Mrp"),
                    ],
                    [
                        Cell(1, 0, "01700000001"),
                        Cell(1, 1, "01800000001"),
                        Cell(1, 2, 45200),
                        Cell(1, 3, 25.5),
                    ],
                ]
            )

    class FakeWorkbook:
        sheets = ["Summary", "C2C Data"]

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return None

        def get_sheet(self, sheet_name):
            assert sheet_name == "C2C Data"
            return FakeWorksheet()

    monkeypatch.setattr(
        live_c2c_service,
        "open_workbook",
        lambda _content: FakeWorkbook(),
    )

    assert live_c2c_service.list_live_c2c_worksheet_names(
        b"test",
        "live-c2c.xlsb",
    ) == ["Summary", "C2C Data"]
    rows = live_c2c_service.parse_live_c2c_workbook(
        b"test",
        "C2C Data",
        "live-c2c.xlsb",
    )
    assert rows[0]["from_number"] == "01700000001"
    assert rows[0]["to_number"] == "01800000001"
    assert rows[0]["modified_on"] == live_c2c_service.convert_date(45200).isoformat(
        sep=" "
    )
    assert rows[0]["transfer_mrp"] == 25.5


async def _source_entities(db, house, *, suffix="1", enabled="Yes"):
    employee = Employee(
        house_id=house.id,
        employee_type="rso",
        status="Active",
        itop_number=f"0170000000{suffix}",
        dms_code=f"RSO-{house.id}-{suffix}",
    )
    retailer = Retailer(
        house_id=house.id,
        retailer_code=f"RET-{house.id}-{suffix}",
        name=f"Retailer {suffix}",
        enabled=enabled,
        itop_number=f"0180000000{suffix}",
    )
    db.add_all([employee, retailer])
    await db.flush()
    return employee, retailer


async def _user_with_permissions(db, house, permissions):
    role = Role(name="Live C2C Importer")
    for name in permissions:
        permission = Permission(name=name)
        db.add(permission)
        await db.flush()
        role.permissions.append(permission)

    user = User(
        username="live-c2c-importer",
        hashed_password="x",
        name="Live C2C Importer",
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


def _workbook_bytes(*, headers, sheet_name="C2C Data", rows=()):
    workbook = Workbook()
    workbook.active.title = "Summary"
    worksheet = workbook.create_sheet(sheet_name)
    worksheet.append(["Live C2C Report"])
    worksheet.append(headers)
    for row in rows:
        worksheet.append(row)
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


async def test_selected_sheet_import_replaces_only_active_rows_in_selected_house(db, house):
    other_house = House(code="C2C-OTHER", name="Other House", email="other@example.com")
    db.add(other_house)
    await db.flush()
    user = await _user_with_permissions(
        db,
        house,
        ("reports.view", "live_c2c.import"),
    )
    employee, retailer = await _source_entities(db, house)
    other_employee, other_retailer = await _source_entities(
        db,
        other_house,
        suffix="2",
    )
    old_row = LiveC2CRow(
        house_id=house.id,
        from_msisdn=employee.id,
        to_msisdn=retailer.id,
        modified_on=None,
        transfer_mrp=10,
        on_route="N",
        source_filename="old.xlsx",
        source_sheet="Old",
        created_by=user.id,
    )
    other_house_row = LiveC2CRow(
        house_id=other_house.id,
        from_msisdn=other_employee.id,
        to_msisdn=other_retailer.id,
        modified_on=None,
        transfer_mrp=12,
        on_route="N",
        source_filename="other.xlsx",
        source_sheet="Old",
        created_by=user.id,
    )
    db.add_all([old_row, other_house_row])
    await db.commit()

    workbook = _workbook_bytes(
        headers=["Transfer Mrp", "To Msisdn", "Modified ON", "From Msisdn"],
        rows=[
            [
                "25.50",
                retailer.itop_number,
                "2026-11-17 10:30",
                employee.itop_number,
            ]
        ],
    )
    async with _client(db, user) as client:
        response = await client.post(
            "/api/reports/live-c2c/import",
            headers={"X-House-ID": str(house.id)},
            data={"sheet_name": "C2C Data"},
            files={
                "file": (
                    "live-c2c.xlsx",
                    workbook,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
        report_response = await client.get(
            "/api/reports/live-c2c",
            headers={"X-House-ID": str(house.id)},
        )

    assert response.status_code == 200
    assert response.json()["data"]["imported_rows"] == 1
    assert report_response.status_code == 200
    report_rows = report_response.json()["data"]
    assert len(report_rows) == 1
    assert {
        key: report_rows[0][key]
        for key in ("from_msisdn", "to_msisdn", "modified_on", "transfer_mrp")
    } == {
        "from_msisdn": employee.itop_number,
        "to_msisdn": retailer.itop_number,
        "modified_on": "2026-11-17 10:30",
        "transfer_mrp": "25.50",
    }
    assert report_rows[0]["on_route"] == "N"

    saved_rows = (await db.execute(select(LiveC2CRow).order_by(LiveC2CRow.id))).scalars().all()
    assert old_row.is_deleted is True
    assert other_house_row.is_deleted is False
    assert len([row for row in saved_rows if row.house_id == house.id and not row.is_deleted]) == 1
    assert len([row for row in saved_rows if row.house_id == other_house.id and not row.is_deleted]) == 1
    activity = (await db.execute(select(ActivityLog).where(ActivityLog.module == "live_c2c"))).scalar_one()
    assert activity.action == "import"
    assert activity.new_values["imported_rows"] == 1


async def test_invalid_selected_sheet_does_not_replace_existing_rows(db, house):
    user = await _user_with_permissions(
        db,
        house,
        ("reports.view", "live_c2c.import"),
    )
    existing = LiveC2CRow(
        house_id=house.id,
        from_msisdn=(await _source_entities(db, house))[0].id,
        to_msisdn=(await _source_entities(db, house, suffix="2"))[1].id,
        modified_on=None,
        transfer_mrp=10,
        on_route="N",
        source_filename="existing.xlsx",
        source_sheet="C2C",
        created_by=user.id,
    )
    db.add(existing)
    await db.commit()

    workbook = _workbook_bytes(
        headers=["Wrong Header", "To Msisdn"],
        rows=[["from", "to"]],
    )
    async with _client(db, user) as client:
        response = await client.post(
            "/api/reports/live-c2c/import",
            headers={"X-House-ID": str(house.id)},
            data={"sheet_name": "C2C Data"},
            files={"file": ("live-c2c.xlsx", workbook)},
        )

    assert response.status_code == 400
    assert response.json()["detail"]["error_code"] == "live_c2c_missing_columns"
    await db.refresh(existing)
    assert existing.is_deleted is False


async def test_empty_selected_sheet_does_not_replace_existing_rows(db, house):
    user = await _user_with_permissions(
        db,
        house,
        ("reports.view", "live_c2c.import"),
    )
    existing = LiveC2CRow(
        house_id=house.id,
        from_msisdn=(await _source_entities(db, house))[0].id,
        to_msisdn=(await _source_entities(db, house, suffix="2"))[1].id,
        modified_on=None,
        transfer_mrp=10,
        on_route="N",
        source_filename="existing.xlsx",
        source_sheet="C2C",
        created_by=user.id,
    )
    db.add(existing)
    await db.commit()
    workbook = _workbook_bytes(
        headers=["From Msisdn", "To Msisdn", "Modified ON", "Transfer Mrp"],
    )

    async with _client(db, user) as client:
        response = await client.post(
            "/api/reports/live-c2c/import",
            headers={"X-House-ID": str(house.id)},
            data={"sheet_name": "C2C Data"},
            files={"file": ("live-c2c.xlsx", workbook)},
        )

    assert response.status_code == 400
    assert response.json()["detail"]["error_code"] == "live_c2c_empty_sheet"
    await db.refresh(existing)
    assert existing.is_deleted is False


async def test_preview_counts_disabled_retailers_and_imports_entity_ids(db, house):
    user = await _user_with_permissions(
        db,
        house,
        ("reports.view", "live_c2c.import"),
    )
    employee, disabled_retailer = await _source_entities(
        db,
        house,
        suffix="1",
        enabled="N",
    )
    _, enabled_retailer = await _source_entities(
        db,
        house,
        suffix="2",
        enabled="Yes",
    )
    route = Route(
        house_id=house.id,
        code=f"ROUTE-{house.id}",
        name="Daily Route",
        visit_days=[
            "saturday",
            "sunday",
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
        ],
        is_active=True,
    )
    db.add(route)
    await db.flush()
    db.add(
        RetailerRoute(
            retailer_id=disabled_retailer.id,
            route_id=route.id,
            status="active",
            is_primary=True,
        )
    )
    await db.commit()
    workbook = _workbook_bytes(
        headers=["From Msisdn", "To Msisdn", "Modified ON", "Transfer Mrp"],
        rows=[
            [employee.itop_number, disabled_retailer.itop_number, "2026-11-18", "10"],
            [employee.itop_number, disabled_retailer.itop_number, "2026-11-18", "12"],
            [employee.itop_number, enabled_retailer.itop_number, "2026-11-18", "15"],
        ],
    )

    async with _client(db, user) as client:
        preview = await client.post(
            "/api/reports/live-c2c/preview",
            headers={"X-House-ID": str(house.id)},
            data={"sheet_name": "C2C Data"},
            files={"file": ("live-c2c.xlsx", workbook)},
        )
        assert preview.status_code == 200
        assert preview.json()["data"]["disabled_retailer_count"] == 1
        assert await db.scalar(select(LiveC2CRow.id)) is None

        response = await client.post(
            "/api/reports/live-c2c/import",
            headers={"X-House-ID": str(house.id)},
            data={"sheet_name": "C2C Data"},
            files={"file": ("live-c2c.xlsx", workbook)},
        )
        report_response = await client.get(
            "/api/reports/live-c2c",
            headers={"X-House-ID": str(house.id)},
        )

    assert response.status_code == 200
    assert response.json()["data"]["disabled_retailer_count"] == 1
    saved_rows = (
        await db.execute(select(LiveC2CRow).order_by(LiveC2CRow.id))
    ).scalars().all()
    assert [row.from_msisdn for row in saved_rows] == [employee.id] * 3
    assert [row.to_msisdn for row in saved_rows] == [
        disabled_retailer.id,
        disabled_retailer.id,
        enabled_retailer.id,
    ]
    assert [row.on_route for row in saved_rows] == ["Y", "Y", "N"]
    assert report_response.json()["data"][0]["from_msisdn"] == employee.itop_number
    assert report_response.json()["data"][0]["to_msisdn"] == disabled_retailer.itop_number
    assert report_response.json()["data"][0]["on_route"] == "Y"


async def test_xlsb_upload_lists_worksheets(db, house, monkeypatch):
    user = await _user_with_permissions(db, house, ("live_c2c.import",))
    monkeypatch.setattr(
        reports,
        "list_live_c2c_worksheet_names",
        lambda _content, _filename: ["Summary", "C2C Data"],
    )

    async with _client(db, user) as client:
        response = await client.post(
            "/api/reports/live-c2c/worksheets",
            headers={"X-House-ID": str(house.id)},
            files={"file": ("live-c2c.xlsb", b"binary workbook")},
        )

    assert response.status_code == 200
    assert response.json()["data"]["sheet_names"] == ["Summary", "C2C Data"]


async def test_import_requires_live_c2c_import_permission(db, house):
    user = await _user_with_permissions(db, house, ("reports.view",))
    workbook = _workbook_bytes(
        headers=["From Msisdn", "To Msisdn", "Modified ON", "Transfer Mrp"],
        rows=[["01700000001", "01700000002", "2026-11-17", "10"]],
    )

    async with _client(db, user) as client:
        response = await client.post(
            "/api/reports/live-c2c/import",
            headers={"X-House-ID": str(house.id)},
            data={"sheet_name": "C2C Data"},
            files={"file": ("live-c2c.xlsx", workbook)},
        )

    assert response.status_code == 403
