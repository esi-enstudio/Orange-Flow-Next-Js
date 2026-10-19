import logging
from typing import List, Optional, Tuple
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status, Query, Request, Response
from sqlalchemy import select, and_, or_, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.routers.deps import get_db, has_permission, has_any_permission, get_house_context
from app.schemas.lifting import (
    LiftingPreviewResponse,
    LiftingRecordCreate,
    LiftingRecordUpdate,
    LiftingRecordSchema,
)
from app.models.lifting import LiftingRecord, LiftingProduct, LiftingStatus, PaymentMethod
from app.models.product import Product
from app.models.house import House
from app.models.user import User
from app.constants.dms import DMS_BANK_BY_ID, DMS_BANK_IDS
from app.utils.access_control import is_admin_user
from app.utils.activity_logger import log_activity
from app.utils.timezone import now_naive
from app.services.Automation.lifting_excel import export_lifting_records_excel
from app.services.Automation.lifting_statement_pdf import build_lifting_statement_pdf

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


def _resolve_bank(bank_id: Optional[int]) -> tuple[Optional[int], Optional[str]]:
    """Validate the DMS BankId and resolve its display name."""
    if bank_id is None:
        return None, None
    if bank_id not in DMS_BANK_IDS:
        raise HTTPException(status_code=422, detail="Invalid DMS bank selection.")
    return bank_id, DMS_BANK_BY_ID[bank_id]


def _build_lifting_conditions(
    *,
    current_user: User,
    header_house_id: Optional[int],
    house_id: Optional[int],
    date_from: Optional[date],
    date_to: Optional[date],
    status: Optional[str],
    search: Optional[str],
) -> Tuple[list, Optional[int]]:
    """
    Shared WHERE conditions for lifting list/export/summary so the summary always
    reflects exactly the same (house/db isolated) filter set as the list.
    Returns the conditions and the effective house id (for activity logging).
    """
    conditions = [LiftingRecord.is_deleted == False]

    eff_house_id = header_house_id or house_id
    if eff_house_id:
        conditions.append(LiftingRecord.house_id == eff_house_id)
    elif not is_admin_user(current_user):
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

    return conditions, eff_house_id


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
    conditions, _ = _build_lifting_conditions(
        current_user=current_user,
        header_house_id=header_house_id,
        house_id=house_id,
        date_from=date_from,
        date_to=date_to,
        status=status,
        search=search,
    )

    query = select(LiftingRecord).options(
        selectinload(LiftingRecord.house),
        selectinload(LiftingRecord.products).selectinload(LiftingProduct.product),
    ).where(and_(*conditions)).order_by(
        LiftingRecord.lifting_date.desc(), LiftingRecord.id.desc()
    )

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
    conditions, eff_house_id = _build_lifting_conditions(
        current_user=current_user,
        header_house_id=header_house_id,
        house_id=house_id,
        date_from=date_from,
        date_to=date_to,
        status=status,
        search=search,
    )

    query = select(LiftingRecord).options(
        selectinload(LiftingRecord.house),
        selectinload(LiftingRecord.products).selectinload(LiftingProduct.product),
    ).where(and_(*conditions)).order_by(
        LiftingRecord.lifting_date.desc(), LiftingRecord.id.desc()
    )

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


