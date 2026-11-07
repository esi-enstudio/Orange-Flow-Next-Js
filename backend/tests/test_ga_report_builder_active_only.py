"""GA report builder: only active RSO/BP employees and enabled retailers are reported.

Covers the report rows themselves and the entity pickers that feed the builder.
"""

from sqlalchemy import update

from app.models.employee import Employee
from app.models.ga_report_event import GaReportEvent  # noqa: F401  (FK target)
from app.models.ga_report_target import GaReportTarget  # noqa: F401  (FK target)
from app.models.house import House
from app.models.retailer import Retailer
from app.services.ga_report_builder_service import GaReportBuilderService, ReportConfig


async def _house(db, code="GA-H1"):
    house = House(code=code, name=f"House {code}", email=f"{code.lower()}@example.com")
    db.add(house)
    await db.commit()
    await db.refresh(house)
    return house


def _employee(house, dms, employee_type, status, name=None):
    return Employee(
        house_id=house.id,
        dms_code=dms,
        employee_name=name or dms,
        employee_type=employee_type,
        status=status,
        employee_id=dms,
    )


async def _build_employee_report(db, house, entity_type):
    service = GaReportBuilderService(
        db,
        ReportConfig(
            {
                "house_id": house.id,
                "target_type": entity_type,
                "columns": ["rso_name"] if entity_type == "rso" else ["bp_name"],
                "slabs": 1,
            }
        ),
    )
    return await service.build_report()


async def test_rso_report_only_contains_active_rso_employees(db):
    house = await _house(db)
    db.add_all(
        [
            _employee(house, "RSO-ACTIVE", "rso", "Active", "Active RSO"),
            # Case-insensitive matching: uppercase type / lowercase status still count.
            _employee(house, "RSO-UPPER", "RSO", "active", "Uppercase RSO"),
            # A blank or missing status is unknown, not active — never report it.
            _employee(house, "RSO-NO-STATUS", "rso", None, "No Status RSO"),
            _employee(house, "RSO-BLANK", "rso", "   ", "Blank Status RSO"),
            _employee(house, "RSO-RESIGNED", "rso", "Resigned", "Resigned RSO"),
            _employee(house, "RSO-INACTIVE", "rso", "Inactive", "Inactive RSO"),
            _employee(house, "BP-ACTIVE", "bp", "Active", "Active BP"),
        ]
    )
    await db.commit()
    # The model default fills a status on insert; force a real NULL to prove it is excluded.
    await db.execute(update(Employee).where(Employee.dms_code == "RSO-NO-STATUS").values(status=None))
    await db.commit()

    report = await _build_employee_report(db, house, "rso")
    names = {row["rso_name"] for row in report["rows"]}

    assert names == {"Active RSO", "Uppercase RSO"}


async def test_bp_report_only_contains_active_bp_employees(db):
    house = await _house(db, "GA-H2")
    db.add_all(
        [
            _employee(house, "BP-ACTIVE", "bp", "Active", "Active BP"),
            _employee(house, "BP-UPPER", "BP", "active", "Uppercase BP"),
            _employee(house, "BP-NO-STATUS", "bp", None, "No Status BP"),
            _employee(house, "BP-SUSPENDED", "bp", "Suspended", "Suspended BP"),
            _employee(house, "RSO-ACTIVE", "rso", "Active", "Active RSO"),
        ]
    )
    await db.commit()
    await db.execute(update(Employee).where(Employee.dms_code == "BP-NO-STATUS").values(status=None))
    await db.commit()

    report = await _build_employee_report(db, house, "bp")
    names = {row["bp_name"] for row in report["rows"]}

    assert names == {"Active BP", "Uppercase BP"}


async def test_retailer_report_only_contains_enabled_retailers(db):
    house = await _house(db, "GA-H3")
    db.add_all(
        [
            Retailer(house_id=house.id, retailer_code="RET-YES", name="Enabled", enabled="Yes"),
            Retailer(house_id=house.id, retailer_code="RET-NO", name="Disabled", enabled="No"),
            Retailer(house_id=house.id, retailer_code="RET-NULL", name="Unknown", enabled=None),
        ]
    )
    await db.commit()

    service = GaReportBuilderService(
        db,
        ReportConfig(
            {
                "house_id": house.id,
                "target_type": "retailer",
                "columns": ["retailer_code"],
                "slabs": 1,
            }
        ),
    )
    report = await service.build_report()

    assert [row["retailer_code"] for row in report["rows"]] == ["RET-YES"]


async def test_report_follows_current_staff_after_an_rso_is_replaced(db):
    """An RSO resigns and a new one joins: the report keeps every active RSO
    (old and new) and drops the resigned one automatically."""
    house = await _house(db, "GA-H5")
    veteran = _employee(house, "RSO-VETERAN", "rso", "Active", "Veteran RSO")
    resigned = _employee(house, "RSO-OLD", "rso", "Resigned", "Resigned RSO")
    newcomer = _employee(house, "RSO-NEW", "rso", "Active", "New RSO")
    db.add_all([veteran, resigned, newcomer])
    await db.commit()

    report = await _build_employee_report(db, house, "rso")
    assert {row["rso_name"] for row in report["rows"]} == {"Veteran RSO", "New RSO"}

    # A saved selection that still contains the resigned RSO reports only the
    # employees who are active today.
    service = GaReportBuilderService(
        db,
        ReportConfig(
            {
                "house_id": house.id,
                "target_type": "rso",
                "columns": ["rso_name"],
                "slabs": 1,
                "rso_ids": [veteran.id, resigned.id],
            }
        ),
    )
    selected_report = await service.build_report()
    assert {row["rso_name"] for row in selected_report["rows"]} == {"Veteran RSO"}


async def test_resigned_employee_drops_out_after_a_status_update(db):
    house = await _house(db, "GA-H6")
    emp = _employee(house, "RSO-TOGGLE", "rso", "Active", "Toggle RSO")
    db.add(emp)
    await db.commit()

    before = await _build_employee_report(db, house, "rso")
    assert {row["rso_name"] for row in before["rows"]} == {"Toggle RSO"}

    emp.status = "Resigned"
    await db.commit()

    after = await _build_employee_report(db, house, "rso")
    assert after["rows"] == []


async def test_entity_pickers_only_offer_active_employees_and_enabled_retailers(db):
    house = await _house(db, "GA-H4")
    db.add_all(
        [
            _employee(house, "RSO-ACTIVE", "rso", "Active", "Active RSO"),
            _employee(house, "RSO-UPPER", "RSO", "active", "Uppercase RSO"),
            _employee(house, "RSO-NO-STATUS", "rso", None, "No Status RSO"),
            _employee(house, "RSO-RESIGNED", "rso", "Resigned", "Resigned RSO"),
            Retailer(house_id=house.id, retailer_code="RET-YES", name="Enabled", enabled="Yes"),
            Retailer(house_id=house.id, retailer_code="RET-NO", name="Disabled", enabled="No"),
        ]
    )
    await db.commit()
    await db.execute(update(Employee).where(Employee.dms_code == "RSO-NO-STATUS").values(status=None))
    await db.commit()

    service = GaReportBuilderService(db, ReportConfig({"house_id": house.id}))

    rso_codes = {row["code"] for row in await service.get_entities("rso", None)}
    assert rso_codes == {"RSO-ACTIVE", "RSO-UPPER"}

    retailer_codes = {row["code"] for row in await service.get_entities("retailer", None)}
    assert retailer_codes == {"RET-YES"}
