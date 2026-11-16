import logging
from typing import Optional, List
from datetime import datetime, date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, Request
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, contains_eager

from app.routers.deps import get_db, has_permission, get_house_context, get_current_user
from app.models.activation import Activation
from app.models.retailer import Retailer
from app.models.employee import Employee
from app.models.product import Product, ProductCategory, ProductStatus
from app.models.user import User
from app.models.house import House
from app.utils.access_control import is_admin_user
from app.utils.activity_logger import log_activity
from app.services.cache_service import cache_service
from app.services.Automation.activation_excel import export_activations_excel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ga-query", tags=["ga-query"])

# Bumped away (both here and by every writer of Activation/Retailer links) whenever
# the underlying data changes; a short TTL only bounds Redis memory, not freshness.
GA_QUERY_CACHE_TTL = 300
GA_QUERY_CACHE_PREFIX = "ga_query"


def _parse_ids(raw: Optional[str]) -> Optional[List[int]]:
    """Parse a comma-separated list of integer IDs into a list, or None if empty."""
    if not raw:
        return None
    ids = [int(x.strip()) for x in raw.split(",") if x.strip().isdigit()]
    return ids or None


@router.get("/retailers")
async def get_ga_query_retailers(
    search: Optional[str] = None,
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ga_query.view")),
    header_house_id: Optional[int] = Depends(get_house_context),
):
    """Get retailers for the selected house with optional search (results are limited)."""
    query = select(Retailer).options(
        joinedload(Retailer.employee).joinedload(Employee.user)
    ).where(Retailer.enabled.ilike("y%"))

    if header_house_id:
        query = query.where(Retailer.house_id == header_house_id)
    elif not is_admin_user(current_user):
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(Retailer.house_id.in_(user_house_ids))
        else:
            return []

    if search:
        pattern = f"%{search}%"
        query = query.where(
            or_(
                Retailer.retailer_code.ilike(pattern),
                Retailer.name.ilike(pattern),
                Retailer.owner_name.ilike(pattern),
            )
        )

    result = await db.execute(query.order_by(Retailer.name).limit(limit))
    retailers = result.scalars().unique().all()

    return [
        {
            "id": r.id,
            "retailer_code": r.retailer_code,
            "name": r.name,
            "owner_name": r.owner_name,
            "itop_number": r.itop_number,
            "house_id": r.house_id,
            "employee_name": r.employee.employee_name if r.employee else None,
            "rso_itop_number": r.employee.itop_number if r.employee else None,
        }
        for r in retailers
    ]


