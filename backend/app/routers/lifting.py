import logging
from typing import List, Optional
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status, Query, Request, Response
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.routers.deps import get_db, has_permission, has_any_permission, get_house_context
from app.schemas.lifting import (
    LiftingPreviewResponse,
    LiftingRecordCreate,
    LiftingRecordSchema,
)
from app.models.lifting import LiftingRecord, LiftingProduct, LiftingStatus, PaymentMethod
from app.models.product import Product
from app.models.user import User
from app.utils.access_control import is_admin_user
from app.utils.activity_logger import log_activity
from app.utils.timezone import now_naive
from app.services.Automation.lifting_excel import export_lifting_records_excel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/lifting", tags=["lifting"])

TOPUP_DIVISOR = 0.9625


def _compute_lifting(
    *,
    total_bank_deposit: float,
    products: List[dict],
):
    """
    products: list of {product: Product, quantity: int}
    """
    total_lifting_amount = 0.0
    computed_products = []

    for item in products:
        product: Product = item["product"]
        quantity: int = item["quantity"]

        dd_price = float(product.dd_lifting_price or 0.0)
        line_total = dd_price * quantity
        total_lifting_amount += line_total

        computed_products.append(
            {
                "product_id": product.id,
                "product_code": product.product_code,
                "product_name": product.product_name,
                "category": product.category,
                "subcategory": product.subcategory,
                "quantity": quantity,
                "unit_price": dd_price,
                "total_price": line_total,
            }
        )

    remaining_amount = float(total_bank_deposit) - float(total_lifting_amount)
    itopup_amount = remaining_amount / TOPUP_DIVISOR if TOPUP_DIVISOR else 0.0

    return {
        "total_lifting_amount": total_lifting_amount,
        "remaining_amount": remaining_amount,
        "itopup_amount": itopup_amount,
        "products": computed_products,
    }


@router.get("", response_model=List[LiftingRecordSchema])
async def list_lifting_records(
    house_id: Optional[int] = Query(None, description="Filter by house"),
    date_from: Optional[date] = Query(None, description="Start date (YYYY-MM-DD)"),
    date_to: Optional[date] = Query(None, description="End date (YYYY-MM-DD)"),
    status: Optional[str] = Query(None, description="Filter by status"),
    search: Optional[str] = Query(None, description="Search by product code/name or notes"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_any_permission(["lifting.view", "products.view"])),
    header_house_id: Optional[int] = Depends(get_house_context),
):
    is_admin = is_admin_user(current_user)
    query = select(LiftingRecord).options(
        selectinload(LiftingRecord.house),
        selectinload(LiftingRecord.products).selectinload(LiftingProduct.product),
    ).order_by(LiftingRecord.lifting_date.desc(), LiftingRecord.id.desc())

    conditions = [LiftingRecord.is_deleted == False]

    eff_house_id = header_house_id or house_id
    if eff_house_id:
        conditions.append(LiftingRecord.house_id == eff_house_id)
    elif not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            conditions.append(LiftingRecord.house_id.in_(user_house_ids))
        else:
            conditions.append(LiftingRecord.house_id == -1)

    if date_from:
        conditions.append(LiftingRecord.lifting_date >= date_from)
    if date_to:
        conditions.append(LiftingRecord.lifting_date <= date_to)
    if status:
        conditions.append(LiftingRecord.status == status)

    if search:
        pattern = f"%{search}%"
        subq = select(LiftingProduct.lifting_record_id).where(
            or_(
                LiftingProduct.product_code.ilike(pattern),
                LiftingProduct.product_name.ilike(pattern),
            )
        ).subquery()
        conditions.append(
            or_(
                LiftingRecord.id.in_(subq),
                LiftingRecord.notes.ilike(pattern),
            )
        )

    if conditions:
        query = query.where(and_(*conditions))

    query = query.offset(offset).limit(limit)
    result = await db.execute(query)
    return result.unique().scalars().all()


