import logging
from typing import Optional, List
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, and_, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.routers.deps import get_db, has_permission, get_current_user, get_house_context
from app.schemas.sales import (
    SalesCreate, SalesUpdate, SalesResponse,
    BatchSalesCreate, SalesEntry, SalesSummary,
)
from app.schemas.pagination import PaginationParams, PaginatedResponse, PaginationMeta
from app.models.sales import DailySales
from app.models.product import Product
from app.models.user import User
from app.utils.access_control import is_admin_user
from app.utils.activity_logger import log_activity
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sales", tags=["Sales"])


@router.post("/batch")
async def batch_create_sales(
    body: BatchSalesCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sales.create")),
    house_id: Optional[int] = Depends(get_house_context),
):
    target_house_id = house_id or current_user.houses[0].id if current_user.houses else None
    if not target_house_id:
        raise HTTPException(status_code=400, detail="No house context available")

    product_ids = [e.product_id for e in body.entries]
    result = await db.execute(
        select(Product).where(Product.id.in_(product_ids), Product.status == "Active")
    )
    valid_products = {p.id for p in result.scalars().all()}
    for e in body.entries:
        if e.product_id not in valid_products:
            raise HTTPException(status_code=400, detail=f"Product {e.product_id} not found or inactive")

    created = []
    updated = []
    for entry in body.entries:
        sales_amount = entry.sold_quantity * entry.unit_price

        existing = await db.execute(
            select(DailySales).where(
                DailySales.house_id == target_house_id,
                DailySales.product_id == entry.product_id,
                DailySales.date == body.date,
                DailySales.is_deleted == False,
            )
        )
        record = existing.scalar_one_or_none()

        if record:
            record.sold_quantity = entry.sold_quantity
            record.unit_price = entry.unit_price
            record.total_sales_amount = sales_amount
            record.updated_by = current_user.id
            updated.append(record)
        else:
            record = DailySales(
                house_id=target_house_id,
                product_id=entry.product_id,
                date=body.date,
                sold_quantity=entry.sold_quantity,
                unit_price=entry.unit_price,
                total_sales_amount=sales_amount,
                created_by=current_user.id,
                updated_by=current_user.id,
            )
            db.add(record)
            created.append(record)

    await db.commit()
    for r in created + updated:
        await db.refresh(r)

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="sales", action="batch_create" if created else "batch_update",
        record_id=None, request=request, status_code=200,
        new_values={"date": str(body.date), "entries": len(body.entries),
                     "created": len(created), "updated": len(updated)},
    )

    return {
        "success": True,
        "message": f"Created {len(created)}, updated {len(updated)} entries",
        "created_count": len(created),
        "updated_count": len(updated),
    }


