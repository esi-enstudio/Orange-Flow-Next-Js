"""Finance API (P3): expenses, receipts, cashbook, daily closing, iTopUp entries."""

from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.employee import Employee
from app.models.finance import CashAccount, CashTransaction, DailyClosing, Expense, Receipt, TopupEntry
from app.models.itopup_balance import ITopUpBalance, ITopUpTransfer
from app.models.user import User
from app.routers.deps import get_db, has_permission, require_house_context
from app.schemas.finance import (
    CashEntryCreate,
    CashReversal,
    ClosingReopen,
    ClosingSubmit,
    ExpenseCreate,
    ExpensePay,
    ExpenseReject,
    ReceiptCreate,
    TopupEntryCreate,
    TopupTransferCreate,
    TopupVerify,
)
from app.services import finance_service as svc
from app.services import finance_excel
from app.services.itopup_service import apply_itopup_change
from app.utils.activity_logger import log_activity
from app.utils.timezone import now_naive

router = APIRouter(prefix="/api/v1/finance", tags=["finance"])

VIEW = has_permission("finance.view")
EXPORT = has_permission("finance.export")
EXPENSE_CREATE = has_permission("finance.expense_create")
EXPENSE_APPROVE = has_permission("finance.expense_approve")
EXPENSE_PAY = has_permission("finance.expense_pay")
RECEIPT_CREATE = has_permission("finance.receipt_create")
CASH_ENTRY = has_permission("finance.cash_entry")
CASH_REVERSE = has_permission("finance.cash_reverse")
CLOSING_SUBMIT = has_permission("finance.closing_submit")
CLOSING_APPROVE = has_permission("finance.closing_approve")
CLOSING_REOPEN = has_permission("finance.closing_reopen")
TOPUP_VIEW = has_permission("itopup_balance.view")
TOPUP_CREATE = has_permission("itopup_balance.create")
TOPUP_VERIFY = has_permission("itopup_balance.verify")


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


def _expense_out(expense: Expense) -> dict:
    return {
        "id": expense.id,
        "business_date": expense.business_date.isoformat() if expense.business_date else None,
        "source": expense.source,
        "category_id": expense.category_id,
        "category_name": getattr(expense.category, "name", None),
        "employee_id": expense.employee_id,
        "employee_name": getattr(expense.employee, "employee_name", None),
        "description": expense.description,
        "amount": float(expense.amount or 0),
        "status": expense.status,
        "rejection_reason": expense.rejection_reason,
        "payment_reference": expense.payment_reference,
        "notes": expense.notes,
        "created_at": expense.created_at.isoformat() if expense.created_at else None,
        "approved_at": expense.approved_at.isoformat() if expense.approved_at else None,
        "paid_at": expense.paid_at.isoformat() if expense.paid_at else None,
    }


def _receipt_out(receipt: Receipt) -> dict:
    return {
        "id": receipt.id,
        "business_date": receipt.business_date.isoformat() if receipt.business_date else None,
        "receipt_type": receipt.receipt_type,
        "source_name": receipt.source_name,
        "related_party": receipt.related_party,
        "related_due_reference": receipt.related_due_reference,
        "amount": float(receipt.amount or 0),
        "payment_method": receipt.payment_method,
        "reference": receipt.reference,
        "notes": receipt.notes,
        "created_at": receipt.created_at.isoformat() if receipt.created_at else None,
    }


def _closing_out(closing: DailyClosing) -> dict:
    return {
        "id": closing.id,
        "business_date": closing.business_date.isoformat(),
        "status": closing.status,
        "opening_cash": float(closing.opening_cash or 0),
        "cash_in": float(closing.cash_in or 0),
        "cash_out": float(closing.cash_out or 0),
        "expected_cash": float(closing.expected_cash or 0),
        "counted_cash": float(closing.counted_cash or 0),
        "difference": float(closing.difference or 0),
        "stock_snapshot": closing.stock_snapshot,
        "employee_snapshot": closing.employee_snapshot,
        "topup_snapshot": closing.topup_snapshot,
        "notes": closing.notes,
        "reopen_reason": closing.reopen_reason,
        "submitted_at": closing.submitted_at.isoformat() if closing.submitted_at else None,
        "approved_at": closing.approved_at.isoformat() if closing.approved_at else None,
    }


