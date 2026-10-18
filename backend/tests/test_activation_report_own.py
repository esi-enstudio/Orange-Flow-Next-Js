"""Activation Report service: own (assisted) activation counting.

The GA feed records a person's assisted activations in two shapes and both
must count towards the RSO "Own GA" metrics (yesterday, MTD total, active
days):
  * recorded under the employee's assisted retailer code
    (`employees.assisted_retailer_code`), or
  * assisted-tagged rows — the retailer name carries an assisted marker
    ("Assisted", "Rso Assisted", "Assisted-001-<name>-<dms code>", ...)
    while the row stays linked to the employee
    (`activation.employee_id`, the attribution snapshot at import time).

Imported assisted rows of the second shape were previously missed and the
report showed 0 own activations for those RSOs.
"""
from datetime import date
from unittest.mock import AsyncMock, patch

from sqlalchemy.dialects import postgresql

from app.models.activation import Activation
from app.models.employee import Employee
from app.models.retailer import Retailer
from app.models.supervisor_assignment import SupervisorRSOAssignment
from app.services.activation_report_service import ActivationReportService

REPORT_TODAY = date(2026, 10, 18)
REPORT_YESTERDAY = date(2026, 10, 17)


async def _seed(db, house):
    owner = Employee(
        house_id=house.id, employee_name="Shahadat Islam Efran", dms_code="RS058703",
        employee_type="rso", status="Active", assisted_retailer_code="R591212",
        itop_number="1409944001",
    )
    other = Employee(
        house_id=house.id, employee_name="Other RSO", dms_code="RS059999",
        employee_type="rso", status="Active", assisted_retailer_code=None,
    )
    plain = Employee(
        house_id=house.id, employee_name="Plain RSO", dms_code="RS059998",
        employee_type="rso", status="Active", assisted_retailer_code=None,
    )
    db.add_all([owner, other, plain])
    await db.commit()
    await db.refresh(owner)
    await db.refresh(other)
    await db.refresh(plain)

    assisted_shop = Retailer(house_id=house.id, retailer_code="R591212", name="Monir Telecom", employee_id=owner.id)
    tagged_shop = Retailer(house_id=house.id, retailer_code="R363745", name="Ali", employee_id=owner.id)
    market_shop = Retailer(house_id=house.id, retailer_code="R209376", name="Shefa medical hall", employee_id=owner.id)
    other_shop = Retailer(house_id=house.id, retailer_code="R777777", name="Other shop", employee_id=other.id)
    db.add_all([assisted_shop, tagged_shop, market_shop, other_shop])
    await db.commit()
    for r in (assisted_shop, tagged_shop, market_shop, other_shop):
        await db.refresh(r)

    assisted_tag = "Assisted-001-Efran-RS058703"
    db.add_all([
        # (1) own via the assisted retailer code
        Activation(
            house_id=house.id, retailer_id=assisted_shop.id, employee_id=owner.id,
            activation_date=REPORT_YESTERDAY, retailer_code="R591212",
            retailer_name="Monir Telecom", sim_no="SIM-1",
        ),
        # (2) own via the assisted name tag on a feed row linked to the employee
        Activation(
            house_id=house.id, retailer_id=tagged_shop.id, employee_id=owner.id,
            activation_date=REPORT_YESTERDAY, retailer_code="R363745",
            retailer_name=assisted_tag, sim_no="SIM-2",
        ),
        # (3) same tag on an earlier day: counts for MTD total and active days
        Activation(
            house_id=house.id, retailer_id=tagged_shop.id, employee_id=owner.id,
            activation_date=date(2026, 10, 15), retailer_code="R363745",
            retailer_name=assisted_tag, sim_no="SIM-3",
        ),
        # (4) plain market row at the owner's retailer
        Activation(
            house_id=house.id, retailer_id=market_shop.id, employee_id=owner.id,
            activation_date=REPORT_YESTERDAY, retailer_code="R209376",
            retailer_name="Shefa medical hall", sim_no="SIM-4",
        ),
        # (5) another RSO's assisted row — must stay with that RSO
        Activation(
            house_id=house.id, retailer_id=other_shop.id, employee_id=other.id,
            activation_date=REPORT_YESTERDAY, retailer_code="R777777",
            retailer_name="Assisted", sim_no="SIM-5",
        ),
        # (6) assisted row without an employee link — not attributable
        Activation(
            house_id=house.id, retailer_id=None, employee_id=None,
            activation_date=REPORT_YESTERDAY, retailer_code="R888888",
            retailer_name="Assisted", sim_no="SIM-6",
        ),
    ])
    await db.commit()
    return owner, other, plain


async def _run_service(db, house):
    with patch(
        "app.services.activation_report_service.get_effective_rule_conditions",
        new=AsyncMock(return_value={}),
    ):
        svc = ActivationReportService(db, house_id=house.id, month=10, year=2026)
        # Pin the report day so the assertions are date-independent.
        svc.today = REPORT_TODAY
        return await svc.get_rso_performance()