@router.get("/summary")
async def lifting_summary(
    house_id: Optional[int] = Query(None, description="Filter by house"),
    date_from: Optional[date] = Query(None, description="Start date (YYYY-MM-DD)"),
    date_to: Optional[date] = Query(None, description="End date (YYYY-MM-DD)"),
    status: Optional[str] = Query(None, description="Filter by status"),
    search: Optional[str] = Query(None, description="Search by product code/name or notes"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("lifting.view")),
    header_house_id: Optional[int] = Depends(get_house_context),
):
    """
    Totals for the currently filtered lifting records: bank deposit, lifting value,
    iTopUp and the product value/quantity grouped by product category.

    Each category carries both `mrp_amount` (current product MRP x quantity) and
    `amount` (the stored DD lifting price x quantity). MRP is the headline number,
    the lifting value stays available as the subtotal.
    """
    conditions, _ = _build_lifting_conditions(
        current_user=current_user,
        header_house_id=header_house_id,
        house_id=house_id,
        date_from=date_from,
        date_to=date_to,
        status=status,
        search=search,
    )

    totals_stmt = select(
        func.count(LiftingRecord.id),
        func.coalesce(func.sum(LiftingRecord.total_bank_deposit), 0.0),
        func.coalesce(func.sum(LiftingRecord.total_lifting_amount), 0.0),
        func.coalesce(func.sum(LiftingRecord.itopup_amount), 0.0),
        func.coalesce(func.sum(LiftingRecord.remaining_amount), 0.0),
    ).where(and_(*conditions))

    (
        total_records,
        total_bank_deposit,
        total_lifting_amount,
        total_itopup,
        total_remaining,
    ) = (await db.execute(totals_stmt)).one()

    category_stmt = (
        select(
            Product.category,
            func.coalesce(func.sum(LiftingProduct.quantity), 0),
            func.coalesce(func.sum(LiftingProduct.total_price), 0.0),
            func.coalesce(
                func.sum(func.coalesce(Product.mrp, 0.0) * LiftingProduct.quantity), 0.0
            ),
        )
        .select_from(LiftingProduct)
        .join(LiftingRecord, LiftingProduct.lifting_record_id == LiftingRecord.id)
        .join(Product, LiftingProduct.product_id == Product.id)
        .where(and_(*conditions))
        .group_by(Product.category)
        .order_by(func.sum(Product.mrp * LiftingProduct.quantity).desc().nullslast())
    )
    category_rows = (await db.execute(category_stmt)).all()

    categories = [
        {
            "category": category or "Other",
            "quantity": int(quantity or 0),
            "amount": round(float(amount or 0.0), 2),
            "mrp_amount": round(float(mrp_amount or 0.0), 2),
        }
        for category, quantity, amount, mrp_amount in category_rows
    ]

    return {
        "success": True,
        "data": {
            "total_records": int(total_records or 0),
            "total_bank_deposit": round(float(total_bank_deposit or 0.0), 2),
            "total_lifting_amount": round(float(total_lifting_amount or 0.0), 2),
            "total_itopup": round(float(total_itopup or 0.0), 2),
            "total_remaining": round(float(total_remaining or 0.0), 2),
            "total_quantity": sum(c["quantity"] for c in categories),
            "categories": categories,
        },
    }