# --------------------------------------------------------------------------- #
# expense categories & expenses
# --------------------------------------------------------------------------- #
@router.get("/expense-categories")
async def expense_categories(
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VIEW),
):
    await svc.ensure_default_categories(db, house_id)
    await db.commit()
    from app.models.finance import ExpenseCategory

    rows = (
        await db.execute(
            select(ExpenseCategory)
            .where(ExpenseCategory.house_id == house_id, ExpenseCategory.is_active.is_(True))
            .order_by(ExpenseCategory.source, ExpenseCategory.name)
        )
    ).scalars().all()
    return {
        "success": True,
        "data": [
            {"id": row.id, "name": row.name, "source": row.source} for row in rows
        ],
    }


@router.get("/employees")
async def finance_employees(
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VIEW),
):
    """Active house employees for the expense / iTopUp pickers.

    Kept inside the finance router so a finance-only role does not need
    `employees.view` to record an expense for an RSO.
    """
    rows = (
        await db.execute(
            select(Employee)
            .where(Employee.house_id == house_id, Employee.status == "Active")
            .order_by(Employee.employee_name)
        )
    ).scalars().all()
    return {
        "success": True,
        "data": [
            {
                "id": row.id,
                "employee_name": row.employee_name,
                "employee_id": row.employee_id,
                "dms_code": row.dms_code,
                "employee_type": row.employee_type,
            }
            for row in rows
        ],
    }


@router.get("/cash-accounts")
async def cash_accounts(
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VIEW),
):
    await svc.get_default_cash_account(db, house_id)
    await db.commit()
    rows = (
        await db.execute(
            select(CashAccount)
            .where(CashAccount.house_id == house_id, CashAccount.is_active.is_(True))
            .order_by(CashAccount.id)
        )
    ).scalars().all()
    return {
        "success": True,
        "data": [
            {
                "id": row.id,
                "name": row.name,
                "account_type": row.account_type,
                "opening_balance": float(row.opening_balance or 0),
            }
            for row in rows
        ],
    }


@router.get("/expenses/summary")
async def expense_summary(
    status_filter: Optional[str] = Query(None, alias="status"),
    source: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VIEW),
):
    data = await svc.expense_summary(
        db,
        house_id=house_id,
        status=status_filter,
        source=source,
        search=search,
        date_from=date_from,
        date_to=date_to,
    )
    return {"success": True, "data": data}


@router.get("/expenses/export")
async def export_expenses(
    request: Request,
    status_filter: Optional[str] = Query(None, alias="status"),
    source: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(EXPORT),
):
    filters = svc.expense_filters(
        house_id=house_id,
        status=status_filter,
        source=source,
        search=search,
        date_from=date_from,
        date_to=date_to,
    )
    rows = list(
        (
            await db.execute(
                select(Expense)
                .options(selectinload(Expense.category), selectinload(Expense.employee))
                .where(*filters)
                .order_by(Expense.id.desc())
            )
        )
        .scalars()
        .all()
    )
    excel_data = await finance_excel.export_expenses_excel(rows)
    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="finance",
        action="export",
        record_identifier=f"{len(rows)} expenses",
        new_values={"house_id": house_id, "count": len(rows)},
        request=request,
        status_code=200,
    )
    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=finance_expenses.xlsx"},
    )


@router.get("/expenses")
async def list_expenses(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status_filter: Optional[str] = Query(None, alias="status"),
    source: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VIEW),
):
    rows, total = await svc.list_expenses(
        db,
        house_id=house_id,
        page=page,
        per_page=per_page,
        status=status_filter,
        source=source,
        search=search,
        date_from=date_from,
        date_to=date_to,
    )
    return {
        "success": True,
        "data": [_expense_out(row) for row in rows],
        "pagination": _pagination(page, per_page, total),
    }