@router.get("", response_model=PaginatedResponse)
async def list_sales(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    product_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sales.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    user_house_ids = [h.id for h in current_user.houses]

    query = (
        select(DailySales)
        .options(selectinload(DailySales.product))
        .where(DailySales.is_deleted == False)
    )

    if is_admin_user(current_user) and house_id:
        query = query.where(DailySales.house_id == house_id)
    elif not is_admin_user(current_user):
        if house_id:
            if house_id not in user_house_ids:
                raise HTTPException(status_code=403, detail="Access denied to this house")
            query = query.where(DailySales.house_id == house_id)
        else:
            query = query.where(DailySales.house_id.in_(user_house_ids))

    if date_from:
        query = query.where(DailySales.date >= date_from)
    if date_to:
        query = query.where(DailySales.date <= date_to)
    if product_id:
        query = query.where(DailySales.product_id == product_id)
    if search:
        pattern = f"%{search}%"
        query = query.join(DailySales.product).where(
            or_(Product.product_name.ilike(pattern), Product.product_code.ilike(pattern))
        )

    total_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(total_query)
    total = total_result.scalar() or 0

    query = query.order_by(DailySales.date.desc(), DailySales.id.desc())

    offset = (pagination.page - 1) * pagination.per_page
    query = query.offset(offset).limit(pagination.per_page)

    result = await db.execute(query)
    records = result.unique().scalars().all()

    data = [SalesResponse.model_validate(r) for r in records]

    return PaginatedResponse(
        success=True,
        data=data,
        pagination=PaginationMeta(
            page=pagination.page,
            per_page=pagination.per_page,
            total=total,
            total_pages=max(1, (total + pagination.per_page - 1) // pagination.per_page),
            has_next=(pagination.page * pagination.per_page) < total,
            has_prev=pagination.page > 1,
        ),
    )


@router.get("/summary", response_model=SalesSummary)
async def get_sales_summary(
    date: date = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sales.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    user_house_ids = [h.id for h in current_user.houses]

    query = select(
        func.coalesce(func.sum(DailySales.sold_quantity), 0),
        func.coalesce(func.sum(DailySales.total_sales_amount), 0.0),
        func.count(DailySales.id),
    ).where(DailySales.date == date, DailySales.is_deleted == False)

    if is_admin_user(current_user) and house_id:
        query = query.where(DailySales.house_id == house_id)
    elif not is_admin_user(current_user):
        if house_id:
            query = query.where(DailySales.house_id == house_id)
        else:
            query = query.where(DailySales.house_id.in_(user_house_ids))

    result = await db.execute(query)
    row = result.one()

    return SalesSummary(
        total_sold=row[0] or 0,
        total_sales_amount=float(row[1] or 0),
        entry_count=row[2] or 0,
    )


@router.get("/products")
async def get_products_for_sales(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sales.view")),
):
    result = await db.execute(
        select(Product).where(Product.status == "Active").order_by(Product.category, Product.product_name)
    )
    products = result.scalars().all()
    return [
        {"id": p.id, "product_name": p.product_name, "product_code": p.product_code, "category": p.category}
        for p in products
    ]


@router.get("/{record_id}", response_model=SalesResponse)
async def get_sales_record(
    record_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sales.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    query = (
        select(DailySales)
        .options(selectinload(DailySales.product))
        .where(DailySales.id == record_id, DailySales.is_deleted == False)
    )
    result = await db.execute(query)
    record = result.unique().scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")

    user_house_ids = [h.id for h in current_user.houses]
    if not is_admin_user(current_user) and record.house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="Access denied")

    return SalesResponse.model_validate(record)


@router.put("/{record_id}", response_model=SalesResponse)
async def update_sales_record(
    record_id: int,
    body: SalesUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sales.edit")),
    house_id: Optional[int] = Depends(get_house_context),
):
    result = await db.execute(
        select(DailySales).where(DailySales.id == record_id, DailySales.is_deleted == False)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")

    user_house_ids = [h.id for h in current_user.houses]
    if not is_admin_user(current_user) and record.house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="Access denied")

    old_values = {
        "sold_quantity": record.sold_quantity,
        "unit_price": record.unit_price,
    }

    if body.sold_quantity is not None:
        record.sold_quantity = body.sold_quantity
    if body.unit_price is not None:
        record.unit_price = body.unit_price
    if body.notes is not None:
        record.notes = body.notes

    record.total_sales_amount = record.sold_quantity * record.unit_price
    record.updated_by = current_user.id

    await db.commit()
    await db.refresh(record)

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="sales", action="edit", record_id=record.id,
        old_values=old_values,
        new_values={
            "sold_quantity": record.sold_quantity,
            "unit_price": record.unit_price,
        },
        request=request, status_code=200,
    )

    return SalesResponse.model_validate(record)


@router.delete("/{record_id}")
async def delete_sales_record(
    record_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sales.delete")),
    house_id: Optional[int] = Depends(get_house_context),
):
    result = await db.execute(
        select(DailySales).where(DailySales.id == record_id, DailySales.is_deleted == False)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")

    user_house_ids = [h.id for h in current_user.houses]
    if not is_admin_user(current_user) and record.house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="Access denied")

    record.is_deleted = True
    record.deleted_at = now_naive()
    record.deleted_by = current_user.id
    await db.commit()

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="sales", action="delete", record_id=record.id,
        old_values={"date": str(record.date), "product_id": record.product_id},
        request=request, status_code=200,
    )

    return {"success": True, "message": "Record deleted successfully"}
