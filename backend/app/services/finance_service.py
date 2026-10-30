"""Finance ledger business logic (P3).

Cash is append-only: expenses only hit cash when *paid*, and corrections create
reversal transactions. A date whose daily closing is approved refuses new
entries until a manager reopens it.
"""

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.employee import Employee
from app.models.finance import (
    CashAccount,
    CashTransaction,
    DailyClosing,
    Expense,
    ExpenseCategory,
    Receipt,
    TopupEntry,
)
from app.models.itopup_balance import ITopUpBalance
from app.models.stock import SerialUnit
from app.services.inventory_service import resolve_business_date
from app.services.itopup_service import apply_itopup_change
from app.utils.timezone import now_naive

TWO = Decimal("0.01")
DEFAULT_HOUSE_CATEGORIES = (
    ("Office Rent", "house"),
    ("Utilities", "house"),
    ("Internet", "house"),
    ("Stationery", "house"),
    ("Food & Entertainment", "house"),
    ("Bank Charges", "house"),
    ("Transport", "route"),
    ("Fuel", "route"),
    ("Daily Allowance", "route"),
    ("Other", "house"),
)


def _error(status_code: int, code: str, message: str, fields: Optional[dict] = None):
    detail = {"code": code, "message": message}
    if fields:
        detail["fields"] = fields
    raise HTTPException(status_code=status_code, detail=detail)


