"""P3 finance: expense lifecycle, cashbook, daily closing and iTopUp entries."""

from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.models.employee import Employee
from app.models.finance import CashTransaction, DailyClosing, Expense, Receipt
from app.models.house import House
from app.models.itopup_balance import ITopUpBalance, ITopUpBalanceLedger
from app.schemas.finance import (
    CashEntryCreate,
    ClosingReopen,
    ClosingSubmit,
    ExpenseCreate,
    ExpenseReject,
    ReceiptCreate,
    TopupEntryCreate,
    TopupVerify,
)
from app.services import finance_service as svc
from app.services.itopup_service import apply_itopup_change

TODAY = date(2026, 10, 29)


@pytest.fixture
async def setup(db):
    house = House(code="FIN-H1", name="Finance House", email="fin1@example.com")
    other = House(code="FIN-H2", name="Other Finance House", email="fin2@example.com")
    db.add_all([house, other])
    await db.flush()

    rso = Employee(
        house_id=house.id,
        dms_code="FIN-RSO-1",
        employee_name="Finance RSO",
        employee_type="rso",
        status="Active",
        employee_id="FIN-RSO-1",
    )
    db.add(rso)
    await db.commit()
    return {"house": house, "other": other, "rso": rso}


def _expense(setup, amount="120.50", source="house", **overrides):
    payload = dict(
        business_date=TODAY,
        description="Office supplies",
        amount=Decimal(amount),
        source=source,
        employee_id=setup["rso"].id if source == "route" else None,
    )
    payload.update(overrides)
    return ExpenseCreate(**payload)


async def test_expense_must_be_approved_before_payment(db, setup):
    house_id = setup["house"].id
    expense = await svc.create_expense(
        db, house_id=house_id, user_id=1, data=_expense(setup)
    )
    await db.commit()
    assert expense.status == "pending"

    with pytest.raises(HTTPException) as exc:
        await svc.pay_expense(db, house_id=house_id, expense_id=expense.id, user_id=2)
    assert exc.value.detail["code"] == "INVALID_STATUS"

    await svc.approve_expense(db, house_id=house_id, expense_id=expense.id, user_id=2)
    await db.commit()
    paid = await svc.pay_expense(
        db, house_id=house_id, expense_id=expense.id, user_id=2, reference="CASH-1"
    )
    await db.commit()
    assert paid.status == "paid"

    cash = list(
        (
            await db.execute(
                select(CashTransaction).where(CashTransaction.source_type == "expense")
            )
        )
        .scalars()
        .all()
    )
    assert len(cash) == 1
    assert cash[0].direction == "out"
    assert cash[0].amount == Decimal("120.50")

    with pytest.raises(HTTPException) as exc:
        await svc.pay_expense(db, house_id=house_id, expense_id=expense.id, user_id=2)
    assert exc.value.detail["code"] == "INVALID_STATUS"
    assert (
        await db.execute(
            select(func.count(CashTransaction.id)).where(
                CashTransaction.source_type == "expense"
            )
        )
    ).scalar() == 1


async def test_rejection_requires_reason_and_blocks_payment(db, setup):
    house_id = setup["house"].id
    expense = await svc.create_expense(
        db, house_id=house_id, user_id=1, data=_expense(setup)
    )
    await db.commit()
    rejected = await svc.reject_expense(
        db, house_id=house_id, expense_id=expense.id, user_id=2, reason="Duplicate bill"
    )
    await db.commit()
    assert rejected.status == "rejected"
    assert rejected.rejection_reason == "Duplicate bill"

    with pytest.raises(HTTPException) as exc:
        await svc.pay_expense(db, house_id=house_id, expense_id=expense.id, user_id=2)
    assert exc.value.detail["code"] == "INVALID_STATUS"


