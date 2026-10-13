"""Live Location module router.

* ``POST /api/v1/location/update`` — device ingest endpoint used by the
  employee's mobile automation macro (no login; optional API key).
* ``GET  /api/v1/locations/live`` — latest position of every tracked employee
  for a house (powers the live map + dashboard).
* ``GET  /api/v1/locations/history/{employee_id}`` — movement trail.
* ``GET  /api/v1/locations/export`` — Excel export of the live snapshot.
"""

import logging
import math
import os
from datetime import date as date_cls
from datetime import datetime, time, timedelta
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.employee_location import EmployeeLiveLocation, EmployeeLocation
from app.models.house import House
from app.models.user import User
from app.routers.deps import get_current_user, get_db, get_house_context, has_permission
from app.schemas.location import LocationUpdateIn
from app.services.location_service import (
    LOCATION_HEARTBEAT_MINUTES,
    LOCATION_MIN_MOVE_METERS,
    LOCATION_ONLINE_MINUTES,
    resolve_employee,
)
from app.utils.access_control import is_admin_user
from app.utils.activity_logger import log_activity
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

router = APIRouter(tags=["live-location"])

# Only these roles — and roles explicitly granted ``location.history`` — may
# inspect an employee's full-day travel history. Super Admin / Admin always
# qualify; Manager/House Manager deliberately do NOT (they are treated as admins
# elsewhere, but travel history is stricter on purpose).
HISTORY_ADMIN_ROLES = frozenset({"admin", "super admin", "super_admin"})


async def require_location_history(current_user: User = Depends(get_current_user)) -> User:
    """Strict gate for the travel-history read APIs (admin only by default)."""
    role_names = {r.name.lower() for r in current_user.roles}
    if role_names & HISTORY_ADMIN_ROLES:
        return current_user
    permissions = {p.name for role in current_user.roles for p in role.permissions}
    if "location.history" in permissions:
        return current_user
    raise HTTPException(
        status_code=403,
        detail={
            "code": "FORBIDDEN",
            "message": "Only administrators can view employee travel history",
            "required_permission": "location.history",
        },
    )


