import logging
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.deps import get_db, has_permission, get_current_user, get_house_context, require_house_context
from app.schemas.stock import (
    CategoryStockSummary, SubcategoryStock, EmployeeStockListItem,
    EmployeeStockDetail, ProductStockEntry,
    StockDashboardSummary, EmployeeStockCreate, EmployeeStockUpdate,
    EmployeeStockResponse,
    HouseStockCreate, HouseStockBulkCreate, HouseStockUpdate, HouseStockResponse,
    StockTransferCreate, StockTransferResponse,
    DailyStockEntry, DailyStockResponse,
)
from app.schemas.pagination import PaginationParams, PaginatedResponse, PaginationMeta
from app.models.employee_stock import EmployeeStock
from app.models.house_stock import HouseStock
from app.models.house import House
from app.models.product import Product
from app.models.employee import Employee
from app.models.user import User
from app.models.stock_transfer import StockTransfer
from app.models.stock_movement import StockMovement
from app.utils.stock_movement import log_stock_movement
from app.utils.access_control import is_admin_user
from app.utils.activity_logger import log_activity
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/stock", tags=["Stock"])


def _get_user_house_ids(current_user: User) -> List[int]:
    return [h.id for h in current_user.houses]


def _apply_house_filter(query, model, current_user: User, house_id: Optional[int]):
    user_house_ids = _get_user_house_ids(current_user)
    if is_admin_user(current_user) and house_id:
        return query.where(model.house_id == house_id)
    elif not is_admin_user(current_user):
        if house_id:
            if house_id not in user_house_ids:
                raise HTTPException(status_code=403, detail="Access denied to this house")
            return query.where(model.house_id == house_id)
        else:
            return query.where(model.house_id.in_(user_house_ids))
    return query


# ─── Dashboard Summary (Category-wise) ───────────────────────────

@router.get("/summary", response_model=StockDashboardSummary)
async def get_stock_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.view")),
    house_id: Optional[int] = Depends(get_house_context),
    mode: str = Query("employee"),
):
    user_house_ids = _get_user_house_ids(current_user)
    is_house_mode = mode == "house"

    if house_id:
        if not is_admin_user(current_user) and house_id not in user_house_ids:
            raise HTTPException(status_code=403, detail="Access denied")
        house_ids = [house_id]
    elif is_admin_user(current_user):
        all_houses = await db.execute(select(House.id))
        house_ids = [row[0] for row in all_houses.all()]
    else:
        house_ids = user_house_ids

    StockModel = HouseStock if is_house_mode else EmployeeStock

    query = (
        select(
            Product.category,
            Product.subcategory,
            func.sum(StockModel.quantity),
        )
        .join(Product, StockModel.product_id == Product.id)
        .where(
            StockModel.house_id.in_(house_ids),
            StockModel.is_deleted == False,
            StockModel.quantity > 0,
            Product.status == "Active",
        )
        .group_by(Product.category, Product.subcategory)
    )
    result = await db.execute(query)
    rows = result.all()

    qty_map: dict = {}
    for cat, subcat, qty in rows:
        c = cat or "Other"
        s = subcat or "Other"
        q = qty or 0
        if c not in qty_map:
            qty_map[c] = {}
        if s not in qty_map[c]:
            qty_map[c][s] = {"quantity": 0, "amount": 0.0, "products": set()}
        qty_map[c][s]["quantity"] += q

    price_query = select(
        Product.category, Product.subcategory,
        Product.id, Product.dd_lifting_price
    ).where(Product.status == "Active")
    price_result = await db.execute(price_query)
    price_rows = price_result.all()

    price_info = {}
    for cat, subcat, pid, price in price_rows:
        key = (cat or "Other", subcat or "Other")
        if key not in price_info:
            price_info[key] = {}
        price_info[key][pid] = price or 0

    stock_query = select(
        StockModel.product_id, StockModel.quantity
    ).where(
        StockModel.house_id.in_(house_ids),
        StockModel.is_deleted == False,
        StockModel.quantity > 0,
    )
    stock_result = await db.execute(stock_query)
    stock_rows = stock_result.all()

    prod_qty = {}
    for pid, qty in stock_rows:
        prod_qty[pid] = prod_qty.get(pid, 0) + (qty or 0)

    for pid, qty in prod_qty.items():
        for (cat, subcat), prices in price_info.items():
            if pid in prices:
                if subcat not in qty_map.get(cat, {}):
                    if cat not in qty_map:
                        qty_map[cat] = {}
                    qty_map[cat][subcat] = {"quantity": 0, "amount": 0.0, "products": set()}
                qty_map[cat][subcat]["amount"] += qty * prices[pid]
                qty_map[cat][subcat]["products"].add(pid)
                break

    categories = []
    for cat_name in sorted(qty_map.keys()):
        subcats = [
            SubcategoryStock(
                subcategory=s, quantity=d["quantity"],
                amount=round(d["amount"], 2), product_count=len(d["products"])
            )
            for s, d in sorted(qty_map[cat_name].items())
            if d["quantity"] > 0
        ]
        total_qty = sum(s.quantity for s in subcats)
        total_amt = sum(s.amount for s in subcats)
        if subcats:
            categories.append(CategoryStockSummary(
                category=cat_name, total_quantity=total_qty,
                total_amount=round(total_amt, 2), subcategories=subcats
            ))

    employee_count = 0
    if not is_house_mode:
        emp_count_query = select(func.count(func.distinct(EmployeeStock.employee_id))).where(
            EmployeeStock.house_id.in_(house_ids),
            EmployeeStock.is_deleted == False,
            EmployeeStock.quantity > 0,
        )
        emp_count_result = await db.execute(emp_count_query)
        employee_count = emp_count_result.scalar() or 0

    return StockDashboardSummary(categories=categories, employee_count=employee_count)