async def test_only_cash_receipts_enter_the_cashbook(db, setup):
    house_id = setup["house"].id
    await svc.create_receipt(
        db,
        house_id=house_id,
        user_id=1,
        data=ReceiptCreate(
            business_date=TODAY,
            receipt_type="Old due",
            amount=Decimal("500"),
            payment_method="cash",
            reference="RC-1",
        ),
    )
    await svc.create_receipt(
        db,
        house_id=house_id,
        user_id=1,
        data=ReceiptCreate(
            business_date=TODAY,
            receipt_type="Supplier refund",
            amount=Decimal("300"),
            payment_method="bank",
        ),
    )
    await db.commit()

    book = await svc.cashbook(db, house_id=house_id, business_date=TODAY)
    assert book["cash_in"] == 500.0
    assert book["cash_out"] == 0.0
    assert len(book["transactions"]) == 1
    assert (
        await db.execute(select(func.count(Receipt.id)))
    ).scalar() == 2


async def test_cash_entry_reversal_is_append_only(db, setup):
    house_id = setup["house"].id
    tx = await svc.create_cash_entry(
        db,
        house_id=house_id,
        user_id=1,
        data=CashEntryCreate(
            business_date=TODAY,
            direction="out",
            amount=Decimal("80"),
            description="Tea",
        ),
    )
    await db.commit()

    reversal = await svc.reverse_cash_entry(
        db, house_id=house_id, transaction_id=tx.id, user_id=2, reason="Wrong entry"
    )
    await db.commit()
    assert reversal.direction == "in"
    assert reversal.reversal_of == tx.id

    # The original row is untouched and a second reversal is refused.
    original = await db.get(CashTransaction, tx.id)
    assert original.direction == "out"
    with pytest.raises(HTTPException) as exc:
        await svc.reverse_cash_entry(
            db, house_id=house_id, transaction_id=tx.id, user_id=2
        )
    assert exc.value.detail["code"] == "ALREADY_REVERSED"


async def test_approved_closing_freezes_the_date_until_reopened(db, setup):
    house_id = setup["house"].id
    closing = await svc.submit_closing(
        db,
        house_id=house_id,
        user_id=1,
        data=ClosingSubmit(business_date=TODAY, counted_cash=Decimal("0")),
    )
    await db.commit()
    assert closing.status == "submitted"
    assert closing.difference == Decimal("0.00")

    approved = await svc.approve_closing(
        db, house_id=house_id, closing_id=closing.id, user_id=2
    )
    await db.commit()
    assert approved.status == "approved"

    with pytest.raises(HTTPException) as exc:
        await svc.create_expense(db, house_id=house_id, user_id=1, data=_expense(setup))
    assert exc.value.detail["code"] == "DATE_CLOSED"

    with pytest.raises(HTTPException) as exc:
        await svc.create_cash_entry(
            db,
            house_id=house_id,
            user_id=1,
            data=CashEntryCreate(
                business_date=TODAY, direction="in", amount=Decimal("10")
            ),
        )
    assert exc.value.detail["code"] == "DATE_CLOSED"

    await svc.reopen_closing(
        db,
        house_id=house_id,
        closing_id=closing.id,
        user_id=2,
        reason="Missed a bill",
    )
    await db.commit()
    reopened = (
        await db.execute(select(DailyClosing).where(DailyClosing.id == closing.id))
    ).scalar_one()
    assert reopened.status == "reopened"

    created = await svc.create_expense(
        db, house_id=house_id, user_id=1, data=_expense(setup)
    )
    await db.commit()
    assert created.id is not None


async def test_closing_difference_detects_short_cash(db, setup):
    house_id = setup["house"].id
    await svc.create_cash_entry(
        db,
        house_id=house_id,
        user_id=1,
        data=CashEntryCreate(
            business_date=TODAY, direction="in", amount=Decimal("1000")
        ),
    )
    await db.commit()

    closing = await svc.submit_closing(
        db,
        house_id=house_id,
        user_id=1,
        data=ClosingSubmit(business_date=TODAY, counted_cash=Decimal("950")),
    )
    await db.commit()
    assert closing.expected_cash == Decimal("1000.00")
    assert closing.difference == Decimal("-50.00")
    assert closing.stock_snapshot == {}
    assert closing.topup_snapshot == []


