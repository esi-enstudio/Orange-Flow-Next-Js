"""add bp_retailer_code table

Revision ID: a9b0c1d2e3f4
Revises: c1d2e3f4a5b6
Create Date: 2026-06-16 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a9b0c1d2e3f4"
down_revision: Union[str, None] = "c1d2e3f4a5b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "bp_retailer_codes",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("bp_id", sa.Integer(), nullable=False),
        sa.Column("retailer_id", sa.Integer(), nullable=False),
        sa.Column("house_id", sa.Integer(), nullable=False),
        sa.Column("retailer_code", sa.String(length=100), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=True, default="active"),
        sa.Column("is_deleted", sa.Boolean(), nullable=True, default=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True, default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=True, default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_bp_retailer_codes_bp_id", "bp_retailer_codes", ["bp_id"])
    op.create_index("ix_bp_retailer_codes_retailer_id", "bp_retailer_codes", ["retailer_id"])
    op.create_index("ix_bp_retailer_codes_house_id", "bp_retailer_codes", ["house_id"])


def downgrade() -> None:
    op.drop_table("bp_retailer_codes")
