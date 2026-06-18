from typing import Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.routers.deps import get_db, has_permission, get_current_user
from app.models.order_collection import OrderCollection
from app.models.user import User
from app.utils.access_control import is_admin_user

router = APIRouter(prefix="/api/orders", tags=["orders"])


@router.get("")
async def get_orders(
    retailer_id: Optional[int] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("reports.view")),
):
    query = select(OrderCollection).options(
        joinedload(OrderCollection.retailer), joinedload(OrderCollection.employee)
    )

    if retailer_id:
        query = query.where(OrderCollection.retailer_id == retailer_id)
    if start_date:
        query = query.where(OrderCollection.order_date >= datetime.strptime(start_date, "%Y-%m-%d").date())
    if end_date:
        query = query.where(OrderCollection.order_date <= datetime.strptime(end_date, "%Y-%m-%d").date())

    emp = current_user.employee_profile
    if emp and not is_admin_user(current_user):
        query = query.where(OrderCollection.employee_id == emp.id)

    result = await db.execute(query.order_by(OrderCollection.order_date.desc()))
    return {"data": result.unique().scalars().all()}


@router.post("")
async def create_order(
    retailer_id: int = Query(...),
    order_date: str = Query(...),
    items: str = Query("[]"),
    total_amount: float = Query(...),
    notes: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("reports.view")),
):
    emp = current_user.employee_profile
    if not emp:
        raise HTTPException(status_code=400, detail="No employee profile found")

    import json
    items_list = json.loads(items)

    order = OrderCollection(
        retailer_id=retailer_id,
        employee_id=emp.id,
        order_date=datetime.strptime(order_date, "%Y-%m-%d").date(),
        items=items_list,
        total_amount=total_amount,
        notes=notes,
    )
    db.add(order)
    await db.commit()
    await db.refresh(order)
    return {"success": True, "data": order}