# ─── Subcategory Details (for modal) ─────────────────────────────

@router.get("/subcategories/{category}", response_model=List[SubcategoryStock])
async def get_subcategory_details(
    category: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.view")),
    house_id: Optional[int] = Depends(get_house_context),
    mode: str = Query("employee"),
):
    user_house_ids = _get_user_house_ids(current_user)
    is_house_mode = mode == "house"

    if house_id:
        if not is_admin_user(current_user) and house_id not in user_house_ids:
            raise HTTPException(status_code=403, detail="Access denied")
        house_ids = [house_id]
    elif is_admin_user(current_user):
        all_houses = await db.execute(select(House.id))
        house_ids = [row[0] for row in all_houses.all()]
    else:
        house_ids = user_house_ids

    StockModel = HouseStock if is_house_mode else EmployeeStock

    query = (
        select(
            Product.subcategory,
            func.sum(StockModel.quantity),
        )
        .join(Product, StockModel.product_id == Product.id)
        .where(
            StockModel.house_id.in_(house_ids),
            StockModel.is_deleted == False,
            StockModel.quantity > 0,
            Product.category == category,
            Product.status == "Active",
        )
        .group_by(Product.subcategory)
    )
    result = await db.execute(query)
    rows = result.all()

    subcat_qty = {}
    for subcat, qty in rows:
        s = subcat or "Other"
        subcat_qty[s] = subcat_qty.get(s, 0) + (qty or 0)

    price_query = select(
        Product.subcategory, Product.id, Product.dd_lifting_price
    ).where(
        Product.category == category,
        Product.status == "Active",
    )
    price_result = await db.execute(price_query)
    price_rows = price_result.all()

    subcat_info = {}
    for subcat, pid, price in price_rows:
        s = subcat or "Other"
        if s not in subcat_info:
            subcat_info[s] = {"products": set()}
        subcat_info[s]["products"].add(pid)

    result_list = []
    for s in sorted(subcat_info.keys()):
        qty = subcat_qty.get(s, 0)
        amount = 0.0
        if qty > 0:
            prod_ids = subcat_info[s]["products"]
            for pid in prod_ids:
                stock_qty = await db.execute(
                    select(func.coalesce(func.sum(StockModel.quantity), 0)).where(
                        StockModel.product_id == pid,
                        StockModel.house_id.in_(house_ids),
                        StockModel.is_deleted == False,
                        StockModel.quantity > 0,
                    )
                )
                stock_qty_scalar = stock_qty.scalar() or 0
                price_p = await db.execute(
                    select(Product.dd_lifting_price).where(Product.id == pid)
                )
                price_p_scalar = price_p.scalar() or 0
                amount += stock_qty_scalar * price_p_scalar

        result_list.append(SubcategoryStock(
            subcategory=s, quantity=qty,
            amount=round(amount, 2),
            product_count=len(subcat_info[s]["products"]),
        ))

    return result_list


# ─── Employees with Stock ────────────────────────────────────────