async def test_topup_usage_reduces_balance_and_verify_flags_discrepancy(db, setup):
    house_id = setup["house"].id
    await apply_itopup_change(
        db,
        house_id=house_id,
        employee_id=setup["rso"].id,
        amount=5000,
        movement_type="lifting_in",
        reference_type="test",
        user_id=1,
    )
    await db.commit()

    entry = await svc.create_topup_entry(
        db,
        house_id=house_id,
        user_id=1,
        data=TopupEntryCreate(
            employee_id=setup["rso"].id,
            business_date=TODAY,
            entry_type="usage",
            amount=Decimal("1200"),
        ),
    )
    await db.commit()

    balance = (
        await db.execute(
            select(ITopUpBalance).where(ITopUpBalance.employee_id == setup["rso"].id)
        )
    ).scalar_one()
    assert balance.balance == Decimal("3800.00")

    ledger = (
        await db.execute(
            select(ITopUpBalanceLedger).where(
                ITopUpBalanceLedger.reference_type == "topup_entry"
            )
        )
    ).scalar_one()
    assert ledger.amount == Decimal("-1200.00")

    verified = await svc.verify_topup_entry(
        db,
        house_id=house_id,
        entry_id=entry.id,
        user_id=2,
        verified_amount=Decimal("1150"),
        notes="Report mismatch",
    )
    await db.commit()
    assert verified.is_verified is True
    assert verified.discrepancy == Decimal("-50.00")

    reconciliation = await svc.topup_reconciliation(
        db, house_id=house_id, business_date=TODAY
    )
    holder = next(
        row for row in reconciliation["holders"] if row["employee_id"] == setup["rso"].id
    )
    assert holder["used"] == 1200.0
    assert holder["closing_balance"] == 3800.0
    assert reconciliation["entries"][0]["is_verified"] is True


async def test_negative_topup_usage_is_refused_by_balance_guard(db, setup):
    house_id = setup["house"].id
    with pytest.raises(HTTPException) as exc:
        await svc.create_topup_entry(
            db,
            house_id=house_id,
            user_id=1,
            data=TopupEntryCreate(
                employee_id=setup["rso"].id,
                business_date=TODAY,
                entry_type="usage",
                amount=Decimal("10"),
            ),
        )
    assert exc.value.status_code == 400
    assert (
        await db.execute(select(func.count(ITopUpBalanceLedger.id)))
    ).scalar() == 0


async def test_finance_records_are_house_scoped(db, setup):
    house_id = setup["house"].id
    other_id = setup["other"].id
    expense = await svc.create_expense(
        db, house_id=house_id, user_id=1, data=_expense(setup)
    )
    await db.commit()

    with pytest.raises(HTTPException) as exc:
        await svc.approve_expense(
            db, house_id=other_id, expense_id=expense.id, user_id=2
        )
    assert exc.value.status_code == 404

    rows, total = await svc.list_expenses(
        db, house_id=other_id, page=1, per_page=20
    )
    assert rows == [] and total == 0

    closing = await svc.submit_closing(
        db,
        house_id=other_id,
        user_id=1,
        data=ClosingSubmit(business_date=TODAY, counted_cash=Decimal("0")),
    )
    await db.commit()
    with pytest.raises(HTTPException) as exc:
        await svc.approve_closing(
            db, house_id=house_id, closing_id=closing.id, user_id=2
        )
    assert exc.value.status_code == 404


async def test_expense_rejects_foreign_category(db, setup):
    from app.models.finance import ExpenseCategory

    category = ExpenseCategory(house_id=setup["other"].id, name="Foreign", source="house")
    db.add(category)
    await db.commit()

    with pytest.raises(HTTPException) as exc:
        await svc.create_expense(
            db,
            house_id=setup["house"].id,
            user_id=1,
            data=_expense(setup, category_id=category.id),
        )
    assert exc.value.status_code == 404
