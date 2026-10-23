"""Active SSO: the Achieved / 0 Activation / 1 Activation columns run per-column rules.

The "RSO Target vs Achievement · Retailer Count" table lets a rule be scoped to
one metric column (``achieved`` for the Achieved column, ``day_0`` / ``day_1``
for the 0/1 Activation buckets). A column-scoped rule must change only its own
column; a section-level rule (``column_key = "all"``) must change every column.
"""
from datetime import date

import pytest

from app.models.activation import Activation
from app.models.employee import Employee
from app.models.retailer import Retailer
from app.models.retailer_marking import RetailerMarking, RetailerMarkingAssignment
from app.models.rule_config import ReportRuleMaster, RuleExcludedProductCode, RuleExcludedRetailerType
from app.services.active_sso_report_service import ActiveSsoReportService

START = date(2026, 10, 1)
END = date(2026, 10, 31)
PRODUCT = "SIM-001"


async def _rso(db, house) -> Employee:
    rso = Employee(
        house_id=house.id,
        employee_name="RSO One",
        dms_code="R001",
        employee_id="RSO-001",
        employee_type="rso",
        status="Active",
        itop_number="1915270001",
    )
    db.add(rso)
    await db.commit()
    await db.refresh(rso)
    return rso


async def _retailer(db, house, rso, code: str) -> Retailer:
    retailer = Retailer(
        house_id=house.id,
        employee_id=rso.id,
        retailer_code=code,
        name=f"Retailer {code}",
        enabled="Yes",
        sim_seller="Yes",
    )
    db.add(retailer)
    await db.commit()
    await db.refresh(retailer)
    return retailer


async def _activations(db, house, retailer, count: int, product_code: str = PRODUCT) -> None:
    for i in range(count):
        db.add(
            Activation(
                house_id=house.id,
                retailer_id=retailer.id,
                retailer_code=retailer.retailer_code,
                activation_date=START,
                product_code=product_code,
                sim_no=f"{retailer.retailer_code}-{product_code}-{i}",
            )
        )
    await db.commit()


async def _add_rule(
    db,
    house,
    column_key: str,
    *,
    product_codes: list[str] | None = None,
    retailer_types: list[str] | None = None,
) -> ReportRuleMaster:
    rule = ReportRuleMaster(
        house_id=house.id,
        context_key="active_sso",
        rule_name=f"RSO rule ({column_key})",
        target_role="RSO",
        apply_to="rso",
        column_key=column_key,
        is_active=True,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    for code in product_codes or []:
        db.add(RuleExcludedProductCode(rule_id=rule.id, product_code=code))
    for name in retailer_types or []:
        db.add(RuleExcludedRetailerType(rule_id=rule.id, retailer_type=name))
    await db.commit()
    return rule


async def _counts(db, house) -> dict:
    dashboard = await ActiveSsoReportService(db, house.id, START, END).build_dashboard()
    (row,) = dashboard["rows"]
    return row


async def _seed(db, house):
    """R-ACH: 2 activations (Achieved); R-ONE: 1; R-ZERO: 0."""
    rso = await _rso(db, house)
    achieved = await _retailer(db, house, rso, "R-ACH")
    one = await _retailer(db, house, rso, "R-ONE")
    zero = await _retailer(db, house, rso, "R-ZERO")
    await _activations(db, house, achieved, 2)
    await _activations(db, house, one, 1)
    return zero


async def test_baseline_counts_without_rules(db, house):
    await _seed(db, house)
    row = await _counts(db, house)
    assert row["retailer_count"] == 3
    assert row["achieved"] == 1
    assert row["retailer_counts"]["day_0"] == 1
    assert row["retailer_counts"]["day_1"] == 1


async def test_achieved_column_rule_leaves_buckets_untouched(db, house):
    await _seed(db, house)
    await _add_rule(db, house, "achieved", product_codes=[PRODUCT])
    row = await _counts(db, house)
    assert row["achieved"] == 0
    assert row["retailer_counts"]["day_0"] == 1
    assert row["retailer_counts"]["day_1"] == 1


async def test_zero_activation_column_rule_leaves_other_columns_untouched(db, house):
    zero = await _seed(db, house)
    marking = RetailerMarking(name="BSP", code="BSP")
    db.add(marking)
    await db.commit()
    await db.refresh(marking)
    db.add(RetailerMarkingAssignment(retailer_id=zero.id, marking_id=marking.id, status="active"))
    await db.commit()

    await _add_rule(db, house, "day_0", retailer_types=["BSP"])
    row = await _counts(db, house)
    assert row["retailer_counts"]["day_0"] == 0
    assert row["achieved"] == 1
    assert row["retailer_counts"]["day_1"] == 1


async def test_one_activation_column_rule_counts_the_excluded_product_as_zero(db, house):
    await _seed(db, house)
    await _add_rule(db, house, "day_1", product_codes=[PRODUCT])
    row = await _counts(db, house)
    assert row["retailer_counts"]["day_1"] == 0
    assert row["retailer_counts"]["day_0"] == 1
    assert row["achieved"] == 1


def test_api_accepts_only_the_table_s_column_scopes():
    from fastapi import HTTPException

    from app.routers.rule_config import _normalize_column_key

    assert _normalize_column_key("day_0", "active_sso", "rso") == "day_0"
    assert _normalize_column_key("day_1,achieved", "active_sso", "rso") == "achieved,day_1"
    # Only the three columns this table exposes can be rule-scoped.
    with pytest.raises(HTTPException):
        _normalize_column_key("day_2", "active_sso", "rso")


async def test_section_rule_applies_to_every_column(db, house):
    await _seed(db, house)
    await _add_rule(db, house, "all", product_codes=[PRODUCT])
    row = await _counts(db, house)
    assert row["achieved"] == 0
    # Every retailer's product-code activations are excluded, so all three
    # (including the previously achieved one) land in the 0 Activation bucket.
    assert row["retailer_counts"]["day_0"] == 3
    assert row["retailer_counts"]["day_1"] == 0
