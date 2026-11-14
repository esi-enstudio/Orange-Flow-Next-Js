"""SIM Issue report: coverage math, pending retailers and tenant scoping.

The report measures issued vs pending against the *eligible* retailer base
(enabled = Yes and sim_seller = Yes). A retailer that issued but is not in that
base must never turn pending negative, and another house's rows must never leak
into the totals.
"""
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.models.employee import Employee
from app.models.house import House
from app.models.retailer import Retailer
from app.models.sim_issue import SimIssue
from app.models.supervisor_assignment import SupervisorRSOAssignment
from app.routers.deps import get_current_user, get_db
from app.routers.sim_issue_report import router
from app.services import sim_issue_report_service as svc

START = date(2026, 11, 1)
END = date(2026, 11, 30)


def test_coverage_pct_rounds_and_handles_empty_base():
    assert svc.coverage_pct(1, 2) == 50.0
    assert svc.coverage_pct(2, 3) == 66.7
    assert svc.coverage_pct(0, 0) == 0.0


@pytest.fixture
async def data(db):
    house = House(code="SIM-R1", name="SIM Report House", email="simr1@example.com")
    other_house = House(code="SIM-R2", name="Other SIM House", email="simr2@example.com")
    db.add_all([house, other_house])
    await db.flush()

    sup = Employee(
        house_id=house.id, employee_type="supervisor", status="Active",
        dms_code="SUP-1", employee_name="Supervisor One", employee_id="SUP-1",
    )
    rso = Employee(
        house_id=house.id, employee_type="rso", status="Active",
        dms_code="RSO-1", employee_name="RSO One", employee_id="RSO-1",
    )
    bp = Employee(
        house_id=house.id, employee_type="bp", status="Active",
        dms_code="BP-1", employee_name="BP One", employee_id="BP-1",
    )
    db.add_all([sup, rso, bp])
    await db.flush()

    db.add_all([
        SupervisorRSOAssignment(
            supervisor_employee_id=sup.id, member_employee_id=rso.id, house_id=house.id
        ),
        SupervisorRSOAssignment(
            supervisor_employee_id=sup.id, member_employee_id=bp.id, house_id=house.id
        ),
    ])

    retailers = [
        # eligible, issued
        Retailer(
            house_id=house.id, employee_id=rso.id, retailer_code="R-RSO-1",
            name="RSO Retailer One", enabled="Yes", sim_seller="Yes",
        ),
        # eligible, pending
        Retailer(
            house_id=house.id, employee_id=rso.id, retailer_code="R-RSO-2",
            name="RSO Retailer Two", enabled="Yes", sim_seller="Yes",
        ),
        # not a SIM seller -> outside the eligible base, still a real SIM row
        Retailer(
            house_id=house.id, employee_id=rso.id, retailer_code="R-RSO-3",
            name="RSO Retailer Three", enabled="Yes", sim_seller="No",
        ),
        # BP eligible, issued
        Retailer(
            house_id=house.id, employee_id=bp.id, retailer_code="R-BP-1",
            name="BP Retailer One", enabled="Yes", sim_seller="Yes",
        ),
        # another house must never appear
        Retailer(
            house_id=other_house.id, retailer_code="R-OTHER-1",
            name="Other House Retailer", enabled="Yes", sim_seller="Yes",
        ),
    ]
    db.add_all(retailers)
    await db.flush()

    sims = [
        SimIssue(house_id=house.id, issue_date=date(2026, 11, 3), retailer_code="R-RSO-1",
                 retailer_name="RSO Retailer One", sim_no="SIM-1", product_code="P1"),
        SimIssue(house_id=house.id, issue_date=date(2026, 11, 3), retailer_code="R-RSO-1",
                 retailer_name="RSO Retailer One", sim_no="SIM-2", product_code="P1"),
        SimIssue(house_id=house.id, issue_date=date(2026, 11, 4), retailer_code="R-RSO-3",
                 retailer_name="RSO Retailer Three", sim_no="SIM-3", product_code="P2"),
        SimIssue(house_id=house.id, issue_date=date(2026, 11, 4), retailer_code="R-BP-1",
                 retailer_name="BP Retailer One", sim_no="SIM-4", product_code="P1"),
        # retailer missing from the master -> Unassigned, never pending
        SimIssue(house_id=house.id, issue_date=date(2026, 11, 4), retailer_code="R-UNKNOWN",
                 retailer_name="Unknown Retailer", sim_no="SIM-5", product_code="P1"),
        # another house's row
        SimIssue(house_id=other_house.id, issue_date=date(2026, 11, 3),
                 retailer_code="R-OTHER-1", retailer_name="Other House Retailer",
                 sim_no="SIM-X", product_code="P1"),
    ]
    db.add_all(sims)
    await db.commit()
    return {
        "house": house, "other_house": other_house,
        "sup": sup, "rso": rso, "bp": bp, "db": db,
    }


async def _summary(db, house_id, start=START, end=END, **kwargs):
    return await svc.get_summary(db, house_id, start, end, **kwargs)


def _row(summary, name):
    return next(r for r in summary["rows"] if r["name"] == name or (
        name == "unassigned" and r["employee_type"] == "unassigned"
    ))


