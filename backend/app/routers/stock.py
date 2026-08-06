from typing import Optional
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.routers.deps import get_db, has_permission, get_current_user, get_house_context, require_house_context
from app.models.stock import StockItem, StockLedger, StockTransfer, StockAdjustment, DailyStockSnapshot
from app.models.product import Product
from app.models.employee import Employee
from app.models.house import House
from app.models.user import User
from app.schemas.stock import (
    StockItemSchema, StockItemCreate, StockBulkCreate,
    StockTransferCreate, StockTransferSchema,
    StockAdjustmentCreate, StockAdjustmentSchema,
    StockLedgerSchema, DailyStockSnapshotSchema, StockSummaryItem,
)
from app.services.stock_service import apply_stock_change, ensure_house_access, LOCATION_RSO
from app.utils.access_control import is_admin_user
from app.utils.activity_logger import log_activity
from app.utils.timezone import now_naive

router = APIRouter(prefix="/api/stock", tags=["Stock"])


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


def _unit_value(product: Product) -> float:
    return float(product.dd_lifting_price or 0.0)


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


@router.get("/summary")
async def stock_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    cond = _house_filter_condition(StockItem, current_user, house_id)
    stmt = select(StockItem)
    if cond is not None:
        stmt = stmt.where(cond)
    stmt = stmt.where(StockItem.is_deleted == False)
    result = await db.execute(stmt)
    items = result.scalars().all()

    agg = {}
    for it in items:
        bucket = agg.setdefault(it.product_id, {"warehouse": 0, "rso": 0})
        bucket[it.location_type] += it.quantity

    products = (await db.execute(select(Product).where(Product.status == "Active"))).scalars().all()
    rows = []
    total_qty = 0
    total_value = 0.0
    warehouse_total = 0
    rso_total = 0
    for p in sorted(products, key=lambda x: (x.product_name or "").lower()):
        bucket = agg.get(p.id, {"warehouse": 0, "rso": 0})
        wq, rq = bucket["warehouse"], bucket["rso"]
        unit = _unit_value(p)
        wv = round(wq * unit, 2)
        rv = round(rq * unit, 2)
        rows.append(StockSummaryItem(
            product_id=p.id,
            product_code=p.product_code,
            product_name=p.product_name,
            category=p.category,
            unit_price=unit,
            warehouse_quantity=wq,
            rso_quantity=rq,
            total_quantity=wq + rq,
            warehouse_value=wv,
            rso_value=rv,
            total_value=round(wv + rv, 2),
        ).model_dump())
        total_qty += wq + rq
        total_value += wv + rv
        warehouse_total += wq
        rso_total += rq

    return {
        "success": True,
        "data": rows,
        "totals": {
            "warehouse_quantity": warehouse_total,
            "rso_quantity": rso_total,
            "total_quantity": total_qty,
            "warehouse_value": round(warehouse_total * 0, 2),
            "total_value": round(total_value, 2),
        },
    }