@router.get("/employees", response_model=PaginatedResponse)
async def list_employees_with_stock(
    search: Optional[str] = Query(None),
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    user_house_ids = _get_user_house_ids(current_user)
    house_ids = []
    if is_admin_user(current_user) and house_id:
        house_ids = [house_id]
    elif not is_admin_user(current_user):
        if house_id:
            if house_id not in user_house_ids:
                raise HTTPException(status_code=403, detail="Access denied")
            house_ids = [house_id]
        else:
            house_ids = user_house_ids
    else:
        house_ids = user_house_ids

    base = (
        select(
            EmployeeStock.employee_id,
            func.count(EmployeeStock.product_id).label("product_count"),
            func.sum(EmployeeStock.quantity).label("total_quantity"),
        )
        .where(
            EmployeeStock.house_id.in_(house_ids),
            EmployeeStock.is_deleted == False,
            EmployeeStock.quantity > 0,
        )
        .group_by(EmployeeStock.employee_id)
    )

    count_query = select(func.count()).select_from(base.subquery())
    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0

    offset = (pagination.page - 1) * pagination.per_page
    query = base.order_by(func.sum(EmployeeStock.quantity).desc()).offset(offset).limit(pagination.per_page)
    result = await db.execute(query)
    rows = result.all()

    employee_ids = [r.employee_id for r in rows]

    employees = []
    if employee_ids:
        emp_result = await db.execute(
            select(Employee).options(
                selectinload(Employee.user)
            ).where(Employee.id.in_(employee_ids))
        )
        emp_map = {e.id: e for e in emp_result.scalars().all()}

        if search:
            filtered_ids = [
                eid for eid in employee_ids
                if eid in emp_map and (
                    search.lower() in (emp_map[eid].dms_code or "").lower()
                    or search.lower() in (emp_map[eid].itop_number or "").lower()
                    or search.lower() in (emp_map[eid].pool_number or "").lower()
                    or search.lower() in (emp_map[eid].employee_id or "").lower()
                )
            ]
            rows = [r for r in rows if r.employee_id in filtered_ids]
            total = len(rows)

        for r in rows:
            emp = emp_map.get(r.employee_id)
            emp_name = emp.user.name if emp and emp.user else (emp.dms_code if emp else f"Employee #{r.employee_id}")
            employees.append(EmployeeStockListItem(
                employee_id=r.employee_id,
                employee_name=emp_name,
                dms_code=emp.dms_code if emp else None,
                employee_type=emp.employee_type if emp else "Unknown",
                itop_number=emp.itop_number if emp else None,
                pool_number=emp.pool_number if emp else None,
                product_count=r.product_count or 0,
                total_quantity=r.total_quantity or 0,
            ))

    return PaginatedResponse(
        success=True,
        data=employees,
        pagination=PaginationMeta(
            page=pagination.page,
            per_page=pagination.per_page,
            total=total,
            total_pages=max(1, (total + pagination.per_page - 1) // pagination.per_page),
            has_next=(pagination.page * pagination.per_page) < total,
            has_prev=pagination.page > 1,
        ),
    )


# ─── Single Employee Stock Detail ────────────────────────────────

@router.get("/employee/{employee_id}", response_model=EmployeeStockDetail)
async def get_employee_stock_detail(
    employee_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    user_house_ids = _get_user_house_ids(current_user)
    house_ids = []
    if is_admin_user(current_user) and house_id:
        house_ids = [house_id]
    elif not is_admin_user(current_user):
        house_ids = user_house_ids

    emp_result = await db.execute(
        select(Employee).where(Employee.id == employee_id)
    )
    emp = emp_result.unique().scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    if not is_admin_user(current_user) and emp.house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="Access denied")

    query = (
        select(EmployeeStock, Product)
        .join(Product, EmployeeStock.product_id == Product.id)
        .where(
            EmployeeStock.employee_id == employee_id,
            EmployeeStock.house_id.in_(house_ids) if not is_admin_user(current_user) else EmployeeStock.house_id == emp.house_id,
            EmployeeStock.is_deleted == False,
            EmployeeStock.quantity > 0,
            Product.status == "Active",
        )
    )
    result = await db.execute(query)
    rows = result.all()

    products = []
    for stock, prod in rows:
        amount = (stock.quantity or 0) * (prod.dd_lifting_price or 0)
        products.append(ProductStockEntry(
            record_id=stock.id,
            product_id=prod.id,
            product_name=prod.product_name,
            product_code=prod.product_code,
            category=prod.category,
            subcategory=prod.subcategory,
            quantity=stock.quantity or 0,
            amount=round(amount, 2),
        ))

    return EmployeeStockDetail(
        employee_id=emp.id,
        employee_name=emp.dms_code or f"Employee #{emp.id}",
        employee_type=emp.employee_type or "Unknown",
        itop_number=emp.itop_number,
        pool_number=emp.pool_number,
        products=products,
    )


# ─── Employee Stock CRUD ─────────────────────────────────────────

@router.post("/employee-stock", response_model=EmployeeStockResponse, status_code=201)
async def create_employee_stock(
    body: EmployeeStockCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.create")),
    house_id: int = Depends(require_house_context),
):
    user_house_ids = _get_user_house_ids(current_user)

    if not is_admin_user(current_user) and house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="Access denied")

    emp_check = await db.execute(select(Employee).where(Employee.id == body.employee_id))
    if not emp_check.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Employee not found")

    prod_check = await db.execute(
        select(Product).where(Product.id == body.product_id, Product.status == "Active")
    )
    if not prod_check.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Product not found or inactive")

    existing = await db.execute(
        select(EmployeeStock).where(
            EmployeeStock.house_id == house_id,
            EmployeeStock.employee_id == body.employee_id,
            EmployeeStock.product_id == body.product_id,
            EmployeeStock.is_deleted == False,
        )
    )
    record = existing.scalar_one_or_none()
    before_qty = record.quantity if record else 0

    if record:
        record.quantity = body.quantity
        record.updated_at = now_naive()
    else:
        record = EmployeeStock(
            house_id=house_id,
            employee_id=body.employee_id,
            product_id=body.product_id,
            quantity=body.quantity,
        )
        db.add(record)

    await db.commit()
    await db.refresh(record)

    qty_change = record.quantity - before_qty
    await log_stock_movement(
        db=db, product_id=body.product_id,
        quantity_change=qty_change, before_qty=before_qty,
        movement_type="create" if not record else "adjust",
        house_id=house_id, employee_id=body.employee_id,
        created_by=current_user.id,
    )

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="stock", action="create" if not existing else "edit",
        record_id=record.id, request=request, status_code=201,
        new_values={"employee_id": body.employee_id, "product_id": body.product_id, "quantity": body.quantity},
    )

    emp = await db.execute(select(Employee).where(Employee.id == record.employee_id))
    emp_data = emp.scalar_one_or_none()
    prod = await db.execute(select(Product).where(Product.id == record.product_id))
    prod_data = prod.scalar_one_or_none()

    return EmployeeStockResponse(
        id=record.id, house_id=record.house_id,
        employee_id=record.employee_id, product_id=record.product_id,
        quantity=record.quantity,
        created_at=record.created_at, updated_at=record.updated_at,
        employee_name=emp_data.dms_code if emp_data else None,
        employee_type=emp_data.employee_type if emp_data else None,
        product_name=prod_data.product_name if prod_data else None,
        product_code=prod_data.product_code if prod_data else None,
    )


