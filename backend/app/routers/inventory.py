"""Serial-tracked inventory API (P1).

All endpoints require an explicit inventory permission **and** a resolvable
house context, so a tenant can never read another house's stock even with a
valid token.
"""

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.employee import Employee
from app.models.product import Product
from app.models.stock import InventoryLedger, SerialUnit, StockDocument, StockDocumentLine
from app.models.user import User
from app.routers.deps import (
    get_db,
    has_any_permission,
    has_permission,
    require_house_context,
)
from app.schemas.stock import (
    IssueCreate,
    ReceiptCreate,
    ReturnCreate,
    ReturnVerifyRequest,
)
from app.services import inventory_service as svc
from app.utils.activity_logger import log_activity

router = APIRouter(prefix="/api/v1/inventory", tags=["inventory"])

VIEW = has_permission("inventory.view")
RECEIVE = has_permission("inventory.receive")
ISSUE = has_permission("inventory.issue")
RETURN = has_permission("inventory.return")
VERIFY = has_permission("inventory.verify")


# --------------------------------------------------------------------------- #
# serializers
# --------------------------------------------------------------------------- #
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


def _serial_out(unit: SerialUnit) -> dict:
    employee = unit.employee
    product = unit.product
    return {
        "id": unit.id,
        "serial_number": unit.serial_number,
        "product_id": unit.product_id,
        "product_name": getattr(product, "product_name", None),
        "product_code": getattr(product, "product_code", None),
        "category": getattr(product, "category", None),
        "status": unit.status,
        "employee_id": unit.current_employee_id,
        "employee_name": getattr(employee, "employee_name", None),
        "dms_code": getattr(employee, "dms_code", None),
        "location_id": unit.current_location_id,
        "batch_id": unit.batch_id,
        "unit_cost": float(unit.unit_cost or 0),
        "face_value": float(unit.face_value or 0),
        "received_at": unit.received_at.isoformat() if unit.received_at else None,
        "status_updated_at": unit.status_updated_at.isoformat() if unit.status_updated_at else None,
        "created_at": unit.created_at.isoformat() if unit.created_at else None,
    }


def _doc_out(doc: StockDocument, *, include_serials: bool = False) -> dict:
    line = doc.lines[0] if doc.lines else None
    product = getattr(line, "product", None)
    employee = doc.employee
    payload = {
        "id": doc.id,
        "document_no": doc.document_no,
        "document_type": doc.document_type,
        "status": doc.status,
        "business_date": doc.business_date.isoformat() if doc.business_date else None,
        "employee_id": doc.employee_id,
        "employee_name": getattr(employee, "employee_name", None),
        "dms_code": getattr(employee, "dms_code", None),
        "employee_type": getattr(employee, "employee_type", None),
        "supplier": doc.supplier,
        "purchase_reference": doc.purchase_reference,
        "invoice_number": doc.invoice_number,
        "batch_number": doc.batch_number,
        "expected_quantity": doc.expected_quantity,
        "total_quantity": doc.total_quantity,
        "discrepancy": doc.discrepancy,
        "unit_cost": float(doc.unit_cost or 0),
        "face_value": float(doc.face_value or 0),
        "notes": doc.notes,
        "reason": doc.reason,
        "product_id": getattr(line, "product_id", None),
        "product_name": getattr(product, "product_name", None),
        "product_code": getattr(product, "product_code", None),
        "serials_count": len(doc.serial_lines),
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
        "posted_at": doc.posted_at.isoformat() if doc.posted_at else None,
        "verified_at": doc.verified_at.isoformat() if doc.verified_at else None,
    }
    if include_serials:
        payload["serials"] = [
            {
                "serial_number": serial_line.serial_number,
                "serial_unit_id": serial_line.serial_unit_id,
                "status_before": serial_line.status_before,
                "status_after": serial_line.status_after,
                "action": serial_line.action,
            }
            for serial_line in doc.serial_lines
        ]
    return payload