@router.get("/activations")
async def get_ga_query_activations(
    request: Request,
    retailer_id: Optional[int] = None,
    retailer_code: Optional[str] = None,
    retailer_ids: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    product_code: Optional[str] = None,
    product_codes: Optional[str] = None,
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    sort_by: Optional[str] = Query(None, description="Column to sort by: activation_date, retailer, rso, sim_msisdn, product, selling_price"),
    sort_order: str = Query("desc", description="asc or desc"),
    f_rso: Optional[str] = None,
    f_sim_msisdn: Optional[str] = None,
    f_product: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ga_query.view")),
    header_house_id: Optional[int] = Depends(get_house_context),
):
    """Get activations for one or more retailers (or all, when no retailer given) within date range.

    Supports server-side sorting (sort_by / sort_order) and per-column filtering
    (f_<column> params) over the activated-on page's visible columns.
    """
    cache_key = cache_service.cache_key(
        GA_QUERY_CACHE_PREFIX,
        "activations",
        current_user.id,
        header_house_id,
        request.url.query,
    )
    cached = await cache_service.get(cache_key)
    if cached is not None:
        return cached

    ids = _parse_ids(retailer_ids)

    query = (
        select(Activation)
        .outerjoin(Activation.house)
        .outerjoin(Activation.retailer)
        .outerjoin(Retailer.employee)
        .outerjoin(Employee.user)
        .options(
            contains_eager(Activation.house),
            contains_eager(Activation.retailer).contains_eager(Retailer.employee).contains_eager(Employee.user),
        )
    )

    if header_house_id:
        query = query.where(Activation.house_id == header_house_id)
    elif not is_admin_user(current_user):
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(Activation.house_id.in_(user_house_ids))

    if ids:
        query = query.where(Activation.retailer_id.in_(ids))
    elif retailer_id:
        query = query.where(Activation.retailer_id == retailer_id)
    elif retailer_code:
        query = query.where(Activation.retailer_code == retailer_code)

    if start_date:
        try:
            sd = datetime.strptime(start_date, "%Y-%m-%d").date()
            query = query.where(Activation.activation_date >= sd)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid start_date format. Use YYYY-MM-DD")

    if end_date:
        try:
            ed = datetime.strptime(end_date, "%Y-%m-%d").date()
            query = query.where(Activation.activation_date <= ed)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid end_date format. Use YYYY-MM-DD")

    if product_code:
        query = query.where(Activation.product_code == product_code)
    elif product_codes:
        codes_list = [c.strip() for c in product_codes.split(",") if c.strip()]
        if codes_list:
            query = query.where(Activation.product_code.in_(codes_list))

    if search:
        pattern = f"%{search}%"
        query = query.where(
            or_(
                Activation.sim_no.ilike(pattern),
                Activation.msisdn.ilike(pattern),
                Activation.product_name.ilike(pattern),
                Activation.bts_code.ilike(pattern),
            )
        )

    # ── Per-column filters (server-side) ──
    if f_rso:
        rso_values = [v.strip() for v in f_rso.split(",") if v.strip()]
        if rso_values:
            query = query.where(
                or_(
                    Employee.employee_name.in_(rso_values),
                    Employee.dms_code.in_(rso_values),
                    Employee.employee_id.in_(rso_values),
                )
            )

    if f_sim_msisdn:
        pattern = f"%{f_sim_msisdn}%"
        query = query.where(
            or_(Activation.sim_no.ilike(pattern), Activation.msisdn.ilike(pattern))
        )

    if f_product:
        codes_list = [c.strip() for c in f_product.split(",") if c.strip()]
        if codes_list:
            query = query.where(Activation.product_code.in_(codes_list))

    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    offset = (page - 1) * per_page

    sort_map = {
        "activation_date": Activation.activation_date,
        "retailer": Activation.retailer_name,
        "rso": func.coalesce(Employee.employee_name, Employee.dms_code),
        "sim_msisdn": Activation.sim_no,
        "product": Activation.product_code,
        "selling_price": Activation.selling_price,
    }
    sort_col = sort_map.get(sort_by)
    if sort_col is not None:
        primary = sort_col.desc().nulls_last() if sort_order == "desc" else sort_col.asc().nulls_last()
        order = (primary, Activation.id.desc())
    else:
        order = (Activation.activation_date.desc(), Activation.id.desc())

    result = await db.execute(
        query.order_by(*order).offset(offset).limit(per_page)
    )
    records = result.unique().scalars().all()

    data = []
    for r in records:
        item = {
            "id": r.id,
            "sim_no": r.sim_no,
            "activation_date": r.activation_date.isoformat() if r.activation_date else None,
            "activation_time": r.activation_time,
            "retailer_code": r.retailer_code,
            "retailer_name": r.retailer_name,
            "retailer_itop_number": r.retailer.itop_number if r.retailer else None,
            "bts_code": r.bts_code,
            "thana": r.thana,
            "promotion": r.promotion,
            "product_code": r.product_code,
            "product_name": r.product_name,
            "msisdn": r.msisdn,
            "selling_price": r.selling_price,
            "bp_flag": r.bp_flag,
            "bp_number": r.bp_number,
            "fc_bts_code": r.fc_bts_code,
            "bio_bts_code": r.bio_bts_code,
            "dh_lifting_date": r.dh_lifting_date,
            "issue_date": r.issue_date,
            "subscription_type": r.subscription_type,
            "service_class": r.service_class,
            "customer_second_contact": r.customer_second_contact,
            "house_id": r.house_id,
            "house_name": r.house.name if r.house else None,
            "rso_name": None,
            "rso_dms_code": None,
        }
        if r.retailer and r.retailer.employee:
            emp = r.retailer.employee
            item["rso_name"] = emp.employee_name or emp.dms_code
            item["rso_dms_code"] = emp.dms_code
        data.append(item)

    total_pages = max(1, -(-total // per_page))

    payload = {
        "success": True,
        "data": data,
        "pagination": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "total_pages": total_pages,
            "has_next": page < total_pages,
            "has_prev": page > 1,
        },
    }
    await cache_service.set(cache_key, payload, ttl=GA_QUERY_CACHE_TTL)
    return payload


@router.get("/product-codes")
async def get_ga_query_product_codes(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ga_query.view")),
):
    """Get active SIM-category products for the filter dropdown."""
    result = await db.execute(
        select(Product.product_code, Product.product_name)
        .where(
            Product.category == ProductCategory.SIM.value,
            Product.status == ProductStatus.ACTIVE.value,
            Product.product_code != "",
        )
        .order_by(Product.product_code)
    )
    return [
        {"code": code, "product_name": product_name}
        for code, product_name in result.all()
    ]


@router.get("/rso-options")
async def get_ga_query_rso_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ga_query.view")),
    header_house_id: Optional[int] = Depends(get_house_context),
):
    """Get every employee of the active house for the filter dropdown."""
    effective_name = func.coalesce(Employee.employee_name, Employee.dms_code, Employee.employee_id)

    query = (
        select(
            effective_name.label("name"),
            Employee.dms_code,
            Employee.itop_number,
            Employee.employee_type,
        )
        .where(effective_name.isnot(None))
    )

    if header_house_id:
        query = query.where(Employee.house_id == header_house_id)
    elif not is_admin_user(current_user):
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(Employee.house_id.in_(user_house_ids))
        else:
            return []

    result = await db.execute(query.order_by(effective_name))
    return [
        {
            # f_rso matches employee_name OR dms_code server-side; dms_code is unique when present.
            "value": dms_code or name,
            "name": name,
            "dms_code": dms_code,
            "itop_number": itop_number,
            "employee_type": employee_type,
        }
        for name, dms_code, itop_number, employee_type in result.all()
    ]