@router.put("/employee-stock/{record_id}", response_model=EmployeeStockResponse)
async def update_employee_stock(
    record_id: int,
    body: EmployeeStockUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.edit")),
    house_id: Optional[int] = Depends(get_house_context),
):
    result = await db.execute(
        select(EmployeeStock).where(EmployeeStock.id == record_id, EmployeeStock.is_deleted == False)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")

    user_house_ids = _get_user_house_ids(current_user)
    if not is_admin_user(current_user) and record.house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="Access denied")

    old_qty = record.quantity
    record.quantity = body.quantity
    await db.commit()
    await db.refresh(record)

    qty_change = record.quantity - old_qty
    await log_stock_movement(
        db=db, product_id=record.product_id,
        quantity_change=qty_change, before_qty=old_qty,
        movement_type="adjust",
        house_id=record.house_id, employee_id=record.employee_id,
        created_by=current_user.id,
    )

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="stock", action="edit", record_id=record.id,
        old_values={"quantity": old_qty}, new_values={"quantity": body.quantity},
        request=request, status_code=200,
    )

    emp = await db.execute(select(Employee).where(Employee.id == record.employee_id))
    emp_data = emp.scalar_one_or_none()
    prod = await db.execute(select(Product).where(Product.id == record.product_id))
    prod_data = prod.scalar_one_or_none()

    return EmployeeStockResponse(
        id=record.id, house_id=record.house_id,
        employee_id=record.employee_id, product_id=record.product_id,
        quantity=record.quantity,
        created_at=record.created_at, updated_at=record.updated_at,
        employee_name=emp_data.dms_code if emp_data else None,
        employee_type=emp_data.employee_type if emp_data else None,
        product_name=prod_data.product_name if prod_data else None,
        product_code=prod_data.product_code if prod_data else None,
    )


@router.delete("/employee-stock/{record_id}")
async def delete_employee_stock(
    record_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.delete")),
    house_id: Optional[int] = Depends(get_house_context),
):
    result = await db.execute(
        select(EmployeeStock).where(EmployeeStock.id == record_id, EmployeeStock.is_deleted == False)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")

    user_house_ids = _get_user_house_ids(current_user)
    if not is_admin_user(current_user) and record.house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="Access denied")

    deleted_qty = record.quantity
    record.is_deleted = True
    record.deleted_at = now_naive()
    record.deleted_by = current_user.id
    await db.commit()

    await log_stock_movement(
        db=db, product_id=record.product_id,
        quantity_change=-deleted_qty, before_qty=deleted_qty,
        movement_type="delete",
        house_id=record.house_id, employee_id=record.employee_id,
        created_by=current_user.id,
    )

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="stock", action="delete", record_id=record.id,
        old_values={"employee_id": record.employee_id, "product_id": record.product_id},
        request=request, status_code=200,
    )

    return {"success": True, "message": "Employee stock record deleted"}