@router.get("/export")
async def export_lifting_records(
    house_id: Optional[int] = Query(None, description="Filter by house"),
    date_from: Optional[date] = Query(None, description="Start date (YYYY-MM-DD)"),
    date_to: Optional[date] = Query(None, description="End date (YYYY-MM-DD)"),
    status: Optional[str] = Query(None, description="Filter by status"),
    search: Optional[str] = Query(None, description="Search by product code/name or notes"),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
    current_user: User = Depends(has_any_permission(["lifting.view", "lifting.export"])),
    header_house_id: Optional[int] = Depends(get_house_context),
):
    is_admin = is_admin_user(current_user)
    query = select(LiftingRecord).options(
        selectinload(LiftingRecord.house),
        selectinload(LiftingRecord.products).selectinload(LiftingProduct.product),
    ).order_by(LiftingRecord.lifting_date.desc(), LiftingRecord.id.desc())

    conditions = [LiftingRecord.is_deleted == False]

    eff_house_id = header_house_id or house_id
    if eff_house_id:
        conditions.append(LiftingRecord.house_id == eff_house_id)
    elif not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            conditions.append(LiftingRecord.house_id.in_(user_house_ids))
        else:
            conditions.append(LiftingRecord.house_id == -1)

    if date_from:
        conditions.append(LiftingRecord.lifting_date >= date_from)
    if date_to:
        conditions.append(LiftingRecord.lifting_date <= date_to)
    if status:
        conditions.append(LiftingRecord.status == status)

    if search:
        pattern = f"%{search}%"
        subq = select(LiftingProduct.lifting_record_id).where(
            or_(
                LiftingProduct.product_code.ilike(pattern),
                LiftingProduct.product_name.ilike(pattern),
            )
        ).subquery()
        conditions.append(
            or_(
                LiftingRecord.id.in_(subq),
                LiftingRecord.notes.ilike(pattern),
            )
        )

    if conditions:
        query = query.where(and_(*conditions))

    result = await db.execute(query)
    records = result.unique().scalars().all()

    excel_data = await export_lifting_records_excel(records)
    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="lifting",
        action="export",
        record_identifier=f"{len(records)} records",
        new_values={
            "house_id": eff_house_id,
            "date_from": date_from.isoformat() if date_from else None,
            "date_to": date_to.isoformat() if date_to else None,
            "status": status,
            "search": search,
            "count": len(records),
        },
        request=request,
        status_code=200,
    )
    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=lifting_records_export.xlsx"}
    )


@router.get("/{record_id}", response_model=LiftingRecordSchema)
async def get_lifting_record(
    record_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("lifting.view")),
):
    result = await db.execute(
        select(LiftingRecord)
        .options(
            selectinload(LiftingRecord.house),
            selectinload(LiftingRecord.products).selectinload(LiftingProduct.product),
        )
        .where(LiftingRecord.id == record_id, LiftingRecord.is_deleted == False)
    )
    record = result.unique().scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Lifting record not found")
    return record


@router.delete("/{record_id}")
async def delete_lifting_record(
    record_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("lifting.delete")),
    header_house_id: Optional[int] = Depends(get_house_context),
):
    result = await db.execute(
        select(LiftingRecord)
        .options(
            selectinload(LiftingRecord.house),
            selectinload(LiftingRecord.products),
        )
        .where(LiftingRecord.id == record_id, LiftingRecord.is_deleted == False)
    )
    record = result.unique().scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Lifting record not found")

    user_house_ids = [h.id for h in current_user.houses]
    if not is_admin_user(current_user) and record.house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="Access denied")

    house_name = (record.house.display_name or record.house.name) if record.house else f"House #{record.house_id}"
    record.is_deleted = True
    record.deleted_at = now_naive()
    record.deleted_by = current_user.id
    await db.commit()

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="lifting", action="delete", record_id=record.id,
        record_identifier=f"{record.lifting_date} ({house_name})",
        old_values={
            "lifting_date": str(record.lifting_date),
            "house_id": record.house_id,
            "status": getattr(record.status, "value", record.status),
            "total_lifting_amount": record.total_lifting_amount,
            "total_bank_deposit": record.total_bank_deposit,
        },
        request=request, status_code=200,
    )

    return {"success": True, "message": "Lifting record deleted successfully"}