async def test_summary_counts_only_eligible_retailers(data, db):
    summary = await _summary(db, data["house"].id)

    rso_row = _row(summary, "RSO One")
    assert rso_row["retailers_total"] == 2
    assert rso_row["retailers_issued"] == 1
    assert rso_row["retailers_pending"] == 1
    assert rso_row["coverage_pct"] == 50.0
    # All raw SIMs are counted, including the non-seller retailer.
    assert rso_row["sims"] == 3
    assert rso_row["supervisor_name"] == "Supervisor One"

    bp_row = _row(summary, "BP One")
    assert bp_row["employee_type"] == "bp"
    assert bp_row["retailers_total"] == 1
    assert bp_row["retailers_issued"] == 1
    assert bp_row["retailers_pending"] == 0
    assert bp_row["coverage_pct"] == 100.0


async def test_summary_totals_and_unassigned(data, db):
    summary = await _summary(db, data["house"].id)
    totals = summary["totals"]

    assert totals["sims"] == 5
    assert totals["retailers_total"] == 3
    assert totals["retailers_issued"] == 2
    assert totals["retailers_pending"] == 1
    assert totals["coverage_pct"] == 66.7
    assert totals["employees"] == 2

    unassigned = _row(summary, "unassigned")
    assert unassigned["sims"] == 1
    assert unassigned["retailers_total"] == 0
    assert unassigned["retailers_pending"] == 0

    daily = {d["date"]: d for d in summary["daily_totals"]}
    assert daily["2026-11-03"]["sims"] == 2
    assert daily["2026-11-03"]["retailers"] == 1
    assert daily["2026-11-04"]["sims"] == 3
    assert daily["2026-11-04"]["retailers"] == 1


async def test_date_filter_does_not_repend_issued_retailers(data, db):
    summary = await _summary(
        db, data["house"].id, start=date(2026, 11, 4), end=date(2026, 11, 4)
    )
    rso_row = _row(summary, "RSO One")
    assert rso_row["retailers_issued"] == 0
    assert rso_row["retailers_pending"] == 2
    assert rso_row["coverage_pct"] == 0.0
    assert rso_row["daily"][0]["date"] == "2026-11-04"


async def test_pending_retailer_list_is_the_eligible_base(data, db):
    result = await svc.get_retailers(
        db, data["house"].id, START, END, status="pending"
    )
    codes = [r["retailer_code"] for r in result["rows"]]
    assert codes == ["R-RSO-2"]
    assert result["rows"][0]["status"] == "pending"
    assert result["rows"][0]["employee_name"] == "RSO One"
    assert result["pending"] == 1
    assert result["issued"] == 2


async def test_details_are_house_and_retailer_scoped(data, db):
    result = await svc.get_details(
        db, data["house"].id, START, END, retailer_code="R-RSO-1"
    )
    assert result["total"] == 2
    assert {r["sim_no"] for r in result["rows"]} == {"SIM-1", "SIM-2"}

    other = await svc.get_summary(db, data["other_house"].id, START, END)
    assert other["totals"]["sims"] == 1
    assert other["totals"]["retailers_total"] == 1


async def test_filter_options_are_house_scoped(data, db):
    options = await svc.get_filter_options(db, data["house"].id)

    assert {e["name"] for e in options["employees"]} == {"RSO One", "BP One"}
    assert all(e["supervisor_name"] == "Supervisor One" for e in options["employees"])
    assert {p["code"] for p in options["products"]} == {"P1", "P2"}
    assert options["promotions"] == []


@pytest.fixture
async def api(data, db):
    app = FastAPI()
    app.include_router(router)

    async def _get_db():
        yield db

    user = SimpleNamespace(
        id=1,
        name="Report Tester",
        roles=[SimpleNamespace(name="Admin", permissions=[])],
        houses=[data["house"]],
        employee_profile=None,
    )

    async def _get_user():
        return user

    app.dependency_overrides[get_db] = _get_db
    app.dependency_overrides[get_current_user] = _get_user
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


async def test_api_rejects_another_house(api, data):
    response = await api.get(
        "/api/sim-issues/report/summary",
        params={"house_id": data["other_house"].id},
    )
    assert response.status_code == 403


async def test_api_filters_payload(api, data):
    response = await api.get(
        "/api/sim-issues/report/filters",
        params={"house_id": data["house"].id},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["defaults"]["house_id"] == data["house"].id
    assert {e["name"] for e in body["employees"]} == {"RSO One", "BP One"}


async def test_api_summary_and_export(api, data):
    response = await api.get(
        "/api/sim-issues/report/summary",
        params={"house_id": data["house"].id, "start_date": "2026-11-01", "end_date": "2026-11-30"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["totals"]["coverage_pct"] == 66.7

    pytest.importorskip("openpyxl")
    exported = await api.get(
        "/api/sim-issues/report/export",
        params={
            "view": "retailers",
            "status": "pending",
            "house_id": data["house"].id,
            "start_date": "2026-11-01",
            "end_date": "2026-11-30",
        },
    )
    assert exported.status_code == 200
    assert exported.content[:2] == b"PK"
