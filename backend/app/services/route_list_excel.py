"""DMS route-list import (RouteList*.xls).

The DMS export is a **tab-separated text file named ``.xls``**; a real workbook
is read with openpyxl. ``SIMSELLING`` / ``AIRTIMESELLING`` / ``SAFRUNNER`` are
product flags, not route attributes, and are ignored.

Ownership matching: ``RSOCode`` is the RSO's ``dms_code`` (exact identity) and
is preferred. ``Rso Number`` is their ``itop_number``, which is reused across
handoffs, so it is only the fallback and the **Active** employee wins.
"""
import io
import logging
import re

import pandas as pd
from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.house import House
from app.models.route import EmployeeRoute, Route
from app.models.user import User
from app.utils.access_control import is_super_admin_user
from app.utils.timezone import now_naive
from app.services.route_service import ROUTE_CODE_RE, route_house_prefix

logger = logging.getLogger(__name__)

WEEKDAYS = (
    "saturday",
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
)
REQUIRED_COLUMNS = ("routecode", "distributorcode")
MAX_REPORTED_ERRORS = 20


def _norm_header(value) -> str:
    """``Rso Number`` / ``RSOCode`` / ``ROUTE_CODE`` all collapse to one key."""
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def _text(value) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.lower() in ("nan", "none", "null") else text


def _flag(value) -> bool:
    return _text(value).lower() in ("y", "yes", "1", "true")


def _length(value):
    raw = _text(value)
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _read_frame(data: bytes) -> pd.DataFrame:
    """Read a DMS text export or a real Excel workbook."""
    if b"\x00" in data[:4096]:
        # shortcut: only xlsx workbooks are supported (openpyxl); legacy BIFF
        # .xls would need xlrd - add it if DMS ever exports that format.
        return pd.read_excel(io.BytesIO(data), dtype=str)
    text = data.decode("utf-8-sig", errors="replace")
    return pd.read_csv(io.StringIO(text), sep=None, engine="python", dtype=str)


def _employee_maps(employees: list[Employee]) -> tuple[dict, dict]:
    """``(house_id, dms_code)`` and Active-only ``(house_id, itop_number)`` maps."""
    by_dms: dict[tuple[int, str], Employee] = {}
    by_itop: dict[tuple[int, str], Employee] = {}
    for employee in employees:
        if (employee.employee_type or "").lower() != "rso":
            continue
        if employee.dms_code:
            by_dms[(employee.house_id, employee.dms_code.strip().upper())] = employee
        if employee.itop_number and (employee.status or "") == "Active":
            by_itop[(employee.house_id, employee.itop_number.strip().upper())] = employee
    return by_dms, by_itop


