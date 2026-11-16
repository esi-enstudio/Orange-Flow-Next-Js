import os
import shutil
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Query, Response
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.routers.deps import get_db, has_permission, has_any_permission, get_house_context
from app.schemas.pagination import PaginationParams, PaginatedResponse, PaginationMeta
from app.models.retailer import Retailer
from app.models.employee import Employee
from app.models.route import RetailerRoute, Route
from app.models.user import User
from app.services.route_list_excel import WEEKDAYS
from app.utils.access_control import is_admin_user
from app.utils.timezone import now_naive
from app.utils.validation import safe_filename, validate_excel
from app.services.Automation.retailer_excel import process_retailer_excel, export_retailers_excel

router = APIRouter(prefix="/api/retailers", tags=["retailers"])


def _active_routes(retailer: Retailer) -> list[dict]:
    """Normalized active route links in primary-first order."""
    links = [
        link
        for link in (retailer.route_links or [])
        if link.status == "active" and link.route is not None and not link.route.is_deleted
    ]
    links.sort(key=lambda link: (not link.is_primary, link.route.code))
    return [
        {
            "id": link.route_id,
            "code": link.route.code,
            "name": link.route.name,
            "is_primary": link.is_primary,
        }
        for link in links
    ]


def _is_on_route_today(retailer: Retailer, day: str) -> bool:
    return any(
        link.status == "active"
        and link.route is not None
        and not link.route.is_deleted
        and link.route.is_active
        and day in (link.route.visit_days or [])
        for link in (retailer.route_links or [])
    )


def _house_scope_ids(current_user: User, house_id: Optional[int]) -> Optional[list[int]]:
    """House scope for retailer queries (None = every house, admin only)."""
    if house_id:
        return [house_id]
    if is_admin_user(current_user):
        return None
    user_house_ids = [h.id for h in current_user.houses]
    return user_house_ids or [-1]


def _csv_ints(value: Optional[str]) -> list[int]:
    """Parse a comma separated id list ("3,7,12")."""
    if not value:
        return []
    ids: list[int] = []
    for part in str(value).split(","):
        part = part.strip()
        if part.isdigit():
            ids.append(int(part))
    return ids


def _yes_no_values(value: Optional[str]) -> Optional[list[str]]:
    """Accept Yes/No and the Y/N form the DMS files use."""
    if not value:
        return None
    normalized = value.strip().lower()
    if normalized in ("yes", "y", "true", "1"):
        return ["Yes", "Y", "yes", "TRUE", "true"]
    if normalized in ("no", "n", "false", "0"):
        return ["No", "N", "no", "FALSE", "false"]
    return [value]


async def _route_ids_for_day(db: AsyncSession, day: str) -> list[int]:
    """Active routes whose DMS weekly visit plan covers ``day``."""
    rows = (
        await db.execute(
            select(Route.id, Route.visit_days).where(
                Route.is_deleted.is_(False), Route.is_active.is_(True)
            )
        )
    ).all()
    return [route_id for route_id, days in rows if day in (days or [])]


async def _retailer_ids_for_routes(db: AsyncSession, route_ids: list[int]):
    """Subquery: retailers actively linked to any of ``route_ids``."""
    return select(RetailerRoute.retailer_id).where(
        RetailerRoute.route_id.in_(route_ids),
        RetailerRoute.status == "active",
    )