@router.get("/employee-stock/list", response_model=PaginatedResponse)
async def list_employee_stock_records(
    employee_id: Optional[int] = Query(None),
    product_id: Optional[int] = Query(None),
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    user_house_ids = _get_user_house_ids(current_user)
    query = (
        select(EmployeeStock)
        .where(EmployeeStock.is_deleted == False)
    )

    if is_admin_user(current_user) and house_id:
        query = query.where(EmployeeStock.house_id == house_id)
    elif not is_admin_user(current_user):
        if house_id:
            query = query.where(EmployeeStock.house_id == house_id)
        else:
            query = query.where(EmployeeStock.house_id.in_(user_house_ids))

    if employee_id:
        query = query.where(EmployeeStock.employee_id == employee_id)
    if product_id:
        query = query.where(EmployeeStock.product_id == product_id)

    total_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(total_query)
    total = total_result.scalar() or 0

    query = query.order_by(EmployeeStock.updated_at.desc())
    offset = (pagination.page - 1) * pagination.per_page
    query = query.offset(offset).limit(pagination.per_page)
    result = await db.execute(query)
    records = result.unique().scalars().all()

    data = []
    for r in records:
        emp = await db.execute(select(Employee).where(Employee.id == r.employee_id))
        emp_data = emp.scalar_one_or_none()
        prod = await db.execute(select(Product).where(Product.id == r.product_id))
        prod_data = prod.scalar_one_or_none()

        data.append(EmployeeStockResponse(
            id=r.id, house_id=r.house_id,
            employee_id=r.employee_id, product_id=r.product_id,
            quantity=r.quantity,
            created_at=r.created_at, updated_at=r.updated_at,
            employee_name=emp_data.dms_code if emp_data else None,
            employee_type=emp_data.employee_type if emp_data else None,
            product_name=prod_data.product_name if prod_data else None,
            product_code=prod_data.product_code if prod_data else None,
        ))

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


# ─── House Stock CRUD ──────────────────────────────────────────────

@router.get("/house-stock", response_model=List[HouseStockResponse])
async def list_house_stock(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    user_house_ids = _get_user_house_ids(current_user)

    query = select(HouseStock).where(HouseStock.is_deleted == False)

    if is_admin_user(current_user) and house_id:
        query = query.where(HouseStock.house_id == house_id)
    elif not is_admin_user(current_user):
        target = [house_id] if house_id else user_house_ids
        query = query.where(HouseStock.house_id.in_(target))

    result = await db.execute(query.order_by(HouseStock.updated_at.desc()))
    records = result.unique().scalars().all()

    house_cache: dict = {}
    data = []
    for r in records:
        hid = r.house_id
        if hid not in house_cache:
            h = await db.execute(select(House).where(House.id == hid))
            house_cache[hid] = h.scalar_one_or_none()
        house = house_cache[hid]
        prod = await db.execute(select(Product).where(Product.id == r.product_id))
        p = prod.scalar_one_or_none()
        data.append(HouseStockResponse(
            id=r.id, house_id=r.house_id, product_id=r.product_id,
            quantity=r.quantity, created_at=r.created_at, updated_at=r.updated_at,
            product_name=p.product_name if p else None,
            product_code=p.product_code if p else None,
            category=p.category if p else None,
            house_name=house.name if house else None,
            house_code=house.code if house else None,
        ))
    return data


@router.post("/house-stock", response_model=HouseStockResponse, status_code=201)
async def create_house_stock(
    body: HouseStockCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.create")),
    house_id: int = Depends(require_house_context),
):

    existing_result = await db.execute(
        select(HouseStock).where(
            HouseStock.house_id == house_id,
            HouseStock.product_id == body.product_id,
            HouseStock.is_deleted == False,
        )
    )
    existing = existing_result.scalar_one_or_none()
    before_qty = existing.quantity if existing else 0
    if existing:
        existing.quantity += body.quantity
        record = existing
        action = "edit"
    else:
        record = HouseStock(house_id=house_id, product_id=body.product_id, quantity=body.quantity)
        db.add(record)
        action = "create"

    await db.commit()
    await db.refresh(record)

    await log_stock_movement(
        db=db, product_id=body.product_id,
        quantity_change=record.quantity - before_qty, before_qty=before_qty,
        movement_type=action,
        house_id=house_id,
        created_by=current_user.id,
    )

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="stock", action=action, record_id=record.id,
        new_values={"product_id": body.product_id, "quantity": record.quantity},
        request=request, status_code=201,
    )

    prod = await db.execute(select(Product).where(Product.id == record.product_id))
    p = prod.scalar_one_or_none()
    return HouseStockResponse(
        id=record.id, house_id=record.house_id, product_id=record.product_id,
        quantity=record.quantity, created_at=record.created_at, updated_at=record.updated_at,
        product_name=p.product_name if p else None,
        product_code=p.product_code if p else None,
        category=p.category if p else None,
    )


@router.post("/house-stock/bulk", status_code=201)
async def bulk_create_house_stock(
    body: HouseStockBulkCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.create")),
    house_id: int = Depends(require_house_context),
):
    results = []
    for item in body.items:
        existing_result = await db.execute(
            select(HouseStock).where(
                HouseStock.house_id == house_id,
                HouseStock.product_id == item.product_id,
                HouseStock.is_deleted == False,
            )
        )
        existing = existing_result.scalar_one_or_none()
        before_qty = existing.quantity if existing else 0
        if existing:
            existing.quantity += item.quantity
            record = existing
        else:
            record = HouseStock(house_id=house_id, product_id=item.product_id, quantity=item.quantity)
            db.add(record)
        results.append((record, before_qty))

    await db.commit()
    for r, _ in results:
        await db.refresh(r)

    for r, before in results:
        await log_stock_movement(
            db=db, product_id=r.product_id,
            quantity_change=r.quantity - before, before_qty=before,
            movement_type="create",
            house_id=house_id,
            created_by=current_user.id,
        )

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="stock", action="create", record_id=results[0][0].id,
        new_values={"bulk_count": len(body.items)},
        request=request, status_code=201,
    )

    return {"success": True, "count": len(results)}


