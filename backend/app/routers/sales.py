from typing import Optional
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.routers.deps import get_db, has_permission, get_current_user, get_house_context, require_house_context
from app.models.sales import SalesRecord
from app.models.product import Product
from app.models.employee import Employee
from app.models.user import User
from app.schemas.sales import SalesCreate, SalesBulkCreate, SalesSchema, SalesSummary
from app.services.stock_service import apply_stock_change, ensure_house_access, LOCATION_RSO
from app.utils.access_control import is_admin_user
from app.utils.activity_logger import log_activity
from app.utils.timezone import now_naive

router = APIRouter(prefix="/api/sales", tags=["Sales"])


def _pagination(page: int, per_page: int, total: int):
    total_pages = (total + per_page - 1) // per_page if total else 0
    return {
        "page": page,
        "per_page": per_page,
        "total": total,
        "total_pages": total_pages,
        "has_next": page < total_pages,
        "has_prev": page > 1,
    }


def _emp_name(emp) -> Optional[str]:
    if emp is None:
        return None
    return (getattr(emp, "user", None).name if getattr(emp, "user", None) else None) \
        or emp.employee_id or emp.dms_code or None


def _house_filter_condition(Model, user: User, house_id: Optional[int]):
    if house_id:
        return Model.house_id == house_id
    if not is_admin_user(user):
        user_house_ids = [h.id for h in user.houses]
        if user_house_ids:
            return Model.house_id.in_(user_house_ids)
        return Model.house_id == -1
    return None


def _parse_sale_date(raw: Optional[str]) -> date:
    if not raw:
        return date.today()
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid sale_date format, expected YYYY-MM-DD")


@router.post("", status_code=201)
async def create_sale(
    data: SalesCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sales.create")),
    house_id: int = Depends(require_house_context),
):
    await ensure_house_access(current_user, house_id)
    product = (await db.execute(select(Product).where(Product.id == data.product_id))).scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if data.source_type == LOCATION_RSO and not data.employee_id:
        raise HTTPException(status_code=422, detail="employee_id is required for RSO sales")
    if data.source_type == LOCATION_RSO and data.employee_id:
        emp = (await db.execute(select(Employee).where(Employee.id == data.employee_id))).scalar_one_or_none()
        if not emp or emp.house_id != house_id:
            raise HTTPException(status_code=404, detail="Employee not found in this house")

    try:
        try:
            item = await apply_stock_change(
                db, house_id=house_id, product_id=data.product_id,
                location_type=data.source_type, employee_id=data.employee_id,
                delta=-data.quantity, movement_type="sale",
                reference_type="sale", reason="Sale", user_id=current_user.id,
            )
        except HTTPException as e:
            if "Insufficient" in str(e.detail):
                raise HTTPException(status_code=400, detail=f"Insufficient stock for {product.product_code} ({product.product_name})")
            raise
    except HTTPException:
        await db.rollback()
        raise

    sale = SalesRecord(
        house_id=house_id,
        product_id=data.product_id,
        source_type=data.source_type,
        employee_id=data.employee_id,
        quantity=data.quantity,
        unit_price=data.unit_price,
        total_amount=round(data.quantity * data.unit_price, 2),
        sale_date=_parse_sale_date(data.sale_date),
        notes=data.notes,
        created_by=current_user.id,
    )
    db.add(sale)
    await db.commit()
    await db.refresh(sale)

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="sales", action="create", record_id=sale.id,
        record_identifier=product.product_code,
        new_values=data.model_dump(), request=request,
    )
    return {
        "success": True,
        "data": {"id": sale.id, "total_amount": sale.total_amount, "remaining_stock": item.quantity},
    }


