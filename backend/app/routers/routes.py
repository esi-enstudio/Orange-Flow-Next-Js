"""Route master CRUD, retailer links and RSO ownership.

A route is house-scoped reference data (``MYMVAI01_ROUTE0066``). Retailers link
to one or more routes through ``retailer_routes`` and a route is owned by exactly
one Active RSO at a time (``employee_routes``), both effective-dated so history
survives a resignation, transfer or re-import.
"""
import io
import math
from typing import List, Optional

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.house import House
from app.models.retailer import Retailer
from app.models.route import EmployeeRoute, RetailerRoute, Route
from app.models.user import User
from app.routers.deps import get_db, get_house_context, has_permission
from app.schemas.pagination import PaginatedResponse, PaginationMeta, PaginationParams
from app.services.route_list_excel import WEEKDAYS, import_route_list
from app.services.route_service import ROUTE_CODE_RE, route_house_prefix
from app.utils.access_control import is_super_admin_user
from app.utils.activity_logger import log_activity
from app.utils.timezone import now_naive
from app.utils.validation import validate_excel

router = APIRouter(prefix="/api/routes", tags=["routes"])

SORTABLE = {"id", "code", "name", "is_active", "created_at"}


def _scoped_house_ids(current_user: User, house_id: Optional[int]) -> Optional[List[int]]:
    """House scope for route queries (None = every house, super admin only)."""
    if house_id:
        return [house_id]
    if is_super_admin_user(current_user):
        return None
    house_ids = [h.id for h in current_user.houses]
    return house_ids or [-1]


def _assert_house_access(current_user: User, house_id: int) -> None:
    if is_super_admin_user(current_user):
        return
    if house_id not in [h.id for h in current_user.houses]:
        raise HTTPException(status_code=403, detail="You do not have access to this house")


async def _get_route_or_404(db: AsyncSession, route_id: int) -> Route:
    route = await db.get(Route, route_id)
    if not route or route.is_deleted:
        raise HTTPException(status_code=404, detail="Route not found")
    return route


def _owner_map(rows) -> dict:
    owners: dict = {}
    for link, employee in rows:
        owners[link.route_id] = {
            "employee_id": employee.id,
            "name": employee.employee_name or employee.dms_code or employee.employee_id,
            "employee_code": employee.employee_id or employee.dms_code,
            "dms_code": employee.dms_code,
            "itop_number": employee.itop_number,
            "assigned_at": link.assigned_at,
        }
    return owners


async def _active_owner_map(db: AsyncSession, route_ids: List[int]) -> dict:
    if not route_ids:
        return {}
    rows = await db.execute(
        select(EmployeeRoute, Employee)
        .join(Employee, Employee.id == EmployeeRoute.employee_id)
        .where(
            EmployeeRoute.route_id.in_(route_ids),
            EmployeeRoute.status == "active",
        )
    )
    return _owner_map(rows.all())


async def _retailer_count_map(db: AsyncSession, route_ids: List[int]) -> dict:
    if not route_ids:
        return {}
    rows = await db.execute(
        select(RetailerRoute.route_id, func.count(func.distinct(RetailerRoute.retailer_id)))
        .where(
            RetailerRoute.route_id.in_(route_ids),
            RetailerRoute.status == "active",
        )
        .group_by(RetailerRoute.route_id)
    )
    return {route_id: count for route_id, count in rows.all()}


@router.get("/options")
async def route_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("routes.view")),
    house_id: Optional[int] = Depends(get_house_context),
    search: Optional[str] = None,
    limit: int = Query(200, ge=1, le=1000),
):
    """Lightweight route list for filter dropdowns."""
    query = select(Route.id, Route.code, Route.name).where(
        Route.is_deleted.is_(False), Route.is_active.is_(True)
    )
    house_ids = _scoped_house_ids(current_user, house_id)
    if house_ids is not None:
        query = query.where(Route.house_id.in_(house_ids))
    if search:
        pattern = f"%{search.strip()}%"
        query = query.where(or_(Route.code.ilike(pattern), Route.name.ilike(pattern)))
    rows = (await db.execute(query.order_by(Route.code).limit(limit))).all()
    return {
        "success": True,
        "data": [{"id": rid, "code": code, "name": name} for rid, code, name in rows],
    }