# --------------------------------------------------------------------------- #
# Geometry helpers (movement trail + derived stop points)
# --------------------------------------------------------------------------- #
def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two coordinates in metres."""
    radius = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    )
    return 2 * radius * math.asin(min(1.0, math.sqrt(a)))


def _day_bounds(day: date_cls) -> Tuple[datetime, datetime]:
    """Return the ``[start, end)`` naive-BST window for a calendar day."""
    start = datetime.combine(day, time.min)
    return start, start + timedelta(days=1)


def _derive_stops(
    points: List[Dict[str, Any]],
    radius_m: float = 150.0,
    min_minutes: float = 6.0,
) -> List[Dict[str, Any]]:
    """Cluster the day's points into "places" the employee stayed at.

    A stop is a run of consecutive points that stay within ``radius_m`` of the
    cluster's anchor for at least ``min_minutes``. Transient passes are dropped;
    the raw trail still contains every stored point.
    """
    stops: List[Dict[str, Any]] = []
    cluster: List[Dict[str, Any]] = []

    def flush(run: List[Dict[str, Any]]) -> None:
        if len(run) < 2:
            return
        first, last = run[0], run[-1]
        duration = (last["time"] - first["time"]).total_seconds() / 60.0
        if duration < min_minutes:
            return
        center_lat = sum(p["lat"] for p in run) / len(run)
        center_lng = sum(p["lng"] for p in run) / len(run)
        stops.append(
            {
                "index": len(stops) + 1,
                "lat": round(center_lat, 6),
                "lng": round(center_lng, 6),
                "arrival": first["time"],
                "departure": last["time"],
                "duration_minutes": int(round(duration)),
                "point_count": len(run),
                "link": f"https://maps.google.com/?q={center_lat:.6f},{center_lng:.6f}",
            }
        )

    for point in points:
        if not cluster:
            cluster = [point]
            continue
        anchor = cluster[0]
        if _haversine_m(anchor["lat"], anchor["lng"], point["lat"], point["lng"]) <= radius_m:
            cluster.append(point)
        else:
            flush(cluster)
            cluster = [point]
    flush(cluster)
    return stops


def _trail_distance_km(points: List[Dict[str, Any]]) -> float:
    total = 0.0
    for prev, cur in zip(points, points[1:]):
        total += _haversine_m(prev["lat"], prev["lng"], cur["lat"], cur["lng"])
    return round(total / 1000.0, 3)


# --------------------------------------------------------------------------- #
# Device ingest
# --------------------------------------------------------------------------- #
def _verify_device_key(request: Request) -> None:
    """Optional shared-secret check for the device ingest endpoint.

    Enabled only when ``LOCATION_INGEST_API_KEY`` is configured, so an existing
    macro keeps working out of the box while deployments that need it can lock
    the endpoint down. Accepts the key via ``X-API-Key`` header, ``Authorization:
    Bearer`` header, or ``api_key`` query parameter.
    """
    expected = (os.getenv("LOCATION_INGEST_API_KEY") or "").strip()
    if not expected:
        try:
            from config.settings import settings

            expected = (getattr(settings, "LOCATION_INGEST_API_KEY", None) or "").strip()
        except Exception:
            expected = ""
    if not expected:
        return

    provided = (request.headers.get("X-API-Key") or "").strip()
    auth = request.headers.get("Authorization") or ""
    if not provided and auth.lower().startswith("bearer "):
        provided = auth[7:].strip()
    if not provided:
        provided = (request.query_params.get("api_key") or "").strip()

    if provided != expected:
        raise HTTPException(
            status_code=401,
            detail={
                "code": "UNAUTHORIZED",
                "message": "Invalid or missing location ingest API key",
            },
        )


async def _should_store_history_point(
    db: AsyncSession,
    employee_id: int,
    latitude: float,
    longitude: float,
    recorded_at: datetime,
) -> bool:
    """Decide whether a new movement-trail point should be persisted.

    Returns ``True`` when there is no earlier point, when the employee moved at
    least ``LOCATION_MIN_MOVE_METERS``, or when ``LOCATION_HEARTBEAT_MINUTES``
    have passed since the last stored point (so a stationary device still leaves
    markers throughout the day).
    """
    last = (
        await db.execute(
            select(
                EmployeeLocation.latitude,
                EmployeeLocation.longitude,
                EmployeeLocation.recorded_at,
            )
            .where(EmployeeLocation.employee_id == employee_id)
            .order_by(EmployeeLocation.recorded_at.desc())
            .limit(1)
        )
    ).first()
    if last is None:
        return True

    last_lat, last_lng, last_at = last
    if last_lat is None or last_lng is None or last_at is None:
        return True

    moved = _haversine_m(last_lat, last_lng, latitude, longitude)
    if moved >= LOCATION_MIN_MOVE_METERS:
        return True
    # Guard against clock skew: treat a backwards timestamp as "store".
    elapsed_min = (recorded_at - last_at).total_seconds() / 60.0
    return elapsed_min < 0 or elapsed_min >= LOCATION_HEARTBEAT_MINUTES


@router.post("/api/v1/location/update")
async def ingest_location(
    payload: LocationUpdateIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Receive a location ping from an employee device (macro)."""
    _verify_device_key(request)

    emp = await resolve_employee(db, payload.employee_id)
    if not emp:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "EMPLOYEE_NOT_FOUND",
                "message": f"No employee matched identifier '{payload.employee_id}'",
            },
        )

    recorded_at = payload.recorded_at or now_naive()
    ip_address = request.client.host if request.client else None
    house_id = emp.house_id
    telemetry = payload.telemetry()
    is_charging = payload.resolve_is_charging()

    # The ``employees.user_id`` pointer is not FK-enforced and can hold a stale
    # reference (the linked user may have been removed), so only persist a
    # user_id that actually exists — otherwise the FK-constrained live row fails.
    linked_user_id: Optional[int] = None
    if emp.user_id is not None:
        if await db.scalar(select(User.id).where(User.id == emp.user_id)) is not None:
            linked_user_id = emp.user_id

    # Upsert the "latest known location" row.
    insert_stmt = pg_insert(EmployeeLiveLocation).values(
        employee_id=emp.id,
        user_id=linked_user_id,
        house_id=house_id,
        latitude=payload.latitude,
        longitude=payload.longitude,
        battery_percent=payload.current_battery_percent,
        is_charging=is_charging,
        accuracy=payload.accuracy,
        speed=payload.speed,
        altitude=payload.altitude,
        provider=payload.provider,
        device_name=payload.device_name,
        telemetry=telemetry or None,
        source="macro",
        last_ip=ip_address,
        ping_count=1,
        first_seen_at=recorded_at,
        last_seen_at=recorded_at,
    )
    upsert_stmt = insert_stmt.on_conflict_do_update(
        index_elements=[EmployeeLiveLocation.employee_id],
        set_={
            "user_id": linked_user_id,
            "house_id": house_id,
            "latitude": payload.latitude,
            "longitude": payload.longitude,
            "battery_percent": payload.current_battery_percent,
            "is_charging": is_charging,
            "accuracy": payload.accuracy,
            "speed": payload.speed,
            "altitude": payload.altitude,
            "provider": payload.provider,
            "device_name": payload.device_name,
            "telemetry": telemetry or None,
            "last_ip": ip_address,
            "last_seen_at": recorded_at,
            "ping_count": EmployeeLiveLocation.ping_count + 1,
            "updated_at": now_naive(),
        },
    )
    await db.execute(upsert_stmt)

    # Append the history row (movement trail). The macro can ping every few
    # seconds, so the trail is thinned: a point is persisted only when the
    # employee actually moved (>= LOCATION_MIN_MOVE_METERS) or enough time
    # elapsed (>= LOCATION_HEARTBEAT_MINUTES) since the last stored point. This
    # keeps a clean "places traveled" trail while capping storage at a level a
    # 30-day window can comfortably hold.
    history_saved = await _should_store_history_point(db, emp.id, payload.latitude, payload.longitude, recorded_at)
    if history_saved:
        db.add(
            EmployeeLocation(
                employee_id=emp.id,
                house_id=house_id,
                latitude=payload.latitude,
                longitude=payload.longitude,
                battery_percent=payload.current_battery_percent,
                is_charging=is_charging,
                accuracy=payload.accuracy,
                speed=payload.speed,
                altitude=payload.altitude,
                provider=payload.provider,
                device_name=payload.device_name,
                telemetry=telemetry or None,
                source="macro",
                ip_address=ip_address,
                recorded_at=recorded_at,
            )
        )
    await db.commit()

    logger.info(
        "📍 Location ping — employee=%s (%s) lat=%s long=%s battery=%s history=%s",
        emp.id,
        emp.employee_name or emp.dms_code or emp.employee_id,
        payload.latitude,
        payload.longitude,
        payload.current_battery_percent,
        "stored" if history_saved else "thinned",
    )

    return {
        "success": True,
        "message": "Location updated",
        "data": {
            "employee_id": emp.id,
            "employee_name": emp.employee_name,
            "recorded_at": recorded_at,
            "latitude": payload.latitude,
            "longitude": payload.longitude,
            "battery_percent": payload.current_battery_percent,
            "history_saved": history_saved,
        },
    }