@router.get("/statement")
async def lifting_statement(
    house_id: Optional[int] = Query(None, description="Filter by house"),
    date_from: Optional[date] = Query(None, description="Start date (YYYY-MM-DD)"),
    date_to: Optional[date] = Query(None, description="End date (YYYY-MM-DD)"),
    status: Optional[str] = Query(None, description="Filter by status"),
    search: Optional[str] = Query(None, description="Search by product code/name or notes"),
    db: AsyncSession = Depends(get_db),
    request: Request = None,
    current_user: User = Depends(has_permission("lifting.export")),
    header_house_id: Optional[int] = Depends(get_house_context),
):
    """
    Printable PDF statement (one or more pages) for the lifting records that
    match the current filters. Totals, category breakdown and every product line
    are included; the house scope comes from the X-House-ID header / house_id.
    """
    conditions, eff_house_id = _build_lifting_conditions(
        current_user=current_user,
        header_house_id=header_house_id,
        house_id=house_id,
        date_from=date_from,
        date_to=date_to,
        status=status,
        search=search,
    )

    query = (
        select(LiftingRecord)
        .options(
            selectinload(LiftingRecord.house),
            selectinload(LiftingRecord.products).selectinload(LiftingProduct.product),
        )
        .where(and_(*conditions))
        .order_by(LiftingRecord.lifting_date.asc(), LiftingRecord.id.asc())
    )
    records = (await db.execute(query)).unique().scalars().all()

    if not records:
        # NOTE: `status` is the query filter here, so it shadows fastapi.status.
        raise HTTPException(
            status_code=400,
            detail="No lifting records match the selected filters.",
        )

    house_name = "All Houses"
    if eff_house_id:
        house = await db.get(House, eff_house_id)
        house_name = house.display_name if house else f"House #{eff_house_id}"

    if date_from and date_to:
        period_label = f"{date_from.strftime('%d %b %Y')} - {date_to.strftime('%d %b %Y')}"
    elif date_from:
        period_label = f"From {date_from.strftime('%d %b %Y')}"
    elif date_to:
        period_label = f"Up to {date_to.strftime('%d %b %Y')}"
    else:
        period_label = "All dates"

    pdf_bytes = build_lifting_statement_pdf(
        records,
        house_name=house_name,
        period_label=period_label,
        generated_by=current_user.name,
        generated_at=now_naive(),
    )

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="lifting",
        action="export",
        record_identifier=f"{len(records)} records",
        new_values={
            "format": "pdf",
            "statement": True,
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

    filename = (
        "lifting_statement_"
        f"{date_from.isoformat() if date_from else 'start'}_"
        f"{date_to.isoformat() if date_to else 'end'}.pdf"
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
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
    bank_id, bank_name = _resolve_bank(lifting_data.bank_id)

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
        deposit_slip=lifting_data.deposit_slip,
        bank_id=bank_id,
        bank_name=bank_name,
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


@router.patch("/{record_id}", response_model=LiftingRecordSchema)
async def update_lifting_record(
    record_id: int,
    lifting_data: LiftingRecordUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("lifting.edit")),
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

    user_house_ids = [h.id for h in current_user.houses]
    if not is_admin_user(current_user) and record.house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="Access denied")

    # Enforce 1-hour edit window for non-admin users
    if not is_admin_user(current_user) and record.created_at:
        elapsed = (now_naive() - record.created_at).total_seconds()
        if elapsed > 3600:
            raise HTTPException(
                status_code=403,
                detail="Edit window of 1 hour has expired after record creation."
            )

    if lifting_data.notes is not None:
        record.notes = lifting_data.notes
    if lifting_data.deposit_slip is not None:
        record.deposit_slip = lifting_data.deposit_slip
    if "bank_id" in lifting_data.model_fields_set:
        bank_id, bank_name = _resolve_bank(lifting_data.bank_id)
        record.bank_id = bank_id
        record.bank_name = bank_name
    if lifting_data.status is not None:
        record.status = LiftingStatus(lifting_data.status)
    if lifting_data.total_bank_deposit is not None:
        record.total_bank_deposit = lifting_data.total_bank_deposit

    if lifting_data.products is not None:
        product_ids = [p.product_id for p in lifting_data.products]
        res_prods = await db.execute(
            select(Product).where(Product.id.in_(product_ids))
        )
        products = res_prods.scalars().all()
        found_ids = {p.id for p in products}
        missing = [pid for pid in product_ids if pid not in found_ids]
        if missing:
            raise HTTPException(status_code=404, detail=f"Products not found: {missing}")

        product_map = {p.id: p for p in products}
        selected = [{"product": product_map[p.product_id], "quantity": p.quantity} for p in lifting_data.products]

        computed = _compute_lifting(
            total_bank_deposit=float(record.total_bank_deposit),
            products=selected,
        )
        record.total_lifting_amount = computed["total_lifting_amount"]
        record.remaining_amount = computed["remaining_amount"]
        record.itopup_amount = computed["itopup_amount"]

        record.products.clear()
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
    elif lifting_data.total_bank_deposit is not None:
        remaining = float(record.total_bank_deposit) - float(record.total_lifting_amount)
        record.remaining_amount = remaining
        record.itopup_amount = remaining / TOPUP_DIVISOR if TOPUP_DIVISOR else 0.0

    await db.commit()
    await db.refresh(record)

    # Reload relationships
    stmt = (
        select(LiftingRecord)
        .options(
            selectinload(LiftingRecord.house),
            selectinload(LiftingRecord.products).selectinload(LiftingProduct.product)
        )
        .where(LiftingRecord.id == record.id)
    )
    result = await db.execute(stmt)
    return result.scalar_one()