async def import_route_list(db: AsyncSession, data: bytes, current_user: User) -> dict:
    """Upsert the DMS route list into the route master and sync RSO ownership.

    Only rows the caller may touch are written. Existing routes keep values the
    file does not carry (a blank cell never clears a stored value), and routes
    that are absent from the file are left untouched.
    """
    try:
        frame = _read_frame(data)
    except Exception as exc:
        raise ValueError(f"Could not read the file: {exc}") from exc
    frame.columns = [_norm_header(column) for column in frame.columns]
    missing = [column for column in REQUIRED_COLUMNS if column not in frame.columns]
    if missing:
        raise ValueError(
            "This is not a DMS route list — missing column(s): " + ", ".join(missing)
        )

    allowed_house_ids = (
        None
        if is_super_admin_user(current_user)
        else {house.id for house in current_user.houses}
    )

    raw_rows = frame.to_dict("records")
    house_codes = {
        _text(row.get("distributorcode")).upper()
        for row in raw_rows
        if _text(row.get("distributorcode"))
    }
    houses = (
        await db.execute(
            select(House).where(func.upper(House.code).in_(sorted(house_codes)))
        )
    ).scalars().all()
    house_by_code = {(house.code or "").strip().upper(): house for house in houses}

    errors: list[str] = []
    skipped = 0
    items: list[dict] = []
    for index, row in enumerate(raw_rows, start=2):
        code = _text(row.get("routecode")).replace(" ", "").upper()
        if not code:
            skipped += 1
            continue
        house_code = _text(row.get("distributorcode")).upper()
        house = house_by_code.get(house_code)
        reason = None
        if house is None:
            reason = f"house {house_code or '(blank)'} not found"
        elif allowed_house_ids is not None and house.id not in allowed_house_ids:
            reason = f"you do not have access to house {house_code}"
        elif not ROUTE_CODE_RE.match(code) or route_house_prefix(code) != house_code:
            reason = f"route code {code} does not belong to house {house_code}"
        if reason:
            skipped += 1
            if len(errors) < MAX_REPORTED_ERRORS:
                errors.append(f"Row {index}: {reason}")
            continue
        visit_days = [day for day in WEEKDAYS if _flag(row.get(day))]
        items.append(
            {
                "house_id": house.id,
                "code": code,
                "name": _text(row.get("routename")) or None,
                "description": _text(row.get("description")) or None,
                "route_length": _length(row.get("routelength")),
                "visit_days": visit_days or None,
                "rso_code": _text(row.get("rsocode")).upper(),
                "rso_number": _text(row.get("rsonumber")).upper(),
            }
        )

    if not items:
        raise ValueError("No valid route row found in the file")

    house_ids = sorted({item["house_id"] for item in items})
    codes = sorted({item["code"] for item in items})
    existing = (
        await db.execute(
            select(Route).where(Route.house_id.in_(house_ids), Route.code.in_(codes))
        )
    ).scalars().all()
    route_map = {(route.house_id, route.code): route for route in existing}

    employees = (
        await db.execute(select(Employee).where(Employee.house_id.in_(house_ids)))
    ).scalars().all()
    by_dms, by_itop = _employee_maps(employees)

    created = updated = unchanged = 0
    for item in items:
        route = route_map.get((item["house_id"], item["code"]))
        if route is None:
            route = Route(
                house_id=item["house_id"],
                code=item["code"],
                is_active=True,
                created_by=current_user.id,
            )
            db.add(route)
            route_map[(item["house_id"], item["code"])] = route
            created += 1
        else:
            values = {
                key: item[key]
                for key in ("name", "description", "route_length", "visit_days")
            }
            changed = any(
                value is not None and getattr(route, key) != value
                for key, value in values.items()
            )
            if route.is_deleted:
                route.is_deleted = False
                route.deleted_at = None
                route.deleted_by = None
                changed = True
            if changed:
                updated += 1
            else:
                unchanged += 1
        route.updated_by = current_user.id
        for key in ("name", "description", "route_length", "visit_days"):
            if item[key] is not None:
                setattr(route, key, item[key])

    await db.flush()

    owner_by_route: dict[int, tuple[Route, int]] = {}
    rso_unmatched = 0
    for item in items:
        route = route_map[(item["house_id"], item["code"])]
        if not item["rso_code"] and not item["rso_number"]:
            continue
        employee = by_dms.get((item["house_id"], item["rso_code"]))
        if employee is None or (employee.status or "") != "Active":
            employee = by_itop.get((item["house_id"], item["rso_number"]))
        if employee is None:
            rso_unmatched += 1
            continue
        owner_by_route[route.id] = (route, employee.id)

    rso_assigned = 0
    if owner_by_route:
        active_links = (
            await db.execute(
                select(EmployeeRoute).where(
                    EmployeeRoute.route_id.in_(list(owner_by_route)),
                    EmployeeRoute.status == "active",
                )
            )
        ).scalars().all()
        current = {link.route_id: link for link in active_links}
        timestamp = now_naive()
        to_close = [
            link.id
            for route_id, link in current.items()
            if owner_by_route[route_id][1] != link.employee_id
        ]
        if to_close:
            # The partial unique index allows one active owner per route, so the
            # outgoing links are written before the incoming ones.
            await db.execute(
                update(EmployeeRoute)
                .where(EmployeeRoute.id.in_(to_close))
                .values(
                    status="inactive",
                    effective_to=timestamp,
                    removed_at=timestamp,
                    removed_by=current_user.id,
                    reason="transfer",
                )
            )
        new_links = [
            {
                "house_id": route.house_id,
                "employee_id": employee_id,
                "route_id": route_id,
                "status": "active",
                "effective_from": timestamp,
                "assigned_at": timestamp,
                "assigned_by": current_user.id,
                "reason": "import",
            }
            for route_id, (route, employee_id) in owner_by_route.items()
            if getattr(current.get(route_id), "employee_id", None) != employee_id
        ]
        if new_links:
            await db.execute(insert(EmployeeRoute), new_links)
            rso_assigned = len(new_links)

    await db.flush()
    logger.info(
        "Route list import by %s: %s created, %s updated, %s unchanged, "
        "%s RSO assigned, %s unmatched, %s skipped",
        current_user.id,
        created,
        updated,
        unchanged,
        rso_assigned,
        rso_unmatched,
        skipped,
    )
    return {
        "total_rows": len(raw_rows),
        "created": created,
        "updated": updated,
        "unchanged": unchanged,
        "rso_assigned": rso_assigned,
        "rso_unmatched": rso_unmatched,
        "skipped": skipped,
        "errors": errors,
    }