# --------------------------------------------------------------------------- #
# Read APIs
# --------------------------------------------------------------------------- #
def _house_scope(current_user: User, house_context: Optional[int]) -> Optional[List[int]]:
    """Return the list of house ids to filter by, or None for "all houses"."""
    if house_context:
        return [house_context]
    if is_admin_user(current_user):
        return None
    return [h.id for h in current_user.houses]


def _serialize_live(
    live: EmployeeLiveLocation,
    emp: Employee,
    house: Optional[House],
    online_minutes: int,
) -> Dict[str, Any]:
    minutes_since = None
    if live.last_seen_at:
        minutes_since = int((now_naive() - live.last_seen_at).total_seconds() // 60)
    is_online = minutes_since is not None and minutes_since <= online_minutes

    battery = live.battery_percent
    if battery is None:
        battery_status = "unknown"
    elif live.is_charging:
        battery_status = "charging"
    elif battery <= 20:
        battery_status = "low"
    else:
        battery_status = "ok"

    return {
        "employee_id": emp.id,
        "employee_name": emp.employee_name,
        "employee_type": emp.employee_type,
        "employee_code": emp.employee_id,
        "dms_code": emp.dms_code,
        "itop_number": emp.itop_number,
        # RSOs are identified by their iTopUp number; other roles use the pool
        # number, so the read API must expose both for the UI to choose.
        "pool_number": emp.pool_number,
        "house_id": emp.house_id,
        "house_name": house.name if house else None,
        "house_code": house.code if house else None,
        "latitude": live.latitude,
        "longitude": live.longitude,
        "battery_percent": battery,
        "battery_status": battery_status,
        "is_charging": live.is_charging,
        "accuracy": live.accuracy,
        "speed": live.speed,
        "altitude": live.altitude,
        "provider": live.provider,
        "device_name": live.device_name,
        "telemetry": live.telemetry or {},
        "source": live.source,
        "ping_count": live.ping_count,
        "first_seen_at": live.first_seen_at,
        "last_seen_at": live.last_seen_at,
        "minutes_since": minutes_since,
        "is_online": is_online,
        "status": "online" if is_online else "offline",
    }


async def _load_scope_rows(
    db: AsyncSession,
    house_ids: Optional[List[int]],
    search: Optional[str],
    employee_type: Optional[str],
):
    stmt = (
        select(EmployeeLiveLocation, Employee, House)
        .join(Employee, EmployeeLiveLocation.employee_id == Employee.id)
        .outerjoin(House, Employee.house_id == House.id)
    )
    if house_ids is not None:
        stmt = stmt.where(EmployeeLiveLocation.house_id.in_(house_ids))
    if employee_type:
        stmt = stmt.where(Employee.employee_type == employee_type)
    if search:
        term = f"%{search.strip().lower()}%"
        stmt = stmt.where(
            func.lower(func.coalesce(Employee.employee_name, "")).like(term)
            | func.lower(func.coalesce(Employee.dms_code, "")).like(term)
            | func.lower(func.coalesce(Employee.employee_id, "")).like(term)
            | func.lower(func.coalesce(Employee.itop_number, "")).like(term)
        )
    return (await db.execute(stmt)).all()


@router.get("/api/v1/locations/live")
async def list_live_locations(
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=1, le=1000),
    search: Optional[str] = Query(None),
    employee_type: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status", description="online | offline"),
    battery_below: Optional[int] = Query(None, ge=0, le=100),
    online_minutes: int = Query(LOCATION_ONLINE_MINUTES, ge=1, le=1440),
    sort_by: str = Query("last_seen_at"),
    sort_order: str = Query("desc"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("location.view")),
    house_context: Optional[int] = Depends(get_house_context),
):
    house_ids = _house_scope(current_user, house_context)
    rows = await _load_scope_rows(db, house_ids, search, employee_type)

    items = [_serialize_live(live, emp, house, online_minutes) for live, emp, house in rows]

    # Summary over the whole scope (not narrowed by status/battery filters).
    total = len(items)
    online = sum(1 for i in items if i["is_online"])
    low_battery = sum(1 for i in items if i["battery_status"] == "low")
    charging = sum(1 for i in items if i["battery_status"] == "charging")

    # Coverage: active employees in scope vs employees currently tracked.
    emp_stmt = select(func.count(Employee.id)).where(Employee.status == "Active")
    if house_ids is not None:
        emp_stmt = emp_stmt.where(Employee.house_id.in_(house_ids))
    active_total = (await db.execute(emp_stmt)).scalar() or 0

    # Apply the client-side filters.
    filtered = items
    if status_filter in ("online", "offline"):
        want_online = status_filter == "online"
        filtered = [i for i in filtered if i["is_online"] == want_online]
    if battery_below is not None:
        filtered = [
            i for i in filtered
            if i["battery_percent"] is not None and i["battery_percent"] <= battery_below
        ]

    reverse = sort_order.lower() != "asc"
    sort_key = sort_by if sort_by in {"last_seen_at", "employee_name", "battery_percent", "employee_type"} else "last_seen_at"
    filtered.sort(
        key=lambda i: (i[sort_key] is None, i[sort_key]),
        reverse=reverse,
    )

    return {
        "success": True,
        "data": filtered,
        "summary": {
            "tracked": total,
            "online": online,
            "offline": total - online,
            "low_battery": low_battery,
            "charging": charging,
            "active_total": active_total,
            "online_minutes": online_minutes,
        },
    }


