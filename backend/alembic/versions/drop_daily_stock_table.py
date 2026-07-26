"""drop daily_stock table (module removed)

Revision ID: drop_daily_stock_table
Revises: remove_customer_nid_sim_type
Create Date: 2026-07-25 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "drop_daily_stock_table"
down_revision: Union[str, None] = "remove_customer_nid_sim_type"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table("daily_stock")


def downgrade() -> None:
    op.create_table(
        "daily_stock",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("house_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("opening_quantity", sa.Integer(), nullable=True, server_default="0"),
        sa.Column("received_quantity", sa.Integer(), nullable=True, server_default="0"),
        sa.Column("returned_quantity", sa.Integer(), nullable=True, server_default="0"),
        sa.Column("closing_quantity", sa.Integer(), nullable=True, server_default="0"),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("updated_by", sa.Integer(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=True, server_default="false"),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["house_id"], ["houses.id"],),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"],),
        sa.UniqueConstraint("house_id", "product_id", "date", name="uq_daily_stock_house_product_date"),
    )
    op.create_index("ix_daily_stock_house_id", "daily_stock", ["house_id"])
    op.create_index("ix_daily_stock_product_id", "daily_stock", ["product_id"])
    op.create_index("ix_daily_stock_date", "daily_stock", ["date"])
    op.create_index("ix_daily_stock_is_deleted", "daily_stock", ["is_deleted"])