@router.put("/house-stock/{record_id}", response_model=HouseStockResponse)
async def update_house_stock(
    record_id: int,
    body: HouseStockUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.edit")),
    house_id: Optional[int] = Depends(get_house_context),
):
    result = await db.execute(
        select(HouseStock).where(HouseStock.id == record_id, HouseStock.is_deleted == False)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")

    user_house_ids = _get_user_house_ids(current_user)
    if not is_admin_user(current_user) and record.house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="Access denied")

    old_qty = record.quantity
    record.quantity = body.quantity
    await db.commit()
    await db.refresh(record)

    await log_stock_movement(
        db=db, product_id=record.product_id,
        quantity_change=record.quantity - old_qty, before_qty=old_qty,
        movement_type="adjust",
        house_id=record.house_id,
        created_by=current_user.id,
    )

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="stock", action="edit", record_id=record.id,
        old_values={"quantity": old_qty}, new_values={"quantity": record.quantity},
        request=request, status_code=200,
    )

    prod = await db.execute(select(Product).where(Product.id == record.product_id))
    p = prod.scalar_one_or_none()
    return HouseStockResponse(
        id=record.id, house_id=record.house_id, product_id=record.product_id,
        quantity=record.quantity, created_at=record.created_at, updated_at=record.updated_at,
        product_name=p.product_name if p else None,
        product_code=p.product_code if p else None,
        category=p.category if p else None,
    )


@router.delete("/house-stock/{record_id}")
async def delete_house_stock(
    record_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.delete")),
    house_id: Optional[int] = Depends(get_house_context),
):
    result = await db.execute(
        select(HouseStock).where(HouseStock.id == record_id, HouseStock.is_deleted == False)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")

    user_house_ids = _get_user_house_ids(current_user)
    if not is_admin_user(current_user) and record.house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="Access denied")

    deleted_qty = record.quantity
    record.is_deleted = True
    record.deleted_at = now_naive()
    record.deleted_by = current_user.id
    await db.commit()

    await log_stock_movement(
        db=db, product_id=record.product_id,
        quantity_change=-deleted_qty, before_qty=deleted_qty,
        movement_type="delete",
        house_id=record.house_id,
        created_by=current_user.id,
    )

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="stock", action="delete", record_id=record.id,
        old_values={"product_id": record.product_id, "quantity": record.quantity},
        request=request, status_code=200,
    )

    return {"success": True, "message": "House stock record deleted"}


# ─── Stock Transfers ───────────────────────────────────────────────

