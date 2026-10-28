"""Active SSO: the Projection column reconciles with the displayed D.Avg.

The page, the WhatsApp image and every totals row show D.Avg as a whole number.
Projection is therefore derived from that same rounded value
(``D.Avg x period days``) — e.g. D.Avg 5 over a 31-day month is 155, never the
152 a 4.9 daily average would produce.
"""
from datetime import date

import pytest

from app.models.employee import Employee
from app.services.active_sso_report_service import (
    ActiveSsoReportService,
    rounded_daily_avg,
)

START = date(2026, 10, 1)
END = date(2026, 10, 31)


def _service() -> ActiveSsoReportService:
    svc = ActiveSsoReportService(None, 1, START, END)  # no DB access in these units
    svc.total_days = 31
    svc.days_elapsed = 22
    svc.days_remaining = 9
    return svc


def _counts(svc: ActiveSsoReportService, active: int) -> dict:
    counts = {key: 0 for key in svc.count_keys}
    counts["active"] = active
    counts["retailer_count"] = 50
    return counts


def _row(svc: ActiveSsoReportService, achieved: int) -> dict:
    emp = Employee(id=1, employee_name="RSO One", dms_code="R001")
    return svc._make_row(emp, {}, {}, {}, {1: 100}, _counts(svc, achieved))


def test_rounded_daily_avg_mirrors_javascript_math_round():
    # The page rounds with Math.round (half-up), not Python's banker's round.
    assert rounded_daily_avg(7.6) == 8
    assert rounded_daily_avg(8.4) == 8
    assert rounded_daily_avg(2.5) == 3
    assert rounded_daily_avg(0.4) == 0


def test_row_projection_equals_rounded_daily_avg_times_period_days():
    svc = _service()
    row = _row(svc, achieved=37)  # 37 / 22 = 1.68 -> displayed D.Avg 2
    assert row["daily_avg"] == pytest.approx(37 / 22)
    assert row["projection"] == 2 * 31 == 62.0


def test_whole_daily_avg_projects_exactly():
    # The reported case: D.Avg 5 over 31 days must be 155.
    svc = _service()
    row = _row(svc, achieved=110)  # 110 / 22 = 5.0
    assert row["daily_avg"] == pytest.approx(5.0)
    assert row["projection"] == 5 * 31 == 155.0


def test_daily_avg_is_rounded_once_not_twice():
    # Regression: rounding to one decimal first turned 64 / 26 = 2.46 into 2.5,
    # and the second round then printed D.Avg 3 instead of 2.
    svc = _service()
    svc.days_elapsed = 26
    row = _row(svc, achieved=64)
    assert rounded_daily_avg(row["daily_avg"]) == 2
    assert row["projection"] == 2 * 31 == 62.0


def test_aggregate_projection_equals_rounded_daily_avg_times_period_days():
    svc = _service()
    aggregate = svc._aggregate([_row(svc, achieved=37)])
    assert aggregate["daily_avg"] == 2.0
    assert aggregate["projection"] == 2 * 31 == 62.0


def test_aggregate_daily_avg_is_the_sum_of_the_displayed_column():
    # The grand total must equal the column the reader adds up: each RSO gets
    # 12 / 26 = 0.46, printed as D.Avg 0, so the total row is 0 as well.
    svc = _service()
    svc.days_elapsed = 26
    rows = [_row(svc, achieved=12) for _ in range(10)]  # 4.61/day over the house
    assert sum(rounded_daily_avg(row["daily_avg"]) for row in rows) == 0
    aggregate = svc._aggregate(rows)
    assert aggregate["achieved"] == 120
    assert aggregate["daily_avg"] == 0.0
    assert aggregate["projection"] == 0.0


def test_aggregate_drr_is_the_sum_of_the_displayed_column():
    svc = _service()
    # 100 / 9 = 11.1 -> each row prints DRR 11
    rows = [_row(svc, achieved=0) for _ in range(3)]
    assert {row["drr"] for row in rows} == {11}
    assert svc._aggregate(rows)["drr"] == 33


def test_aggregate_projection_never_drifts_from_printed_daily_avg():
    svc = _service()
    svc.days_elapsed = 26
    aggregate = svc._aggregate([_row(svc, achieved=128)])  # 4.92 -> prints 5
    assert aggregate["daily_avg"] == 5.0
    assert aggregate["projection"] == 5 * 31 == 155.0


def test_supervisor_summary_uses_the_same_projection_rule():
    svc = _service()
    row = {**_row(svc, achieved=37), "supervisor_id": 7, "supervisor_name": "Supervisor A"}
    (sup,) = svc._supervisor_summary([row])
    assert sup["daily_avg"] == 2.0
    assert sup["projection"] == 2 * 31 == 62.0