@router.post("/bulk", status_code=201)
async def bulk_create_sales(
    data: SalesBulkCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sales.create")),
    house_id: int = Depends(require_house_context),
):
    await ensure_house_access(current_user, house_id)
    if data.source_type == LOCATION_RSO and not data.employee_id:
        raise HTTPException(status_code=422, detail="employee_id is required for RSO sales")
    if data.source_type == LOCATION_RSO and data.employee_id:
        emp = (await db.execute(select(Employee).where(Employee.id == data.employee_id))).scalar_one_or_none()
        if not emp or emp.house_id != house_id:
            raise HTTPException(status_code=404, detail="Employee not found in this house")

    sale_date = _parse_sale_date(data.sale_date)
    created_ids = []
    total_amount = 0.0
    product_codes = []
    try:
        for item in data.items:
            product = (await db.execute(select(Product).where(Product.id == item.product_id))).scalar_one_or_none()
            if not product:
                raise HTTPException(status_code=404, detail=f"Product {item.product_id} not found")
            try:
                await apply_stock_change(
                    db, house_id=house_id, product_id=item.product_id,
                    location_type=data.source_type, employee_id=data.employee_id,
                    delta=-item.quantity, movement_type="sale",
                    reference_type="sale", reason="Sale", user_id=current_user.id,
                )
            except HTTPException as e:
                if "Insufficient" in str(e.detail):
                    raise HTTPException(status_code=400, detail=f"Insufficient stock for {product.product_code} ({product.product_name})")
                raise
            sale = SalesRecord(
                house_id=house_id,
                product_id=item.product_id,
                source_type=data.source_type,
                employee_id=data.employee_id,
                quantity=item.quantity,
                unit_price=item.unit_price,
                total_amount=round(item.quantity * item.unit_price, 2),
                sale_date=sale_date,
                notes=data.notes,
                created_by=current_user.id,
            )
            db.add(sale)
            await db.flush()
            created_ids.append(sale.id)
            total_amount += sale.total_amount
            product_codes.append(product.product_code)
    except HTTPException:
        await db.rollback()
        raise
    await db.commit()

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="sales", action="create", record_id=created_ids[0] if created_ids else None,
        record_identifier=", ".join(product_codes),
        new_values=data.model_dump(), request=request,
    )
    return {
        "success": True,
        "data": {"ids": created_ids, "count": len(created_ids), "total_amount": round(total_amount, 2)},
    }