@router.get("/export")
async def export_ga_query(
    request: Request,
    retailer_id: Optional[int] = None,
    retailer_code: Optional[str] = None,
    retailer_ids: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    product_code: Optional[str] = None,
    product_codes: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ga_query.export")),
    header_house_id: Optional[int] = Depends(get_house_context),
):
    """Export activations to Excel."""
    ids = _parse_ids(retailer_ids)

    query = select(Activation).options(joinedload(Activation.house), joinedload(Activation.retailer))

    if header_house_id:
        query = query.where(Activation.house_id == header_house_id)
    elif not is_admin_user(current_user):
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(Activation.house_id.in_(user_house_ids))

    if ids:
        query = query.where(Activation.retailer_id.in_(ids))
    elif retailer_id:
        query = query.where(Activation.retailer_id == retailer_id)
    elif retailer_code:
        query = query.where(Activation.retailer_code == retailer_code)

    if start_date:
        try:
            sd = datetime.strptime(start_date, "%Y-%m-%d").date()
            query = query.where(Activation.activation_date >= sd)
        except ValueError:
            pass
    if end_date:
        try:
            ed = datetime.strptime(end_date, "%Y-%m-%d").date()
            query = query.where(Activation.activation_date <= ed)
        except ValueError:
            pass

    if product_code:
        query = query.where(Activation.product_code == product_code)
    elif product_codes:
        codes_list = [c.strip() for c in product_codes.split(",") if c.strip()]
        if codes_list:
            query = query.where(Activation.product_code.in_(codes_list))

    result = await db.execute(query.order_by(Activation.activation_date.desc(), Activation.id.desc()))
    records = result.scalars().unique().all()

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="ga_query",
        action="export",
        request=request,
    )

    excel_data = await export_activations_excel(records)
    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=ga_query_activations.xlsx"},
    )


@router.get("/summary")
async def get_ga_query_summary(
    request: Request,
    retailer_id: Optional[int] = None,
    retailer_code: Optional[str] = None,
    retailer_ids: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ga_query.view")),
    header_house_id: Optional[int] = Depends(get_house_context),
):
    """Get summary stats for the query results."""
    cache_key = cache_service.cache_key(
        GA_QUERY_CACHE_PREFIX,
        "summary",
        current_user.id,
        header_house_id,
        request.url.query,
    )
    cached = await cache_service.get(cache_key)
    if cached is not None:
        return cached

    ids = _parse_ids(retailer_ids)

    base = select(Activation.id, Activation.product_code, Activation.activation_date)
    if ids:
        base = base.where(Activation.retailer_id.in_(ids))
    elif retailer_id:
        base = base.where(Activation.retailer_id == retailer_id)
    elif retailer_code:
        base = base.where(Activation.retailer_code == retailer_code)

    if header_house_id:
        base = base.where(Activation.house_id == header_house_id)
    elif not is_admin_user(current_user):
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            base = base.where(Activation.house_id.in_(user_house_ids))

    if start_date:
        try:
            sd = datetime.strptime(start_date, "%Y-%m-%d").date()
            base = base.where(Activation.activation_date >= sd)
        except ValueError:
            pass
    if end_date:
        try:
            ed = datetime.strptime(end_date, "%Y-%m-%d").date()
            base = base.where(Activation.activation_date <= ed)
        except ValueError:
            pass

    sub = base.subquery()

    total_q = select(func.count()).select_from(sub)
    total_result = await db.execute(total_q)
    total = total_result.scalar() or 0

    products_q = select(
        sub.c.product_code, func.count().label("count")
    ).where(
        sub.c.product_code.isnot(None), sub.c.product_code != ""
    ).group_by(sub.c.product_code).order_by(sub.c.product_code)
    products_result = await db.execute(products_q)
    products = [{"code": row[0], "count": row[1]} for row in products_result.all()]

    dates_q = select(
        sub.c.activation_date, func.count().label("count")
    ).group_by(sub.c.activation_date).order_by(sub.c.activation_date)
    dates_result = await db.execute(dates_q)
    daily = [{"date": row[0].isoformat() if row[0] else None, "count": row[1]} for row in dates_result.all()]

    payload = {
        "success": True,
        "total_activations": total,
        "product_breakdown": products,
        "daily_breakdown": daily,
    }
    await cache_service.set(cache_key, payload, ttl=GA_QUERY_CACHE_TTL)
    return payload