def _ledger_out(entry: InventoryLedger) -> dict:
    return {
        "id": entry.id,
        "product_id": entry.product_id,
        "product_name": getattr(entry.product, "product_name", None),
        "serial_number": entry.serial_number,
        "document_no": entry.document_no,
        "movement_type": entry.movement_type,
        "quantity": entry.quantity,
        "employee_id": entry.employee_id,
        "employee_name": getattr(entry.employee, "employee_name", None),
        "status_before": entry.status_before,
        "status_after": entry.status_after,
        "note": entry.note,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
    }


# --------------------------------------------------------------------------- #
# lookups
# --------------------------------------------------------------------------- #
@router.get("/summary")
async def inventory_summary(
    product_id: Optional[int] = Query(None),
    employee_id: Optional[int] = Query(None),
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VIEW),
):
    scope = svc.employee_scope_id(current_user)
    data = await svc.stock_summary(
        db,
        house_id=house_id,
        product_id=product_id,
        employee_id=scope or employee_id,
    )
    return {"success": True, "data": data}


@router.get("/serials")
async def list_serials(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    product_id: Optional[int] = Query(None),
    employee_id: Optional[int] = Query(None),
    sort_by: str = Query("id"),
    sort_order: str = Query("desc"),
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VIEW),
):
    scope = svc.employee_scope_id(current_user)
    rows, total = await svc.list_serial_units(
        db,
        house_id=house_id,
        page=page,
        per_page=per_page,
        search=search,
        status=status_filter,
        product_id=product_id,
        employee_id=employee_id,
        sort_by=sort_by,
        sort_order=sort_order,
        scope_employee_id=scope,
    )
    return {
        "success": True,
        "data": [_serial_out(unit) for unit in rows],
        "pagination": _pagination(page, per_page, total),
    }


@router.get("/serials/{serial_id}/history")
async def serial_history(
    serial_id: int,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VIEW),
):
    history = await svc.serial_history(db, house_id=house_id, serial_id=serial_id)
    unit = history["serial"]
    if svc.employee_scope_id(current_user) not in (None, unit.current_employee_id):
        raise HTTPException(status_code=403, detail="You do not have access to this serial")
    return {
        "success": True,
        "data": {
            "serial": _serial_out(unit),
            "movements": [
                {
                    "id": line.id,
                    "document_id": line.document_id,
                    "action": line.action,
                    "status_before": line.status_before,
                    "status_after": line.status_after,
                    "employee_before_id": line.employee_before_id,
                    "employee_after_id": line.employee_after_id,
                    "note": line.note,
                    "created_at": line.created_at.isoformat() if line.created_at else None,
                }
                for line in history["movements"]
            ],
            "ledger": [_ledger_out(entry) for entry in history["ledger"]],
        },
    }


@router.get("/ledger")
async def list_ledger(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    serial_number: Optional[str] = Query(None),
    document_no: Optional[str] = Query(None),
    movement_type: Optional[str] = Query(None),
    product_id: Optional[int] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VIEW),
):
    filters = [InventoryLedger.house_id == house_id]
    if serial_number:
        filters.append(InventoryLedger.serial_number.ilike(f"%{serial_number.strip()}%"))
    if document_no:
        filters.append(InventoryLedger.document_no.ilike(f"%{document_no.strip()}%"))
    if movement_type:
        filters.append(InventoryLedger.movement_type == movement_type)
    if product_id:
        filters.append(InventoryLedger.product_id == product_id)
    if date_from:
        filters.append(func.date(InventoryLedger.created_at) >= date_from)
    if date_to:
        filters.append(func.date(InventoryLedger.created_at) <= date_to)

    total = (
        await db.execute(select(func.count(InventoryLedger.id)).where(*filters))
    ).scalar() or 0
    rows = list(
        (
            await db.execute(
                select(InventoryLedger)
                .options(
                    selectinload(InventoryLedger.product),
                    selectinload(InventoryLedger.employee),
                )
                .where(*filters)
                .order_by(InventoryLedger.id.desc())
                .offset((page - 1) * per_page)
                .limit(per_page)
            )
        )
        .scalars()
        .all()
    )
    return {
        "success": True,
        "data": [_ledger_out(entry) for entry in rows],
        "pagination": _pagination(page, per_page, total),
    }