async def test_rso_own_counts_assisted_code_and_tagged_rows(db, house):
    owner, other, plain = await _seed(db, house)
    rows = {r["id"]: r for r in await _run_service(db, house)}

    owned = rows[owner.id]
    # yesterday: assisted-code row + tagged row
    assert owned["yesterday_activation"] == 2
    # MTD: both shapes across 15 Oct and 17 Oct
    assert owned["month_total_activation"] == 3
    # active days: 15 Oct + 17 Oct
    assert owned["active_days"] == 2
    # Market GA keeps counting every activation at the RSO's retailers.
    assert owned["market_yesterday"] == 3
    assert owned["market_activation"] == 4

    # Another RSO's tagged row counts for that RSO, never for the owner.
    other_row = rows[other.id]
    assert other_row["yesterday_activation"] == 1
    assert other_row["month_total_activation"] == 1
    assert other_row["active_days"] == 1
    assert other_row["market_yesterday"] == 1

    # RSO with neither an assisted code nor tagged rows stays at zero.
    assert rows[plain.id]["yesterday_activation"] == 0
    assert rows[plain.id]["month_total_activation"] == 0
    assert rows[plain.id]["active_days"] == 0


def test_own_clause_covers_both_assisted_shapes():
    pg = postgresql.dialect()
    clause = ActivationReportService._own_assisted_clause(189, "R591212")
    compiled = str(clause.compile(dialect=pg, compile_kwargs={"literal_binds": True}))
    assert "activations.retailer_code IN ('R591212')" in compiled
    assert "activations.employee_id IN (189)" in compiled
    assert "activations.retailer_name ILIKE" in compiled
    assert "%assist%" in compiled

    # Without an assisted code the tagged branch still applies (feed-only RSOs).
    code_less = ActivationReportService._own_assisted_clause(193, None)
    compiled_less = str(code_less.compile(dialect=pg, compile_kwargs={"literal_binds": True}))
    assert "retailer_code" not in compiled_less
    assert "activations.employee_id IN (193)" in compiled_less


def test_team_own_clause_covers_every_member():
    pg = postgresql.dialect()
    clause = ActivationReportService._own_assisted_clause_many(
        [189, 131], ["R591212", None]
    )
    compiled = str(clause.compile(dialect=pg, compile_kwargs={"literal_binds": True}))
    assert "activations.employee_id IN (189, 131)" in compiled
    assert "activations.retailer_code IN ('R591212')" in compiled
    assert "%assist%" in compiled


async def test_supervisor_team_columns_reconcile_with_member_rows(db, house):
    """The supervisor table's Yest Emp / Tot / Yest Mkt / Tot equal the sums of
    the same member metrics shown in the RSO/BP tables below it."""
    owner, other, plain = await _seed(db, house)

    supervisor = Employee(
        house_id=house.id, employee_name="Team Lead", dms_code="RS059000",
        employee_type="supervisor", status="Active", pool_number="01790000001",
    )
    bp = Employee(
        house_id=house.id, employee_name="BP Person", dms_code="BP059000",
        employee_type="bp", status="Active", assisted_retailer_code="R344412",
        itop_number="1409944099",
    )
    db.add_all([supervisor, bp])
    await db.commit()
    await db.refresh(supervisor)
    await db.refresh(bp)

    bp_shop = Retailer(
        house_id=house.id, retailer_code="R344412", name="BP Shop", employee_id=bp.id
    )
    db.add(bp_shop)
    await db.commit()
    await db.refresh(bp_shop)

    db.add_all([
        SupervisorRSOAssignment(
            supervisor_employee_id=supervisor.id, member_employee_id=owner.id,
            house_id=house.id,
        ),
        SupervisorRSOAssignment(
            supervisor_employee_id=supervisor.id, member_employee_id=bp.id,
            house_id=house.id,
        ),
        # BP own rows carry the BP's assisted retailer code (named "BP Shop")
        Activation(
            house_id=house.id, retailer_id=bp_shop.id, employee_id=bp.id,
            activation_date=REPORT_YESTERDAY, retailer_code="R344412",
            retailer_name="BP Shop", sim_no="SIM-BP-1",
        ),
        Activation(
            house_id=house.id, retailer_id=bp_shop.id, employee_id=bp.id,
            activation_date=date(2026, 10, 10), retailer_code="R344412",
            retailer_name="BP Shop", sim_no="SIM-BP-2",
        ),
    ])
    await db.commit()

    with patch(
        "app.services.activation_report_service.get_effective_rule_conditions",
        new=AsyncMock(return_value={}),
    ):
        svc = ActivationReportService(db, house_id=house.id, month=10, year=2026)
        svc.today = REPORT_TODAY
        rso_rows = {r["id"]: r for r in await svc.get_rso_performance()}
        bp_rows = {r["id"]: r for r in await svc.get_bp_performance()}
        sup_rows = {r["id"]: r for r in await svc.get_supervisor_performance()}

    team = sup_rows[supervisor.id]
    assert team["own_yesterday"] == (
        rso_rows[owner.id]["yesterday_activation"]
        + bp_rows[bp.id]["yesterday_activation"]
    ) == 3   # 2 RSO (code + tag) + 1 BP
    assert team["own_month"] == (
        rso_rows[owner.id]["month_total_activation"]
        + bp_rows[bp.id]["month_total_activation"]
    ) == 5   # RSO 3 (2 shapes) + BP 2
    assert team["market_yesterday"] == rso_rows[owner.id]["market_yesterday"] == 3
    assert team["market_month"] == rso_rows[owner.id]["market_activation"] == 4

    # Members owned by no supervisor never leak into the team totals.
    assert team["own_yesterday"] == 3
    assert other.id not in (m["employee_id"] for m in team["team"])
    assert plain.id not in (m["employee_id"] for m in team["team"])
