"""Field sales API (P2).

Sale entry is serial-validated; approval is a separate permission so a
field user can submit but never approve their own sale.
"""

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.field_sales import Sale
from app.models.product import Product
from app.models.user import User
from app.routers.deps import get_db, has_permission, require_house_context
from app.schemas.field_sales import SaleCreate, SaleReject, SaleUpdate
from app.services import field_sales_service as svc
from app.utils.access_control import is_admin_user
from app.utils.activity_logger import log_activity

router = APIRouter(prefix="/api/v1/sales", tags=["field-sales"])

VIEW = has_permission("field_sales.view")
CREATE = has_permission("field_sales.create")
EDIT = has_permission("field_sales.edit")
SUBMIT = has_permission("field_sales.submit")
APPROVE = has_permission("field_sales.approve")
REJECT = has_permission("field_sales.reject")


def _sales_scope(user: User) -> Optional[int]:
    """Non-admin field users only see/create their own sales."""
    if is_admin_user(user):
        return None
    profile = getattr(user, "employee_profile", None)
    if profile and (profile.employee_type or "").lower() in {"rso", "bp", "supervisor"}:
        return profile.id
    return None


def _pagination(page: int, per_page: int, total: int) -> dict:
    total_pages = (total + per_page - 1) // per_page if per_page else 0
    return {
        "page": page,
        "per_page": per_page,
        "total": total,
        "total_pages": total_pages,
        "has_next": page < total_pages,
        "has_prev": page > 1,
    }


def _sale_out(sale: Sale) -> dict:
    serials_by_line: dict = {}
    for serial_line in sale.serial_lines:
        serials_by_line.setdefault(serial_line.sale_line_id, []).append(
            {
                "serial_number": serial_line.serial_number,
                "status_after": serial_line.status_after,
            }
        )
    employee = sale.employee
    retailer = sale.retailer
    return {
        "id": sale.id,
        "sale_no": sale.sale_no,
        "status": sale.status,
        "business_date": sale.business_date.isoformat() if sale.business_date else None,
        "employee_id": sale.employee_id,
        "employee_name": getattr(employee, "employee_name", None),
        "dms_code": getattr(employee, "dms_code", None),
        "employee_type": getattr(employee, "employee_type", None),
        "retailer_id": sale.retailer_id,
        "retailer_name": getattr(retailer, "name", None),
        "retailer_code": getattr(retailer, "retailer_code", None),
        "route": sale.route,
        "payment_status": sale.payment_status,
        "total_quantity": sale.total_quantity,
        "total_amount": float(sale.total_amount or 0),
        "paid_amount": float(sale.paid_amount or 0),
        "notes": sale.notes,
        "reject_reason": sale.reject_reason,
        "created_at": sale.created_at.isoformat() if sale.created_at else None,
        "submitted_at": sale.submitted_at.isoformat() if sale.submitted_at else None,
        "approved_at": sale.approved_at.isoformat() if sale.approved_at else None,
        "lines": [
            {
                "id": line.id,
                "product_id": line.product_id,
                "product_name": getattr(line.product, "product_name", None),
                "product_code": getattr(line.product, "product_code", None),
                "quantity": line.quantity,
                "unit_price": float(line.unit_price or 0),
                "total_amount": float(line.total_amount or 0),
                "serials": serials_by_line.get(line.id, []),
            }
            for line in sale.lines
        ],
    }


@router.get("/dashboard")
async def sales_dashboard(
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VIEW),
):
    data = await svc.sales_dashboard(db, house_id=house_id, employee_id=_sales_scope(current_user))
    return {
        "success": True,
        "data": {
            **{key: value for key, value in data.items() if key != "recent_sales"},
            "recent_sales": [_sale_out(sale) for sale in data["recent_sales"]],
        },
    }


@router.get("/retailers")
async def search_retailers(
    search: Optional[str] = Query(None),
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VIEW),
):
    retailers = await svc.search_retailers(db, house_id=house_id, search=search)
    return {
        "success": True,
        "data": [
            {
                "id": retailer.id,
                "name": retailer.name,
                "retailer_code": retailer.retailer_code,
                "route": retailer.route,
                "thana": retailer.thana,
                "itop_number": retailer.itop_number,
            }
            for retailer in retailers
        ],
    }


@router.get("/employees")
async def sales_employees(
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VIEW),
):
    scope = _sales_scope(current_user)
    rows = await svc.sale_employees(db, house_id=house_id)
    if scope:
        rows = [row for row in rows if row["id"] == scope]
    return {"success": True, "data": rows}


