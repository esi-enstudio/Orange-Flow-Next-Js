"""Status classification for the report engine.

Single source of truth for achieved / on_track / needs_attention / behind.

The rule is the project-wide time-based rule (docs/agents/ui-components.md):

* a finished period compares the raw percentage against 100 / 70 / 40;
* the first seven days of a running month use the same raw thresholds;
* after that the percentage is compared against the elapsed pace of the month.

The engine always computes the status and the API sends it; the frontend never
re-derives it.
"""
from datetime import date

ACHIEVED_MIN_PCT: float = 100.0
ON_TRACK_MIN_PCT: float = 70.0
NEEDS_ATTENTION_MIN_PCT: float = 40.0

STATUS_VALUES: tuple[str, ...] = (
    "achieved",
    "on_track",
    "needs_attention",
    "behind",
    "no_target",
    "not_applicable",
)

# The first days of a month are too early for pace math: a 3% achievement on
# day 2 is not "behind", it is simply day 2.
RAW_THRESHOLD_DAYS = 7


def month_start_of(d: date) -> date:
    """First day of the calendar month containing ``d``."""
    return date(d.year, d.month, 1)


def days_in_month(month_start: date) -> int:
    """Number of days in the month that starts at ``month_start``."""
    if month_start.month == 12:
        next_month = date(month_start.year + 1, 1, 1)
    else:
        next_month = date(month_start.year, month_start.month + 1, 1)
    return (next_month - month_start).days


def _raw_status(percentage: float) -> str:
    if percentage >= ACHIEVED_MIN_PCT:
        return "achieved"
    if percentage >= ON_TRACK_MIN_PCT:
        return "on_track"
    if percentage >= NEEDS_ATTENTION_MIN_PCT:
        return "needs_attention"
    return "behind"


def compute_status(
    *,
    percentage: float | None,
    target: float | None,
    date_from: date,
    date_to: date,
    today: date,
) -> str:
    """Classify one row/summary.

    ``not_applicable`` means "no meaningful comparison" (no target chosen, or a
    per-day row that cannot be compared to a period target). ``no_target`` means
    a target of zero was configured.
    """
    if target is None:
        return "not_applicable"
    if target <= 0:
        return "no_target"
    if percentage is None:
        return "not_applicable"

    # A finished period is judged against the full target.
    if date_to < today:
        return _raw_status(percentage)

    reference = min(today, date_to)
    if reference < date_from:
        reference = date_from

    if reference.day <= RAW_THRESHOLD_DAYS:
        return _raw_status(percentage)

    time_pct = reference.day / days_in_month(month_start_of(reference)) * 100
    if percentage >= ACHIEVED_MIN_PCT:
        return "achieved"
    if percentage >= time_pct:
        return "on_track"
    if percentage >= time_pct / 2:
        return "needs_attention"
    return "behind"
