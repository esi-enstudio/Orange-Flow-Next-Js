"""Shared data loading for the Live C2C report.

Both ``GET /reports/live-c2c/rsos`` and the WhatsApp/Telegram image builder
render the same RSO productivity table, so both read their rows from here —
one loader means the delivered image can never drift from the page's numbers.

A row is the page's full table record: the RSO's identity, its current-month
productivity targets (``rso_targets``) and the figures derived from the stored
``live_c2c`` rows of the same house.
"""
from dataclasses import dataclass
from datetime import date, datetime, time
from typing import Any, Optional

from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.house import House
from app.models.live_c2c import LiveC2CRow
from app.models.rso_target import RSOTarget
from app.utils.timezone import now_naive


def live_c2c_month_start(today: date | None = None) -> date:
    """First day of the current BST month."""
    current = today or now_naive().date()
    return date(current.year, current.month, 1)


async def load_live_c2c_rsos_and_targets(
    db: AsyncSession,
    *,
    house_id: int,
    target_date: date,
) -> tuple[list[Employee], dict[int, tuple[float, float]]]:
    """Active RSOs of a house plus that month's productivity targets."""
    rso_result = await db.execute(
        select(Employee).where(
            Employee.house_id == house_id,
            Employee.employee_type == "rso",
            Employee.status == "Active",
        )
    )
    # The report shows RSOs sorted A-Z by iTop number; rows without one go last.
    rsos = sorted(
        rso_result.scalars().all(),
        key=lambda employee: (
            not employee.itop_number,
            employee.itop_number or "",
            employee.id,
        ),
    )

    target_result = await db.execute(
        select(RSOTarget).where(
            RSOTarget.house_id == house_id,
            RSOTarget.target_date == target_date,
        )
    )
    targets = {
        target.employee_id: (
            float(target.productivity_c2c_tgt or 0.0),
            float(target.productivity_trans_tgt or 0.0),
        )
        for target in target_result.scalars().all()
    }
    return rsos, targets


@dataclass(frozen=True)
class LiveC2CRsoTotals:
    """Per-RSO C2C figures derived from the stored live_c2c rows."""

    c2c_today_route: float = 0.0
    c2c_other_route: float = 0.0
    today_route_trans: int = 0
    other_route_trans: int = 0
    start_time: Optional[str] = None
    end_time: Optional[str] = None


def live_c2c_clock(value: Optional[str]) -> Optional[time]:
    """Parse a stored Modified ON value into a clock time.

    Imports store a time-only ISO string, but old rows may hold a full
    timestamp; both are accepted and anything unparseable is ignored.
    """
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    try:
        return time.fromisoformat(text)
    except ValueError:
        pass
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).time()
    except ValueError:
        return None


def live_c2c_serving_hours(
    start_clock: Optional[time],
    end_clock: Optional[time],
) -> Optional[float]:
    if start_clock is None or end_clock is None:
        return None
    seconds = (
        end_clock.hour * 3600 + end_clock.minute * 60 + end_clock.second
        - start_clock.hour * 3600 - start_clock.minute * 60 - start_clock.second
    )
    return round(seconds / 3600, 2)