@router.post("/expenses", status_code=status.HTTP_201_CREATED)
async def create_expense(
    payload: ExpenseCreate,
    request: Request,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(EXPENSE_CREATE),
):
    expense = await svc.create_expense(db, house_id=house_id, user_id=current_user.id, data=payload)
    await db.commit()
    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="finance",
        action="create",
        record_id=expense.id,
        record_identifier=expense.description,
        new_values={"amount": float(expense.amount), "status": expense.status},
        request=request,
        status_code=201,
    )
    return {"success": True, "data": _expense_out(expense)}


@router.post("/expenses/{expense_id}/approve")
async def approve_expense(
    expense_id: int,
    request: Request,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(EXPENSE_APPROVE),
):
    expense = await svc.approve_expense(
        db, house_id=house_id, expense_id=expense_id, user_id=current_user.id
    )
    await db.commit()
    await log_activity(
        db, user_id=current_user.id, user_name=current_user.name, module="finance",
        action="approve", record_id=expense.id, record_identifier=expense.description,
        new_values={"status": "approved"}, request=request,
    )
    return {"success": True, "data": _expense_out(expense)}


@router.post("/expenses/{expense_id}/reject")
async def reject_expense(
    expense_id: int,
    payload: ExpenseReject,
    request: Request,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(EXPENSE_APPROVE),
):
    expense = await svc.reject_expense(
        db, house_id=house_id, expense_id=expense_id, user_id=current_user.id, reason=payload.reason
    )
    await db.commit()
    await log_activity(
        db, user_id=current_user.id, user_name=current_user.name, module="finance",
        action="reject", record_id=expense.id, record_identifier=expense.description,
        new_values={"status": "rejected", "reason": payload.reason}, request=request,
    )
    return {"success": True, "data": _expense_out(expense)}


@router.post("/expenses/{expense_id}/pay")
async def pay_expense(
    expense_id: int,
    payload: ExpensePay,
    request: Request,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(EXPENSE_PAY),
):
    expense = await svc.pay_expense(
        db,
        house_id=house_id,
        expense_id=expense_id,
        user_id=current_user.id,
        account_id=payload.account_id,
        reference=payload.reference,
    )
    await db.commit()
    await log_activity(
        db, user_id=current_user.id, user_name=current_user.name, module="finance",
        action="edit", record_id=expense.id, record_identifier=expense.description,
        new_values={"status": "paid", "reference": payload.reference}, request=request,
    )
    return {"success": True, "data": _expense_out(expense)}


# --------------------------------------------------------------------------- #
# receipts & cash
# --------------------------------------------------------------------------- #
@router.get("/receipts/summary")
async def receipt_summary(
    search: Optional[str] = Query(None),
    payment_method: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VIEW),
):
    data = await svc.receipt_summary(
        db,
        house_id=house_id,
        search=search,
        payment_method=payment_method,
        date_from=date_from,
        date_to=date_to,
    )
    return {"success": True, "data": data}


@router.get("/receipts/export")
async def export_receipts(
    request: Request,
    search: Optional[str] = Query(None),
    payment_method: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(EXPORT),
):
    filters = svc.receipt_filters(
        house_id=house_id,
        search=search,
        payment_method=payment_method,
        date_from=date_from,
        date_to=date_to,
    )
    rows = list(
        (
            await db.execute(
                select(Receipt)
                .where(*filters)
                .order_by(Receipt.id.desc())
            )
        )
        .scalars()
        .all()
    )
    excel_data = await finance_excel.export_receipts_excel(rows)
    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="finance",
        action="export",
        record_identifier=f"{len(rows)} receipts",
        new_values={"house_id": house_id, "count": len(rows)},
        request=request,
        status_code=200,
    )
    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=finance_receipts.xlsx"},
    )


