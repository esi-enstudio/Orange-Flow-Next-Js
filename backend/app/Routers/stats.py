from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import date

from app.Routers.deps import get_db, has_permission, get_house_context
from app.Models.retailer import Retailer
from app.Models.house import House
from app.Models.bts import BTS
from app.Models.employee import Employee
from app.Models.user import User
from app.Models.activation import Activation
from app.Models.live_activation import LiveActivation
from app.Utils.access_control import is_admin_user
from app.Utils.activation_rules import get_excluded_codes, exclude_clause

router = APIRouter(prefix="/api", tags=["stats"])

@router.get("/stats")
async def get_stats(
    db: AsyncSession = Depends(get_db),
    current_user = Depends(has_permission("view_reports")),
    house_id: Optional[int] = Depends(get_house_context)
):
    excluded_codes = await get_excluded_codes(db)
    today_str = date.today().strftime("%Y-%m-%d")

    retailer_query = select(func.count()).select_from(Retailer)
    house_query = select(func.count()).select_from(House)
    bts_query = select(func.count()).select_from(BTS)
    emp_query = select(func.count()).select_from(Employee)
    user_query = select(func.count()).select_from(User).where(User.status == "Active")
    activation_query = (
        select(func.count())
        .select_from(LiveActivation)
        .where(LiveActivation.activation_date == today_str)
    )
    clause = exclude_clause(LiveActivation, excluded_codes)
    if clause is not None:
        activation_query = activation_query.where(clause)

    is_admin = is_admin_user(current_user)

    if house_id:
        retailer_query = retailer_query.where(Retailer.house_id == house_id)
        emp_query = emp_query.where(Employee.house_id == house_id)
        house_query = house_query.where(House.id == house_id)
        bts_query = bts_query.where(BTS.house_id == house_id)
        activation_query = activation_query.where(LiveActivation.house_id == house_id)
    elif is_admin:
        pass
    else:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            retailer_query = retailer_query.where(Retailer.house_id.in_(user_house_ids))
            emp_query = emp_query.where(Employee.house_id.in_(user_house_ids))
            house_query = house_query.where(House.id.in_(user_house_ids))
            bts_query = bts_query.where(BTS.house_id.in_(user_house_ids))
            activation_query = activation_query.where(LiveActivation.house_id.in_(user_house_ids))
        else:
            retailer_query = retailer_query.where(Retailer.house_id == -1)
            emp_query = emp_query.where(Employee.house_id == -1)
            house_query = house_query.where(House.id == -1)
            bts_query = bts_query.where(BTS.house_id == -1)
            activation_query = activation_query.where(LiveActivation.house_id == -1)

    retailer_count = (await db.execute(retailer_query)).scalar()
    house_count = (await db.execute(house_query)).scalar()
    bts_count = (await db.execute(bts_query)).scalar()
    emp_count = (await db.execute(emp_query)).scalar()
    active_users = (await db.execute(user_query)).scalar()
    today_activations = (await db.execute(activation_query)).scalar()

    return {
        "total_retailers": retailer_count,
        "total_houses": house_count,
        "total_bts": bts_count,
        "total_employees": emp_count,
        "active_users": active_users,
        "today_activations": today_activations,
    }
