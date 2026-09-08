import logging
from typing import Optional, List
from datetime import datetime, date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, Request
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.routers.deps import get_db, has_permission, get_house_context, get_current_user
from app.models.activation import Activation
from app.models.retailer import Retailer
from app.models.employee import Employee
from app.models.user import User
from app.models.house import House
from app.utils.access_control import is_admin_user
from app.utils.activity_logger import log_activity
from app.services.Automation.activation_excel import export_activations_excel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ga-query", tags=["ga-query"])


@router.get("/retailers")
async def get_ga_query_retailers(
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ga_query.view")),
    header_house_id: Optional[int] = Depends(get_house_context),
):
    """Get retailers for the selected house with activation counts."""
    query = select(Retailer).options(
        joinedload(Retailer.employee).joinedload(Employee.user)
    )

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

    result = await db.execute(query.order_by(Retailer.name))
    retailers = result.scalars().unique().all()

    return [
        {
            "id": r.id,
            "retailer_code": r.retailer_code,
            "name": r.name,
            "owner_name": r.owner_name,
            "itop_number": r.itop_number,
            "house_id": r.house_id,
            "employee_name": r.employee.user.name if r.employee and r.employee.user else None,
            "rso_itop_number": r.employee.itop_number if r.employee else None,
        }
        for r in retailers
    ]


@router.get("/activations")
async def get_ga_query_activations(
    retailer_id: Optional[int] = None,
    retailer_code: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    product_code: Optional[str] = None,
    product_codes: Optional[str] = None,
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ga_query.view")),
    header_house_id: Optional[int] = Depends(get_house_context),
):
    """Get activations for a specific retailer within date range."""
    if not retailer_id and not retailer_code:
        raise HTTPException(status_code=400, detail="retailer_id or retailer_code is required")

    query = select(Activation).options(
        joinedload(Activation.house),
        joinedload(Activation.retailer).joinedload(Retailer.employee).joinedload(Employee.user),
    )

    if header_house_id:
        query = query.where(Activation.house_id == header_house_id)
    elif not is_admin_user(current_user):
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(Activation.house_id.in_(user_house_ids))

    if retailer_id:
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

    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    offset = (page - 1) * per_page
    result = await db.execute(
        query.order_by(Activation.activation_date.desc(), Activation.id.desc())
        .offset(offset)
        .limit(per_page)
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
            item["rso_name"] = emp.user.name if emp.user else emp.dms_code
            item["rso_dms_code"] = emp.dms_code
        data.append(item)

    total_pages = max(1, -(-total // per_page))

    return {
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


@router.get("/product-codes")
async def get_ga_query_product_codes(
    retailer_id: Optional[int] = None,
    retailer_code: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ga_query.view")),
    header_house_id: Optional[int] = Depends(get_house_context),
):
    """Get distinct product codes for filter dropdown."""
    query = select(Activation.product_code, func.count(Activation.id).label("count")).where(
        Activation.product_code.isnot(None), Activation.product_code != ""
    )

    if header_house_id:
        query = query.where(Activation.house_id == header_house_id)
    elif not is_admin_user(current_user):
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(Activation.house_id.in_(user_house_ids))

    if retailer_id:
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

    query = query.group_by(Activation.product_code).order_by(Activation.product_code)
    result = await db.execute(query)
    rows = result.all()

    return [
        {"code": row[0], "count": row[1]}
        for row in rows
    ]


@router.get("/export")
async def export_ga_query(
    request: Request,
    retailer_id: Optional[int] = None,
    retailer_code: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    product_code: Optional[str] = None,
    product_codes: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ga_query.export")),
    header_house_id: Optional[int] = Depends(get_house_context),
):
    """Export activations to Excel."""
    if not retailer_id and not retailer_code:
        raise HTTPException(status_code=400, detail="retailer_id or retailer_code is required")

    query = select(Activation).options(joinedload(Activation.house))

    if header_house_id:
        query = query.where(Activation.house_id == header_house_id)
    elif not is_admin_user(current_user):
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(Activation.house_id.in_(user_house_ids))

    if retailer_id:
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
    retailer_id: Optional[int] = None,
    retailer_code: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ga_query.view")),
    header_house_id: Optional[int] = Depends(get_house_context),
):
    """Get summary stats for the query results."""
    if not retailer_id and not retailer_code:
        raise HTTPException(status_code=400, detail="retailer_id or retailer_code is required")

    base = select(Activation.id, Activation.product_code, Activation.activation_date)
    if retailer_id:
        base = base.where(Activation.retailer_id == retailer_id)
    else:
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

    return {
        "success": True,
        "total_activations": total,
        "product_breakdown": products,
        "daily_breakdown": daily,
    }
