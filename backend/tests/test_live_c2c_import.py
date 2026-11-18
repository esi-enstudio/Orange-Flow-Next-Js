from decimal import Decimal
from io import BytesIO

import httpx
from conftest import make_house
from fastapi import FastAPI
from openpyxl import Workbook
from pyxlsb.worksheet import Cell
from sqlalchemy import func, select

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
from app.utils.timezone import now_naive


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
        headers=[
            "Transfer Mrp",
            "To Msisdn",
            "Modified ON",
            "From Msisdn",
            "House Code",
        ],
        rows=[
            [
                "25.50",
                retailer.itop_number,
                "2026-11-17 10:30",
                employee.itop_number,
                house.code,
            ],
            [
                "50.00",
                other_retailer.itop_number,
                "2026-11-17 10:45",
                other_employee.itop_number,
                other_house.code,
            ]
        ],
    )
    async with _client(db, user) as client:
        preview_response = await client.post(
            "/api/reports/live-c2c/preview",
            headers={"X-House-ID": str(house.id)},
            data={"sheet_name": "C2C Data"},
            files={"file": ("live-c2c.xlsx", workbook)},
        )
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

    assert preview_response.status_code == 200
    preview = preview_response.json()["data"]
    assert preview["can_import"] is True
    assert preview["summary"]["total_rows"] == 1
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
    assert [(row.house_id, row.source_filename) for row in saved_rows] == [
        (other_house.id, "other.xlsx"),
        (house.id, "live-c2c.xlsx"),
    ]
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
    assert existing.id is not None


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
    assert existing.id is not None


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


async def test_preview_check_lists_only_unmatched_from_numbers(db, house):
    await _user_with_permissions(db, house, ("reports.view", "live_c2c.import"))
    employee, retailer = await _source_entities(db, house)
    rows = [
        {
            "_row_number": 3,
            "from_number": employee.itop_number,
            "to_number": retailer.itop_number,
            "modified_on": "x",
            "transfer_mrp": 10,
        },
        {
            "_row_number": 4,
            "from_number": "01799999999",
            "to_number": retailer.itop_number,
            "modified_on": "x",
            "transfer_mrp": 10,
        },
        {
            "_row_number": 5,
            "from_number": "01799999999",
            "to_number": retailer.itop_number,
            "modified_on": "x",
            "transfer_mrp": 10,
        },
    ]

    check = await live_c2c_service.prepare_live_c2c_import(
        db, house_id=house.id, rows=rows
    )

    assert check.can_import is False
    assert [(issue.side, issue.value, issue.status) for issue in check.issues] == [
        ("from", "01799999999", "not_found")
    ]
    assert check.issues[0].row_count == 2
    assert check.issues[0].excel_rows == [4, 5]
    assert check.issues[0].candidates == []
    assert check.summary == {
        "total_rows": 3,
        "importable_rows": 1,
        "issue_count": 1,
        "affected_rows": 2,
        "duplicate_rows": 0,
    }
    assert check.rows == []


async def test_preview_check_is_clean_when_every_row_matches(db, house):
    employee, retailer = await _source_entities(db, house)
    rows = [
        {
            "_row_number": 3,
            "from_number": employee.itop_number,
            "to_number": retailer.itop_number,
            "modified_on": "x",
            "transfer_mrp": 10,
        }
    ]

    check = await live_c2c_service.prepare_live_c2c_import(
        db, house_id=house.id, rows=rows
    )

    assert check.can_import is True
    assert check.issues == []
    assert check.truncated is False
    assert check.duplicate_excel_rows == []
    assert check.rows[0]["from_msisdn"] == employee.id
    assert check.rows[0]["to_msisdn"] == retailer.id


async def test_preview_check_lists_candidates_for_ambiguous_from_number(db, house):
    first, retailer = await _source_entities(db, house)
    second = Employee(
        house_id=house.id,
        employee_type="rso",
        status="Active",
        itop_number=first.itop_number,
        dms_code="RSO-DUP-1",
    )
    db.add(second)
    await db.flush()
    rows = [
        {
            "_row_number": 3,
            "from_number": first.itop_number,
            "to_number": retailer.itop_number,
            "modified_on": "x",
            "transfer_mrp": 10,
        }
    ]

    check = await live_c2c_service.prepare_live_c2c_import(
        db, house_id=house.id, rows=rows
    )

    issue = check.issues[0]
    assert (issue.side, issue.status) == ("from", "ambiguous")
    assert {candidate["dms_code"] for candidate in issue.candidates} == {
        first.dms_code,
        "RSO-DUP-1",
    }
    assert set(issue.candidates[0]) == {
        "id",
        "name",
        "name_bn",
        "dms_code",
        "itop_number",
    }