@router.get("/receipts")
async def list_receipts(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    payment_method: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VIEW),
):
    rows, total = await svc.list_receipts(
        db,
        house_id=house_id,
        page=page,
        per_page=per_page,
        search=search,
        payment_method=payment_method,
        date_from=date_from,
        date_to=date_to,
    )
    return {
        "success": True,
        "data": [_receipt_out(row) for row in rows],
        "pagination": _pagination(page, per_page, total),
    }


@router.post("/receipts", status_code=status.HTTP_201_CREATED)
async def create_receipt(
    payload: ReceiptCreate,
    request: Request,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(RECEIPT_CREATE),
):
    receipt = await svc.create_receipt(db, house_id=house_id, user_id=current_user.id, data=payload)
    await db.commit()
    await log_activity(
        db, user_id=current_user.id, user_name=current_user.name, module="finance",
        action="create", record_id=receipt.id, record_identifier=receipt.receipt_type,
        new_values={"amount": float(receipt.amount), "method": receipt.payment_method},
        request=request, status_code=201,
    )
    return {"success": True, "data": _receipt_out(receipt)}


@router.post("/cash/entries", status_code=status.HTTP_201_CREATED)
async def create_cash_entry(
    payload: CashEntryCreate,
    request: Request,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(CASH_ENTRY),
):
    tx = await svc.create_cash_entry(db, house_id=house_id, user_id=current_user.id, data=payload)
    await db.commit()
    await log_activity(
        db, user_id=current_user.id, user_name=current_user.name, module="finance",
        action="create", record_id=tx.id, record_identifier=payload.reference,
        new_values={"direction": tx.direction, "amount": float(tx.amount)},
        request=request, status_code=201,
    )
    return {
        "success": True,
        "data": {
            "id": tx.id,
            "direction": tx.direction,
            "amount": float(tx.amount),
            "reference": tx.reference,
            "business_date": tx.business_date.isoformat(),
        },
    }


@router.post("/cash/transactions/{transaction_id}/reverse")
async def reverse_cash_entry(
    transaction_id: int,
    payload: CashReversal,
    request: Request,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(CASH_REVERSE),
):
    reversal = await svc.reverse_cash_entry(
        db,
        house_id=house_id,
        transaction_id=transaction_id,
        user_id=current_user.id,
        reason=payload.reason,
    )
    await db.commit()
    await log_activity(
        db, user_id=current_user.id, user_name=current_user.name, module="finance",
        action="edit", record_id=transaction_id,
        new_values={"reversal_id": reversal.id, "reason": payload.reason}, request=request,
    )
    return {
        "success": True,
        "data": {"id": reversal.id, "direction": reversal.direction, "amount": float(reversal.amount)},
    }


@router.get("/cashbook/daily")
async def daily_cashbook(
    business_date: Optional[date] = Query(None, alias="date"),
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VIEW),
):
    target = business_date or now_naive().date()
    book = await svc.cashbook(db, house_id=house_id, business_date=target)
    return {"success": True, "data": book}


@router.get("/cashbook/export")
async def export_cashbook(
    request: Request,
    business_date: Optional[date] = Query(None, alias="date"),
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(EXPORT),
):
    target = business_date or now_naive().date()
    book = await svc.cashbook(db, house_id=house_id, business_date=target)
    excel_data = await finance_excel.export_cashbook_excel(book)
    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="finance",
        action="export",
        record_identifier=f"cashbook {target.isoformat()}",
        new_values={"house_id": house_id, "business_date": target.isoformat()},
        request=request,
        status_code=200,
    )
    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=cashbook_{target.isoformat()}.xlsx"},
    )


# --------------------------------------------------------------------------- #
# daily closing
# --------------------------------------------------------------------------- #
@router.get("/daily-closings/export")
async def export_closings(
    request: Request,
    status_filter: Optional[str] = Query(None, alias="status"),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(EXPORT),
):
    rows, _total = await svc.list_closings(
        db,
        house_id=house_id,
        status=status_filter,
        date_from=date_from,
        date_to=date_to,
    )
    excel_data = await finance_excel.export_closings_excel(rows)
    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="finance",
        action="export",
        record_identifier=f"{len(rows)} daily closings",
        new_values={"house_id": house_id, "count": len(rows)},
        request=request,
        status_code=200,
    )
    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=daily_closings.xlsx"},
    )