@router.post("/transfer", response_model=StockTransferResponse, status_code=201)
async def create_stock_transfer(
    body: StockTransferCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.create")),
    house_id: int = Depends(require_house_context),
):

    product = await db.execute(select(Product).where(Product.id == body.product_id))
    prod = product.scalar_one_or_none()
    if not prod:
        raise HTTPException(status_code=404, detail="Product not found")

    src_before = 0
    src_after = 0
    dst_before = 0
    dst_after = 0

    async def deduct_source():
        nonlocal src_before, src_after
        if body.from_type == "house":
            src = await db.execute(
                select(HouseStock).where(
                    HouseStock.house_id == house_id,
                    HouseStock.product_id == body.product_id,
                    HouseStock.is_deleted == False,
                )
            )
            src_rec = src.scalar_one_or_none()
            if not src_rec or src_rec.quantity < body.quantity:
                raise HTTPException(status_code=400, detail=f"Insufficient house stock (available: {src_rec.quantity if src_rec else 0})")
            src_before = src_rec.quantity
            src_rec.quantity -= body.quantity
            src_after = src_rec.quantity
        else:
            src = await db.execute(
                select(EmployeeStock).where(
                    EmployeeStock.employee_id == body.from_id,
                    EmployeeStock.product_id == body.product_id,
                    EmployeeStock.is_deleted == False,
                )
            )
            src_rec = src.scalar_one_or_none()
            if not src_rec or src_rec.quantity < body.quantity:
                raise HTTPException(status_code=400, detail=f"Insufficient employee stock (available: {src_rec.quantity if src_rec else 0})")
            src_before = src_rec.quantity
            src_rec.quantity -= body.quantity
            src_after = src_rec.quantity

    async def add_destination():
        nonlocal dst_before, dst_after
        if body.to_type == "house":
            dst = await db.execute(
                select(HouseStock).where(
                    HouseStock.house_id == house_id,
                    HouseStock.product_id == body.product_id,
                    HouseStock.is_deleted == False,
                )
            )
            dst_rec = dst.scalar_one_or_none()
            if dst_rec:
                dst_before = dst_rec.quantity
                dst_rec.quantity += body.quantity
                dst_after = dst_rec.quantity
            else:
                dst_before = 0
                dst_after = body.quantity
                db.add(HouseStock(house_id=house_id, product_id=body.product_id, quantity=body.quantity))
        else:
            dst = await db.execute(
                select(EmployeeStock).where(
                    EmployeeStock.employee_id == body.to_id,
                    EmployeeStock.product_id == body.product_id,
                    EmployeeStock.is_deleted == False,
                )
            )
            dst_rec = dst.scalar_one_or_none()
            if dst_rec:
                dst_before = dst_rec.quantity
                dst_rec.quantity += body.quantity
                dst_after = dst_rec.quantity
            else:
                dst_before = 0
                dst_after = body.quantity
                db.add(EmployeeStock(
                    house_id=house_id,
                    employee_id=body.to_id,
                    product_id=body.product_id,
                    quantity=body.quantity,
                ))

    await deduct_source()
    await add_destination()

    transfer = StockTransfer(
        house_id=house_id,
        from_type=body.from_type, from_id=body.from_id,
        to_type=body.to_type, to_id=body.to_id,
        product_id=body.product_id, quantity=body.quantity,
        note=body.note, created_by=current_user.id,
    )
    db.add(transfer)
    await db.commit()
    await db.refresh(transfer)

    src_employee_id = body.from_id if body.from_type == "employee" else None
    src_house_id = house_id if body.from_type == "house" else None
    dst_employee_id = body.to_id if body.to_type == "employee" else None
    dst_house_id = house_id if body.to_type == "house" else None

    await log_stock_movement(
        db=db, product_id=body.product_id,
        quantity_change=-(body.quantity), before_qty=src_before,
        movement_type="transfer_out", reference_id=transfer.id,
        house_id=src_house_id, employee_id=src_employee_id,
        created_by=current_user.id,
    )
    await log_stock_movement(
        db=db, product_id=body.product_id,
        quantity_change=body.quantity, before_qty=dst_before,
        movement_type="transfer_in", reference_id=transfer.id,
        house_id=dst_house_id, employee_id=dst_employee_id,
        created_by=current_user.id,
    )

    from_identifier = None
    to_identifier = None
    if body.from_type == "employee":
        e = await db.execute(select(Employee).where(Employee.id == body.from_id))
        emp = e.scalar_one_or_none()
        from_identifier = emp.dms_code if emp else f"Employee#{body.from_id}"
    if body.to_type == "employee":
        e = await db.execute(select(Employee).where(Employee.id == body.to_id))
        emp = e.scalar_one_or_none()
        to_identifier = emp.dms_code if emp else f"Employee#{body.to_id}"

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="stock", action="transfer", record_id=transfer.id,
        new_values={
            "from": f"{body.from_type}#{body.from_id}",
            "to": f"{body.to_type}#{body.to_id}",
            "product_id": body.product_id, "quantity": body.quantity,
        },
        request=request, status_code=201,
    )

    return StockTransferResponse(
        id=transfer.id, house_id=transfer.house_id,
        from_type=transfer.from_type, from_id=transfer.from_id,
        to_type=transfer.to_type, to_id=transfer.to_id,
        product_id=transfer.product_id, quantity=transfer.quantity,
        note=transfer.note, created_by=transfer.created_by,
        created_at=transfer.created_at,
        from_identifier=from_identifier, to_identifier=to_identifier,
        product_name=prod.product_name,
    )


