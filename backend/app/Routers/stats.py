import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import date, datetime, timedelta

from app.Routers.deps import get_db, has_permission, get_house_context, get_current_user
from app.Models.retailer import Retailer
from app.Models.house import House
from app.Models.bts import BTS
from app.Models.employee import Employee
from app.Models.user import User
from app.Models.activation import Activation
from app.Models.live_activation import LiveActivation

from app.Models.ga_filter import FilterTag, RetailerFilter
from app.Utils.access_control import is_admin_user
from app.Utils.activation_rules import get_excluded_codes, exclude_clause

router = APIRouter(prefix="/api", tags=["stats"])


@router.get("/stats")
async def get_stats(
    db: AsyncSession = Depends(get_db),
    current_user = Depends(has_permission("view_reports")),
    house_id: Optional[int] = Depends(get_house_context),
    q_house_id: Optional[int] = Query(None, alias="house_id"),
):
    target_house_id = q_house_id or house_id
    if q_house_id and not is_admin_user(current_user):
        user_house_ids = [h.id for h in current_user.houses]
        if q_house_id not in user_house_ids:
            raise HTTPException(status_code=403, detail="You do not have access to this house")
    excluded_codes = await get_excluded_codes(db)
    today_d = date.today()

    retailer_query = select(func.count()).select_from(Retailer)
    active_retailer_query = select(func.count()).select_from(Retailer).where(Retailer.enabled == "Yes")
    inactive_retailer_query = select(func.count()).select_from(Retailer).where((Retailer.enabled != "Yes") | Retailer.enabled.is_(None))
    house_query = select(func.count()).select_from(House)
    bts_query = select(func.count()).select_from(BTS)
    emp_query = select(func.count()).select_from(Employee)
    active_emp_query = select(func.count()).select_from(Employee).where(Employee.status == "Active")
    inactive_emp_query = select(func.count()).select_from(Employee).where((Employee.status != "Active") | Employee.status.is_(None))
    user_query = select(func.count()).select_from(User).where(User.status == "Active")
    activation_query = (
        select(func.count())
        .select_from(LiveActivation)
        .where(LiveActivation.activation_date == today_d)
    )
    clause = exclude_clause(LiveActivation, excluded_codes)
    if clause is not None:
        activation_query = activation_query.where(clause)

    is_admin = is_admin_user(current_user)

    if target_house_id:
        retailer_query = retailer_query.where(Retailer.house_id == target_house_id)
        active_retailer_query = active_retailer_query.where(Retailer.house_id == target_house_id)
        inactive_retailer_query = inactive_retailer_query.where(Retailer.house_id == target_house_id)
        emp_query = emp_query.where(Employee.house_id == target_house_id)
        active_emp_query = active_emp_query.where(Employee.house_id == target_house_id)
        inactive_emp_query = inactive_emp_query.where(Employee.house_id == target_house_id)
        house_query = house_query.where(House.id == target_house_id)
        bts_query = bts_query.where(BTS.house_id == target_house_id)
        activation_query = activation_query.where(LiveActivation.house_id == target_house_id)
    elif is_admin:
        pass
    else:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            retailer_query = retailer_query.where(Retailer.house_id.in_(user_house_ids))
            active_retailer_query = active_retailer_query.where(Retailer.house_id.in_(user_house_ids))
            inactive_retailer_query = inactive_retailer_query.where(Retailer.house_id.in_(user_house_ids))
            emp_query = emp_query.where(Employee.house_id.in_(user_house_ids))
            active_emp_query = active_emp_query.where(Employee.house_id.in_(user_house_ids))
            inactive_emp_query = inactive_emp_query.where(Employee.house_id.in_(user_house_ids))
            house_query = house_query.where(House.id.in_(user_house_ids))
            bts_query = bts_query.where(BTS.house_id.in_(user_house_ids))
            activation_query = activation_query.where(LiveActivation.house_id.in_(user_house_ids))
        else:
            retailer_query = retailer_query.where(Retailer.house_id == -1)
            active_retailer_query = active_retailer_query.where(Retailer.house_id == -1)
            inactive_retailer_query = inactive_retailer_query.where(Retailer.house_id == -1)
            emp_query = emp_query.where(Employee.house_id == -1)
            active_emp_query = active_emp_query.where(Employee.house_id == -1)
            inactive_emp_query = inactive_emp_query.where(Employee.house_id == -1)
            house_query = house_query.where(House.id == -1)
            bts_query = bts_query.where(BTS.house_id == -1)
            activation_query = activation_query.where(LiveActivation.house_id == -1)

    product_query = (
        select(LiveActivation.product_code, func.count().label("cnt"))
        .where(LiveActivation.activation_date == today_d)
        .group_by(LiveActivation.product_code)
    )
    clause_p = exclude_clause(LiveActivation, excluded_codes)
    if clause_p is not None:
        product_query = product_query.where(clause_p)
    if target_house_id:
        product_query = product_query.where(LiveActivation.house_id == target_house_id)
    elif is_admin:
        pass
    else:
        if user_house_ids:
            product_query = product_query.where(LiveActivation.house_id.in_(user_house_ids))
        else:
            product_query = product_query.where(LiveActivation.house_id == -1)
    product_rows = (await db.execute(product_query)).all()
    product_breakdown = {row.product_code: row.cnt for row in product_rows}

    retailer_count = (await db.execute(retailer_query)).scalar()
    active_retailer_count = (await db.execute(active_retailer_query)).scalar()
    inactive_retailer_count = (await db.execute(inactive_retailer_query)).scalar()
    house_count = (await db.execute(house_query)).scalar()
    bts_count = (await db.execute(bts_query)).scalar()
    emp_count = (await db.execute(emp_query)).scalar()
    active_emp_count = (await db.execute(active_emp_query)).scalar()
    inactive_emp_count = (await db.execute(inactive_emp_query)).scalar()
    active_users = (await db.execute(user_query)).scalar()
    today_activations = (await db.execute(activation_query)).scalar()

    return {
        "total_retailers": retailer_count,
        "active_retailers": active_retailer_count,
        "inactive_retailers": inactive_retailer_count,
        "total_houses": house_count,
        "total_bts": bts_count,
        "total_employees": emp_count,
        "active_employees": active_emp_count,
        "inactive_employees": inactive_emp_count,
        "active_users": active_users,
        "today_activations": today_activations,
        "product_breakdown": product_breakdown,
    }