@router.get("/daily-closings")
async def list_closings(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status_filter: Optional[str] = Query(None, alias="status"),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(VIEW),
):
    rows, total = await svc.list_closings(
        db,
        house_id=house_id,
        status=status_filter,
        date_from=date_from,
        date_to=date_to,
        page=page,
        per_page=per_page,
    )
    return {
        "success": True,
        "data": [_closing_out(row) for row in rows],
        "pagination": _pagination(page, per_page, total),
    }


@router.post("/daily-closings", status_code=status.HTTP_201_CREATED)
async def submit_closing(
    payload: ClosingSubmit,
    request: Request,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(CLOSING_SUBMIT),
):
    closing = await svc.submit_closing(db, house_id=house_id, user_id=current_user.id, data=payload)
    await db.commit()
    await log_activity(
        db, user_id=current_user.id, user_name=current_user.name, module="finance",
        action="create", record_id=closing.id,
        record_identifier=closing.business_date.isoformat(),
        new_values={"counted_cash": float(closing.counted_cash), "difference": float(closing.difference)},
        request=request, status_code=201,
    )
    return {"success": True, "data": _closing_out(closing)}


@router.post("/daily-closings/{closing_id}/approve")
async def approve_closing(
    closing_id: int,
    request: Request,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(CLOSING_APPROVE),
):
    closing = await svc.approve_closing(
        db, house_id=house_id, closing_id=closing_id, user_id=current_user.id
    )
    await db.commit()
    await log_activity(
        db, user_id=current_user.id, user_name=current_user.name, module="finance",
        action="approve", record_id=closing.id,
        record_identifier=closing.business_date.isoformat(),
        new_values={"status": "approved"}, request=request,
    )
    return {"success": True, "data": _closing_out(closing)}


@router.post("/daily-closings/{closing_id}/reopen")
async def reopen_closing(
    closing_id: int,
    payload: ClosingReopen,
    request: Request,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(CLOSING_REOPEN),
):
    closing = await svc.reopen_closing(
        db,
        house_id=house_id,
        closing_id=closing_id,
        user_id=current_user.id,
        reason=payload.reason,
    )
    await db.commit()
    await log_activity(
        db, user_id=current_user.id, user_name=current_user.name, module="finance",
        action="edit", record_id=closing.id,
        record_identifier=closing.business_date.isoformat(),
        new_values={"status": "reopened", "reason": payload.reason}, request=request,
    )
    return {"success": True, "data": _closing_out(closing)}


# --------------------------------------------------------------------------- #
# iTopUp daily entries
# --------------------------------------------------------------------------- #
@router.get("/itopup/balances")
async def topup_balances(
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(TOPUP_VIEW),
):
    rows = (
        await db.execute(select(ITopUpBalance).where(ITopUpBalance.house_id == house_id))
    ).scalars().all()
    employee_ids = [row.employee_id for row in rows if row.employee_id]
    employees = {}
    if employee_ids:
        employees = {
            emp.id: emp.employee_name
            for emp in (
                await db.execute(select(Employee).where(Employee.id.in_(employee_ids)))
            ).scalars().all()
        }
    return {
        "success": True,
        "data": [
            {
                "employee_id": row.employee_id,
                "employee_name": employees.get(row.employee_id) or "Mother SIM",
                "balance": float(row.balance or 0),
            }
            for row in rows
        ],
    }


@router.get("/itopup/transfers")
async def topup_transfers(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(TOPUP_VIEW),
):
    rows, total = await svc.list_topup_transfers(
        db, house_id=house_id, page=page, per_page=per_page
    )
    return {
        "success": True,
        "data": rows,
        "pagination": _pagination(page, per_page, total),
    }


