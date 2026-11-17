"""Status rules for the report engine (time-based project rule)."""
from datetime import date

import pytest

from app.services.report_engine.status import (
    compute_status,
    days_in_month,
    month_start_of,
)

TODAY = date(2026, 11, 20)


def _status(pct, target=100, date_from=date(2026, 10, 1), date_to=date(2026, 10, 31), today=TODAY):
    return compute_status(
        percentage=pct,
        target=target,
        date_from=date_from,
        date_to=date_to,
        today=today,
    )


def test_finished_period_uses_raw_thresholds():
    assert _status(100.0) == "achieved"
    assert _status(150.0) == "achieved"
    assert _status(99.9) == "on_track"
    assert _status(70.0) == "on_track"
    assert _status(69.9) == "needs_attention"
    assert _status(40.0) == "needs_attention"
    assert _status(39.9) == "behind"


def test_running_period_first_seven_days_uses_raw_thresholds():
    # Reference day 5 -> raw thresholds even though pace would be 16.7%.
    assert _status(
        15.0,
        date_from=date(2026, 11, 1),
        date_to=date(2026, 11, 30),
        today=date(2026, 11, 5),
    ) == "behind"


def test_running_period_uses_pace_after_first_week():
    kwargs = dict(date_from=date(2026, 11, 1), date_to=date(2026, 11, 30))
    # 20/30 = 66.7% of the month elapsed.
    assert _status(100.0, **kwargs) == "achieved"
    assert _status(80.0, **kwargs) == "on_track"
    assert _status(70.0, **kwargs) == "on_track"
    assert _status(60.0, **kwargs) == "needs_attention"
    assert _status(40.0, **kwargs) == "needs_attention"
    assert _status(20.0, **kwargs) == "behind"


def test_future_range_uses_its_first_day_as_reference():
    # A range that has not started yet must not crash or divide by zero days.
    # Reference becomes date_from (25 Nov) -> pace 83.3%.
    assert _status(
        40.0,
        date_from=date(2026, 11, 25),
        date_to=date(2026, 11, 30),
        today=date(2026, 11, 20),
    ) == "behind"


def test_missing_target_never_divides_by_zero():
    assert _status(None, target=None) == "not_applicable"
    assert _status(None, target=0) == "no_target"
    assert _status(50.0, target=0) == "no_target"


def test_month_helpers():
    assert month_start_of(date(2026, 2, 17)) == date(2026, 2, 1)
    assert days_in_month(date(2024, 2, 1)) == 29
    assert days_in_month(date(2026, 2, 1)) == 28
    assert days_in_month(date(2026, 12, 1)) == 31


@pytest.mark.parametrize("pct", [0.0, 39.9, 40.0, 69.9, 70.0, 99.9, 100.0])
def test_every_result_is_in_the_enum(pct):
    from app.services.report_engine.status import STATUS_VALUES

    assert _status(pct) in STATUS_VALUES
