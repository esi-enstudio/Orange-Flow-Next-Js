from typing import Optional
from datetime import datetime, date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.routers.deps import get_db, has_permission, get_house_context, get_current_user
from app.models.bp_target import BpTarget
from app.models.employee import Employee
from app.models.user import User
from app.models.house_target import HouseTarget
from app.utils.access_control import is_admin_user

router = APIRouter(prefix="/api/bp-targets", tags=["bp_targets"])


@router.get("")
async def get_bp_targets(
    target_date: Optional[str] = Query(None),
    employee_id: Optional[int] = Query(None),
    house_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("targets.view")),
):
    query = select(BpTarget).options(joinedload(BpTarget.employee), joinedload(BpTarget.house))

    if house_id:
        query = query.where(BpTarget.house_id == house_id)
    else:
        user_house_ids = [h.id for h in current_user.houses]
        if not is_admin_user(current_user) and user_house_ids:
            query = query.where(BpTarget.house_id.in_(user_house_ids))

    if employee_id:
        query = query.where(BpTarget.employee_id == employee_id)
    if target_date:
        td = datetime.strptime(target_date, "%Y-%m-%d").date()
        if td.day != 1:
            td = date(td.year, td.month, 1)
        query = query.where(BpTarget.target_date == td)

    result = await db.execute(query.order_by(BpTarget.id.desc()))
    records = result.unique().scalars().all()
    return {"data": records}


@router.post("/distribute")
async def distribute_bp_targets(
    target_date: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("targets.edit")),
    house_id: Optional[int] = Depends(get_house_context),
):
    td = datetime.strptime(target_date, "%Y-%m-%d").date()
    if td.day != 1:
        td = date(td.year, td.month, 1)

    target_house_id = house_id
    if not target_house_id:
        user_house_ids = [h.id for h in current_user.houses]
        if not user_house_ids:
            raise HTTPException(status_code=400, detail="No house found")
        target_house_id = user_house_ids[0]

    house_target_res = await db.execute(
        select(HouseTarget).where(
            HouseTarget.house_id == target_house_id,
            HouseTarget.target_date == td,
        )
    )
    house_target = house_target_res.scalar_one_or_none()
    if not house_target or not house_target.bp_ga:
        raise HTTPException(status_code=404, detail="No BP GA target found for this house/month")

    bp_emps = await db.execute(
        select(Employee).where(
            Employee.house_id == target_house_id,
            Employee.employee_type == "bp",
            Employee.status == "Active",
        )
    )
    bp_list = bp_emps.scalars().all()
    if not bp_list:
        raise HTTPException(status_code=404, detail="No active BPs found in this house")

    per_bp_target = house_target.bp_ga // len(bp_list)
    created = 0
    for bp in bp_list:
        existing = await db.execute(
            select(BpTarget).where(
                BpTarget.employee_id == bp.id,
                BpTarget.target_date == td,
            )
        )
        if existing.scalar_one_or_none():
            continue
        bt = BpTarget(
            house_id=target_house_id,
            employee_id=bp.id,
            ga_target=per_bp_target,
            target_date=td,
        )
        db.add(bt)
        created += 1

    await db.commit()
    return {
        "success": True,
        "message": f"Distributed {house_target.bp_ga} BP GA target among {len(bp_list)} BPs ({per_bp_target} each)",
        "created": created,
    }


@router.put("/{target_id}")
async def update_bp_target(
    target_id: int,
    ga_target: int = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("targets.edit")),
):
    bt = await db.get(BpTarget, target_id)
    if not bt:
        raise HTTPException(status_code=404, detail="BP target not found")
    bt.ga_target = ga_target
    await db.commit()
    return {"success": True, "message": "BP target updated"}
