"""Report engine: registry-driven, house-scoped report querying.

The engine is the single place where "metric x dimension x period x target"
is turned into one grouped aggregate. Legacy services keep their own code until
phase 4 moves them here.
"""
from app.services.report_engine.status import (
    ACHIEVED_MIN_PCT,
    NEEDS_ATTENTION_MIN_PCT,
    ON_TRACK_MIN_PCT,
    STATUS_VALUES,
    compute_status,
    days_in_month,
    month_start_of,
)

__all__ = [
    "ACHIEVED_MIN_PCT",
    "NEEDS_ATTENTION_MIN_PCT",
    "ON_TRACK_MIN_PCT",
    "STATUS_VALUES",
    "compute_status",
    "days_in_month",
    "month_start_of",
]