@router.get("/export")
async def export_routes(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("routes.export")),
    house_id: Optional[int] = Depends(get_house_context),
):
    query = select(Route).where(Route.is_deleted.is_(False))
    house_ids = _scoped_house_ids(current_user, house_id)
    if house_ids is not None:
        query = query.where(Route.house_id.in_(house_ids))
    routes = (await db.execute(query.order_by(Route.code))).scalars().all()
    route_ids = [route.id for route in routes]
    owners = await _active_owner_map(db, route_ids)
    counts = await _retailer_count_map(db, route_ids)
    house_codes = {
        hid: code
        for hid, code in (await db.execute(select(House.id, House.code))).all()
    }

    data = [
        {
            "DISTRIBUTOR_CODE": house_codes.get(route.house_id, ""),
            "ROUTE_CODE": route.code,
            "ROUTE_NAME": route.name or "",
            "DESCRIPTION": route.description or "",
            "ROUTE_LENGTH": route.route_length,
            **{
                day.upper(): "Y" if day in (route.visit_days or []) else "N"
                for day in WEEKDAYS
            },
            "STATUS": "Active" if route.is_active else "Inactive",
            "RSO": (owners.get(route.id) or {}).get("name", ""),
            "RSO_CODE": (owners.get(route.id) or {}).get("employee_code", ""),
            "RETAILER_COUNT": counts.get(route.id, 0),
        }
        for route in routes
    ]
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        pd.DataFrame(data, columns=[
            "DISTRIBUTOR_CODE", "ROUTE_CODE", "ROUTE_NAME", "DESCRIPTION",
            "ROUTE_LENGTH", *[day.upper() for day in WEEKDAYS],
            "STATUS", "RSO", "RSO_CODE", "RETAILER_COUNT",
        ]).to_excel(writer, index=False, sheet_name="Routes")
    await log_activity(
        db, current_user.id, current_user.name, "routes", "export",
        new_values={"route_count": len(routes)}, request=request, status_code=200,
    )
    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=routes_export.xlsx"},
    )