@router.get("/api/v1/locations/list")
async def list_tracked_employees(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("location.view")),
    house_context: Optional[int] = Depends(get_house_context),
):
    """Return a simple list of tracked employees with their basic identifiers.

    Used by the frontend's Travel History selector (name + code + type). House
    scope is enforced in the same way as live locations.
    """
    house_ids = _house_scope(current_user, house_context)

    stmt = (
        select(EmployeeLiveLocation, Employee, House)
        .join(Employee, EmployeeLiveLocation.employee_id == Employee.id)
        .outerjoin(House, Employee.house_id == House.id)
        .order_by(func.lower(func.coalesce(Employee.employee_name, "")))
    )
    if house_ids is not None:
        stmt = stmt.where(EmployeeLiveLocation.house_id.in_(house_ids))

    rows = (await db.execute(stmt)).all()
    items = []
    for live, emp, house in rows:
        items.append(
            {
                "employee_id": emp.id,
                "employee_name": emp.employee_name,
                "employee_type": emp.employee_type,
                "employee_code": emp.employee_id,
                "dms_code": emp.dms_code,
                "itop_number": emp.itop_number,
                "house_id": emp.house_id,
                "house_name": house.name if house else None,
                "last_seen_at": live.last_seen_at,
            }
        )
    return {"success": True, "data": items}