@router.get("")
async def get_retailers(
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("retailers.view")),
    house_id: Optional[int] = Depends(get_house_context),
    retailer_type: Optional[str] = None,
    enabled: Optional[str] = None,
    sim_seller: Optional[str] = None,
    scratch_card_seller: Optional[str] = None,
    category: Optional[str] = None,
    service_point: Optional[str] = None,
    district: Optional[str] = None,
    thana: Optional[str] = None,
    route: Optional[str] = None,
    route_id: Optional[int] = None,
    route_ids: Optional[str] = None,
    route_code: Optional[str] = None,
    retailer_ids: Optional[str] = None,
    employee_ids: Optional[str] = None,
    has_employee: Optional[bool] = None,
    employee_id: Optional[int] = None,
    visit_day: Optional[str] = None,
    on_route_today: Optional[bool] = None,
):
    base_query = select(Retailer).options(
        joinedload(Retailer.house),
        joinedload(Retailer.employee).selectinload(Employee.user),
        selectinload(Retailer.route_links).joinedload(RetailerRoute.route),
    )
    scope_ids = _house_scope_ids(current_user, house_id)
    if scope_ids is not None:
        base_query = base_query.where(Retailer.house_id.in_(scope_ids))

    if pagination.search and pagination.search.strip():
        search_pattern = f"%{pagination.search.strip()}%"
        # The active RSO's own identifiers are searchable from the retailer list.
        rso_match = (
            select(Employee.id)
            .where(
                Employee.id == Retailer.employee_id,
                or_(
                    Employee.employee_name.ilike(search_pattern),
                    Employee.itop_number.ilike(search_pattern),
                    Employee.dms_code.ilike(search_pattern),
                    Employee.employee_id.ilike(search_pattern),
                ),
            )
            .exists()
        )
        # Route codes and names come from the normalized active links.
        route_match = (
            select(RetailerRoute.id)
            .join(Route, Route.id == RetailerRoute.route_id)
            .where(
                RetailerRoute.retailer_id == Retailer.id,
                RetailerRoute.status == "active",
                Route.is_deleted.is_(False),
                or_(
                    Route.code.ilike(search_pattern),
                    Route.name.ilike(search_pattern),
                ),
            )
            .exists()
        )
        base_query = base_query.where(
            or_(
                Retailer.name.ilike(search_pattern),
                Retailer.retailer_code.ilike(search_pattern),
                Retailer.itop_number.ilike(search_pattern),
                Retailer.itop_sr_number.ilike(search_pattern),
                Retailer.owner_name.ilike(search_pattern),
                Retailer.contact_no.ilike(search_pattern),
                Retailer.tran_mobile_no.ilike(search_pattern),
                Retailer.address.ilike(search_pattern),
                Retailer.district.ilike(search_pattern),
                Retailer.thana.ilike(search_pattern),
                Retailer.service_point.ilike(search_pattern),
                Retailer.category.ilike(search_pattern),
                Retailer.bp_code.ilike(search_pattern),
                Retailer.bp_number.ilike(search_pattern),
                rso_match,
                route_match,
            )
        )

    selected_ids = _csv_ints(retailer_ids)
    if selected_ids:
        base_query = base_query.where(Retailer.id.in_(selected_ids))
    if retailer_type:
        base_query = base_query.where(Retailer.type == retailer_type)
    for column, value in (
        (Retailer.enabled, enabled),
        (Retailer.sim_seller, sim_seller),
        (Retailer.scratch_card_seller, scratch_card_seller),
    ):
        values = _yes_no_values(value)
        if values:
            base_query = base_query.where(column.in_(values))
    if category:
        base_query = base_query.where(Retailer.category.ilike(f"%{category}%"))
    if service_point:
        base_query = base_query.where(Retailer.service_point.ilike(f"%{service_point}%"))
    if district:
        base_query = base_query.where(Retailer.district.ilike(f"%{district}%"))
    if thana:
        base_query = base_query.where(Retailer.thana.ilike(f"%{thana}%"))
    if route:
        base_query = base_query.where(Retailer.route.ilike(f"%{route}%"))
    if route_id:
        base_query = base_query.where(
            Retailer.id.in_(
                select(RetailerRoute.retailer_id).where(
                    RetailerRoute.route_id == route_id,
                    RetailerRoute.status == "active",
                )
            )
        )
    selected_route_ids = _csv_ints(route_ids)
    if selected_route_ids:
        base_query = base_query.where(
            Retailer.id.in_(await _retailer_ids_for_routes(db, selected_route_ids))
        )
    if route_code:
        base_query = base_query.where(
            Retailer.id.in_(
                select(RetailerRoute.retailer_id)
                .join(Route, Route.id == RetailerRoute.route_id)
                .where(
                    Route.code == route_code.strip().upper(),
                    Route.is_deleted.is_(False),
                    RetailerRoute.status == "active",
                )
            )
        )
    selected_employee_ids = _csv_ints(employee_ids)
    if selected_employee_ids:
        base_query = base_query.where(Retailer.employee_id.in_(selected_employee_ids))
    elif employee_id:
        base_query = base_query.where(Retailer.employee_id == employee_id)
    elif has_employee is not None:
        if has_employee:
            base_query = base_query.where(Retailer.employee_id.isnot(None))
        else:
            base_query = base_query.where(Retailer.employee_id.is_(None))

    # Weekday planning: "on route today" and an explicit weekday both mean the
    # retailer sits on a route whose DMS visit plan covers that day.
    day = (visit_day or "").strip().lower()
    if on_route_today and day not in WEEKDAYS:
        day = now_naive().strftime("%A").lower()
    if day in WEEKDAYS:
        day_route_ids = await _route_ids_for_day(db, day)
        if day_route_ids:
            base_query = base_query.where(
                Retailer.id.in_(await _retailer_ids_for_routes(db, day_route_ids))
            )
        else:
            base_query = base_query.where(Retailer.id == -1)

    count_query = select(func.count()).select_from(base_query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    sort_column = getattr(Retailer, pagination.sort_by, Retailer.id)
    order = sort_column.asc() if pagination.sort_order == "asc" else sort_column.desc()
    offset = (pagination.page - 1) * pagination.per_page
    result = await db.execute(base_query.offset(offset).limit(pagination.per_page).order_by(order))
    retailers = result.scalars().unique().all()

    total_pages = max(1, -(-total // pagination.per_page))
    today = now_naive().strftime("%A").lower()
    data = []
    for r in retailers:
        item = {
            "id": r.id, "house_id": r.house_id, "retailer_code": r.retailer_code,
            "name": r.name, "type": r.type, "enabled": r.enabled,
            "sim_seller": r.sim_seller, "scratch_card_seller": r.scratch_card_seller,
            "tran_mobile_no": r.tran_mobile_no,
            "itop_sr_number": r.itop_sr_number, "itop_number": r.itop_number,
            "service_point": r.service_point, "category": r.category,
            "owner_name": r.owner_name, "contact_no": r.contact_no,
            "district": r.district, "thana": r.thana, "address": r.address,
            "nid": r.nid, "bp_code": r.bp_code, "bp_number": r.bp_number,
            "dob": r.dob, "route": r.route, "house": None, "employee": None,
            "routes": _active_routes(r),
            "on_route_today": _is_on_route_today(r, today),
        }
        if r.house:
            item["house"] = {"id": r.house.id, "name": r.house.name, "code": r.house.code}
        if r.employee:
            item["employee"] = {
                "id": r.employee.id,
                "name": r.employee.employee_name or r.employee.dms_code,
                "itop_number": r.employee.itop_number,
                "dms_code": r.employee.dms_code,
                "employee_name": r.employee.employee_name
            }
        data.append(item)

    return PaginatedResponse(
        success=True,
        data=data,
        pagination=PaginationMeta(
            page=pagination.page,
            per_page=pagination.per_page,
            total=total,
            total_pages=total_pages,
            has_next=pagination.page < total_pages,
            has_prev=pagination.page > 1
        )
    )


@router.get("/filter-options")
async def retailer_filter_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("retailers.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    """Distinct values used by the retailer filter drawer, scoped to the house."""
    scope_ids = _house_scope_ids(current_user, house_id)

    async def distinct_values(column) -> list[str]:
        query = select(column).where(column.isnot(None)).distinct()
        if scope_ids is not None:
            query = query.where(Retailer.house_id.in_(scope_ids))
        values = (await db.execute(query)).scalars().all()
        return sorted(
            {str(value).strip() for value in values if value and str(value).strip()},
            key=str.lower,
        )

    return {
        "success": True,
        "data": {
            "types": await distinct_values(Retailer.type),
            "service_points": await distinct_values(Retailer.service_point),
            "categories": await distinct_values(Retailer.category),
            "thanas": await distinct_values(Retailer.thana),
        },
    }


@router.get("/by-house/{house_id}")
async def get_retailers_by_house(
    house_id: int,
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_any_permission([
        "retailers.view",
        "dms.sim_issue",
        "dms.sim_return",
        "dms.sim_status"
    ]))
):
    is_admin = is_admin_user(current_user)
    if not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if house_id not in user_house_ids:
            raise HTTPException(status_code=403, detail="You do not have access to this house")
    query = (
        select(Retailer)
        .options(joinedload(Retailer.employee))
        .where(Retailer.house_id == house_id)
    )
    if search:
        pattern = f"%{search}%"
        query = query.where(
            (Retailer.name.ilike(pattern)) |
            (Retailer.retailer_code.ilike(pattern)) |
            (Retailer.itop_number.ilike(pattern))
        )
    query = query.order_by(Retailer.name).limit(50)
    result = await db.execute(query)
    retailers = result.unique().scalars().all()

    # Collect all retailer codes to look up assisted_by employees
    codes = [r.retailer_code for r in retailers if r.retailer_code]
    assisted_map = {}
    if codes:
        assisted_result = await db.execute(
            select(Employee).where(Employee.assisted_retailer_code.in_(codes))
        )
        for emp in assisted_result.scalars().all():
            if emp.assisted_retailer_code:
                assisted_map[emp.assisted_retailer_code] = emp.employee_type

    return [
        {
            "id": r.id,
            "retailer_code": r.retailer_code,
            "name": r.name,
            "itop_number": r.itop_number,
            "itop_sr_number": r.itop_sr_number,
            "employee_id": r.employee_id,
            "employee_itop_number": r.employee.itop_number if r.employee else None,
            "is_assisted": r.retailer_code in assisted_map,
            "assisted_by_role": assisted_map.get(r.retailer_code)
        }
        for r in retailers
    ]


@router.post("/import")
async def import_retailers(file: UploadFile = File(...), db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("retailers.import"))):
    if not os.path.exists("temp_downloads"): os.makedirs("temp_downloads")
    filename = file.filename or "upload.xlsx"
    if not validate_excel(filename):
        raise HTTPException(status_code=400, detail="Invalid file type. Only .xlsx and .xls files are allowed.")
    file_path = f"temp_downloads/{safe_filename(filename)}"
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        count, error = await process_retailer_excel(file_path)
        if error: raise HTTPException(status_code=400, detail=error)
        return {"message": f"Successfully imported {count} retailers", "count": count}
    finally:
        if os.path.exists(file_path): os.remove(file_path)


@router.get("/export")
async def export_retailers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("retailers.export")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(Retailer).options(
        joinedload(Retailer.house),
        joinedload(Retailer.employee).selectinload(Employee.user),
        selectinload(Retailer.route_links).joinedload(RetailerRoute.route),
    )
    scope_ids = _house_scope_ids(current_user, house_id)
    if scope_ids is not None:
        query = query.where(Retailer.house_id.in_(scope_ids))
    result = await db.execute(query.order_by(Retailer.id.desc()))
    retailers = result.unique().scalars().all()
    excel_data = await export_retailers_excel(retailers)
    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=retailers_export.xlsx"}
    )
