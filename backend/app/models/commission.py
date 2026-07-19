from decimal import Decimal
from datetime import date, datetime
from sqlalchemy import (
    Column, Integer, String, Numeric, Date, DateTime, Text,
    ForeignKey, UniqueConstraint, Index,
    CheckConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import JSONB
from typing import Optional
from app.utils.timezone import now_naive

from app.models.base import Base
from app.models.house import House
from app.models.employee import Employee


class StatementBatch(Base):
    __tablename__ = "statement_batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    statement_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    house_id: Mapped[int] = mapped_column(ForeignKey("houses.id", ondelete="CASCADE"), nullable=False, index=True)
    batch_reference: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    total_records: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    processed_records: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    failed_records: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    error_log: Mapped[Optional[str]] = mapped_column(Text)
    uploaded_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_naive)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_naive, onupdate=now_naive)

    house: Mapped["House"] = relationship("House")
    campaign_transactions: Mapped[list["CampaignTransaction"]] = relationship("CampaignTransaction", back_populates="statement_batch")
    financial_entries: Mapped[list["FinancialEntry"]] = relationship("FinancialEntry", back_populates="statement_batch")

    __table_args__ = (
        Index("ix_statement_batches_date_status", "statement_date", "status"),
        Index("ix_statement_batches_house_date", "house_id", "statement_date"),
    )


class CampaignType(Base):
    __tablename__ = "campaign_types"

    id: Mapped[int] = mapped_column(primary_key=True)
    category: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    campaign_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(default=True)
    valid_from: Mapped[Optional[date]] = mapped_column(Date)
    valid_to: Mapped[Optional[date]] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_naive)

    transactions: Mapped[list["CampaignTransaction"]] = relationship("CampaignTransaction", back_populates="campaign_type")

    __table_args__ = (
        UniqueConstraint("campaign_name", "category", name="uq_campaign_type_name_category"),
        Index("ix_campaign_types_active", "is_active"),
        Index("ix_campaign_types_valid_dates", "valid_from", "valid_to"),
    )


class CampaignTransaction(Base):
    __tablename__ = "campaign_transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    statement_batch_id: Mapped[int] = mapped_column(
        ForeignKey("statement_batches.id", ondelete="CASCADE"), nullable=False, index=True
    )
    house_id: Mapped[int] = mapped_column(
        ForeignKey("houses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    campaign_type_id: Mapped[int] = mapped_column(
        ForeignKey("campaign_types.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    participant_type: Mapped[str] = mapped_column(String(30), nullable=False)
    participant_ref: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    participant_name: Mapped[Optional[str]] = mapped_column(String(255))
    employee_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("employees.id", ondelete="SET NULL"), nullable=True, index=True
    )
    purpose: Mapped[Optional[str]] = mapped_column(Text)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    extra_data: Mapped[Optional[dict]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_naive)

    statement_batch: Mapped["StatementBatch"] = relationship("StatementBatch", back_populates="campaign_transactions")
    house: Mapped["House"] = relationship("House")
    campaign_type: Mapped["CampaignType"] = relationship("CampaignType", back_populates="transactions")
    employee: Mapped[Optional["Employee"]] = relationship("Employee")

    __table_args__ = (
        Index("ix_campaign_txn_batch_campaign", "statement_batch_id", "campaign_type_id"),
        Index("ix_campaign_txn_house_campaign", "house_id", "campaign_type_id"),
        Index("ix_campaign_txn_participant", "participant_type", "participant_ref"),
        Index("ix_campaign_txn_amount", "amount"),
        CheckConstraint("amount >= 0", name="ck_campaign_txn_amount_positive"),
    )


class FinancialEntry(Base):
    __tablename__ = "financial_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    statement_batch_id: Mapped[int] = mapped_column(
        ForeignKey("statement_batches.id", ondelete="CASCADE"), nullable=False, index=True
    )
    house_id: Mapped[int] = mapped_column(
        ForeignKey("houses.id", ondelete="CASCADE"), nullable=False, index=True
    )
    entry_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    extra_data: Mapped[Optional[dict]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_naive)

    statement_batch: Mapped["StatementBatch"] = relationship("StatementBatch", back_populates="financial_entries")
    house: Mapped["House"] = relationship("House")

    __table_args__ = (
        Index("ix_financial_entries_type", "entry_type"),
        Index("ix_financial_entries_house_type", "house_id", "entry_type"),
        Index("ix_financial_entries_batch_type", "statement_batch_id", "entry_type"),
        CheckConstraint("amount >= 0", name="ck_financial_entry_amount_positive"),
    )


class CommissionAuditLog(Base):
    __tablename__ = "commission_audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    table_name: Mapped[str] = mapped_column(String(100), nullable=False)
    record_id: Mapped[int] = mapped_column(nullable=False)
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    old_values: Mapped[Optional[dict]] = mapped_column(JSONB)
    new_values: Mapped[Optional[dict]] = mapped_column(JSONB)
    changed_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    changed_at: Mapped[datetime] = mapped_column(DateTime, default=now_naive)

    __table_args__ = (
        Index("ix_audit_log_table_record", "table_name", "record_id"),
        Index("ix_audit_log_changed_at", "changed_at"),
    )


class CommissionStaging(Base):
    __tablename__ = "commission_staging"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_reference: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    row_number: Mapped[int] = mapped_column(Integer, nullable=False)
    raw_data: Mapped[dict] = mapped_column(JSONB, nullable=False)

    house_code: Mapped[str] = mapped_column(String(50), nullable=False)
    house_name: Mapped[Optional[str]] = mapped_column(String(255))
    statement_date: Mapped[date] = mapped_column(Date, nullable=False)
    campaign_name: Mapped[str] = mapped_column(String(255), nullable=False)
    campaign_category: Mapped[Optional[str]] = mapped_column(String(100))
    participant_type: Mapped[Optional[str]] = mapped_column(String(50))
    participant_ref: Mapped[Optional[str]] = mapped_column(String(100))
    participant_name: Mapped[Optional[str]] = mapped_column(String(255))
    purpose: Mapped[Optional[str]] = mapped_column(Text)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)

    validation_status: Mapped[str] = mapped_column(String(20), default="pending")
    validation_errors: Mapped[Optional[list]] = mapped_column(JSONB, default=list)
    is_duplicate: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_naive)

    __table_args__ = (
        UniqueConstraint("batch_reference", "row_number", name="uq_staging_batch_row"),
        Index("ix_staging_house_code", "house_code"),
        Index("ix_staging_status", "validation_status"),
        Index("ix_staging_statement_date", "statement_date"),
    )
