from typing import Optional
from datetime import datetime, date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.routers.deps import get_db, has_permission, get_current_user
from app.models.retailer_visit import RetailerVisit
from app.models.employee import Employee
from app.models.user import User
from app.utils.access_control import is_admin_user

router = APIRouter(prefix="/api/retailer-visits", tags=["retailer_visits"])


@router.get("")
async def get_visits(
    retailer_id: Optional[int] = Query(None),
    employee_id: Optional[int] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("reports.view")),
):
    query = select(RetailerVisit).options(
        joinedload(RetailerVisit.retailer), joinedload(RetailerVisit.employee)
    )

    if retailer_id:
        query = query.where(RetailerVisit.retailer_id == retailer_id)
    if employee_id:
        query = query.where(RetailerVisit.employee_id == employee_id)
    else:
        emp = current_user.employee_profile
        if emp and not is_admin_user(current_user):
            query = query.where(RetailerVisit.employee_id == emp.id)
    if start_date:
        sd = datetime.strptime(start_date, "%Y-%m-%d").date()
        query = query.where(RetailerVisit.visit_date >= sd)
    if end_date:
        ed = datetime.strptime(end_date, "%Y-%m-%d").date()
        query = query.where(RetailerVisit.visit_date <= ed)

    result = await db.execute(query.order_by(RetailerVisit.visit_date.desc()))
    return {"data": result.unique().scalars().all()}


@router.post("")
async def create_visit(
    retailer_id: int = Query(...),
    visit_date: str = Query(...),
    purpose: Optional[str] = Query(None),
    notes: Optional[str] = Query(None),
    order_collected: Optional[str] = Query("No"),
    next_visit_date: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("reports.view")),
):
    emp = current_user.employee_profile
    if not emp:
        raise HTTPException(status_code=400, detail="No employee profile found")

    visit = RetailerVisit(
        retailer_id=retailer_id,
        employee_id=emp.id,
        visit_date=datetime.strptime(visit_date, "%Y-%m-%d").date(),
        purpose=purpose,
        notes=notes,
        order_collected=order_collected,
        next_visit_date=datetime.strptime(next_visit_date, "%Y-%m-%d").date() if next_visit_date else None,
    )
    db.add(visit)
    await db.commit()
    await db.refresh(visit)
    return {"success": True, "data": visit}