async def test_preview_check_ignores_other_house_entities(db, house):
    other = await make_house(db, code="H999", name="Other", email="o@example.com")
    other_employee, _ = await _source_entities(db, other, suffix="9")
    _, retailer = await _source_entities(db, house)
    rows = [
        {
            "_row_number": 3,
            "from_number": other_employee.itop_number,
            "to_number": retailer.itop_number,
            "modified_on": "x",
            "transfer_mrp": 10,
        }
    ]

    check = await live_c2c_service.prepare_live_c2c_import(
        db, house_id=house.id, rows=rows
    )

    assert check.can_import is False
    assert check.issues[0].side == "from"
    assert check.issues[0].status == "not_found"
    assert check.issues[0].candidates == []


async def test_preview_check_lists_unmatched_to_numbers(db, house):
    employee, _ = await _source_entities(db, house)
    rows = [
        {
            "_row_number": 3,
            "from_number": employee.itop_number,
            "to_number": "01899999999",
            "modified_on": "x",
            "transfer_mrp": 10,
        }
    ]

    check = await live_c2c_service.prepare_live_c2c_import(
        db, house_id=house.id, rows=rows
    )

    assert check.can_import is False
    issue = check.issues[0]
    assert (issue.side, issue.value, issue.status) == ("to", "01899999999", "not_found")
    assert issue.candidates == []


async def test_preview_check_lists_candidates_for_ambiguous_to_number(db, house):
    employee, retailer = await _source_entities(db, house)
    db.add(
        Retailer(
            house_id=house.id,
            retailer_code=f"RET-DUP-{house.id}",
            name="Duplicate Retailer",
            enabled="Yes",
            itop_number=retailer.itop_number,
        )
    )
    await db.flush()
    rows = [
        {
            "_row_number": 3,
            "from_number": employee.itop_number,
            "to_number": retailer.itop_number,
            "modified_on": "x",
            "transfer_mrp": 10,
        }
    ]

    check = await live_c2c_service.prepare_live_c2c_import(
        db, house_id=house.id, rows=rows
    )

    issue = check.issues[0]
    assert (issue.side, issue.status) == ("to", "ambiguous")
    assert len(issue.candidates) == 2
    assert set(issue.candidates[0]) == {
        "id",
        "name",
        "retailer_code",
        "itop_number",
        "enabled",
    }


