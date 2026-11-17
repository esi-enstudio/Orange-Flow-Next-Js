"""Period target resolution tests for the report engine."""
from datetime import date

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.house_target import HouseTarget
from app.services.report_engine.targets import (
    PeriodTarget,
    TargetSourceNotAvailable,
    TargetSourceUnavailableForMetric,
    TargetValueInvalid,
    TargetValueRequired,
    resolve_period_target,
)


async def _seed_target(db: AsyncSession, house_id: int, month: date, **cols):
    row = HouseTarget(house_id=house_id, target_date=month, **cols)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def _months_between(start: date, end: date) -> list[date]:
    months = []
    cur = date(start.year, start.month, 1)
    last = date(end.year, end.month, 1)
    while cur <= last:
        months.append(cur)
        cur = date(cur.year + (cur.month == 12), (cur.month % 12) + 1, 1)
    return months


async def test_none_returns_nulls(db, house):
    result = await resolve_period_target(
        db=db, source="none", metric_key="ga_activation", house_id=house.id,
        date_from=date(2026, 11, 1), date_to=date(2026, 11, 30), custom_value=None,
    )
    assert result == PeriodTarget(target=None, adjusted_target=None, percent_applied=None,
                                  proration_factor=None, missing_months=0)


async def test_custom_returns_the_literal(db, house):
    result = await resolve_period_target(
        db=db, source="custom", metric_key="c2c", house_id=house.id,
        date_from=date(2026, 11, 1), date_to=date(2026, 11, 15), custom_value=100.0,
    )
    assert result.target == 100.0
    assert result.adjusted_target == 100.0
    assert result.missing_months == 0


async def test_custom_requires_value(db, house):
    with pytest.raises(TargetValueRequired):
        await resolve_period_target(
            db=db, source="custom", metric_key="ga_activation", house_id=house.id,
            date_from=date(2026, 11, 1), date_to=date(2026, 11, 15), custom_value=None,
        )


async def test_custom_negative_is_rejected(db, house):
    with pytest.raises(TargetValueInvalid):
        await resolve_period_target(
            db=db, source="custom", metric_key="ga_activation", house_id=house.id,
            date_from=date(2026, 11, 1), date_to=date(2026, 11, 15), custom_value=-50.0,
        )


async def test_custom_zero_is_allowed(db, house):
    result = await resolve_period_target(
        db=db, source="custom", metric_key="ga_activation", house_id=house.id,
        date_from=date(2026, 11, 1), date_to=date(2026, 11, 15), custom_value=0.0,
    )
    assert result.target == 0.0


async def test_full_month_house_target_equals_row_value(db, house):
    await _seed_target(db, house.id, date(2026, 11, 1), total_ga_target=200)
    result = await resolve_period_target(
        db=db, source="house", metric_key="ga_activation", house_id=house.id,
        date_from=date(2026, 11, 1), date_to=date(2026, 11, 30), custom_value=None,
    )
    assert result.target == 200.0
    assert result.missing_months == 0


async def test_multi_month_house_target_is_sum(db, house):
    await _seed_target(db, house.id, date(2026, 10, 1), total_ga_target=150)
    await _seed_target(db, house.id, date(2026, 11, 1), total_ga_target=200)
    result = await resolve_period_target(
        db=db, source="house", metric_key="ga_activation", house_id=house.id,
        date_from=date(2026, 10, 10), date_to=date(2026, 11, 10), custom_value=None,
    )
    assert result.target == 350.0
    assert result.missing_months == 0


async def test_missing_month_counts_and_contributes_zero(db, house):
    await _seed_target(db, house.id, date(2026, 10, 1), total_ga_target=150)
    # November has no target row.
    result = await resolve_period_target(
        db=db, source="house", metric_key="ga_activation", house_id=house.id,
        date_from=date(2026, 10, 1), date_to=date(2026, 11, 30), custom_value=None,
    )
    assert result.target == 150.0
    assert result.missing_months == 1


async def test_c2c_uses_ev_c2c_target(db, house):
    await _seed_target(db, house.id, date(2026, 11, 1), ev_c2c_target=5000.0)
    result = await resolve_period_target(
        db=db, source="house", metric_key="c2c", house_id=house.id,
        date_from=date(2026, 11, 1), date_to=date(2026, 11, 30), custom_value=None,
    )
    assert result.target == 5000.0


async def test_house_target_unavailable_for_c2s(db, house):
    with pytest.raises(TargetSourceUnavailableForMetric):
        await resolve_period_target(
            db=db, source="house", metric_key="c2s", house_id=house.id,
            date_from=date(2026, 11, 1), date_to=date(2026, 11, 30), custom_value=None,
        )


async def test_house_target_unavailable_for_balance(db, house):
    with pytest.raises(TargetSourceUnavailableForMetric):
        await resolve_period_target(
            db=db, source="house", metric_key="balance", house_id=house.id,
            date_from=date(2026, 11, 1), date_to=date(2026, 11, 30), custom_value=None,
        )


async def test_unsupported_source_raises_not_available(db, house):
    with pytest.raises(TargetSourceNotAvailable):
        await resolve_period_target(
            db=db, source="rso", metric_key="ga_activation", house_id=house.id,
            date_from=date(2026, 11, 1), date_to=date(2026, 11, 30), custom_value=None,
        )


async def test_unknown_metric_raises(db, house):
    with pytest.raises(ValueError):
        await resolve_period_target(
            db=db, source="house", metric_key="nope", house_id=house.id,
            date_from=date(2026, 11, 1), date_to=date(2026, 11, 30), custom_value=None,
        )


async def test_date_to_before_date_from_raises(db, house):
    with pytest.raises(ValueError):
        await resolve_period_target(
            db=db, source="none", metric_key="ga_activation", house_id=house.id,
            date_from=date(2026, 11, 30), date_to=date(2026, 11, 1), custom_value=None,
        )