@router.get("/items")
async def list_stock_items(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    location_type: Optional[str] = Query(None),
    product_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    cond = _house_filter_condition(StockItem, current_user, house_id)
    base = select(StockItem)
    if cond is not None:
        base = base.where(cond)
    base = base.where(StockItem.is_deleted == False)
    if location_type:
        base = base.where(StockItem.location_type == location_type)
    if product_id:
        base = base.where(StockItem.product_id == product_id)

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0

    query = (
        base
        .options(joinedload(StockItem.product), joinedload(StockItem.employee).joinedload(Employee.user), joinedload(StockItem.house))
        .order_by(StockItem.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    result = await db.execute(query)
    rows = result.unique().scalars().all()

    data = []
    for it in rows:
        product = it.product
        unit = _unit_value(product) if product else 0.0
        data.append(StockItemSchema(
            id=it.id,
            house_id=it.house_id,
            product_id=it.product_id,
            location_type=it.location_type,
            employee_id=it.employee_id,
            quantity=it.quantity,
            created_at=it.created_at,
            updated_at=it.updated_at,
            product_code=product.product_code if product else None,
            product_name=product.product_name if product else None,
            product_category=product.category if product else None,
            unit_price=unit,
            total_value=round(it.quantity * unit, 2),
            employee_name=_emp_name(it.employee),
            employee_dms_code=it.employee.dms_code if it.employee else None,
            house_name=it.house.name if it.house else None,
        ).model_dump())

    return {"success": True, "data": data, "pagination": _pagination(page, per_page, total)}


@router.get("/products")
async def active_products(
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    query = select(Product).where(Product.status == "Active").order_by(Product.product_name)
    if search:
        like = f"%{search}%"
        query = query.where(
            (Product.product_name.ilike(like)) | (Product.product_code.ilike(like))
        )
    products = (await db.execute(query.limit(500))).scalars().all()

    stock_cond = _house_filter_condition(StockItem, current_user, house_id)
    stock_stmt = select(
        StockItem.product_id,
        StockItem.location_type,
        func.sum(StockItem.quantity),
    ).where(StockItem.is_deleted == False)
    if stock_cond is not None:
        stock_stmt = stock_stmt.where(stock_cond)
    stock_stmt = stock_stmt.group_by(StockItem.product_id, StockItem.location_type)
    stock_rows = (await db.execute(stock_stmt)).all()
    stock_map = {}
    for product_id, loc, qty in stock_rows:
        bucket = stock_map.setdefault(product_id, {"warehouse": 0, "rso": 0})
        bucket[loc] += int(qty or 0)

    return {
        "success": True,
        "data": [
            {
                "id": p.id,
                "product_code": p.product_code,
                "product_name": p.product_name,
                "category": p.category,
                "mrp": p.mrp,
                "dd_lifting_price": p.dd_lifting_price,
                "ret_lifting_price": p.ret_lifting_price,
                "warehouse_quantity": stock_map.get(p.id, {}).get("warehouse", 0),
                "rso_quantity": stock_map.get(p.id, {}).get("rso", 0),
                "total_quantity": (
                    stock_map.get(p.id, {}).get("warehouse", 0)
                    + stock_map.get(p.id, {}).get("rso", 0)
                ),
            }
            for p in products
        ],
    }


@router.get("/employees")
async def stock_employees(
    product_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    query = select(Employee).where(Employee.status == "Active")
    emp_cond = _house_filter_condition(Employee, current_user, house_id)
    if emp_cond is not None:
        query = query.where(emp_cond)
    employees = (await db.execute(
        query.options(joinedload(Employee.user)).order_by(Employee.employee_id)
    )).unique().scalars().all()

    stock_map = {}
    if product_id is not None:
        stock_stmt = select(
            StockItem.employee_id, func.sum(StockItem.quantity)
        ).where(
            StockItem.product_id == product_id,
            StockItem.location_type == LOCATION_RSO,
            StockItem.is_deleted == False,
        )
        stock_cond = _house_filter_condition(StockItem, current_user, house_id)
        if stock_cond is not None:
            stock_stmt = stock_stmt.where(stock_cond)
        stock_stmt = stock_stmt.group_by(StockItem.employee_id)
        for emp_id, qty in (await db.execute(stock_stmt)).all():
            stock_map[emp_id] = int(qty or 0)

    return {
        "success": True,
        "data": [
            {
                "id": e.id,
                "employee_id": e.employee_id,
                "name": e.user.name if e.user else e.employee_id or e.dms_code,
                "dms_code": e.dms_code,
                "employee_type": e.employee_type,
                "house_id": e.house_id,
                "stock_quantity": stock_map.get(e.id, 0),
            }
            for e in employees
        ],
    }


@router.post("/items/bulk", status_code=201)
async def add_stock_items_bulk(
    data: StockBulkCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.create")),
    house_id: int = Depends(require_house_context),
):
    await ensure_house_access(current_user, house_id)
    created = []
    identifiers = []
    for it in data.items:
        product = (await db.execute(select(Product).where(Product.id == it.product_id))).scalar_one_or_none()
        if not product:
            raise HTTPException(status_code=404, detail=f"Product not found: {it.product_id}")
        if it.location_type == LOCATION_RSO and not it.employee_id:
            raise HTTPException(status_code=422, detail="employee_id is required for RSO stock")
        if it.location_type == LOCATION_RSO and it.employee_id:
            emp = (await db.execute(select(Employee).where(Employee.id == it.employee_id))).scalar_one_or_none()
            if not emp or emp.house_id != house_id:
                raise HTTPException(status_code=404, detail=f"Employee not found in this house: {it.employee_id}")

        item = await apply_stock_change(
            db, house_id=house_id, product_id=it.product_id,
            location_type=it.location_type, employee_id=it.employee_id,
            delta=it.quantity, movement_type="purchase",
            reference_type="stock_item", reason="Bulk stock entry", user_id=current_user.id,
        )
        created.append({"id": item.id, "product_id": it.product_id, "location_type": it.location_type, "quantity": item.quantity})
        identifiers.append(f"{product.product_code}x{it.quantity}")
    await db.commit()

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="stock", action="create", record_id=created[0]["id"] if created else None,
        record_identifier=", ".join(identifiers),
        new_values=data.model_dump(), request=request,
    )
    return {"success": True, "data": created}


@router.post("/items", status_code=201)
async def add_stock_item(
    data: StockItemCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.create")),
    house_id: int = Depends(require_house_context),
):
    await ensure_house_access(current_user, house_id)
    product = (await db.execute(select(Product).where(Product.id == data.product_id))).scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if data.location_type == LOCATION_RSO and not data.employee_id:
        raise HTTPException(status_code=422, detail="employee_id is required for RSO stock")
    if data.location_type == LOCATION_RSO and data.employee_id:
        emp = (await db.execute(select(Employee).where(Employee.id == data.employee_id))).scalar_one_or_none()
        if not emp or emp.house_id != house_id:
            raise HTTPException(status_code=404, detail="Employee not found in this house")

    item = await apply_stock_change(
        db, house_id=house_id, product_id=data.product_id,
        location_type=data.location_type, employee_id=data.employee_id,
        delta=data.quantity, movement_type="purchase",
        reference_type="stock_item", reason="Initial stock entry", user_id=current_user.id,
    )
    await db.commit()

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="stock", action="create", record_id=item.id,
        record_identifier=product.product_code,
        new_values=data.model_dump(), request=request,
    )
    return {"success": True, "data": {"id": item.id, "quantity": item.quantity}}


@router.post("/transfers", status_code=201)
async def create_transfer(
    data: StockTransferCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.transfer")),
    house_id: int = Depends(require_house_context),
):
    await ensure_house_access(current_user, house_id)
    product = (await db.execute(select(Product).where(Product.id == data.product_id))).scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if data.from_type == data.to_type and data.from_employee_id == data.to_employee_id:
        raise HTTPException(status_code=422, detail="Source and destination cannot be the same")

    try:
        await apply_stock_change(
            db, house_id=house_id, product_id=data.product_id,
            location_type=data.from_type, employee_id=data.from_employee_id,
            delta=-data.quantity, movement_type="transfer_out",
            reference_type="transfer", reason="Transfer out", user_id=current_user.id,
        )
        await apply_stock_change(
            db, house_id=house_id, product_id=data.product_id,
            location_type=data.to_type, employee_id=data.to_employee_id,
            delta=data.quantity, movement_type="transfer_in",
            reference_type="transfer", reason="Transfer in", user_id=current_user.id,
        )
    except HTTPException:
        await db.rollback()
        raise

    transfer = StockTransfer(
        house_id=house_id,
        product_id=data.product_id,
        from_type=data.from_type,
        from_employee_id=data.from_employee_id,
        to_type=data.to_type,
        to_employee_id=data.to_employee_id,
        quantity=data.quantity,
        notes=data.notes,
        created_by=current_user.id,
    )
    db.add(transfer)
    await db.commit()
    await db.refresh(transfer)

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="stock", action="transfer", record_id=transfer.id,
        record_identifier=product.product_code,
        new_values=data.model_dump(), request=request,
    )
    return {"success": True, "data": {"id": transfer.id, "quantity": data.quantity}}


@router.get("/transfers")
async def list_transfers(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    product_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    cond = _house_filter_condition(StockTransfer, current_user, house_id)
    base = select(StockTransfer)
    if cond is not None:
        base = base.where(cond)
    base = base.where(StockTransfer.is_deleted == False)
    if product_id:
        base = base.where(StockTransfer.product_id == product_id)

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    query = (
        base
        .options(joinedload(StockTransfer.product),
                 joinedload(StockTransfer.from_employee).joinedload(Employee.user),
                 joinedload(StockTransfer.to_employee).joinedload(Employee.user),
                 joinedload(StockTransfer.creator))
        .order_by(StockTransfer.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    rows = (await db.execute(query)).unique().scalars().all()
    data = [StockTransferSchema(
        id=t.id, house_id=t.house_id, product_id=t.product_id,
        from_type=t.from_type, from_employee_id=t.from_employee_id,
        to_type=t.to_type, to_employee_id=t.to_employee_id,
        quantity=t.quantity, notes=t.notes,
        created_at=t.created_at, created_by=t.created_by,
        product_code=t.product.product_code if t.product else None,
        product_name=t.product.product_name if t.product else None,
        from_employee_name=_emp_name(t.from_employee),
        from_employee_dms_code=t.from_employee.dms_code if t.from_employee else None,
        to_employee_name=_emp_name(t.to_employee),
        to_employee_dms_code=t.to_employee.dms_code if t.to_employee else None,
        created_by_name=t.creator.name if t.creator else None,
    ).model_dump() for t in rows]
    return {"success": True, "data": data, "pagination": _pagination(page, per_page, total)}


@router.post("/adjustments", status_code=201)
async def create_adjustment(
    data: StockAdjustmentCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.adjust")),
    house_id: int = Depends(require_house_context),
):
    await ensure_house_access(current_user, house_id)
    product = (await db.execute(select(Product).where(Product.id == data.product_id))).scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if data.location_type == LOCATION_RSO and data.employee_id:
        emp = (await db.execute(select(Employee).where(Employee.id == data.employee_id))).scalar_one_or_none()
        if not emp or emp.house_id != house_id:
            raise HTTPException(status_code=404, detail="Employee not found in this house")

    delta = data.quantity if data.direction == "increase" else -data.quantity
    try:
        item = await apply_stock_change(
            db, house_id=house_id, product_id=data.product_id,
            location_type=data.location_type, employee_id=data.employee_id,
            delta=delta, movement_type="adjustment",
            reference_type="adjustment", reason=data.reason, user_id=current_user.id,
        )
    except HTTPException:
        await db.rollback()
        raise

    adjustment = StockAdjustment(
        house_id=house_id,
        product_id=data.product_id,
        location_type=data.location_type,
        employee_id=data.employee_id,
        adjustment_type=data.adjustment_type,
        direction=data.direction,
        quantity=data.quantity,
        reason=data.reason,
        notes=data.notes,
        created_by=current_user.id,
    )
    db.add(adjustment)
    await db.commit()
    await db.refresh(adjustment)

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="stock", action=data.adjustment_type, record_id=adjustment.id,
        record_identifier=product.product_code,
        new_values=data.model_dump(), request=request,
    )
    return {"success": True, "data": {"id": adjustment.id, "quantity": item.quantity}}


@router.get("/adjustments")
async def list_adjustments(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    cond = _house_filter_condition(StockAdjustment, current_user, house_id)
    base = select(StockAdjustment)
    if cond is not None:
        base = base.where(cond)
    base = base.where(StockAdjustment.is_deleted == False)

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    query = (
        base
        .options(joinedload(StockAdjustment.product),
                 joinedload(StockAdjustment.employee).joinedload(Employee.user),
                 joinedload(StockAdjustment.creator))
        .order_by(StockAdjustment.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    rows = (await db.execute(query)).unique().scalars().all()
    data = [StockAdjustmentSchema(
        id=a.id, house_id=a.house_id, product_id=a.product_id,
        location_type=a.location_type, employee_id=a.employee_id,
        adjustment_type=a.adjustment_type, direction=a.direction,
        quantity=a.quantity, reason=a.reason, notes=a.notes,
        created_at=a.created_at, created_by=a.created_by,
        product_code=a.product.product_code if a.product else None,
        product_name=a.product.product_name if a.product else None,
        employee_name=_emp_name(a.employee),
        employee_dms_code=a.employee.dms_code if a.employee else None,
        created_by_name=a.creator.name if a.creator else None,
    ).model_dump() for a in rows]
    return {"success": True, "data": data, "pagination": _pagination(page, per_page, total)}


@router.get("/ledger")
async def list_ledger(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    product_id: Optional[int] = Query(None),
    location_type: Optional[str] = Query(None),
    movement_type: Optional[str] = Query(None),
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    cond = _house_filter_condition(StockLedger, current_user, house_id)
    base = select(StockLedger)
    if cond is not None:
        base = base.where(cond)
    if product_id:
        base = base.where(StockLedger.product_id == product_id)
    if location_type:
        base = base.where(StockLedger.location_type == location_type)
    if movement_type:
        base = base.where(StockLedger.movement_type == movement_type)
    if from_date:
        base = base.where(StockLedger.created_at >= from_date)
    if to_date:
        base = base.where(StockLedger.created_at < to_date + timedelta(days=1))

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    query = (
        base
        .options(joinedload(StockLedger.product),
                 joinedload(StockLedger.employee).joinedload(Employee.user),
                 joinedload(StockLedger.creator))
        .order_by(StockLedger.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    rows = (await db.execute(query)).unique().scalars().all()
    data = [StockLedgerSchema(
        id=e.id, house_id=e.house_id, product_id=e.product_id,
        location_type=e.location_type, employee_id=e.employee_id,
        movement_type=e.movement_type, quantity=e.quantity,
        balance_after=e.balance_after, reference_type=e.reference_type,
        reference_id=e.reference_id, reason=e.reason,
        created_at=e.created_at, created_by=e.created_by,
        product_code=e.product.product_code if e.product else None,
        product_name=e.product.product_name if e.product else None,
        employee_name=_emp_name(e.employee),
        created_by_name=e.creator.name if e.creator else None,
    ).model_dump() for e in rows]
    return {"success": True, "data": data, "pagination": _pagination(page, per_page, total)}


@router.post("/snapshots/generate", status_code=201)
async def generate_snapshot(
    request: Request,
    snapshot_date: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.view")),
    house_id: int = Depends(require_house_context),
):
    await ensure_house_access(current_user, house_id)
    target_date = date.today()
    if snapshot_date:
        try:
            target_date = date.fromisoformat(snapshot_date)
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid date format, expected YYYY-MM-DD")

    await db.execute(
        delete(DailyStockSnapshot).where(
            DailyStockSnapshot.snapshot_date == target_date,
            DailyStockSnapshot.house_id == house_id,
        )
    )

    items = (await db.execute(
        select(StockItem).where(
            StockItem.house_id == house_id,
            StockItem.is_deleted == False,
        )
    )).scalars().all()
    products = {p.id: p for p in (await db.execute(select(Product))).scalars().all()}

    created = 0
    for it in items:
        product = products.get(it.product_id)
        unit = _unit_value(product) if product else 0.0
        db.add(DailyStockSnapshot(
            snapshot_date=target_date,
            house_id=house_id,
            product_id=it.product_id,
            location_type=it.location_type,
            employee_id=it.employee_id,
            quantity=it.quantity,
            unit_value=unit,
            total_value=round(it.quantity * unit, 2),
        ))
        created += 1
    await db.commit()

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="stock", action="publish", record_identifier=str(target_date),
        new_values={"snapshot_date": str(target_date), "rows": created}, request=request,
    )
    return {"success": True, "data": {"snapshot_date": str(target_date), "rows_created": created}}


@router.get("/snapshots")
async def list_snapshots(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    snapshot_date: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    cond = _house_filter_condition(DailyStockSnapshot, current_user, house_id)
    base = select(DailyStockSnapshot)
    if cond is not None:
        base = base.where(cond)
    if snapshot_date:
        try:
            base = base.where(DailyStockSnapshot.snapshot_date == date.fromisoformat(snapshot_date))
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid date format, expected YYYY-MM-DD")

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    query = (
        base
        .options(joinedload(DailyStockSnapshot.product),
                 joinedload(DailyStockSnapshot.employee).joinedload(Employee.user),
                 joinedload(DailyStockSnapshot.house))
        .order_by(DailyStockSnapshot.snapshot_date.desc(), DailyStockSnapshot.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    rows = (await db.execute(query)).unique().scalars().all()
    data = [DailyStockSnapshotSchema(
        id=s.id, snapshot_date=s.snapshot_date, house_id=s.house_id,
        product_id=s.product_id, location_type=s.location_type,
        employee_id=s.employee_id, quantity=s.quantity,
        unit_value=s.unit_value, total_value=s.total_value,
        created_at=s.created_at,
        product_code=s.product.product_code if s.product else None,
        product_name=s.product.product_name if s.product else None,
        employee_name=_emp_name(s.employee),
        house_name=s.house.name if s.house else None,
    ).model_dump() for s in rows]
    return {"success": True, "data": data, "pagination": _pagination(page, per_page, total)}


@router.get("/snapshots/dates")
async def snapshot_dates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    cond = _house_filter_condition(DailyStockSnapshot, current_user, house_id)
    base = select(DailyStockSnapshot.snapshot_date).distinct()
    if cond is not None:
        base = base.where(cond)
    rows = (await db.execute(base.order_by(DailyStockSnapshot.snapshot_date.desc()).limit(60))).scalars().all()
    return {"success": True, "data": [str(d) for d in rows]}
