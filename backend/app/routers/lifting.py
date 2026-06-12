import logging
from typing import List, Optional
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status, Query
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
    current_user: User = Depends(has_any_permission(["view_lifting", "view_products"])),
    header_house_id: Optional[int] = Depends(get_house_context),
):
    is_admin = is_admin_user(current_user)
    query = select(LiftingRecord).options(
        selectinload(LiftingRecord.house),
        selectinload(LiftingRecord.products).selectinload(LiftingProduct.product),
    ).order_by(LiftingRecord.lifting_date.desc(), LiftingRecord.id.desc())

    conditions = []

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


@router.get("/{record_id}", response_model=LiftingRecordSchema)
async def get_lifting_record(
    record_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_lifting")),
):
    result = await db.execute(
        select(LiftingRecord)
        .options(
            selectinload(LiftingRecord.house),
            selectinload(LiftingRecord.products).selectinload(LiftingProduct.product),
        )
        .where(LiftingRecord.id == record_id)
    )
    record = result.unique().scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Lifting record not found")
    return record


@router.post("/preview", response_model=LiftingPreviewResponse)
async def preview_lifting(
    lifting_data: LiftingRecordCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_lifting")),
):
    if not lifting_data.products:
        raise HTTPException(status_code=422, detail="At least one product must be selected.")

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
    current_user: User = Depends(has_permission("create_lifting")),
):
    if not lifting_data.products:
        raise HTTPException(status_code=422, detail="At least one product must be selected.")

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