@router.get("/products")
async def sales_products(
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VIEW),
):
    rows = (
        await db.execute(
            select(Product)
            .where(Product.category.in_(["SIM", "Scratch Card"]), Product.status == "Active")
            .order_by(Product.category, Product.product_name)
        )
    ).scalars().all()
    return {
        "success": True,
        "data": [
            {
                "id": product.id,
                "product_code": product.product_code,
                "product_name": product.product_name,
                "category": product.category,
                "mrp": product.mrp,
            }
            for product in rows
        ],
    }


@router.get("")
async def list_sales(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    employee_id: Optional[int] = Query(None),
    retailer_id: Optional[int] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VIEW),
):
    rows, total = await svc.list_sales(
        db,
        house_id=house_id,
        page=page,
        per_page=per_page,
        search=search,
        status=status_filter,
        employee_id=employee_id,
        retailer_id=retailer_id,
        date_from=date_from,
        date_to=date_to,
        scope_employee_id=_sales_scope(current_user),
    )
    return {
        "success": True,
        "data": [_sale_out(sale) for sale in rows],
        "pagination": _pagination(page, per_page, total),
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_sale(
    payload: SaleCreate,
    request: Request,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(CREATE),
):
    sale = await svc.create_sale(
        db,
        house_id=house_id,
        user_id=current_user.id,
        data=payload,
        scope_employee_id=_sales_scope(current_user),
    )
    await db.commit()
    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="field_sales",
        action="create",
        record_id=sale.id,
        record_identifier=sale.sale_no,
        new_values={
            "status": sale.status,
            "employee_id": sale.employee_id,
            "quantity": sale.total_quantity,
            "amount": float(sale.total_amount or 0),
        },
        request=request,
        status_code=201,
    )
    return {"success": True, "data": _sale_out(sale)}


@router.get("/{sale_id}")
async def sale_detail(
    sale_id: int,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VIEW),
):
    sale = await svc.get_sale(db, house_id, sale_id)
    scope = _sales_scope(current_user)
    if scope and sale.employee_id != scope:
        raise HTTPException(status_code=403, detail="You do not have access to this sale")
    return {"success": True, "data": _sale_out(sale)}


@router.patch("/{sale_id}")
async def update_sale(
    sale_id: int,
    payload: SaleUpdate,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(EDIT),
):
    sale = await svc.update_sale(
        db,
        house_id=house_id,
        sale_id=sale_id,
        data=payload,
        scope_employee_id=_sales_scope(current_user),
    )
    await db.commit()
    return {"success": True, "data": _sale_out(sale)}


@router.post("/{sale_id}/submit")
async def submit_sale(
    sale_id: int,
    request: Request,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(SUBMIT),
):
    sale = await svc.submit_sale(
        db, house_id=house_id, sale_id=sale_id, scope_employee_id=_sales_scope(current_user)
    )
    await db.commit()
    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="field_sales",
        action="edit",
        record_id=sale.id,
        record_identifier=sale.sale_no,
        new_values={"status": "submitted", "quantity": sale.total_quantity},
        request=request,
    )
    return {"success": True, "data": _sale_out(sale)}


@router.post("/{sale_id}/approve")
async def approve_sale(
    sale_id: int,
    request: Request,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(APPROVE),
):
    scope = _sales_scope(current_user)
    sale = await svc.get_sale(db, house_id, sale_id)
    if scope and sale.employee_id == scope:
        raise HTTPException(
            status_code=403,
            detail="You cannot approve your own sale submission",
        )
    sale = await svc.approve_sale(db, house_id=house_id, sale_id=sale_id, user_id=current_user.id)
    await db.commit()
    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="field_sales",
        action="approve",
        record_id=sale.id,
        record_identifier=sale.sale_no,
        new_values={"status": "approved", "quantity": sale.total_quantity},
        request=request,
    )
    return {"success": True, "data": _sale_out(sale)}


@router.post("/{sale_id}/reject")
async def reject_sale(
    sale_id: int,
    payload: SaleReject,
    request: Request,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(REJECT),
):
    scope = _sales_scope(current_user)
    existing = await svc.get_sale(db, house_id, sale_id)
    if scope and existing.employee_id == scope:
        raise HTTPException(status_code=403, detail="You cannot reject your own sale submission")
    sale = await svc.reject_sale(
        db,
        house_id=house_id,
        sale_id=sale_id,
        user_id=current_user.id,
        reason=payload.reason,
    )
    await db.commit()
    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="field_sales",
        action="reject",
        record_id=sale.id,
        record_identifier=sale.sale_no,
        new_values={"status": "rejected", "reason": payload.reason},
        request=request,
    )
    return {"success": True, "data": _sale_out(sale)}
