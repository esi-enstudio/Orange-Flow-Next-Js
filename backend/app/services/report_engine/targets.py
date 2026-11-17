"""Period-level target resolution for the report engine.

A target is a *period* value: the sum of monthly targets over every calendar
month the requested range touches. Months without a target row contribute 0 and
increment `missing_months`.

House targets live on `house_targets` keyed per `(house_id, target_date=1st of
month)`. Metrics carry the column name to read via their registry definition
(`metrics.MetricDefinition.target_columns["house"]`).

In phase 1 only `house`, `custom` and `none` are available; rso/bp/supervisor
and `retailer_custom` raise `TARGET_SOURCE_NOT_AVAILABLE`.
"""

from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.house_target import HouseTarget
from app.services.report_engine.metrics import get_metric


@dataclass(frozen=True)
class PeriodTarget:
    target: float | None            # period target (prorated when on)
    adjusted_target: float | None   # target × percent ÷ 100 (phase 1: == target)
    percent_applied: float | None   # the percent used (phase 1: None)
    proration_factor: float | None  # days_in_range / days_in_month per month (phase 1: None)
    missing_months: int             # count of months inside the range with no target row


class TargetSourceNotAvailable(ValueError):
    pass


class TargetValueRequired(ValueError):
    pass


class TargetValueInvalid(ValueError):
    pass


class TargetSourceUnavailableForMetric(ValueError):
    pass


async def resolve_period_target(
    *,
    db: AsyncSession,
    source: str,
    metric_key: str,
    house_id: int,
    date_from: date,
    date_to: date,
    custom_value: float | None,
) -> PeriodTarget:
    if date_to < date_from:
        raise ValueError("date_to must not be earlier than date_from")

    if source == "none":
        return PeriodTarget(
            target=None, adjusted_target=None, percent_applied=None,
            proration_factor=None, missing_months=0,
        )

    if source == "custom":
        if custom_value is None:
            raise TargetValueRequired("custom target requires a value")
        if custom_value < 0:
            raise TargetValueInvalid("custom target must not be negative")
        return PeriodTarget(
            target=custom_value, adjusted_target=custom_value,
            percent_applied=None, proration_factor=None, missing_months=0,
        )

    if source == "house":
        metric = get_metric(metric_key)
        if metric is None:
            raise ValueError("unknown metric")
        column = metric.house_target_column
        if column is None:
            raise TargetSourceUnavailableForMetric(
                f"metric {metric_key} has no stored monthly house target"
            )

        target = 0.0
        missing_months = 0
        cursor = month_start(date_from)
        last = month_start(date_to)
        while cursor <= last:
            row = await db.execute(
                select(HouseTarget).where(
                    HouseTarget.house_id == house_id,
                    HouseTarget.target_date == cursor,
                )
            )
            target_row = row.scalar_one_or_none()
            if target_row is None:
                missing_months += 1
            else:
                value = getattr(target_row, column) or 0.0
                target += float(value)
            cursor = next_month_start(cursor)

        return PeriodTarget(
            target=target, adjusted_target=target,
            percent_applied=None, proration_factor=None,
            missing_months=missing_months,
        )

    # rso / bp / supervisor / retailer_custom arrive in phase 1b / phase 2.
    raise TargetSourceNotAvailable(f"target source {source} is not available in phase 1")


def month_start(d: date) -> date:
    return date(d.year, d.month, 1)


def next_month_start(d: date) -> date:
    if d.month == 12:
        return date(d.year + 1, 1, 1)
    return date(d.year, d.month + 1, 1)
