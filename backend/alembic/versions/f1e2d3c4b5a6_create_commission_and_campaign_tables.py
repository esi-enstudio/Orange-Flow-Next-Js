"""create commission and campaign tables

Revision ID: f1e2d3c4b5a6
Revises: a9b0c1d2e3f4
Create Date: 2026-06-12 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "f1e2d3c4b5a6"
down_revision: Union[str, None] = "a9b0c1d2e3f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "distributors",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("dd_code", sa.String(50), nullable=False),
        sa.Column("distributor_name", sa.String(255), nullable=False),
        sa.Column("territory", sa.String(255), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="ACTIVE"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_distributors_dd_code", "distributors", ["dd_code"], unique=True)
    op.create_index("ix_distributors_status", "distributors", ["status"])
    op.create_index("ix_distributors_territory", "distributors", ["territory"])

    op.create_table(
        "campaign_types",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("category", sa.String(50), nullable=False),
        sa.Column("campaign_name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("valid_from", sa.Date(), nullable=True),
        sa.Column("valid_to", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("campaign_name", "category", name="uq_campaign_type_name_category"),
    )
    op.create_index("ix_campaign_types_active", "campaign_types", ["is_active"])
    op.create_index("ix_campaign_types_category", "campaign_types", ["category"])
    op.create_index(
        "ix_campaign_types_valid_dates", "campaign_types", ["valid_from", "valid_to"]
    )

    op.create_table(
        "statement_batches",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("statement_date", sa.Date(), nullable=False),
        sa.Column("distributor_id", sa.Integer(), nullable=False),
        sa.Column("batch_reference", sa.String(100), nullable=False),
        sa.Column("total_records", sa.Integer(), nullable=True),
        sa.Column("processed_records", sa.Integer(), nullable=True),
        sa.Column("failed_records", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="PENDING"),
        sa.Column("error_log", sa.Text(), nullable=True),
        sa.Column("uploaded_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["distributor_id"], ["distributors.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("batch_reference"),
    )
    op.create_index("ix_statement_batches_date_status", "statement_batches", ["statement_date", "status"])
    op.create_index("ix_statement_batches_distributor_date", "statement_batches", ["distributor_id", "statement_date"])
    op.create_index("ix_statement_batches_statement_date", "statement_batches", ["statement_date"])
    op.create_index("ix_statement_batches_distributor_id", "statement_batches", ["distributor_id"])

    op.create_table(
        "campaign_transactions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("statement_batch_id", sa.Integer(), nullable=False),
        sa.Column("distributor_id", sa.Integer(), nullable=False),
        sa.Column("campaign_type_id", sa.Integer(), nullable=False),
        sa.Column("participant_type", sa.String(30), nullable=False),
        sa.Column("participant_ref", sa.String(100), nullable=False),
        sa.Column("participant_name", sa.String(255), nullable=True),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("extra_data", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["statement_batch_id"], ["statement_batches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["distributor_id"], ["distributors.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["campaign_type_id"], ["campaign_types.id"], ondelete="RESTRICT"),
        sa.CheckConstraint("amount >= 0", name="ck_campaign_txn_amount_positive"),
    )
    op.create_index("ix_campaign_txn_batch_campaign", "campaign_transactions", ["statement_batch_id", "campaign_type_id"])
    op.create_index("ix_campaign_txn_dist_campaign", "campaign_transactions", ["distributor_id", "campaign_type_id"])
    op.create_index("ix_campaign_txn_participant", "campaign_transactions", ["participant_type", "participant_ref"])
    op.create_index("ix_campaign_txn_amount", "campaign_transactions", ["amount"])
    op.create_index("ix_campaign_txn_statement_batch_id", "campaign_transactions", ["statement_batch_id"])
    op.create_index("ix_campaign_txn_distributor_id", "campaign_transactions", ["distributor_id"])
    op.create_index("ix_campaign_txn_campaign_type_id", "campaign_transactions", ["campaign_type_id"])
    op.create_index("ix_campaign_txn_participant_ref", "campaign_transactions", ["participant_ref"])

    op.create_table(
        "financial_entries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("statement_batch_id", sa.Integer(), nullable=False),
        sa.Column("distributor_id", sa.Integer(), nullable=False),
        sa.Column("entry_type", sa.String(30), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("campaign_transaction_id", sa.Integer(), nullable=True),
        sa.Column("extra_data", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["statement_batch_id"], ["statement_batches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["distributor_id"], ["distributors.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["campaign_transaction_id"], ["campaign_transactions.id"], ondelete="SET NULL"),
        sa.CheckConstraint("amount >= 0", name="ck_financial_entry_amount_positive"),
    )
    op.create_index("ix_financial_entries_type", "financial_entries", ["entry_type"])
    op.create_index("ix_financial_entries_distributor_type", "financial_entries", ["distributor_id", "entry_type"])
    op.create_index("ix_financial_entries_batch_type", "financial_entries", ["statement_batch_id", "entry_type"])
    op.create_index("ix_financial_entries_statement_batch_id", "financial_entries", ["statement_batch_id"])
    op.create_index("ix_financial_entries_distributor_id", "financial_entries", ["distributor_id"])
    op.create_index("ix_financial_entries_campaign_txn_id", "financial_entries", ["campaign_transaction_id"])

    op.create_table(
        "commission_audit_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("table_name", sa.String(100), nullable=False),
        sa.Column("record_id", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(20), nullable=False),
        sa.Column("old_values", postgresql.JSONB(), nullable=True),
        sa.Column("new_values", postgresql.JSONB(), nullable=True),
        sa.Column("changed_by", sa.Integer(), nullable=True),
        sa.Column("changed_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["changed_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_audit_log_table_record", "commission_audit_logs", ["table_name", "record_id"])
    op.create_index("ix_audit_log_changed_at", "commission_audit_logs", ["changed_at"])

    op.create_table(
        "commission_staging",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("batch_reference", sa.String(100), nullable=False),
        sa.Column("row_number", sa.Integer(), nullable=False),
        sa.Column("raw_data", postgresql.JSONB(), nullable=False),
        sa.Column("dd_code", sa.String(50), nullable=False),
        sa.Column("distributor_name", sa.String(255), nullable=True),
        sa.Column("statement_date", sa.Date(), nullable=False),
        sa.Column("campaign_name", sa.String(255), nullable=False),
        sa.Column("campaign_category", sa.String(100), nullable=True),
        sa.Column("participant_type", sa.String(50), nullable=True),
        sa.Column("participant_ref", sa.String(100), nullable=True),
        sa.Column("participant_name", sa.String(255), nullable=True),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("vat", sa.Numeric(18, 2), nullable=True),
        sa.Column("ait", sa.Numeric(18, 2), nullable=True),
        sa.Column("gross_commission", sa.Numeric(18, 2), nullable=True),
        sa.Column("net_payable", sa.Numeric(18, 2), nullable=True),
        sa.Column("validation_status", sa.String(20), server_default="pending", nullable=False),
        sa.Column("validation_errors", postgresql.JSONB(), nullable=True),
        sa.Column("is_duplicate", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("batch_reference", "row_number", name="uq_staging_batch_row"),
    )
    op.create_index("ix_staging_batch_reference", "commission_staging", ["batch_reference"])
    op.create_index("ix_staging_dd_code", "commission_staging", ["dd_code"])
    op.create_index("ix_staging_status", "commission_staging", ["validation_status"])
    op.create_index("ix_staging_statement_date", "commission_staging", ["statement_date"])


def downgrade() -> None:
    op.drop_table("commission_staging")
    op.drop_table("commission_audit_logs")
    op.drop_table("financial_entries")
    op.drop_table("campaign_transactions")
    op.drop_table("statement_batches")
    op.drop_table("campaign_types")
    op.drop_table("distributors")

    pass