@router.post("/import")
async def import_routes(
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("routes.import")),
):
    """Upsert the DMS RouteList export into the route master.

    Creates missing routes, refreshes name/description/length/visit days and
    syncs route ownership to the Active RSO named in the file.
    """
    if not validate_excel(file.filename or ""):
        raise HTTPException(
            status_code=400, detail="Only .xls and .xlsx files are allowed"
        )
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="The uploaded file is empty")
    try:
        report = await import_route_list(db, data, current_user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    await db.commit()
    await log_activity(
        db, current_user.id, current_user.name, "routes", "import",
        new_values=report, request=request, status_code=200,
    )
    return {"success": True, "data": report}


@router.get("")
async def list_routes(
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("routes.view")),
    house_id: Optional[int] = Depends(get_house_context),
    is_active: Optional[bool] = None,
    has_rso: Optional[bool] = None,
):
    query = select(Route).where(Route.is_deleted.is_(False))
    house_ids = _scoped_house_ids(current_user, house_id)
    if house_ids is not None:
        query = query.where(Route.house_id.in_(house_ids))
    if pagination.search:
        pattern = f"%{pagination.search.strip()}%"
        query = query.where(or_(Route.code.ilike(pattern), Route.name.ilike(pattern)))
    if is_active is not None:
        query = query.where(Route.is_active.is_(is_active))
    if has_rso is not None:
        owned = select(EmployeeRoute.route_id).where(EmployeeRoute.status == "active")
        query = query.where(Route.id.in_(owned) if has_rso else Route.id.not_in(owned))

    total = (
        await db.execute(select(func.count()).select_from(query.subquery()))
    ).scalar() or 0
    sort_column = getattr(Route, pagination.sort_by, None)
    if pagination.sort_by not in SORTABLE or sort_column is None:
        sort_column = Route.code
    order = sort_column.asc() if pagination.sort_order == "asc" else sort_column.desc()
    offset = (pagination.page - 1) * pagination.per_page
    routes = (
        await db.execute(query.order_by(order).offset(offset).limit(pagination.per_page))
    ).scalars().all()

    route_ids = [route.id for route in routes]
    owners = await _active_owner_map(db, route_ids)
    counts = await _retailer_count_map(db, route_ids)
    total_pages = max(1, -(-total // pagination.per_page))
    return PaginatedResponse(
        success=True,
        data=[
            {
                "id": route.id,
                "house_id": route.house_id,
                "code": route.code,
                "name": route.name,
                "description": route.description,
                "route_length": route.route_length,
                "visit_days": route.visit_days or [],
                "is_active": route.is_active,
                "rso": owners.get(route.id),
                "retailer_count": counts.get(route.id, 0),
                "created_at": route.created_at,
            }
            for route in routes
        ],
        pagination=PaginationMeta(
            page=pagination.page,
            per_page=pagination.per_page,
            total=total,
            total_pages=total_pages,
            has_next=pagination.page < total_pages,
            has_prev=pagination.page > 1,
        ),
    )


@router.post("", status_code=201)
async def create_route(
    payload: dict,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("routes.create")),
    house_id: Optional[int] = Depends(get_house_context),
):
    code = str(payload.get("code") or "").strip().upper()
    name = (payload.get("name") or "").strip() or None
    if not code:
        raise HTTPException(
            status_code=400,
            detail="Route code is required",
        )
    if not ROUTE_CODE_RE.match(code):
        raise HTTPException(
            status_code=400,
            detail="Route code must look like HOUSE_ROUTE01 (house prefix, _ROUTE, digits)",
        )

    if house_id:
        house = await db.get(House, house_id)
    else:
        # No header: a tenant can only create inside its own house.
        houses = current_user.houses if not is_super_admin_user(current_user) else []
        house = houses[0] if len(houses) == 1 else None
        if house is None:
            raise HTTPException(
                status_code=400,
                detail="Please select a house first (X-House-ID header required)",
            )
    if not house:
        raise HTTPException(status_code=404, detail="House not found")
    _assert_house_access(current_user, house.id)
    if route_house_prefix(code) != (house.code or "").strip().upper():
        raise HTTPException(
            status_code=422,
            detail=f"Route code prefix must match the house code ({house.code})",
        )

    existing = (
        await db.execute(
            select(Route).where(Route.house_id == house.id, Route.code == code)
        )
    ).scalar_one_or_none()
    if existing:
        if existing.is_deleted:
            existing.is_deleted = False
            existing.deleted_at = None
            existing.deleted_by = None
            existing.is_active = True
            existing.name = name or existing.name
            existing.updated_by = current_user.id
            route = existing
        else:
            raise HTTPException(status_code=409, detail="This route code already exists")
    else:
        route = Route(
            house_id=house.id,
            code=code,
            name=name,
            is_active=True,
            created_by=current_user.id,
        )
        db.add(route)
    await db.commit()
    await db.refresh(route)
    await log_activity(
        db, current_user.id, current_user.name, "routes", "create",
        record_id=route.id, record_identifier=route.code,
        new_values={"code": route.code, "name": route.name, "house_id": route.house_id},
        request=request, status_code=201,
    )
    return {"success": True, "data": {"id": route.id, "code": route.code, "name": route.name}}


@router.patch("/{route_id}")
async def update_route(
    route_id: int,
    payload: dict,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("routes.edit")),
):
    route = await _get_route_or_404(db, route_id)
    _assert_house_access(current_user, route.house_id)
    if "code" in payload and payload["code"] != route.code:
        raise HTTPException(
            status_code=400,
            detail="Route code cannot be changed after creation",
        )

    old = {
        "name": route.name,
        "description": route.description,
        "route_length": route.route_length,
        "visit_days": route.visit_days or [],
        "is_active": route.is_active,
    }
    if "name" in payload:
        value = payload["name"]
        if value is not None and not isinstance(value, str):
            raise HTTPException(status_code=400, detail="Route name must be text")
        route.name = (value or "").strip() or None
    if "description" in payload:
        value = payload["description"]
        if value is not None and not isinstance(value, str):
            raise HTTPException(status_code=400, detail="Route description must be text")
        route.description = (value or "").strip() or None
    if "route_length" in payload:
        value = payload["route_length"]
        if value is None:
            route.route_length = None
        else:
            try:
                length = float(value)
            except (TypeError, ValueError, OverflowError):
                length = math.nan
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(length)
                or length < 0
            ):
                raise HTTPException(
                    status_code=400,
                    detail="Route length must be a non-negative number",
                )
            route.route_length = length
    if "visit_days" in payload:
        value = payload["visit_days"]
        if not isinstance(value, list) or any(
            not isinstance(day, str) or day.strip().lower() not in WEEKDAYS
            for day in value
        ):
            raise HTTPException(
                status_code=400,
                detail="Visit days must be a list of valid weekdays",
            )
        route.visit_days = list(dict.fromkeys(day.strip().lower() for day in value))
    if "is_active" in payload:
        if not isinstance(payload["is_active"], bool):
            raise HTTPException(status_code=400, detail="Route status must be a boolean")
        route.is_active = payload["is_active"]
    route.updated_by = current_user.id
    await db.commit()
    await db.refresh(route)
    new = {
        "name": route.name,
        "description": route.description,
        "route_length": route.route_length,
        "visit_days": route.visit_days or [],
        "is_active": route.is_active,
    }
    await log_activity(
        db, current_user.id, current_user.name, "routes", "edit",
        record_id=route.id, record_identifier=route.code,
        old_values=old,
        new_values=new,
        request=request, status_code=200,
    )
    return {
        "success": True,
        "data": {
            "id": route.id,
            "code": route.code,
            **new,
        },
    }