@router.get("/products")
async def inventory_products(
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VIEW),
):
    rows = (
        await db.execute(
            select(Product)
            .where(
                Product.category.in_(["SIM", "Scratch Card"]),
                Product.status == "Active",
            )
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


@router.get("/employees")
async def inventory_employees(
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VIEW),
):
    employees = (
        await db.execute(
            select(Employee)
            .where(Employee.house_id == house_id, Employee.status == "Active")
            .order_by(Employee.employee_name)
        )
    ).scalars().all()

    counts = {
        row[0]: row[1]
        for row in (
            await db.execute(
                select(SerialUnit.current_employee_id, func.count(SerialUnit.id))
                .where(
                    SerialUnit.house_id == house_id,
                    SerialUnit.status.in_(["assigned", "returned"]),
                )
                .group_by(SerialUnit.current_employee_id)
            )
        ).all()
    }

    return {
        "success": True,
        "data": [
            {
                "id": employee.id,
                "employee_name": employee.employee_name,
                "employee_id": employee.employee_id,
                "dms_code": employee.dms_code,
                "employee_type": employee.employee_type,
                "itop_number": employee.itop_number,
                "assigned_count": counts.get(employee.id, 0),
            }
            for employee in employees
        ],
    }


# --------------------------------------------------------------------------- #
# receipts
# --------------------------------------------------------------------------- #
@router.get("/receipts")
async def list_receipts(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    product_id: Optional[int] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VIEW),
):
    rows, total = await svc.list_documents(
        db,
        house_id=house_id,
        document_type="receipt",
        page=page,
        per_page=per_page,
        search=search,
        status=status_filter,
        product_id=product_id,
        date_from=date_from,
        date_to=date_to,
    )
    return {
        "success": True,
        "data": [_doc_out(doc) for doc in rows],
        "pagination": _pagination(page, per_page, total),
    }


@router.get("/receipts/{doc_id}")
async def receipt_detail(
    doc_id: int,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VIEW),
):
    doc = await svc.document_detail(db, house_id=house_id, doc_id=doc_id)
    if doc.document_type != "receipt":
        raise HTTPException(status_code=404, detail="Document not found")
    return {"success": True, "data": _doc_out(doc, include_serials=True)}


@router.post("/receipts", status_code=status.HTTP_201_CREATED)
async def create_receipt(
    payload: ReceiptCreate,
    request: Request,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(RECEIVE),
):
    doc = await svc.create_receipt(db, house_id=house_id, user_id=current_user.id, data=payload)
    await db.commit()
    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="inventory",
        action="create",
        record_id=doc.id,
        record_identifier=doc.document_no,
        new_values={"document_type": "receipt", "quantity": doc.total_quantity},
        request=request,
        status_code=201,
    )
    return {"success": True, "data": _doc_out(doc, include_serials=True)}


@router.post("/receipts/{doc_id}/post")
async def post_receipt(
    doc_id: int,
    request: Request,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(RECEIVE),
):
    doc = await svc.post_receipt(db, house_id=house_id, doc_id=doc_id, user_id=current_user.id)
    await db.commit()
    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="inventory",
        action="approve",
        record_id=doc.id,
        record_identifier=doc.document_no,
        new_values={"status": "posted", "quantity": doc.total_quantity},
        request=request,
    )
    return {"success": True, "data": _doc_out(doc, include_serials=True)}


# --------------------------------------------------------------------------- #
# issues
# --------------------------------------------------------------------------- #
@router.get("/issues")
async def list_issues(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    employee_id: Optional[int] = Query(None),
    product_id: Optional[int] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VIEW),
):
    scope = svc.employee_scope_id(current_user)
    rows, total = await svc.list_documents(
        db,
        house_id=house_id,
        document_type="issue",
        page=page,
        per_page=per_page,
        search=search,
        employee_id=employee_id,
        product_id=product_id,
        date_from=date_from,
        date_to=date_to,
        scope_employee_id=scope,
    )
    return {
        "success": True,
        "data": [_doc_out(doc) for doc in rows],
        "pagination": _pagination(page, per_page, total),
    }


