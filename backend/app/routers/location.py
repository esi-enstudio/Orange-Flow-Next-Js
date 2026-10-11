"""Live Location module router.

* ``POST /api/v1/location/update`` — device ingest endpoint used by the
  employee's mobile automation macro (no login; optional API key).
* ``GET  /api/v1/locations/live`` — latest position of every tracked employee
  for a house (powers the live map + dashboard).
* ``GET  /api/v1/locations/history/{employee_id}`` — movement trail.
* ``GET  /api/v1/locations/export`` — Excel export of the live snapshot.
"""

import logging
import os
from datetime import datetime
from io import BytesIO
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.employee_location import EmployeeLiveLocation, EmployeeLocation
from app.models.house import House
from app.models.user import User
from app.routers.deps import get_db, get_house_context, has_permission
from app.schemas.location import LocationUpdateIn
from app.services.location_service import LOCATION_ONLINE_MINUTES, resolve_employee
from app.utils.access_control import is_admin_user
from app.utils.activity_logger import log_activity
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

router = APIRouter(tags=["live-location"])


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
        is_charging=payload.is_charging,
        accuracy=payload.accuracy,
        speed=payload.speed,
        provider=payload.provider,
        device_name=payload.device_name,
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
            "is_charging": payload.is_charging,
            "accuracy": payload.accuracy,
            "speed": payload.speed,
            "provider": payload.provider,
            "device_name": payload.device_name,
            "last_ip": ip_address,
            "last_seen_at": recorded_at,
            "ping_count": EmployeeLiveLocation.ping_count + 1,
            "updated_at": now_naive(),
        },
    )
    await db.execute(upsert_stmt)

    # Append the history row (movement trail).
    db.add(
        EmployeeLocation(
            employee_id=emp.id,
            house_id=house_id,
            latitude=payload.latitude,
            longitude=payload.longitude,
            battery_percent=payload.current_battery_percent,
            is_charging=payload.is_charging,
            accuracy=payload.accuracy,
            speed=payload.speed,
            provider=payload.provider,
            device_name=payload.device_name,
            source="macro",
            ip_address=ip_address,
            recorded_at=recorded_at,
        )
    )
    await db.commit()

    logger.info(
        "📍 Location ping — employee=%s (%s) lat=%s long=%s battery=%s",
        emp.id,
        emp.employee_name or emp.dms_code or emp.employee_id,
        payload.latitude,
        payload.longitude,
        payload.current_battery_percent,
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
        "provider": live.provider,
        "device_name": live.device_name,
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

    total_filtered = len(filtered)
    start = (page - 1) * per_page
    page_items = filtered[start:start + per_page]
    total_pages = (total_filtered + per_page - 1) // per_page if per_page else 0

    return {
        "success": True,
        "data": page_items,
        "pagination": {
            "page": page,
            "per_page": per_page,
            "total": total_filtered,
            "total_pages": total_pages,
            "has_next": page < total_pages,
            "has_prev": page > 1,
        },
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


@router.get("/api/v1/locations/history/{employee_id}")
async def location_history(
    employee_id: int,
    limit: int = Query(200, ge=1, le=2000),
    from_at: Optional[datetime] = Query(None),
    to_at: Optional[datetime] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("location.view")),
    house_context: Optional[int] = Depends(get_house_context),
):
    emp = await db.get(Employee, employee_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    house_ids = _house_scope(current_user, house_context)
    if house_ids is not None and emp.house_id not in house_ids:
        raise HTTPException(status_code=403, detail="Access denied for this employee")

    stmt = select(EmployeeLocation).where(EmployeeLocation.employee_id == employee_id)
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
                "accuracy": r.accuracy,
                "speed": r.speed,
                "recorded_at": r.recorded_at,
            }
            for r in rows
        ],
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