@router.post("/preview", response_model=LiftingPreviewResponse)
async def preview_lifting(
    lifting_data: LiftingRecordCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("lifting.view")),
):
    if not lifting_data.products and lifting_data.total_bank_deposit <= 0:
        raise HTTPException(status_code=422, detail="Select at least one product or enter a positive bank deposit for iTopUp lifting.")

    product_ids = [p.product_id for p in lifting_data.products]
    result = await db.execute(
        select(Product).where(Product.id.in_(product_ids))
    )
    products = result.scalars().all()

    found_ids = {p.id for p in products}
    missing = [pid for pid in product_ids if pid not in found_ids]
    if missing:
        raise HTTPException(status_code=404, detail=f"Products not found: {missing}")

    # Map for quick lookup
    product_map = {p.id: p for p in products}
    selected = [{"product": product_map[p.product_id], "quantity": p.quantity} for p in lifting_data.products]

    computed = _compute_lifting(
        total_bank_deposit=lifting_data.total_bank_deposit,
        products=selected,
    )

    return LiftingPreviewResponse(
        total_lifting_amount=computed["total_lifting_amount"],
        remaining_amount=computed["remaining_amount"],
        itopup_amount=computed["itopup_amount"],
        products=computed["products"],
    )


@router.post("", response_model=LiftingRecordSchema, status_code=status.HTTP_201_CREATED)
async def create_lifting(
    lifting_data: LiftingRecordCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("lifting.create")),
):
    if not lifting_data.products and lifting_data.total_bank_deposit <= 0:
        raise HTTPException(status_code=422, detail="Select at least one product or enter a positive bank deposit for iTopUp lifting.")

    product_ids = [p.product_id for p in lifting_data.products]
    result = await db.execute(
        select(Product).where(Product.id.in_(product_ids))
    )
    products = result.scalars().all()

    found_ids = {p.id for p in products}
    missing = [pid for pid in product_ids if pid not in found_ids]
    if missing:
        raise HTTPException(status_code=404, detail=f"Products not found: {missing}")

    product_map = {p.id: p for p in products}
    selected = [{"product": product_map[p.product_id], "quantity": p.quantity} for p in lifting_data.products]

    computed = _compute_lifting(
        total_bank_deposit=lifting_data.total_bank_deposit,
        products=selected,
    )

    # Persist record
    record = LiftingRecord(
        house_id=lifting_data.house_id,
        lifting_date=lifting_data.lifting_date,
        payment_method=PaymentMethod(lifting_data.payment_method),
        total_bank_deposit=lifting_data.total_bank_deposit,
        total_lifting_amount=computed["total_lifting_amount"],
        remaining_amount=computed["remaining_amount"],
        itopup_amount=computed["itopup_amount"],
        status=LiftingStatus.CONFIRMED,
        notes=lifting_data.notes,
    )
    db.add(record)

    # Persist lifting_products
    for item in selected:
        product: Product = item["product"]
        quantity: int = item["quantity"]

        dd_price = float(product.dd_lifting_price or 0.0)
        record.products.append(
            LiftingProduct(
                product_id=product.id,
                product_code=product.product_code,
                product_name=product.product_name,
                quantity=quantity,
                unit_price=dd_price,
                total_price=dd_price * quantity,
            )
        )

    await db.commit()

    # Eagerly load the relationships to prevent MissingGreenlet errors during serialization
    stmt = (
        select(LiftingRecord)
        .options(
            selectinload(LiftingRecord.house),
            selectinload(LiftingRecord.products).selectinload(LiftingProduct.product)
        )
        .where(LiftingRecord.id == record.id)
    )
    result = await db.execute(stmt)
    refreshed_record = result.scalar_one()

    return refreshed_record

