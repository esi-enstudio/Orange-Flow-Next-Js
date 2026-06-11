import logging
from typing import List, Optional
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.routers.deps import get_db, has_permission
from app.schemas.lifting import (
    LiftingPreviewResponse,
    LiftingRecordCreate,
    LiftingRecordSchema,
)
from app.models.lifting import LiftingRecord, LiftingProduct, LiftingStatus, PaymentMethod
from app.models.product import Product
from app.models.user import User

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
                quantity=quantity,
                unit_price=dd_price,
                total_price=dd_price * quantity,
            )
        )

    await db.commit()
    await db.refresh(record)

    # Ensure relationships are usable if needed by response
    return record