def money(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(TWO, rounding=ROUND_HALF_UP)


async def get_default_cash_account(db: AsyncSession, house_id: int) -> CashAccount:
    account = (
        await db.execute(
            select(CashAccount)
            .where(
                CashAccount.house_id == house_id,
                CashAccount.account_type == "cash",
                CashAccount.is_active.is_(True),
            )
            .order_by(CashAccount.id)
            .limit(1)
        )
    ).scalar_one_or_none()
    if account:
        return account
    account = CashAccount(house_id=house_id, name="House Cash", account_type="cash")
    db.add(account)
    await db.flush()
    return account


async def assert_date_open(db: AsyncSession, house_id: int, business_date: date) -> None:
    closed = (
        await db.execute(
            select(DailyClosing.id).where(
                DailyClosing.house_id == house_id,
                DailyClosing.business_date == business_date,
                DailyClosing.status == "approved",
            )
        )
    ).scalar_one_or_none()
    if closed:
        _error(
            409,
            "DATE_CLOSED",
            f"{business_date} is already closed and approved",
            {"business_date": "This business date is closed. Ask a manager to reopen it."},
        )


# --------------------------------------------------------------------------- #
# expenses & categories
# --------------------------------------------------------------------------- #
async def ensure_default_categories(db: AsyncSession, house_id: int) -> None:
    existing = {
        row[0]
        for row in (
            await db.execute(select(ExpenseCategory.name).where(ExpenseCategory.house_id == house_id))
        ).all()
    }
    for name, source in DEFAULT_HOUSE_CATEGORIES:
        if name not in existing:
            db.add(ExpenseCategory(house_id=house_id, name=name, source=source))
    await db.flush()


async def create_expense(db: AsyncSession, *, house_id: int, user_id: Optional[int], data) -> Expense:
    business_date = resolve_business_date(data.business_date)
    await assert_date_open(db, house_id, business_date)
    if data.category_id:
        category = await db.get(ExpenseCategory, data.category_id)
        if not category or category.house_id != house_id:
            _error(404, "NOT_FOUND", "Expense category not found", {"category_id": "Invalid category"})
    if data.employee_id:
        employee = await db.get(Employee, data.employee_id)
        if not employee or employee.house_id != house_id:
            _error(404, "NOT_FOUND", "Employee not found in this house", {"employee_id": "Invalid employee"})
    if money(data.amount) <= 0:
        _error(400, "VALIDATION_ERROR", "Amount must be greater than zero", {"amount": "Amount must be greater than zero"})

    expense = Expense(
        house_id=house_id,
        category_id=data.category_id,
        employee_id=data.employee_id,
        source=data.source,
        business_date=business_date,
        description=data.description.strip(),
        amount=money(data.amount),
        status="pending",
        notes=data.notes,
        created_by=user_id,
    )
    db.add(expense)
    await db.flush()
    return expense


async def approve_expense(db: AsyncSession, *, house_id: int, expense_id: int, user_id: Optional[int]) -> Expense:
    expense = await _get_expense(db, house_id, expense_id)
    if expense.status != "pending":
        _error(400, "INVALID_STATUS", "Only a pending expense can be approved")
    expense.status = "approved"
    expense.approved_by = user_id
    expense.approved_at = now_naive()
    await db.flush()
    return expense


async def reject_expense(
    db: AsyncSession, *, house_id: int, expense_id: int, user_id: Optional[int], reason: str
) -> Expense:
    expense = await _get_expense(db, house_id, expense_id)
    if expense.status not in ("pending", "approved"):
        _error(400, "INVALID_STATUS", "This expense cannot be rejected")
    expense.status = "rejected"
    expense.rejection_reason = reason.strip()
    expense.rejected_by = user_id
    expense.rejected_at = now_naive()
    await db.flush()
    return expense


async def pay_expense(
    db: AsyncSession,
    *,
    house_id: int,
    expense_id: int,
    user_id: Optional[int],
    account_id: Optional[int] = None,
    reference: Optional[str] = None,
) -> Expense:
    expense = await _get_expense(db, house_id, expense_id)
    if expense.status != "approved":
        _error(400, "INVALID_STATUS", "Approve the expense before paying it")
    await assert_date_open(db, house_id, expense.business_date)
    account = await _resolve_account(db, house_id, account_id)
    await _add_cash(
        db,
        house_id=house_id,
        account_id=account.id,
        business_date=expense.business_date,
        direction="out",
        amount=money(expense.amount),
        source_type="expense",
        source_id=expense.id,
        reference=reference or f"EXP-{expense.id}",
        description=expense.description,
        user_id=user_id,
    )
    expense.status = "paid"
    expense.payment_reference = reference
    expense.paid_by = user_id
    expense.paid_at = now_naive()
    await db.flush()
    return expense


async def _get_expense(db: AsyncSession, house_id: int, expense_id: int) -> Expense:
    expense = (
        await db.execute(
            select(Expense)
            .options(selectinload(Expense.category), selectinload(Expense.employee))
            .where(Expense.id == expense_id, Expense.house_id == house_id, Expense.is_deleted.is_(False))
        )
    ).scalar_one_or_none()
    if not expense:
        _error(404, "NOT_FOUND", "Expense not found")
    return expense


# --------------------------------------------------------------------------- #
# receipts & cash
# --------------------------------------------------------------------------- #
async def create_receipt(db: AsyncSession, *, house_id: int, user_id: Optional[int], data) -> Receipt:
    business_date = resolve_business_date(data.business_date)
    await assert_date_open(db, house_id, business_date)
    if money(data.amount) <= 0:
        _error(400, "VALIDATION_ERROR", "Amount must be greater than zero", {"amount": "Amount must be greater than zero"})
    receipt = Receipt(
        house_id=house_id,
        business_date=business_date,
        receipt_type=data.receipt_type,
        source_name=data.source_name,
        related_party=data.related_party,
        related_due_reference=data.related_due_reference,
        amount=money(data.amount),
        payment_method=data.payment_method,
        reference=data.reference,
        notes=data.notes,
        created_by=user_id,
    )
    db.add(receipt)
    await db.flush()
    # Only cash receipts enter the cashbook; bank/mobile receipts do not.
    if data.payment_method == "cash":
        account = await _resolve_account(db, house_id, None)
        await _add_cash(
            db,
            house_id=house_id,
            account_id=account.id,
            business_date=business_date,
            direction="in",
            amount=money(data.amount),
            source_type="receipt",
            source_id=receipt.id,
            reference=data.reference or f"RCP-{receipt.id}",
            description=data.receipt_type,
            user_id=user_id,
        )
    await db.flush()
    return receipt


async def _resolve_account(db: AsyncSession, house_id: int, account_id: Optional[int]) -> CashAccount:
    if account_id:
        account = await db.get(CashAccount, account_id)
        if not account or account.house_id != house_id:
            _error(404, "NOT_FOUND", "Cash account not found", {"account_id": "Invalid account"})
        return account
    return await get_default_cash_account(db, house_id)


async def _add_cash(
    db: AsyncSession,
    *,
    house_id: int,
    account_id: int,
    business_date: date,
    direction: str,
    amount: Decimal,
    source_type: str,
    source_id: Optional[int],
    reference: Optional[str],
    description: Optional[str],
    user_id: Optional[int],
    reversal_of: Optional[int] = None,
) -> CashTransaction:
    if source_id is not None:
        existing = (
            await db.execute(
                select(CashTransaction.id).where(
                    CashTransaction.house_id == house_id,
                    CashTransaction.source_type == source_type,
                    CashTransaction.source_id == source_id,
                    CashTransaction.direction == direction,
                )
            )
        ).scalar_one_or_none()
        if existing:
            return await db.get(CashTransaction, existing)
    tx = CashTransaction(
        house_id=house_id,
        account_id=account_id,
        business_date=business_date,
        direction=direction,
        amount=money(amount),
        source_type=source_type,
        source_id=source_id,
        reference=reference,
        description=description,
        reversal_of=reversal_of,
        created_by=user_id,
    )
    db.add(tx)
    await db.flush()
    return tx


async def create_cash_entry(db: AsyncSession, *, house_id: int, user_id: Optional[int], data) -> CashTransaction:
    business_date = resolve_business_date(data.business_date)
    await assert_date_open(db, house_id, business_date)
    if money(data.amount) <= 0:
        _error(400, "VALIDATION_ERROR", "Amount must be greater than zero", {"amount": "Amount must be greater than zero"})
    account = await _resolve_account(db, house_id, data.account_id)
    return await _add_cash(
        db,
        house_id=house_id,
        account_id=account.id,
        business_date=business_date,
        direction=data.direction,
        amount=money(data.amount),
        source_type="manual",
        source_id=None,
        reference=data.reference,
        description=data.description,
        user_id=user_id,
    )


async def reverse_cash_entry(
    db: AsyncSession, *, house_id: int, transaction_id: int, user_id: Optional[int], reason: Optional[str] = None
) -> CashTransaction:
    original = (
        await db.execute(
            select(CashTransaction).where(
                CashTransaction.id == transaction_id,
                CashTransaction.house_id == house_id,
                CashTransaction.is_deleted.is_(False),
            )
        )
    ).scalar_one_or_none()
    if not original:
        _error(404, "NOT_FOUND", "Cash transaction not found")
    await assert_date_open(db, house_id, original.business_date)
    already = (
        await db.execute(
            select(CashTransaction.id).where(CashTransaction.reversal_of == original.id)
        )
    ).scalar_one_or_none()
    if already:
        _error(409, "ALREADY_REVERSED", "This cash transaction was already reversed")
    reversal = CashTransaction(
        house_id=house_id,
        account_id=original.account_id,
        business_date=now_naive().date(),
        direction="out" if original.direction == "in" else "in",
        amount=money(original.amount),
        source_type="reversal",
        source_id=original.id,
        reference=original.reference,
        description=f"Reversal of #{original.id}" + (f": {reason}" if reason else ""),
        reversal_of=original.id,
        created_by=user_id,
    )
    db.add(reversal)
    await db.flush()
    return reversal


async def record_sale_cash(db: AsyncSession, *, house_id: int, sale) -> None:
    """Mirror the collected part of an approved sale into the cashbook once."""
    paid = money(getattr(sale, "paid_amount", 0))
    if paid <= 0:
        return
    await assert_date_open(db, house_id, sale.business_date)
    account = await get_default_cash_account(db, house_id)
    await _add_cash(
        db,
        house_id=house_id,
        account_id=account.id,
        business_date=sale.business_date,
        direction="in",
        amount=paid,
        source_type="sale",
        source_id=sale.id,
        reference=sale.sale_no,
        description="Sale collection",
        user_id=getattr(sale, "approved_by", None),
    )


async def cashbook(db: AsyncSession, *, house_id: int, business_date: date) -> dict:
    account = await get_default_cash_account(db, house_id)
    prior = (
        await db.execute(
            select(
                func.coalesce(func.sum(CashTransaction.amount), 0)
            ).where(
                CashTransaction.house_id == house_id,
                CashTransaction.account_id == account.id,
                CashTransaction.business_date < business_date,
                CashTransaction.is_deleted.is_(False),
                CashTransaction.direction == "in",
            )
        )
    ).scalar() or 0
    prior_out = (
        await db.execute(
            select(func.coalesce(func.sum(CashTransaction.amount), 0)).where(
                CashTransaction.house_id == house_id,
                CashTransaction.account_id == account.id,
                CashTransaction.business_date < business_date,
                CashTransaction.is_deleted.is_(False),
                CashTransaction.direction == "out",
            )
        )
    ).scalar() or 0
    opening = money(account.opening_balance) + money(prior) - money(prior_out)

    rows = list(
        (
            await db.execute(
                select(CashTransaction)
                .where(
                    CashTransaction.house_id == house_id,
                    CashTransaction.account_id == account.id,
                    CashTransaction.business_date == business_date,
                    CashTransaction.is_deleted.is_(False),
                )
                .order_by(CashTransaction.id)
            )
        )
        .scalars()
        .all()
    )
    cash_in = sum((money(tx.amount) for tx in rows if tx.direction == "in"), Decimal("0"))
    cash_out = sum((money(tx.amount) for tx in rows if tx.direction == "out"), Decimal("0"))
    expected = opening + cash_in - cash_out

    closing = (
        await db.execute(
            select(DailyClosing).where(
                DailyClosing.house_id == house_id,
                DailyClosing.business_date == business_date,
            )
        )
    ).scalar_one_or_none()

    return {
        "business_date": business_date.isoformat(),
        "account": {"id": account.id, "name": account.name},
        "opening_cash": float(opening),
        "cash_in": float(cash_in),
        "cash_out": float(cash_out),
        "expected_cash": float(expected),
        "counted_cash": float(closing.counted_cash) if closing else None,
        "difference": float(closing.difference) if closing else None,
        "closing_status": closing.status if closing else None,
        "transactions": [
            {
                "id": tx.id,
                "direction": tx.direction,
                "amount": float(tx.amount),
                "source_type": tx.source_type,
                "source_id": tx.source_id,
                "reference": tx.reference,
                "description": tx.description,
                "reversal_of": tx.reversal_of,
                "created_at": tx.created_at.isoformat() if tx.created_at else None,
            }
            for tx in rows
        ],
    }


# --------------------------------------------------------------------------- #
# daily closing
# --------------------------------------------------------------------------- #
async def _snapshots(db: AsyncSession, house_id: int) -> Tuple[dict, list, list]:
    serial_rows = (
        await db.execute(
            select(SerialUnit.status, func.count(SerialUnit.id))
            .where(SerialUnit.house_id == house_id)
            .group_by(SerialUnit.status)
        )
    ).all()
    stock = {status: count for status, count in serial_rows}

    employee_rows = (
        await db.execute(
            select(SerialUnit.current_employee_id, func.count(SerialUnit.id))
            .where(
                SerialUnit.house_id == house_id,
                SerialUnit.current_employee_id.isnot(None),
                SerialUnit.status == "assigned",
            )
            .group_by(SerialUnit.current_employee_id)
        )
    ).all()
    employee_ids = [row[0] for row in employee_rows]
    employees = {}
    if employee_ids:
        employees = {
            emp.id: emp.employee_name
            for emp in (
                await db.execute(select(Employee).where(Employee.id.in_(employee_ids)))
            ).scalars().all()
        }
    employee_snapshot = [
        {"employee_id": emp_id, "employee_name": employees.get(emp_id), "assigned": count}
        for emp_id, count in employee_rows
    ]

    topup_rows = (
        await db.execute(
            select(ITopUpBalance.employee_id, ITopUpBalance.balance).where(
                ITopUpBalance.house_id == house_id
            )
        )
    ).all()
    topup_snapshot = [
        {"employee_id": emp_id, "balance": float(balance)} for emp_id, balance in topup_rows
    ]
    return stock, employee_snapshot, topup_snapshot


async def submit_closing(db: AsyncSession, *, house_id: int, user_id: Optional[int], data) -> DailyClosing:
    business_date = resolve_business_date(data.business_date)
    book = await cashbook(db, house_id=house_id, business_date=business_date)
    existing = (
        await db.execute(
            select(DailyClosing).where(
                DailyClosing.house_id == house_id,
                DailyClosing.business_date == business_date,
            )
        )
    ).scalar_one_or_none()
    if existing and existing.status == "approved":
        _error(409, "DATE_CLOSED", "This date is already closed and approved")

    stock, employees, topup = await _snapshots(db, house_id)
    expected = money(book["expected_cash"])
    counted = money(data.counted_cash)
    closing = existing or DailyClosing(house_id=house_id, business_date=business_date)
    closing.status = "submitted"
    closing.opening_cash = money(book["opening_cash"])
    closing.cash_in = money(book["cash_in"])
    closing.cash_out = money(book["cash_out"])
    closing.expected_cash = expected
    closing.counted_cash = counted
    closing.difference = counted - expected
    closing.stock_snapshot = stock
    closing.employee_snapshot = employees
    closing.topup_snapshot = topup
    closing.notes = data.notes
    closing.submitted_by = user_id
    closing.submitted_at = now_naive()
    if existing is None:
        db.add(closing)
    await db.flush()
    return closing


async def approve_closing(db: AsyncSession, *, house_id: int, closing_id: int, user_id: Optional[int]) -> DailyClosing:
    closing = await _get_closing(db, house_id, closing_id)
    if closing.status != "submitted":
        _error(400, "INVALID_STATUS", "Only a submitted closing can be approved")
    closing.status = "approved"
    closing.approved_by = user_id
    closing.approved_at = now_naive()
    await db.flush()
    return closing


async def reopen_closing(
    db: AsyncSession, *, house_id: int, closing_id: int, user_id: Optional[int], reason: str
) -> DailyClosing:
    closing = await _get_closing(db, house_id, closing_id)
    if closing.status != "approved":
        _error(400, "INVALID_STATUS", "Only an approved closing can be reopened")
    closing.status = "reopened"
    closing.reopened_by = user_id
    closing.reopened_at = now_naive()
    closing.reopen_reason = reason.strip()
    await db.flush()
    return closing


async def _get_closing(db: AsyncSession, house_id: int, closing_id: int) -> DailyClosing:
    closing = (
        await db.execute(
            select(DailyClosing).where(
                DailyClosing.id == closing_id, DailyClosing.house_id == house_id
            )
        )
    ).scalar_one_or_none()
    if not closing:
        _error(404, "NOT_FOUND", "Daily closing not found")
    return closing


# --------------------------------------------------------------------------- #
# iTopUp daily entries
# --------------------------------------------------------------------------- #
async def create_topup_entry(db: AsyncSession, *, house_id: int, user_id: Optional[int], data) -> TopupEntry:
    business_date = resolve_business_date(data.business_date)
    await assert_date_open(db, house_id, business_date)
    if data.employee_id:
        employee = await db.get(Employee, data.employee_id)
        if not employee or employee.house_id != house_id:
            _error(404, "NOT_FOUND", "Employee not found in this house", {"employee_id": "Invalid employee"})

    raw = money(data.amount)
    if data.entry_type in ("usage", "return") and raw <= 0:
        _error(400, "VALIDATION_ERROR", "Amount must be greater than zero", {"amount": "Amount must be greater than zero"})
    if data.entry_type == "adjustment" and raw == 0:
        _error(400, "VALIDATION_ERROR", "Adjustment amount cannot be zero", {"amount": "Adjustment amount cannot be zero"})

    signed = raw if data.entry_type == "adjustment" else -raw
    entry = TopupEntry(
        house_id=house_id,
        employee_id=data.employee_id,
        business_date=business_date,
        entry_type=data.entry_type,
        amount=raw,
        reference=data.reference,
        report_source=data.report_source,
        notes=data.notes,
        created_by=user_id,
    )
    db.add(entry)
    await db.flush()
    await apply_itopup_change(
        db,
        house_id=house_id,
        employee_id=data.employee_id,
        amount=float(signed),
        movement_type=data.entry_type,
        reference_type="topup_entry",
        reference_id=entry.id,
        reason=data.reference,
        user_id=user_id,
    )
    await db.flush()
    return entry


async def verify_topup_entry(
    db: AsyncSession, *, house_id: int, entry_id: int, user_id: Optional[int], verified_amount, notes: Optional[str] = None
) -> TopupEntry:
    entry = (
        await db.execute(
            select(TopupEntry).where(TopupEntry.id == entry_id, TopupEntry.house_id == house_id)
        )
    ).scalar_one_or_none()
    if not entry:
        _error(404, "NOT_FOUND", "iTopUp entry not found")
    verified = money(verified_amount)
    entry.is_verified = True
    entry.verified_amount = verified
    entry.discrepancy = verified - money(entry.amount)
    entry.verified_by = user_id
    entry.verified_at = now_naive()
    if notes:
        entry.notes = notes
    await db.flush()
    return entry


async def topup_reconciliation(db: AsyncSession, *, house_id: int, business_date: date) -> dict:
    # Daily entries carry the business date (the ledger only has created_at), so
    # the per-holder reconciliation is built from `topup_entries`.
    rows = (
        await db.execute(
            select(
                TopupEntry.employee_id,
                TopupEntry.entry_type,
                func.coalesce(func.sum(TopupEntry.amount), 0),
                func.count(TopupEntry.id),
            )
            .where(
                TopupEntry.house_id == house_id,
                TopupEntry.business_date == business_date,
                TopupEntry.is_deleted.is_(False),
            )
            .group_by(TopupEntry.employee_id, TopupEntry.entry_type)
        )
    ).all()

    balances = {
        emp_id: money(balance)
        for emp_id, balance in (
            await db.execute(
                select(ITopUpBalance.employee_id, ITopUpBalance.balance).where(
                    ITopUpBalance.house_id == house_id
                )
            )
        ).all()
    }
    employee_ids = [row[0] for row in rows if row[0] is not None]
    employees = {}
    if employee_ids:
        employees = {
            emp.id: emp.employee_name
            for emp in (
                await db.execute(select(Employee).where(Employee.id.in_(employee_ids)))
            ).scalars().all()
        }

    per_holder: dict = {}

    def entry(emp_id):
        return per_holder.setdefault(
            emp_id,
            {
                "employee_id": emp_id,
                "employee_name": employees.get(emp_id) if emp_id else "Mother SIM",
                "received": 0.0,
                "used": 0.0,
                "returned": 0.0,
                "adjustment": 0.0,
                "closing_balance": float(balances.get(emp_id, 0)),
            },
        )

    for emp_id, movement, total, _count in rows:
        holder = entry(emp_id)
        value = float(total)
        if movement == "usage":
            holder["used"] += abs(value)
        elif movement == "return":
            holder["returned"] += abs(value)
        elif movement == "adjustment":
            holder["adjustment"] += value

    for holder in per_holder.values():
        opening = (
            holder["closing_balance"]
            - holder["received"]
            - holder["adjustment"]
            + holder["used"]
            + holder["returned"]
        )
        holder["opening_balance"] = round(opening, 2)
        holder["expected_closing"] = round(
            opening + holder["received"] + holder["adjustment"] - holder["used"] - holder["returned"],
            2,
        )

    entries = list(
        (
            await db.execute(
                select(TopupEntry)
                .options(selectinload(TopupEntry.employee))
                .where(
                    TopupEntry.house_id == house_id,
                    TopupEntry.business_date == business_date,
                    TopupEntry.is_deleted.is_(False),
                )
                .order_by(TopupEntry.id)
            )
        )
        .scalars()
        .all()
    )

    return {
        "business_date": business_date.isoformat(),
        "holders": sorted(per_holder.values(), key=lambda row: (row["employee_id"] is not None, row["employee_id"] or 0)),
        "entries": [
            {
                "id": entry.id,
                "employee_id": entry.employee_id,
                "employee_name": getattr(entry.employee, "employee_name", None) or "Mother SIM",
                "entry_type": entry.entry_type,
                "amount": float(entry.amount),
                "reference": entry.reference,
                "report_source": entry.report_source,
                "is_verified": entry.is_verified,
                "verified_amount": float(entry.verified_amount) if entry.verified_amount is not None else None,
                "discrepancy": float(entry.discrepancy or 0),
                "notes": entry.notes,
            }
            for entry in entries
        ],
    }


async def list_expenses(
    db: AsyncSession,
    *,
    house_id: int,
    page: int,
    per_page: int,
    status: Optional[str] = None,
    source: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
) -> Tuple[List[Expense], int]:
    filters = [Expense.house_id == house_id, Expense.is_deleted.is_(False)]
    if status:
        filters.append(Expense.status == status)
    if source:
        filters.append(Expense.source == source)
    if search:
        filters.append(Expense.description.ilike(f"%{search.strip()}%"))
    if date_from:
        filters.append(Expense.business_date >= date_from)
    if date_to:
        filters.append(Expense.business_date <= date_to)
    total = (await db.execute(select(func.count(Expense.id)).where(*filters))).scalar() or 0
    rows = list(
        (
            await db.execute(
                select(Expense)
                .options(selectinload(Expense.category), selectinload(Expense.employee))
                .where(*filters)
                .order_by(Expense.id.desc())
                .offset((page - 1) * per_page)
                .limit(per_page)
            )
        )
        .scalars()
        .all()
    )
    return rows, total


async def list_receipts(
    db: AsyncSession,
    *,
    house_id: int,
    page: int,
    per_page: int,
    search: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
) -> Tuple[List[Receipt], int]:
    filters = [Receipt.house_id == house_id, Receipt.is_deleted.is_(False)]
    if search:
        pattern = f"%{search.strip()}%"
        filters.append(
            Receipt.receipt_type.ilike(pattern)
            | Receipt.source_name.ilike(pattern)
            | Receipt.related_party.ilike(pattern)
        )
    if date_from:
        filters.append(Receipt.business_date >= date_from)
    if date_to:
        filters.append(Receipt.business_date <= date_to)
    total = (await db.execute(select(func.count(Receipt.id)).where(*filters))).scalar() or 0
    rows = list(
        (
            await db.execute(
                select(Receipt)
                .where(*filters)
                .order_by(Receipt.id.desc())
                .offset((page - 1) * per_page)
                .limit(per_page)
            )
        )
        .scalars()
        .all()
    )
    return rows, total
