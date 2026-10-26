"""Active LSO daily trend series (chart data).

The chart must never draw an unimported day as a real zero: DMS rows land a
day late, so days after the latest imported date (and future days) carry
``active = None`` instead of 0.
"""
from datetime import date, datetime

import pytest

from app.services import active_lso_report_service

START = date(2026, 10, 1)
END = date(2026, 10, 31)


@pytest.fixture
def svc(monkeypatch):
    frozen = datetime(2026, 10, 26, 12, 0, 0)
    monkeypatch.setattr(active_lso_report_service, "now_naive", lambda: frozen)
    return active_lso_report_service.ActiveLsoReportService(None, 1, START, END)


def test_series_has_one_point_per_day_of_the_period(svc):
    series = svc._trend_series({}, date(2026, 10, 25))
    assert len(series) == 31
    assert series[0]["date"] == "2026-10-01"
    assert series[-1]["date"] == "2026-10-31"


def test_days_with_data_are_zero_filled(svc):
    series = svc._trend_series({"2026-10-01": 933, "2026-10-03": 922}, date(2026, 10, 25))
    by_date = {p["date"]: p["active"] for p in series}
    assert by_date["2026-10-01"] == 933
    assert by_date["2026-10-02"] == 0
    assert by_date["2026-10-03"] == 922


def test_days_after_the_last_imported_day_are_not_drawn_as_zero(svc):
    series = svc._trend_series({"2026-10-25": 907}, date(2026, 10, 25))
    by_date = {p["date"]: p for p in series}
    assert by_date["2026-10-25"]["active"] == 907
    assert by_date["2026-10-25"]["is_future"] is False
    # Import has not reached today yet, so today must not show a fake 0.
    assert by_date["2026-10-26"]["active"] is None
    assert by_date["2026-10-26"]["is_future"] is True
    assert by_date["2026-10-31"]["active"] is None


def test_period_already_over_is_fully_drawn(monkeypatch):
    frozen = datetime(2026, 11, 5, 12, 0, 0)
    monkeypatch.setattr(active_lso_report_service, "now_naive", lambda: frozen)
    svc = active_lso_report_service.ActiveLsoReportService(None, 1, START, END)
    series = svc._trend_series({}, END)
    assert all(p["active"] == 0 for p in series)
    assert all(p["is_future"] is False for p in series)
