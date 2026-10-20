"""Active LSO: the 0-6 Day buckets count real C2S transaction days.

Some DMS imports emit a C2S row for every retailer even on days the retailer
did not transact, with ``daily_value = 0``. Those rows are not sales days: a
retailer with seven zero rows and two real sale days must land in the "2 Day"
bucket, not in "Days No Sales" (or, worse, cross the active-day threshold).

This is a regression test for the report's day buckets, achieved count and
grand total — all of which read the same distinct-day map.
"""
from datetime import date, timedelta

from app.models.employee import Employee
from app.models.itopup_detail import ITopUpDetail
from app.models.retailer import Retailer
from app.services.active_lso_report_service import ActiveLsoReportService

START = date(2026, 10, 1)
END = date(2026, 10, 31)


async def _retailer(db, house, rso, code: str) -> Retailer:
    retailer = Retailer(
        house_id=house.id,
        employee_id=rso.id,
        retailer_code=code,
        name=f"Retailer {code}",
        enabled="Yes",
    )
    db.add(retailer)
    await db.commit()
    await db.refresh(retailer)
    return retailer


async def _c2s_days(db, house, retailer, values: list[float]) -> None:
    """One C2S row per consecutive day, in the given amount order."""
    for offset, value in enumerate(values):
        db.add(
            ITopUpDetail(
                house_id=house.id,
                retailer_id=retailer.id,
                report_type="C2S",
                report_date=START + timedelta(days=offset),
                daily_value=value,
            )
        )
    await db.commit()


async def test_zero_value_rows_are_not_sales_days(db, house):
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

    active = await _retailer(db, house, rso, "R-ACTIVE")
    mixed = await _retailer(db, house, rso, "R-MIXED")
    one_day = await _retailer(db, house, rso, "R-ONE")
    no_sales = await _retailer(db, house, rso, "R-NONE")
    low_amount = await _retailer(db, house, rso, "R-LOW")

    # 7 real sale days and enough amount -> active (not in any bucket).
    await _c2s_days(db, house, active, [100] * 7)
    # 7 zero rows + 2 real sale days -> "2 Day", not "Days No Sales".
    await _c2s_days(db, house, mixed, [0, 0, 0, 0, 0, 0, 0, 100, 100])
    # One sale day with enough amount but too few days -> "1 Day".
    await _c2s_days(db, house, one_day, [600])
    # No C2S rows at all -> "0 Day".
    await _c2s_days(db, house, no_sales, [])
    # Enough days but below the amount threshold -> "Days No Sales".
    await _c2s_days(db, house, low_amount, [50] * 7)

    dashboard = await ActiveLsoReportService(db, house.id, START, END).build_dashboard()
    (row,) = dashboard["rows"]
    counts = row["retailer_counts"]

    assert row["retailer_count"] == 5
    assert row["achieved"] == 1
    assert counts["day_0"] == 1
    assert counts["day_1"] == 1
    assert counts["day_2"] == 1
    assert counts["day_3"] == 0
    assert counts["day_6"] == 0
    assert counts["days_no_sales"] == 1
    # Every retailer is either active or in exactly one bucket
    # (inactive_last_month/reactivated are independent flags, not buckets).
    bucket_keys = [k for k in dashboard["count_keys"]
                   if k.startswith("day_") or k == "days_no_sales"]
    assert row["achieved"] + sum(counts[k] for k in bucket_keys) == 5