@router.delete("/{route_id}", status_code=204)
async def delete_route(
    route_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("routes.delete")),
):
    route = await _get_route_or_404(db, route_id)
    _assert_house_access(current_user, route.house_id)
    in_use = (
        await db.execute(
            select(func.count())
            .select_from(RetailerRoute)
            .where(
                RetailerRoute.route_id == route.id,
                RetailerRoute.status == "active",
            )
        )
    ).scalar() or 0
    owner = (
        await db.execute(
            select(EmployeeRoute.id).where(
                EmployeeRoute.route_id == route.id, EmployeeRoute.status == "active"
            )
        )
    ).scalar()
    if in_use or owner:
        raise HTTPException(
            status_code=409,
            detail="Route still has retailers or an assigned RSO. Unassign them first.",
        )
    timestamp = now_naive()
    route.is_deleted = True
    route.deleted_at = timestamp
    route.deleted_by = current_user.id
    route.is_active = False
    await db.commit()
    await log_activity(
        db, current_user.id, current_user.name, "routes", "delete",
        record_id=route.id, record_identifier=route.code,
        old_values={"code": route.code, "name": route.name},
        request=request, status_code=204,
    )
    return Response(status_code=204)


@router.get("/{route_id}/retailers")
async def route_retailers(
    route_id: int,
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("routes.view")),
):
    route = await _get_route_or_404(db, route_id)
    _assert_house_access(current_user, route.house_id)
    base = (
        select(Retailer)
        .join(RetailerRoute, RetailerRoute.retailer_id == Retailer.id)
        .where(RetailerRoute.route_id == route.id, RetailerRoute.status == "active")
    )
    if pagination.search:
        pattern = f"%{pagination.search.strip()}%"
        base = base.where(
            or_(Retailer.name.ilike(pattern), Retailer.retailer_code.ilike(pattern))
        )
    total = (
        await db.execute(select(func.count()).select_from(base.subquery()))
    ).scalar() or 0
    offset = (pagination.page - 1) * pagination.per_page
    rows = (
        await db.execute(
            base.order_by(Retailer.name).offset(offset).limit(pagination.per_page)
        )
    ).scalars().all()
    total_pages = max(1, -(-total // pagination.per_page))
    return PaginatedResponse(
        success=True,
        data=[
            {
                "id": retailer.id,
                "retailer_code": retailer.retailer_code,
                "name": retailer.name,
                "type": retailer.type,
                "enabled": retailer.enabled,
                "employee_id": retailer.employee_id,
            }
            for retailer in rows
        ],
        pagination=PaginationMeta(
            page=pagination.page,
            per_page=pagination.per_page,
            total=total,
            total_pages=total_pages,
            has_next=pagination.page < total_pages,
            has_prev=pagination.page > 1,
        ),
    )


async def _active_rso_or_422(db: AsyncSession, employee_id: int, house_id: int) -> Employee:
    employee = await db.get(Employee, employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    if employee.house_id != house_id:
        raise HTTPException(status_code=422, detail="Employee and route must be in the same house")
    if (employee.employee_type or "").lower() != "rso":
        raise HTTPException(status_code=422, detail="Only an RSO can own a route")
    if (employee.status or "") != "Active":
        raise HTTPException(status_code=422, detail="Only an Active RSO can own a route")
    return employee


async def _assign_route(db: AsyncSession, route: Route, employee: Employee) -> EmployeeRoute:
    current = (
        await db.execute(
            select(EmployeeRoute).where(
                EmployeeRoute.route_id == route.id, EmployeeRoute.status == "active"
            )
        )
    ).scalar_one_or_none()
    timestamp = now_naive()
    if current:
        if current.employee_id == employee.id:
            return current
        current.status = "inactive"
        current.effective_to = timestamp
        current.removed_at = timestamp
        current.reason = "transfer"
        # The partial unique index allows one active owner per route, so the old
        # row must be written before the new one is inserted.
        await db.flush()
    link = EmployeeRoute(
        house_id=route.house_id,
        employee_id=employee.id,
        route_id=route.id,
        status="active",
        effective_from=timestamp,
        assigned_at=timestamp,
        reason="manual",
    )
    db.add(link)
    return link


@router.post("/{route_id}/assign-rso")
async def assign_rso(
    route_id: int,
    payload: dict,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("routes.assign")),
):
    route = await _get_route_or_404(db, route_id)
    _assert_house_access(current_user, route.house_id)
    if not route.is_active:
        raise HTTPException(status_code=422, detail="Route is inactive")
    employee_id = payload.get("employee_id")
    if not employee_id:
        raise HTTPException(status_code=400, detail="employee_id is required")
    employee = await _active_rso_or_422(db, int(employee_id), route.house_id)
    await _assign_route(db, route, employee)
    await db.commit()
    await log_activity(
        db, current_user.id, current_user.name, "routes", "assign",
        record_id=route.id, record_identifier=route.code,
        new_values={
            "employee_id": employee.id,
            "employee_code": employee.employee_id or employee.dms_code,
            "reason": "manual",
        },
        request=request, status_code=200,
    )
    return {"success": True, "message": "Route assigned"}


@router.post("/{route_id}/unassign-rso")
async def unassign_rso(
    route_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("routes.assign")),
):
    route = await _get_route_or_404(db, route_id)
    _assert_house_access(current_user, route.house_id)
    current = (
        await db.execute(
            select(EmployeeRoute).where(
                EmployeeRoute.route_id == route.id, EmployeeRoute.status == "active"
            )
        )
    ).scalar_one_or_none()
    if not current:
        raise HTTPException(status_code=404, detail="This route has no assigned RSO")
    timestamp = now_naive()
    current.status = "inactive"
    current.effective_to = timestamp
    current.removed_at = timestamp
    current.removed_by = current_user.id
    current.reason = "manual"
    await db.commit()
    await log_activity(
        db, current_user.id, current_user.name, "routes", "unassign",
        record_id=route.id, record_identifier=route.code,
        old_values={"employee_id": current.employee_id},
        request=request, status_code=200,
    )
    return {"success": True, "message": "RSO unassigned"}


@router.post("/bulk-assign")
async def bulk_assign(
    payload: dict,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("routes.assign")),
):
    employee_id = payload.get("employee_id")
    route_ids = payload.get("route_ids") or []
    if not employee_id or not route_ids:
        raise HTTPException(
            status_code=400, detail="employee_id and route_ids are required"
        )
    routes = (
        await db.execute(
            select(Route).where(
                Route.id.in_([int(rid) for rid in route_ids]),
                Route.is_deleted.is_(False),
            )
        )
    ).scalars().all()
    if len(routes) != len(set(int(rid) for rid in route_ids)):
        raise HTTPException(status_code=404, detail="One or more routes were not found")
    house_ids = {route.house_id for route in routes}
    if len(house_ids) != 1:
        raise HTTPException(status_code=422, detail="All routes must belong to one house")
    house_id = house_ids.pop()
    _assert_house_access(current_user, house_id)
    employee = await _active_rso_or_422(db, int(employee_id), house_id)
    for route in routes:
        if not route.is_active:
            raise HTTPException(
                status_code=422, detail=f"Route {route.code} is inactive"
            )
        await _assign_route(db, route, employee)
    await db.commit()
    await log_activity(
        db, current_user.id, current_user.name, "routes", "assign",
        record_identifier=employee.employee_id or employee.dms_code,
        new_values={
            "employee_id": employee.id,
            "route_ids": [route.id for route in routes],
            "reason": "bulk",
        },
        request=request, status_code=200,
    )
    return {"success": True, "assigned": len(routes)}
