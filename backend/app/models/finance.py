"""Finance ledger (P3): expenses, other receipts, cashbook and daily closing.

Money is stored as NUMERIC and every cash movement is an append-only row: a
mistake is corrected with a reversal, never an update or delete.
"""

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.models.base import Base
from app.utils.timezone import now_naive

EXPENSE_STATUSES = ("pending", "approved", "rejected", "paid")
EXPENSE_SOURCES = ("route", "house")
RECEIPT_METHODS = ("cash", "bank", "mobile", "other")
CASH_DIRECTIONS = ("in", "out")
CLOSING_STATUSES = ("submitted", "approved", "reopened")
TOPUP_ENTRY_TYPES = ("usage", "return", "adjustment")


class ExpenseCategory(Base):
    __tablename__ = "expense_categories"
    __table_args__ = (
        UniqueConstraint("house_id", "name", "source", name="uq_expense_category_name"),
    )

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    source = Column(String(20), nullable=False, default="house")
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=now_naive)

    house = relationship("House")


class Expense(Base):
    __tablename__ = "expenses"
    __table_args__ = (
        Index("ix_expenses_house_date", "house_id", "business_date"),
        Index("ix_expenses_house_status", "house_id", "status"),
    )

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    category_id = Column(Integer, ForeignKey("expense_categories.id"), nullable=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True, index=True)
    source = Column(String(20), nullable=False, default="house")
    business_date = Column(Date, nullable=False)
    description = Column(String(500), nullable=False)
    amount = Column(Numeric(14, 2), nullable=False, default=0)
    status = Column(String(20), nullable=False, default="pending", index=True)
    rejection_reason = Column(String(500), nullable=True)
    payment_reference = Column(String(120), nullable=True)
    notes = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    rejected_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    rejected_at = Column(DateTime, nullable=True)
    paid_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    paid_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)
    is_deleted = Column(Boolean, nullable=False, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    house = relationship("House")
    category = relationship("ExpenseCategory", lazy="joined")
    employee = relationship("Employee")


class Receipt(Base):
    """Other receipts (old dues, supplier refunds, misc income)."""

    __tablename__ = "receipts"
    __table_args__ = (Index("ix_receipts_house_date", "house_id", "business_date"),)

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    business_date = Column(Date, nullable=False)
    receipt_type = Column(String(60), nullable=False)
    source_name = Column(String(200), nullable=True)
    related_party = Column(String(200), nullable=True)
    related_due_reference = Column(String(120), nullable=True)
    amount = Column(Numeric(14, 2), nullable=False, default=0)
    payment_method = Column(String(20), nullable=False, default="cash")
    reference = Column(String(120), nullable=True)
    notes = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=now_naive)
    is_deleted = Column(Boolean, nullable=False, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    house = relationship("House")


class CashAccount(Base):
    __tablename__ = "cash_accounts"
    __table_args__ = (UniqueConstraint("house_id", "name", name="uq_cash_account_name"),)

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    account_type = Column(String(20), nullable=False, default="cash")
    opening_balance = Column(Numeric(14, 2), nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=now_naive)

    house = relationship("House")


class CashTransaction(Base):
    """Append-only cash movement. Reversals are new rows, never updates."""

    __tablename__ = "cash_transactions"
    __table_args__ = (
        UniqueConstraint(
            "house_id", "source_type", "source_id", "direction",
            name="uq_cash_transaction_source",
        ),
        Index("ix_cash_transactions_house_date", "house_id", "business_date"),
    )

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    account_id = Column(Integer, ForeignKey("cash_accounts.id"), nullable=False, index=True)
    business_date = Column(Date, nullable=False, index=True)
    direction = Column(String(5), nullable=False)  # in | out
    amount = Column(Numeric(14, 2), nullable=False, default=0)
    source_type = Column(String(30), nullable=False, default="manual")
    source_id = Column(Integer, nullable=True)
    reference = Column(String(120), nullable=True)
    description = Column(String(500), nullable=True)
    reversal_of = Column(Integer, ForeignKey("cash_transactions.id"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=now_naive)
    is_deleted = Column(Boolean, nullable=False, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    house = relationship("House")
    account = relationship("CashAccount")


class DailyClosing(Base):
    __tablename__ = "daily_closings"
    __table_args__ = (
        UniqueConstraint("house_id", "business_date", name="uq_daily_closing_date"),
        Index("ix_daily_closings_house_status", "house_id", "status"),
    )

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    business_date = Column(Date, nullable=False, index=True)
    status = Column(String(20), nullable=False, default="submitted", index=True)
    opening_cash = Column(Numeric(14, 2), nullable=False, default=0)
    cash_in = Column(Numeric(14, 2), nullable=False, default=0)
    cash_out = Column(Numeric(14, 2), nullable=False, default=0)
    expected_cash = Column(Numeric(14, 2), nullable=False, default=0)
    counted_cash = Column(Numeric(14, 2), nullable=False, default=0)
    difference = Column(Numeric(14, 2), nullable=False, default=0)
    stock_snapshot = Column(JSON, nullable=True)
    employee_snapshot = Column(JSON, nullable=True)
    topup_snapshot = Column(JSON, nullable=True)
    notes = Column(Text, nullable=True)
    submitted_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    submitted_at = Column(DateTime, nullable=True)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    reopened_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    reopened_at = Column(DateTime, nullable=True)
    reopen_reason = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)

    house = relationship("House")


class TopupEntry(Base):
    """Daily iTopUp usage / return entry, verified against the source report."""

    __tablename__ = "topup_entries"
    __table_args__ = (
        Index("ix_topup_entries_house_date", "house_id", "business_date"),
        Index("ix_topup_entries_house_employee", "house_id", "employee_id"),
    )

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True, index=True)
    business_date = Column(Date, nullable=False)
    entry_type = Column(String(20), nullable=False, default="usage")
    amount = Column(Numeric(14, 2), nullable=False, default=0)
    reference = Column(String(120), nullable=True)
    report_source = Column(String(20), nullable=False, default="manual")
    is_verified = Column(Boolean, nullable=False, default=False)
    verified_amount = Column(Numeric(14, 2), nullable=True)
    verified_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    verified_at = Column(DateTime, nullable=True)
    discrepancy = Column(Numeric(14, 2), nullable=False, default=0)
    notes = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=now_naive)
    is_deleted = Column(Boolean, nullable=False, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    house = relationship("House")
    employee = relationship("Employee")