@router.get("/stats/daily-activations")
async def get_daily_activations(
    db: AsyncSession = Depends(get_db),
    current_user = Depends(has_permission("view_reports")),
    house_id: Optional[int] = Depends(get_house_context),
    q_house_id: Optional[int] = Query(None, alias="house_id"),
):
    target_house_id = q_house_id or house_id
    if q_house_id and not is_admin_user(current_user):
        user_house_ids = [h.id for h in current_user.houses]
        if q_house_id not in user_house_ids:
            raise HTTPException(status_code=403, detail="You do not have access to this house")

    today = date.today()
    month_start = today.replace(day=1)
    excluded_codes = await get_excluded_codes(db)
    is_admin = is_admin_user(current_user)

    # Past dates (month_start to yesterday) → Activation table
    hist_query = (
        select(Activation.activation_date, func.count())
        .where(Activation.activation_date >= month_start)
        .where(Activation.activation_date < today)
        .group_by(Activation.activation_date)
        .order_by(Activation.activation_date)
    )
    clause_h = exclude_clause(Activation, excluded_codes)
    if clause_h is not None:
        hist_query = hist_query.where(clause_h)
    if target_house_id:
        hist_query = hist_query.where(Activation.house_id == target_house_id)
    elif is_admin:
        pass
    else:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            hist_query = hist_query.where(Activation.house_id.in_(user_house_ids))
        else:
            hist_query = hist_query.where(Activation.house_id == -1)

    hist_rows = (await db.execute(hist_query)).all()
    data_map: dict[str, int] = {}
    for row in hist_rows:
        d = row.activation_date
        if isinstance(d, date):
            ds = d.strftime("%Y-%m-%d")
        else:
            ds = str(d)
        data_map[ds] = row[1]

    # Today → LiveActivation table
    today_str = today.strftime("%Y-%m-%d")
    live_query = (
        select(func.count())
        .select_from(LiveActivation)
        .where(LiveActivation.activation_date == today)
    )
    clause_l = exclude_clause(LiveActivation, excluded_codes)
    if clause_l is not None:
        live_query = live_query.where(clause_l)
    if target_house_id:
        live_query = live_query.where(LiveActivation.house_id == target_house_id)
    elif is_admin:
        pass
    else:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            live_query = live_query.where(LiveActivation.house_id.in_(user_house_ids))
        else:
            live_query = live_query.where(LiveActivation.house_id == -1)

    today_count = (await db.execute(live_query)).scalar()
    data_map[today_str] = today_count

    result = []
    d = month_start
    while d <= today:
        ds = d.strftime("%Y-%m-%d")
        result.append({"date": ds, "count": data_map.get(ds, 0)})
        d += timedelta(days=1)

    return result