async def load_live_c2c_route_totals(
    db: AsyncSession,
    *,
    house_id: int,
) -> dict[int, LiveC2CRsoTotals]:
    """C2C and transaction figures per RSO from the live_c2c table.

    Splits amounts by on_route (Y = today's route, N = other route), counts the
    transactions per side, and captures the day's first/last Modified ON so the
    report can show start time, end time and serving hours. RSOs with no
    live_c2c rows are absent from the mapping and default to zeros.
    """
    has_modified_on = and_(
        LiveC2CRow.modified_on.isnot(None),
        LiveC2CRow.modified_on != "",
    )
    route_result = await db.execute(
        select(
            LiveC2CRow.from_msisdn,
            func.coalesce(
                func.sum(case((LiveC2CRow.on_route == "Y", LiveC2CRow.transfer_mrp))),
                0,
            ).label("c2c_today_route"),
            func.coalesce(
                func.sum(case((LiveC2CRow.on_route == "N", LiveC2CRow.transfer_mrp))),
                0,
            ).label("c2c_other_route"),
            func.coalesce(
                func.sum(case((LiveC2CRow.on_route == "Y", 1), else_=0)),
                0,
            ).label("today_route_trans"),
            func.coalesce(
                func.sum(case((LiveC2CRow.on_route == "N", 1), else_=0)),
                0,
            ).label("other_route_trans"),
            func.min(case((has_modified_on, LiveC2CRow.modified_on))).label("start_time"),
            func.max(case((has_modified_on, LiveC2CRow.modified_on))).label("end_time"),
        )
        .where(LiveC2CRow.house_id == house_id)
        .group_by(LiveC2CRow.from_msisdn)
    )
    return {
        row.from_msisdn: LiveC2CRsoTotals(
            c2c_today_route=float(row.c2c_today_route or 0.0),
            c2c_other_route=float(row.c2c_other_route or 0.0),
            today_route_trans=int(row.today_route_trans or 0),
            other_route_trans=int(row.other_route_trans or 0),
            start_time=row.start_time,
            end_time=row.end_time,
        )
        for row in route_result.all()
    }


async def load_live_c2c_report_rows(
    db: AsyncSession,
    *,
    house_id: int,
    target_date: date | None = None,
) -> list[dict[str, Any]]:
    """One fully populated Live C2C report row per active RSO of the house."""
    target_date = target_date or live_c2c_month_start()
    house = await db.scalar(select(House).where(House.id == house_id))
    if house is None:
        raise LookupError("live_c2c_house_not_found")

    rsos, targets = await load_live_c2c_rsos_and_targets(
        db,
        house_id=house_id,
        target_date=target_date,
    )
    route_totals = await load_live_c2c_route_totals(db, house_id=house_id)

    rows: list[dict[str, Any]] = []
    for employee in rsos:
        c2c_target, trans_target = targets.get(employee.id, (0.0, 0.0))
        rso_totals = route_totals.get(employee.id) or LiveC2CRsoTotals()
        today_route = rso_totals.c2c_today_route
        other_route = rso_totals.c2c_other_route
        total_c2c = today_route + other_route
        total_trans = rso_totals.today_route_trans + rso_totals.other_route_trans
        start_clock = live_c2c_clock(rso_totals.start_time)
        end_clock = live_c2c_clock(rso_totals.end_time)
        rows.append(
            {
                "employee_id": employee.id,
                "house_code": house.code,
                "dms_code": employee.dms_code,
                "rso_name": employee.employee_name or employee.dms_code or "",
                "rso_itop_number": employee.itop_number,
                "productivity_c2c_tgt": c2c_target,
                "c2c_today_route": today_route,
                "c2c_other_route": other_route,
                "total_c2c": total_c2c,
                # Same achievement/remaining semantics as the workbook report:
                # zero percent when the target is zero, and remaining may be
                # negative once the target is exceeded.
                "c2c_achievement_pct": (
                    round(total_c2c / c2c_target * 100, 2)
                    if c2c_target > 0
                    else 0.0
                ),
                "c2c_remaining": round(c2c_target - total_c2c, 2),
                "productivity_trans_tgt": trans_target,
                "today_route_trans": rso_totals.today_route_trans,
                "other_route_trans": rso_totals.other_route_trans,
                "total_trans": total_trans,
                "trans_achievement_pct": (
                    round(total_trans / trans_target * 100, 2)
                    if trans_target > 0
                    else 0.0
                ),
                "trans_remaining": round(trans_target - total_trans, 2),
                "start_time": start_clock.isoformat() if start_clock else None,
                "end_time": end_clock.isoformat() if end_clock else None,
                "serving_hours": live_c2c_serving_hours(start_clock, end_clock),
            }
        )
    return rows