@router.post("/itopup/transfers", status_code=status.HTTP_201_CREATED)
async def create_topup_transfer(
    payload: TopupTransferCreate,
    request: Request,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(TOPUP_CREATE),
):
    if payload.from_employee_id is None and payload.to_employee_id is None:
        raise HTTPException(status_code=422, detail="Mother SIM cannot transfer to itself")
    if payload.from_employee_id == payload.to_employee_id:
        raise HTTPException(status_code=422, detail="Source and destination cannot be the same")

    async def _check(emp_id):
        if emp_id is None:
            return
        employee = await db.get(Employee, emp_id)
        if not employee or employee.house_id != house_id:
            raise HTTPException(status_code=404, detail="Employee not found in this house")

    await _check(payload.from_employee_id)
    await _check(payload.to_employee_id)
    amount = float(payload.amount)
    await apply_itopup_change(
        db, house_id=house_id, employee_id=payload.from_employee_id, amount=-amount,
        movement_type="transfer_out", reference_type="itopup_transfer",
        reason=payload.notes, user_id=current_user.id,
    )
    await apply_itopup_change(
        db, house_id=house_id, employee_id=payload.to_employee_id, amount=amount,
        movement_type="transfer_in", reference_type="itopup_transfer",
        reason=payload.notes, user_id=current_user.id,
    )
    transfer = ITopUpTransfer(
        house_id=house_id,
        from_employee_id=payload.from_employee_id,
        to_employee_id=payload.to_employee_id,
        amount=Decimal(str(payload.amount)),
        movement=payload.movement,
        notes=payload.notes,
        created_by=current_user.id,
    )
    db.add(transfer)
    await db.commit()
    await log_activity(
        db, user_id=current_user.id, user_name=current_user.name, module="finance",
        action="transfer", record_id=transfer.id, record_identifier="iTopUp transfer",
        new_values={"from": payload.from_employee_id, "to": payload.to_employee_id, "amount": amount},
        request=request, status_code=201,
    )
    return {"success": True, "data": {"id": transfer.id, "amount": float(transfer.amount)}}


@router.get("/itopup/reconciliation")
async def topup_reconciliation(
    business_date: Optional[date] = Query(None, alias="date"),
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(TOPUP_VIEW),
):
    target = business_date or now_naive().date()
    data = await svc.topup_reconciliation(db, house_id=house_id, business_date=target)
    return {"success": True, "data": data}


@router.post("/itopup/entries", status_code=status.HTTP_201_CREATED)
async def create_topup_entry(
    payload: TopupEntryCreate,
    request: Request,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(TOPUP_CREATE),
):
    entry = await svc.create_topup_entry(db, house_id=house_id, user_id=current_user.id, data=payload)
    await db.commit()
    await log_activity(
        db, user_id=current_user.id, user_name=current_user.name, module="finance",
        action="create", record_id=entry.id, record_identifier=payload.entry_type,
        new_values={"amount": float(entry.amount), "type": entry.entry_type},
        request=request, status_code=201,
    )
    return {
        "success": True,
        "data": {
            "id": entry.id,
            "entry_type": entry.entry_type,
            "amount": float(entry.amount),
            "is_verified": entry.is_verified,
        },
    }


@router.post("/itopup/entries/{entry_id}/verify")
async def verify_topup_entry(
    entry_id: int,
    payload: TopupVerify,
    request: Request,
    house_id: int = Depends(require_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(TOPUP_VERIFY),
):
    entry = await svc.verify_topup_entry(
        db,
        house_id=house_id,
        entry_id=entry_id,
        user_id=current_user.id,
        verified_amount=payload.verified_amount,
        notes=payload.notes,
    )
    await db.commit()
    await log_activity(
        db, user_id=current_user.id, user_name=current_user.name, module="finance",
        action="edit", record_id=entry.id, record_identifier="iTopUp verification",
        new_values={"verified_amount": float(entry.verified_amount), "discrepancy": float(entry.discrepancy)},
        request=request,
    )
    return {
        "success": True,
        "data": {
            "id": entry.id,
            "is_verified": entry.is_verified,
            "verified_amount": float(entry.verified_amount or 0),
            "discrepancy": float(entry.discrepancy or 0),
        },
    }