@router.get("/api/v1/locations/history/{employee_id}")
async def location_history(
    employee_id: int,
    limit: int = Query(200, ge=1, le=2000),
    on_date: Optional[date_cls] = Query(None, alias="date", description="Filter to a single day (YYYY-MM-DD)"),
    from_at: Optional[datetime] = Query(None),
    to_at: Optional[datetime] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_location_history),
    house_context: Optional[int] = Depends(get_house_context),
):
    """Raw movement trail for an employee (admin-only).

    Restricted to Super Admin / Admin (or a role explicitly granted
    ``location.history``) — this exposes sensitive, continuous employee
    movement data.
    """
    emp = await db.get(Employee, employee_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    house_ids = _house_scope(current_user, house_context)
    if house_ids is not None and emp.house_id not in house_ids:
        raise HTTPException(status_code=403, detail="Access denied for this employee")

    stmt = select(EmployeeLocation).where(EmployeeLocation.employee_id == employee_id)
    if on_date:
        day_start, day_end = _day_bounds(on_date)
        stmt = stmt.where(
            EmployeeLocation.recorded_at >= day_start,
            EmployeeLocation.recorded_at < day_end,
        )
    else:
        if from_at:
            stmt = stmt.where(EmployeeLocation.recorded_at >= from_at)
        if to_at:
            stmt = stmt.where(EmployeeLocation.recorded_at <= to_at)
    stmt = stmt.order_by(EmployeeLocation.recorded_at.desc()).limit(limit)

    rows = (await db.execute(stmt)).scalars().all()
    return {
        "success": True,
        "data": [
            {
                "id": r.id,
                "latitude": r.latitude,
                "longitude": r.longitude,
                "battery_percent": r.battery_percent,
                "is_charging": r.is_charging,
                "accuracy": r.accuracy,
                "speed": r.speed,
                "altitude": r.altitude,
                "provider": r.provider,
                "device_name": r.device_name,
                "ip_address": r.ip_address,
                "telemetry": r.telemetry or {},
                "recorded_at": r.recorded_at,
            }
            for r in rows
        ],
    }


@router.get("/api/v1/locations/movement/{employee_id}")
async def location_movement(
    employee_id: int,
    on_date: Optional[date_cls] = Query(None, alias="date", description="Day to inspect (YYYY-MM-DD); defaults to today"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_location_history),
    house_context: Optional[int] = Depends(get_house_context),
):
    """Full-day travel history for one employee (admin-only).

    Returns the ordered trail for the requested day plus derived "stop" places
    (where the employee stayed), the total distance covered and the first/last
    fix of the day. This is the API behind the page's Travel History view.
    """
    emp = await db.get(Employee, employee_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    house_ids = _house_scope(current_user, house_context)
    if house_ids is not None and emp.house_id not in house_ids:
        raise HTTPException(status_code=403, detail="Access denied for this employee")

    day = on_date or now_naive().date()
    day_start, day_end = _day_bounds(day)

    rows = (
        await db.execute(
            select(EmployeeLocation)
            .where(
                EmployeeLocation.employee_id == employee_id,
                EmployeeLocation.recorded_at >= day_start,
                EmployeeLocation.recorded_at < day_end,
            )
            .order_by(EmployeeLocation.recorded_at.asc())
        )
    ).scalars().all()

    points: List[Dict[str, Any]] = [
        {
            "time": r.recorded_at,
            "lat": r.latitude,
            "lng": r.longitude,
            "battery_percent": r.battery_percent,
            "is_charging": r.is_charging,
            "accuracy": r.accuracy,
            "speed": r.speed,
            "speed_kmh": (r.telemetry or {}).get("speed_kmh"),
            "altitude": r.altitude,
        }
        for r in rows
    ]

    stops = _derive_stops(points)
    summary = {
        "point_count": len(points),
        "stop_count": len(stops),
        "distance_km": _trail_distance_km(points),
        "first_seen": points[0]["time"] if points else None,
        "last_seen": points[-1]["time"] if points else None,
    }

    return {
        "success": True,
        "data": {
            "employee_id": emp.id,
            "employee_name": emp.employee_name,
            "employee_type": emp.employee_type,
            "dms_code": emp.dms_code,
            "itop_number": emp.itop_number,
            "house_id": emp.house_id,
            "date": day.isoformat(),
            "points": points,
            "stops": stops,
            "summary": summary,
        },
    }


@router.get("/api/v1/locations/export")
async def export_live_locations(
    request: Request,
    search: Optional[str] = Query(None),
    employee_type: Optional[str] = Query(None),
    online_minutes: int = Query(LOCATION_ONLINE_MINUTES, ge=1, le=1440),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("location.export")),
    house_context: Optional[int] = Depends(get_house_context),
):
    from openpyxl import Workbook

    house_ids = _house_scope(current_user, house_context)
    rows = await _load_scope_rows(db, house_ids, search, employee_type)
    items = [_serialize_live(live, emp, house, online_minutes) for live, emp, house in rows]

    wb = Workbook()
    ws = wb.active
    ws.title = "Live Locations"
    headers = [
        "Employee", "Type", "DMS Code", "Employee ID", "iTopUp",
        "House", "Status", "Battery %", "Charging", "Latitude", "Longitude",
        "Accuracy (m)", "Speed", "Provider", "Device", "Last Seen", "Pings",
    ]
    ws.append(headers)
    for i in items:
        ws.append([
            i["employee_name"], i["employee_type"], i["dms_code"], i["employee_code"],
            i["itop_number"], i["house_name"], i["status"], i["battery_percent"],
            "Yes" if i["is_charging"] else ("No" if i["is_charging"] is not None else ""),
            i["latitude"], i["longitude"], i["accuracy"], i["speed"],
            i["provider"], i["device_name"],
            i["last_seen_at"].strftime("%Y-%m-%d %H:%M:%S") if i["last_seen_at"] else "",
            i["ping_count"],
        ])

    buffer = BytesIO()
    wb.save(buffer)
    buffer.seek(0)

    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="location",
        action="export",
        status_code=200,
        request=request,
        new_values={"rows": len(items)},
    )

    filename = f"live_locations_{now_naive().strftime('%Y%m%d_%H%M')}.xlsx"
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