async def test_preview_returns_issues_with_http_200(db, house):
    user = await _user_with_permissions(
        db, house, ("reports.view", "live_c2c.import")
    )
    _, retailer = await _source_entities(db, house)
    workbook = _workbook_bytes(
        headers=["From Msisdn", "To Msisdn", "Modified ON", "Transfer Mrp"],
        rows=[["01799999999", retailer.itop_number, "2026-11-17 10:30", "25.50"]],
    )
    async with _client(db, user) as client:
        response = await client.post(
            "/api/reports/live-c2c/preview",
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

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["can_import"] is False
    assert data["issues"] == [
        {
            "side": "from",
            "value": "01799999999",
            "status": "not_found",
            "row_count": 1,
            "excel_rows": [3],
            "candidates": [],
        }
    ]
    assert data["summary"]["issue_count"] == 1
    assert data["disabled_retailer_count"] == 0


async def test_import_blocks_on_mismatch_and_keeps_existing_rows(db, house):
    user = await _user_with_permissions(
        db, house, ("reports.view", "live_c2c.import")
    )
    employee, retailer = await _source_entities(db, house)
    existing = LiveC2CRow(
        house_id=house.id,
        from_msisdn=employee.id,
        to_msisdn=retailer.id,
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
        rows=[["01799999999", retailer.itop_number, "2026-11-17 10:30", "25.50"]],
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

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["error_code"] == "live_c2c_entity_mismatch"
    assert detail["diagnostics"]["issues"][0]["value"] == "01799999999"
    remaining = (await db.execute(select(LiveC2CRow))).scalars().all()
    assert [row.id for row in remaining] == [existing.id]


def test_live_c2c_model_has_no_soft_delete_columns():
    assert {"is_deleted", "deleted_at", "deleted_by"}.isdisjoint(
        LiveC2CRow.__table__.columns.keys()
    )


async def test_import_hard_deletes_only_the_selected_house_rows(db, house):
    other = await make_house(db, code="H777", name="Other", email="o2@example.com")
    user = await _user_with_permissions(
        db, house, ("reports.view", "live_c2c.import")
    )
    employee, retailer = await _source_entities(db, house)
    other_employee, other_retailer = await _source_entities(db, other, suffix="7")
    db.add_all(
        [
            LiveC2CRow(
                house_id=house.id,
                from_msisdn=employee.id,
                to_msisdn=retailer.id,
                modified_on=None,
                transfer_mrp=10,
                on_route="N",
                source_filename="old.xlsx",
                source_sheet="Old",
                created_by=user.id,
            ),
            LiveC2CRow(
                house_id=other.id,
                from_msisdn=other_employee.id,
                to_msisdn=other_retailer.id,
                modified_on=None,
                transfer_mrp=12,
                on_route="N",
                source_filename="other.xlsx",
                source_sheet="Old",
                created_by=user.id,
            ),
        ]
    )
    await db.commit()
    workbook = _workbook_bytes(
        headers=["From Msisdn", "To Msisdn", "Modified ON", "Transfer Mrp"],
        rows=[[employee.itop_number, retailer.itop_number, "2026-11-17 10:30", "25.50"]],
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
        listing = await client.get(
            "/api/reports/live-c2c", headers={"X-House-ID": str(house.id)}
        )

    assert response.status_code == 200
    saved = (await db.execute(select(LiveC2CRow).order_by(LiveC2CRow.id))).scalars().all()
    assert [(row.house_id, row.source_filename) for row in saved] == [
        (other.id, "other.xlsx"),
        (house.id, "live-c2c.xlsx"),
    ]
    assert listing.json()["pagination"]["total"] == 1


def test_copy_columns_cover_every_required_model_column():
    required = {
        column.name
        for column in LiveC2CRow.__table__.columns
        if not column.nullable
        and not column.primary_key
        and column.default is None
        and column.server_default is None
    }
    assert required <= set(live_c2c_service.COPY_COLUMNS)
    assert set(live_c2c_service.COPY_COLUMNS) <= set(
        LiveC2CRow.__table__.columns.keys()
    )


async def test_bulk_insert_writes_every_row(db, house):
    user = await _user_with_permissions(
        db, house, ("reports.view", "live_c2c.import")
    )
    employee, retailer = await _source_entities(db, house)
    rows = [
        {
            "house_id": house.id,
            "from_msisdn": employee.id,
            "to_msisdn": retailer.id,
            "modified_on": None,
            "transfer_mrp": Decimal("1.00"),
            "on_route": "N",
            "source_filename": "bulk.xlsx",
            "source_sheet": "C2C",
            "created_by": user.id,
            "created_at": now_naive(),
        }
        for _ in range(5000)
    ]

    await live_c2c_service._bulk_insert_live_c2c_rows(db, rows)

    assert await db.scalar(select(func.count(LiveC2CRow.id))) == 5000


async def test_same_transfer_twice_is_stored_once(db, house):
    employee, retailer = await _source_entities(db, house)
    row = {
        "_row_number": 3,
        "from_number": employee.itop_number,
        "to_number": retailer.itop_number,
        "modified_on": "2026-11-17 10:30",
        "transfer_mrp": Decimal("1000.00"),
    }
    duplicate = {**row, "_row_number": 4}

    check = await live_c2c_service.prepare_live_c2c_import(
        db, house_id=house.id, rows=[row, duplicate]
    )

    assert check.can_import is True
    assert len(check.rows) == 1
    assert check.summary["duplicate_rows"] == 1
    assert check.duplicate_excel_rows == [4]


async def test_two_real_transfers_are_both_stored(db, house):
    employee, retailer = await _source_entities(db, house)

    check = await live_c2c_service.prepare_live_c2c_import(
        db,
        house_id=house.id,
        rows=[
            {
                "_row_number": 3,
                "from_number": employee.itop_number,
                "to_number": retailer.itop_number,
                "modified_on": "2026-11-17 09:00",
                "transfer_mrp": Decimal("1000.00"),
            },
            {
                "_row_number": 4,
                "from_number": employee.itop_number,
                "to_number": retailer.itop_number,
                "modified_on": "2026-11-17 17:00",
                "transfer_mrp": Decimal("500.00"),
            },
        ],
    )

    assert check.can_import is True
    assert [row["transfer_mrp"] for row in check.rows] == [
        Decimal("1000.00"),
        Decimal("500.00"),
    ]
    assert check.summary["duplicate_rows"] == 0


async def test_dedupe_uses_resolved_entities_not_raw_text(db, house):
    employee, retailer = await _source_entities(db, house)

    check = await live_c2c_service.prepare_live_c2c_import(
        db,
        house_id=house.id,
        rows=[
            {
                "_row_number": 3,
                "from_number": employee.itop_number,
                "to_number": retailer.itop_number,
                "modified_on": "2026-11-17 10:30",
                "transfer_mrp": Decimal("1000.00"),
            },
            {
                "_row_number": 4,
                "from_number": employee.itop_number.lstrip("0"),
                "to_number": retailer.itop_number,
                "modified_on": "2026-11-17 10:30",
                "transfer_mrp": Decimal("1000.00"),
            },
        ],
    )

    assert len(check.rows) == 1
    assert check.summary["duplicate_rows"] == 1


async def test_import_response_reports_skipped_duplicates(db, house):
    user = await _user_with_permissions(
        db, house, ("reports.view", "live_c2c.import")
    )
    employee, retailer = await _source_entities(db, house)
    workbook = _workbook_bytes(
        headers=["From Msisdn", "To Msisdn", "Modified ON", "Transfer Mrp"],
        rows=[
            [employee.itop_number, retailer.itop_number, "2026-11-17 10:30", "1000"],
            [employee.itop_number, retailer.itop_number, "2026-11-17 10:30", "1000"],
        ],
    )
    async with _client(db, user) as client:
        response = await client.post(
            "/api/reports/live-c2c/import",
            headers={"X-House-ID": str(house.id)},
            data={"sheet_name": "C2C Data"},
            files={"file": ("live-c2c.xlsx", workbook)},
        )

    assert response.status_code == 200
    assert response.json()["data"]["imported_rows"] == 1
    assert response.json()["data"]["duplicate_rows"] == 1
    assert await db.scalar(select(func.count(LiveC2CRow.id))) == 1
    activity = (
        await db.execute(select(ActivityLog).where(ActivityLog.module == "live_c2c"))
    ).scalar_one()
    assert activity.new_values["duplicate_rows"] == 1


async def test_preview_rejects_workbook_without_rows_for_selected_house(db, house):
    other_house = House(code="C2C-OTHER", name="Other House", email="other@example.com")
    db.add(other_house)
    await db.flush()
    user = await _user_with_permissions(
        db,
        house,
        ("reports.view", "live_c2c.import"),
    )
    employee, retailer = await _source_entities(db, house)
    workbook = _workbook_bytes(
        headers=["From Msisdn", "To Msisdn", "Modified ON", "Transfer Mrp", "House Code"],
        rows=[
            [
                employee.itop_number,
                retailer.itop_number,
                "2026-11-17 10:30",
                "1000",
                other_house.code,
            ]
        ],
    )
    async with _client(db, user) as client:
        response = await client.post(
            "/api/reports/live-c2c/preview",
            headers={"X-House-ID": str(house.id)},
            data={"sheet_name": "C2C Data"},
            files={"file": ("live-c2c.xlsx", workbook)},
        )

    assert response.status_code == 400
    assert response.json()["detail"]["error_code"] == "live_c2c_empty_sheet"


async def test_preview_rejects_workbook_without_rows_matching_house_name(db, house):
    user = await _user_with_permissions(
        db,
        house,
        ("reports.view", "live_c2c.import"),
    )
    employee, retailer = await _source_entities(db, house)
    workbook = _workbook_bytes(
        headers=["From Msisdn", "To Msisdn", "Modified ON", "Transfer Mrp", "House Name"],
        rows=[
            [
                employee.itop_number,
                retailer.itop_number,
                "2026-11-17 10:30",
                "1000",
                "Wrong House Name",
            ]
        ],
    )
    async with _client(db, user) as client:
        response = await client.post(
            "/api/reports/live-c2c/preview",
            headers={"X-House-ID": str(house.id)},
            data={"sheet_name": "C2C Data"},
            files={"file": ("live-c2c.xlsx", workbook)},
        )

    assert response.status_code == 400
    assert response.json()["detail"]["error_code"] == "live_c2c_empty_sheet"


async def test_preview_accepts_workbook_with_matching_house_code(db, house):
    user = await _user_with_permissions(
        db,
        house,
        ("reports.view", "live_c2c.import"),
    )
    employee, retailer = await _source_entities(db, house)
    workbook = _workbook_bytes(
        headers=["From Msisdn", "To Msisdn", "Modified ON", "Transfer Mrp", "House Code"],
        rows=[
            [
                employee.itop_number,
                retailer.itop_number,
                "2026-11-17 10:30",
                "1000",
                house.code,
            ]
        ],
    )
    async with _client(db, user) as client:
        response = await client.post(
            "/api/reports/live-c2c/preview",
            headers={"X-House-ID": str(house.id)},
            data={"sheet_name": "C2C Data"},
            files={"file": ("live-c2c.xlsx", workbook)},
        )

    assert response.status_code == 200
    assert response.json()["data"]["can_import"] is True


async def test_preview_filters_rows_using_house_name_case_insensitively(db, house):
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
    workbook = _workbook_bytes(
        headers=[
            "From Msisdn",
            "To Msisdn",
            "Modified ON",
            "Transfer Mrp",
            "House Name",
        ],
        rows=[
            [
                employee.itop_number,
                retailer.itop_number,
                "2026-11-17 10:30",
                "1000",
                f" {house.name.upper()} ",
            ],
            [
                other_employee.itop_number,
                other_retailer.itop_number,
                "2026-11-17 10:45",
                "1500",
                other_house.name,
            ],
        ],
    )
    async with _client(db, user) as client:
        response = await client.post(
            "/api/reports/live-c2c/preview",
            headers={"X-House-ID": str(house.id)},
            data={"sheet_name": "C2C Data"},
            files={"file": ("live-c2c.xlsx", workbook)},
        )

    assert response.status_code == 200
    preview = response.json()["data"]
    assert preview["can_import"] is True
    assert preview["summary"]["total_rows"] == 1


async def test_preview_rejects_data_row_without_house_identifier(db, house):
    user = await _user_with_permissions(
        db,
        house,
        ("reports.view", "live_c2c.import"),
    )
    employee, retailer = await _source_entities(db, house)
    workbook = _workbook_bytes(
        headers=[
            "From Msisdn",
            "To Msisdn",
            "Modified ON",
            "Transfer Mrp",
            "House Code",
        ],
        rows=[
            [
                employee.itop_number,
                retailer.itop_number,
                "2026-11-17 10:30",
                "1000",
                "",
            ]
        ],
    )
    async with _client(db, user) as client:
        response = await client.post(
            "/api/reports/live-c2c/preview",
            headers={"X-House-ID": str(house.id)},
            data={"sheet_name": "C2C Data"},
            files={"file": ("live-c2c.xlsx", workbook)},
        )

    assert response.status_code == 400
    assert response.json()["detail"]["error_code"] == "live_c2c_house_missing"


async def test_import_rejects_workbook_without_rows_for_selected_house(db, house):
    user = await _user_with_permissions(
        db,
        house,
        ("reports.view", "live_c2c.import"),
    )
    employee, retailer = await _source_entities(db, house)
    workbook = _workbook_bytes(
        headers=["From Msisdn", "To Msisdn", "Modified ON", "Transfer Mrp", "House Code"],
        rows=[
            [
                employee.itop_number,
                retailer.itop_number,
                "2026-11-17 10:30",
                "1000",
                "WRONG-CODE",
            ]
        ],
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
    assert await db.scalar(select(func.count(LiveC2CRow.id))) == 0