@router.get("")
async def list_sales(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    product_id: Optional[int] = Query(None),
    source_type: Optional[str] = Query(None),
    employee_id: Optional[int] = Query(None),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sales.view")),
    context_house_id: Optional[int] = Depends(get_house_context),
    filter_house_id: Optional[int] = Query(None, alias="house_id"),
):
    cond = _house_filter_condition(SalesRecord, current_user, context_house_id)
    if filter_house_id is not None:
        if not is_admin_user(current_user):
            user_house_ids = [h.id for h in current_user.houses]
            if filter_house_id not in user_house_ids:
                raise HTTPException(status_code=403, detail="Access denied to this house")
        cond = SalesRecord.house_id == filter_house_id
    base = select(SalesRecord)
    if cond is not None:
        base = base.where(cond)
    base = base.where(SalesRecord.is_deleted == False)
    if product_id:
        base = base.where(SalesRecord.product_id == product_id)
    if source_type:
        base = base.where(SalesRecord.source_type == source_type)
    if employee_id:
        base = base.where(SalesRecord.employee_id == employee_id)
    if from_date:
        try:
            base = base.where(SalesRecord.sale_date >= date.fromisoformat(from_date))
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid from_date format, expected YYYY-MM-DD")
    if to_date:
        try:
            base = base.where(SalesRecord.sale_date <= date.fromisoformat(to_date))
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid to_date format, expected YYYY-MM-DD")
    if search:
        like = f"%{search}%"
        base = base.where(
            (SalesRecord.notes.ilike(like))
            | SalesRecord.product.has(Product.product_code.ilike(like))
            | SalesRecord.product.has(Product.product_name.ilike(like))
        )

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    query = (
        base
        .options(joinedload(SalesRecord.house),
                 joinedload(SalesRecord.product),
                 joinedload(SalesRecord.employee).joinedload(Employee.user),
                 joinedload(SalesRecord.creator))
        .order_by(SalesRecord.sale_date.desc(), SalesRecord.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    rows = (await db.execute(query)).unique().scalars().all()
    data = [SalesSchema(
        id=s.id, house_id=s.house_id, product_id=s.product_id,
        source_type=s.source_type, employee_id=s.employee_id,
        quantity=s.quantity, unit_price=s.unit_price,
        total_amount=s.total_amount, sale_date=s.sale_date,
        notes=s.notes, created_at=s.created_at, updated_at=s.updated_at,
        created_by=s.created_by,
        product_code=s.product.product_code if s.product else None,
        product_name=s.product.product_name if s.product else None,
        employee_name=_emp_name(s.employee),
        employee_dms_code=s.employee.dms_code if s.employee else None,
        created_by_name=s.creator.name if s.creator else None,
        house_name=s.house.name if s.house else None,
        house_code=s.house.code if s.house else None,
        house_region=s.house.region if s.house else None,
        house_district=s.house.district if s.house else None,
        house_address=s.house.address if s.house else None,
        house_proprietor_name=s.house.proprietor_name if s.house else None,
        house_proprietor_contact=s.house.proprietor_contact if s.house else None,
        employee_identifier=s.employee.employee_id if s.employee else None,
        employee_itop_number=s.employee.itop_number if s.employee else None,
        employee_pool_number=s.employee.pool_number if s.employee else None,
        employee_personal_number=s.employee.personal_number if s.employee else None,
        employee_type=s.employee.employee_type if s.employee else None,
        employee_status=s.employee.status if s.employee else None,
    ).model_dump() for s in rows]

    totals = {
        "count": total,
        "quantity": sum(s.quantity for s in rows),
        "amount": round(sum(s.total_amount for s in rows), 2),
        "today_amount": round(sum(s.total_amount for s in rows if s.sale_date == date.today()), 2),
    }
    return {"success": True, "data": data, "pagination": _pagination(page, per_page, total), "totals": totals}


@router.get("/summary")
async def sales_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sales.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    cond = _house_filter_condition(SalesRecord, current_user, house_id)
    base = select(SalesRecord).where(SalesRecord.is_deleted == False)
    if cond is not None:
        base = base.where(cond)
    all_rows = (await db.execute(base)).scalars().all()
    today = date.today()
    today_rows = [r for r in all_rows if r.sale_date == today]
    summary = SalesSummary(
        total_sales_count=len(all_rows),
        total_quantity=sum(r.quantity for r in all_rows),
        total_amount=round(sum(r.total_amount for r in all_rows), 2),
        today_quantity=sum(r.quantity for r in today_rows),
        today_amount=round(sum(r.total_amount for r in today_rows), 2),
    )
    return {"success": True, "data": summary.model_dump()}


@router.get("/{sale_id}")
async def get_sale(
    sale_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sales.view")),
):
    result = await db.execute(
        select(SalesRecord)
        .options(joinedload(SalesRecord.house),
                 joinedload(SalesRecord.product),
                 joinedload(SalesRecord.employee).joinedload(Employee.user),
                 joinedload(SalesRecord.creator))
        .where(SalesRecord.id == sale_id, SalesRecord.is_deleted == False)
    )
    sale = result.unique().scalar_one_or_none()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    await ensure_house_access(current_user, sale.house_id)
    return {"success": True, "data": SalesSchema(
        id=sale.id, house_id=sale.house_id, product_id=sale.product_id,
        source_type=sale.source_type, employee_id=sale.employee_id,
        quantity=sale.quantity, unit_price=sale.unit_price,
        total_amount=sale.total_amount, sale_date=sale.sale_date,
        notes=sale.notes, created_at=sale.created_at, updated_at=sale.updated_at,
        created_by=sale.created_by,
        product_code=sale.product.product_code if sale.product else None,
        product_name=sale.product.product_name if sale.product else None,
        employee_name=_emp_name(sale.employee),
        employee_dms_code=sale.employee.dms_code if sale.employee else None,
        created_by_name=sale.creator.name if sale.creator else None,
        house_name=sale.house.name if sale.house else None,
        house_code=sale.house.code if sale.house else None,
        house_region=sale.house.region if sale.house else None,
        house_district=sale.house.district if sale.house else None,
        house_address=sale.house.address if sale.house else None,
        house_proprietor_name=sale.house.proprietor_name if sale.house else None,
        house_proprietor_contact=sale.house.proprietor_contact if sale.house else None,
        employee_identifier=sale.employee.employee_id if sale.employee else None,
        employee_itop_number=sale.employee.itop_number if sale.employee else None,
        employee_pool_number=sale.employee.pool_number if sale.employee else None,
        employee_personal_number=sale.employee.personal_number if sale.employee else None,
        employee_type=sale.employee.employee_type if sale.employee else None,
        employee_status=sale.employee.status if sale.employee else None,
    ).model_dump()}


@router.put("/{sale_id}")
async def update_sale(
    sale_id: int,
    data: SalesCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sales.edit")),
):
    result = await db.execute(
        select(SalesRecord).where(SalesRecord.id == sale_id, SalesRecord.is_deleted == False)
    )
    sale = result.scalar_one_or_none()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    await ensure_house_access(current_user, sale.house_id)

    product = (await db.execute(select(Product).where(Product.id == data.product_id))).scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if data.source_type == LOCATION_RSO and data.employee_id:
        emp = (await db.execute(select(Employee).where(Employee.id == data.employee_id))).scalar_one_or_none()
        if not emp or emp.house_id != sale.house_id:
            raise HTTPException(status_code=404, detail="Employee not found in this house")

    old = {c.name: getattr(sale, c.name) for c in sale.__table__.columns}
    try:
        await apply_stock_change(
            db, house_id=sale.house_id, product_id=sale.product_id,
            location_type=sale.source_type, employee_id=sale.employee_id,
            delta=sale.quantity, movement_type="return",
            reference_type="sale", reason=f"Sale #{sale_id} edited (revert)", user_id=current_user.id,
        )
        await apply_stock_change(
            db, house_id=sale.house_id, product_id=data.product_id,
            location_type=data.source_type, employee_id=data.employee_id,
            delta=-data.quantity, movement_type="sale",
            reference_type="sale", reason=f"Sale #{sale_id} edited (apply)", user_id=current_user.id,
        )
    except HTTPException:
        await db.rollback()
        raise

    sale.product_id = data.product_id
    sale.source_type = data.source_type
    sale.employee_id = data.employee_id
    sale.quantity = data.quantity
    sale.unit_price = data.unit_price
    sale.total_amount = round(data.quantity * data.unit_price, 2)
    sale.sale_date = _parse_sale_date(data.sale_date)
    sale.notes = data.notes
    await db.commit()
    await db.refresh(sale)

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="sales", action="edit", record_id=sale.id,
        record_identifier=product.product_code,
        old_values=old, new_values=data.model_dump(), request=request,
    )
    return {"success": True, "data": {"id": sale.id, "total_amount": sale.total_amount}}


@router.delete("/{sale_id}")
async def delete_sale(
    sale_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sales.delete")),
):
    result = await db.execute(
        select(SalesRecord).where(SalesRecord.id == sale_id, SalesRecord.is_deleted == False)
    )
    sale = result.scalar_one_or_none()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    await ensure_house_access(current_user, sale.house_id)

    try:
        await apply_stock_change(
            db, house_id=sale.house_id, product_id=sale.product_id,
            location_type=sale.source_type, employee_id=sale.employee_id,
            delta=sale.quantity, movement_type="return",
            reference_type="sale", reason=f"Sale #{sale_id} deleted (restore stock)", user_id=current_user.id,
        )
    except HTTPException:
        await db.rollback()
        raise

    old = {c.name: getattr(sale, c.name) for c in sale.__table__.columns}
    sale.is_deleted = True
    sale.deleted_at = now_naive()
    sale.deleted_by = current_user.id
    await db.commit()

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="sales", action="delete", record_id=sale.id,
        old_values=old, request=request,
    )
    return {"success": True, "data": {"id": sale_id}}
