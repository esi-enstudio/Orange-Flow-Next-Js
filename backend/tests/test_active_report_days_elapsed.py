"""Active LSO / Active SSO day accounting.

Two rules are pinned here because the page, the Excel/CSV export and the
WhatsApp image all derive their numbers from them:

* ``days_elapsed`` counts **completed** days only — the current day is still in
  progress (and DMS imports land a day late), so on the 26th elapsed is 25.
* Daily Required (``drr``) spreads the remaining gap over **days left today
  included** — the current day still sells, so on the 26th of a 28-day period
  it divides by 3, not 2.
"""
from datetime import date, datetime

import pytest

from app.models.employee import Employee
from app.services import active_lso_report_service, active_sso_report_service

START = date(2026, 10, 1)
END = date(2026, 10, 28)


@pytest.fixture
def freeze_today(monkeypatch):
    def _freeze(day: date) -> None:
        frozen = datetime(day.year, day.month, day.day, 12, 0, 0)
        monkeypatch.setattr(active_lso_report_service, "now_naive", lambda: frozen)
        monkeypatch.setattr(active_sso_report_service, "now_naive", lambda: frozen)

    return _freeze


def _lso(start: date = START, end: date = END):
    return active_lso_report_service.ActiveLsoReportService(None, 1, start, end)


def _sso(start: date = START, end: date = END):
    return active_sso_report_service.ActiveSsoReportService(None, 1, start, end)


def _services(start: date = START, end: date = END):
    return (_lso(start, end), _sso(start, end))


# ------------------------------------------------------------------ elapsed
def test_mid_month_elapsed_excludes_the_current_day(freeze_today):
    freeze_today(date(2026, 10, 26))
    for svc in _services():
        assert svc.total_days == 28
        assert svc.days_elapsed == 25
        assert svc.days_remaining == 3


def test_first_day_of_range_has_no_elapsed_days(freeze_today):
    freeze_today(START)
    for svc in _services():
        assert svc.days_elapsed == 0
        assert svc.days_remaining == 28


def test_last_day_of_range_leaves_today_remaining(freeze_today):
    freeze_today(END)
    for svc in _services():
        assert svc.days_elapsed == 27
        # Today itself is not elapsed yet, so it is still a remaining day.
        assert svc.days_remaining == 1


def test_period_already_over_counts_every_day(freeze_today):
    freeze_today(date(2026, 11, 5))
    for svc in _services():
        assert svc.days_elapsed == 28
        assert svc.days_remaining == 0


def test_period_not_started_has_nothing_elapsed(freeze_today):
    freeze_today(date(2026, 9, 20))
    for svc in _services():
        assert svc.days_elapsed == 0
        assert svc.days_remaining == 28


# ------------------------------------------------- days remaining (incl today)
def test_days_remaining_includes_today_inside_the_period(freeze_today):
    freeze_today(date(2026, 10, 26))
    for svc in _services():
        # 26, 27, 28
        assert svc.days_remaining == 3


def test_days_remaining_is_zero_after_the_period(freeze_today):
    freeze_today(date(2026, 11, 5))
    for svc in _services():
        assert svc.days_remaining == 0


def test_elapsed_plus_remaining_always_equals_total_days(freeze_today):
    for day in (date(2026, 9, 20), START, date(2026, 10, 26), END, date(2026, 11, 5)):
        freeze_today(day)
        for svc in _services():
            assert svc.days_elapsed + svc.days_remaining == svc.total_days


# --------------------------------------------------------------- daily required
def _lso_row(svc, target: int = 50, achieved: int = 20) -> dict:
    counts = {key: 0 for key in svc.count_keys}
    counts["active"] = achieved
    counts["retailer_count"] = 10
    emp = Employee(id=1, employee_name="RSO One", dms_code="R001")
    return svc._make_row(emp, {}, {}, {}, {1: target}, counts)


def _sso_row(svc, target: int = 50, achieved: int = 20) -> dict:
    counts = {key: 0 for key in svc.count_keys}
    counts["active"] = achieved
    counts["retailer_count"] = 10
    emp = Employee(id=1, employee_name="RSO One", dms_code="R001")
    return svc._make_row(emp, {}, {}, {}, {1: target}, counts)


def test_daily_required_divides_by_days_left_including_today(freeze_today):
    freeze_today(date(2026, 10, 26))
    # remaining 30 over 3 days (26, 27, 28 - today included) -> 10
    for svc, row_fn in ((_lso(), _lso_row), (_sso(), _sso_row)):
        assert svc.days_remaining == 3
        assert row_fn(svc)["drr"] == 10


def test_daily_required_is_zero_once_the_period_is_over(freeze_today):
    freeze_today(date(2026, 11, 5))
    for svc, row_fn in ((_lso(), _lso_row), (_sso(), _sso_row)):
        assert row_fn(svc)["drr"] == 0


def test_summary_daily_required_follows_each_page_total_rule(freeze_today):
    freeze_today(date(2026, 10, 26))  # 3 selling days left (26, 27, 28)

    lso = _lso()
    lso_rows = [_lso_row(lso, target=100, achieved=0) for _ in range(3)]
    # Per RSO: 100 / 3 = 33.3 -> 33 each.
    assert {r["drr"] for r in lso_rows} == {33}
    # Active LSO's grand total is the sum of the displayed column: 3 x 33.
    assert lso._aggregate(lso_rows)["drr"] == 99

    sso = _sso()
    sso_rows = [_sso_row(sso, target=100, achieved=0) for _ in range(3)]
    assert {r["drr"] for r in sso_rows} == {33}
    # Active SSO follows the same rule: the total row is the sum of the
    # displayed column: 3 x 33.
    assert sso._aggregate(sso_rows)["drr"] == 99