@router.get("/transfers", response_model=PaginatedResponse)
async def list_stock_transfers(
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    user_house_ids = _get_user_house_ids(current_user)
    query = select(StockTransfer)

    if is_admin_user(current_user) and house_id:
        query = query.where(StockTransfer.house_id == house_id)
    elif not is_admin_user(current_user):
        if house_id:
            query = query.where(StockTransfer.house_id == house_id)
        else:
            query = query.where(StockTransfer.house_id.in_(user_house_ids))

    total_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(total_query)
    total = total_result.scalar() or 0

    query = query.order_by(StockTransfer.created_at.desc())
    offset = (pagination.page - 1) * pagination.per_page
    query = query.offset(offset).limit(pagination.per_page)
    result = await db.execute(query)
    records = result.unique().scalars().all()

    data = []
    for r in records:
        prod = await db.execute(select(Product).where(Product.id == r.product_id))
        p = prod.scalar_one_or_none()

        from_identifier = None
        if r.from_type == "employee":
            e = await db.execute(select(Employee).where(Employee.id == r.from_id))
            emp = e.scalar_one_or_none()
            from_identifier = emp.dms_code if emp else None

        to_identifier = None
        if r.to_type == "employee":
            e = await db.execute(select(Employee).where(Employee.id == r.to_id))
            emp = e.scalar_one_or_none()
            to_identifier = emp.dms_code if emp else None

        data.append(StockTransferResponse(
            id=r.id, house_id=r.house_id,
            from_type=r.from_type, from_id=r.from_id,
            to_type=r.to_type, to_id=r.to_id,
            product_id=r.product_id, quantity=r.quantity,
            note=r.note, created_by=r.created_by,
            created_at=r.created_at,
            from_identifier=from_identifier, to_identifier=to_identifier,
            product_name=p.product_name if p else None,
        ))

    return PaginatedResponse(
        success=True, data=data,
        pagination=PaginationMeta(
            page=pagination.page, per_page=pagination.per_page,
            total=total,
            total_pages=max(1, (total + pagination.per_page - 1) // pagination.per_page),
            has_next=(pagination.page * pagination.per_page) < total,
            has_prev=pagination.page > 1,
        ),
    )


# ─── Daily Stock Snapshots ───────────────────────────────────────────

@router.get("/daily", response_model=DailyStockResponse)
async def get_daily_stock(
    date: str = Query(..., description="Date in YYYY-MM-DD format"),
    mode: str = Query("house"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("stock.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    user_house_ids = _get_user_house_ids(current_user)
    target_house_ids = []
    if is_admin_user(current_user) and house_id:
        target_house_ids = [house_id]
    elif not is_admin_user(current_user):
        if house_id:
            target_house_ids = [house_id]
        else:
            target_house_ids = user_house_ids
    else:
        all_houses = await db.execute(select(House.id))
        target_house_ids = [row[0] for row in all_houses.all()]

    selected_date = datetime.strptime(date, "%Y-%m-%d").date()
    StockModel = HouseStock if mode == "house" else EmployeeStock

    # get all active products with stock
    products_query = (
        select(Product)
        .where(Product.status == "Active")
        .order_by(Product.product_name)
    )
    products_result = await db.execute(products_query)
    products = products_result.scalars().all()

    # get current stock quantities from the appropriate stock model
    current_query = (
        select(StockModel.product_id, func.coalesce(func.sum(StockModel.quantity), 0))
        .where(
            StockModel.house_id.in_(target_house_ids),
            StockModel.is_deleted == False,
        )
        .group_by(StockModel.product_id)
    )
    current_result = await db.execute(current_query)
    current_qty_map = {row[0]: row[1] for row in current_result.all()}

    next_day = selected_date + timedelta(days=1)
    next_day_start = datetime(next_day.year, next_day.month, next_day.day, 0, 0, 0)

    # house movements = employee_id IS NULL, employee movements = employee_id IS NOT NULL
    def mode_filter(query):
        q = query.where(StockMovement.house_id.in_(target_house_ids))
        if mode == "house":
            return q.where(StockMovement.employee_id.is_(None))
        return q.where(StockMovement.employee_id.isnot(None))

    # get movements AFTER the selected date (from next day onward)
    after_query = mode_filter(
        select(
            StockMovement.product_id,
            func.coalesce(func.sum(StockMovement.quantity_change), 0),
        )
        .where(
            StockMovement.created_at >= next_day_start,
        )
        .group_by(StockMovement.product_id)
    )
    after_result = await db.execute(after_query)
    movements_after = {row[0]: row[1] for row in after_result.all()}

    # get separate in/out for the day
    day_in_query = mode_filter(
        select(
            StockMovement.product_id,
            func.coalesce(func.sum(StockMovement.quantity_change), 0),
        )
        .where(
            func.date(StockMovement.created_at) == selected_date,
            StockMovement.quantity_change > 0,
        )
        .group_by(StockMovement.product_id)
    )
    day_in_result = await db.execute(day_in_query)
    day_in_map = {row[0]: row[1] for row in day_in_result.all()}

    day_out_query = mode_filter(
        select(
            StockMovement.product_id,
            func.coalesce(func.sum(StockMovement.quantity_change), 0),
        )
        .where(
            func.date(StockMovement.created_at) == selected_date,
            StockMovement.quantity_change < 0,
        )
        .group_by(StockMovement.product_id)
    )
    day_out_result = await db.execute(day_out_query)
    day_out_map = {row[0]: abs(row[1]) for row in day_out_result.all()}

    entries = []
    for prod in products:
        pid = prod.id
        current_qty = current_qty_map.get(pid, 0)
        net_after = movements_after.get(pid, 0)

        # closing_qty at end of selected date = current_qty - movements_after
        closing_qty = current_qty - net_after
        if closing_qty < 0:
            closing_qty = 0

        day_in = day_in_map.get(pid, 0)
        day_out = day_out_map.get(pid, 0)

        # opening_qty = closing_qty - day_net (day_net = in - out)
        opening_qty = closing_qty - day_in + day_out
        if opening_qty < 0:
            opening_qty = 0

        entries.append(DailyStockEntry(
            product_id=pid,
            product_name=prod.product_name,
            product_code=prod.product_code,
            category=prod.category,
            subcategory=prod.subcategory,
            opening_qty=opening_qty,
            quantity_in=day_in,
            quantity_out=day_out,
            closing_qty=closing_qty,
        ))

    return DailyStockResponse(date=date, mode=mode, entries=entries)