@router.get("/issues/{doc_id}")
async def issue_detail(
    doc_id: int,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VIEW),
):
    doc = await svc.document_detail(db, house_id=house_id, doc_id=doc_id)
    if doc.document_type != "issue":
        raise HTTPException(status_code=404, detail="Document not found")
    scope = svc.employee_scope_id(current_user)
    if scope not in (None, doc.employee_id):
        raise HTTPException(status_code=403, detail="You do not have access to this voucher")
    return {"success": True, "data": _doc_out(doc, include_serials=True)}


@router.post("/issues", status_code=status.HTTP_201_CREATED)
async def create_issue(
    payload: IssueCreate,
    request: Request,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(ISSUE),
):
    doc = await svc.issue_stock(db, house_id=house_id, user_id=current_user.id, data=payload)
    await db.commit()
    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="inventory",
        action="edit",
        record_id=doc.id,
        record_identifier=doc.document_no,
        new_values={
            "document_type": "issue",
            "employee_id": doc.employee_id,
            "quantity": doc.total_quantity,
        },
        request=request,
        status_code=201,
    )
    return {"success": True, "data": _doc_out(doc, include_serials=True)}


# --------------------------------------------------------------------------- #
# returns
# --------------------------------------------------------------------------- #
@router.get("/returns")
async def list_returns(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    employee_id: Optional[int] = Query(None),
    product_id: Optional[int] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VIEW),
):
    scope = svc.employee_scope_id(current_user)
    rows, total = await svc.list_documents(
        db,
        house_id=house_id,
        document_type="return",
        page=page,
        per_page=per_page,
        search=search,
        status=status_filter,
        employee_id=employee_id,
        product_id=product_id,
        date_from=date_from,
        date_to=date_to,
        scope_employee_id=scope,
    )
    return {
        "success": True,
        "data": [_doc_out(doc) for doc in rows],
        "pagination": _pagination(page, per_page, total),
    }


@router.get("/returns/{doc_id}")
async def return_detail(
    doc_id: int,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VIEW),
):
    doc = await svc.document_detail(db, house_id=house_id, doc_id=doc_id)
    if doc.document_type != "return":
        raise HTTPException(status_code=404, detail="Document not found")
    scope = svc.employee_scope_id(current_user)
    if scope not in (None, doc.employee_id):
        raise HTTPException(status_code=403, detail="You do not have access to this return")
    return {"success": True, "data": _doc_out(doc, include_serials=True)}


@router.post("/returns", status_code=status.HTTP_201_CREATED)
async def create_return(
    payload: ReturnCreate,
    request: Request,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(RETURN),
):
    doc = await svc.create_return(db, house_id=house_id, user_id=current_user.id, data=payload)
    await db.commit()
    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="inventory",
        action="create",
        record_id=doc.id,
        record_identifier=doc.document_no,
        new_values={
            "document_type": "return",
            "employee_id": doc.employee_id,
            "quantity": doc.total_quantity,
        },
        request=request,
        status_code=201,
    )
    return {"success": True, "data": _doc_out(doc, include_serials=True)}


@router.post("/returns/{doc_id}/verify")
async def verify_return(
    doc_id: int,
    payload: ReturnVerifyRequest,
    request: Request,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VERIFY),
):
    doc = await svc.verify_return(
        db,
        house_id=house_id,
        doc_id=doc_id,
        user_id=current_user.id,
        decisions=payload.decisions,
        notes=payload.notes,
    )
    await db.commit()
    counts: dict = {}
    for decision in payload.decisions:
        counts[decision.decision] = counts.get(decision.decision, 0) + 1
    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="inventory",
        action="approve",
        record_id=doc.id,
        record_identifier=doc.document_no,
        new_values={"status": doc.status, "decisions": counts},
        request=request,
    )
    return {"success": True, "data": _doc_out(doc, include_serials=True)}
