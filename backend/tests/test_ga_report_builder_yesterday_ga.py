"""GA report builder: every report carries a "Yest GA" column after Remain."""

from datetime import timedelta

from app.models.activation import Activation
from app.models.employee import Employee
from app.models.house import House
from app.models.retailer import Retailer
from app.services.ga_report_builder_service import GaReportBuilderService, ReportConfig
from app.utils.timezone import now_naive

YESTERDAY = now_naive().date() - timedelta(days=1)


async def _house(db, code: str) -> House:
    house = House(code=code, name=f"House {code}", email=f"{code.lower()}@example.com")
    db.add(house)
    await db.commit()
    await db.refresh(house)
    return house


def _activation(house: House, retailer_id: int | None, retailer_code: str, sim_no: str) -> Activation:
    return Activation(
        house_id=house.id,
        retailer_id=retailer_id,
        retailer_code=retailer_code,
        activation_date=YESTERDAY,
        sim_no=sim_no,
    )


def _service(db, house: House, target_type: str, columns: list[str]) -> GaReportBuilderService:
    return GaReportBuilderService(
        db,
        ReportConfig(
            {"house_id": house.id, "target_type": target_type, "columns": columns, "slabs": 1}
        ),
    )


def _assert_yest_ga_after_remain(columns: list[str]) -> None:
    assert columns[columns.index("slab_1_remaining") + 1] == "yesterday_ga"


async def test_retailer_report_has_yesterday_ga_after_remain(db):
    house = await _house(db, "GA-Y1")
    retailer = Retailer(house_id=house.id, retailer_code="RET-Y1", name="Retailer", enabled="Yes")
    db.add(retailer)
    await db.commit()
    db.add(_activation(house, retailer.id, retailer.retailer_code, "SIM-Y1"))
    await db.commit()

    report = await _service(db, house, "retailer", ["retailer_code"]).build_report()

    _assert_yest_ga_after_remain(report["columns"])
    assert report["rows"][0]["yesterday_ga"] == 1
    assert report["totals"]["yesterday_ga"] == 1


async def test_rso_report_has_yesterday_ga_after_remain(db):
    house = await _house(db, "GA-Y2")
    rso = Employee(
        house_id=house.id, dms_code="RSO-Y2", employee_name="RSO", employee_type="rso", status="Active"
    )
    db.add(rso)
    await db.commit()
    retailer = Retailer(
        house_id=house.id, retailer_code="RET-Y2", name="Retailer", enabled="Yes", employee_id=rso.id
    )
    db.add(retailer)
    await db.commit()
    db.add(_activation(house, retailer.id, retailer.retailer_code, "SIM-Y2"))
    await db.commit()

    report = await _service(db, house, "rso", ["rso_name"]).build_report()

    _assert_yest_ga_after_remain(report["columns"])
    assert report["rows"][0]["yesterday_ga"] == 1


async def test_bp_report_has_yesterday_ga_after_remain(db):
    house = await _house(db, "GA-Y3")
    bp = Employee(
        house_id=house.id,
        dms_code="BP-Y3",
        employee_name="BP",
        employee_type="bp",
        status="Active",
        assisted_retailer_code="RET-Y3",
    )
    db.add(bp)
    await db.commit()
    db.add(_activation(house, None, "RET-Y3", "SIM-Y3"))
    await db.commit()

    report = await _service(db, house, "bp", ["bp_name"]).build_report()

    _assert_yest_ga_after_remain(report["columns"])
    assert report["rows"][0]["yesterday_ga"] == 1
