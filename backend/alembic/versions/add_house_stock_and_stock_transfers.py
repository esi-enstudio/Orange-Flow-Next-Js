"""add house_stock and stock_transfers tables, merge heads

Revision ID: add_house_stock_transfers
Revises: 6d450dc015db, drop_daily_stock_table
Create Date: 2026-07-25 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "add_house_stock_transfers"
down_revision: Union[str, Sequence[str], None] = (
    "6d450dc015db",
    "drop_daily_stock_table",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "house_stock",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("house_id", sa.Integer(), sa.ForeignKey("houses.id"), nullable=False, index=True),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=False, index=True),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), onupdate=sa.func.now()),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false"), index=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("house_id", "product_id", name="uq_house_stock_house_product"),
    )

    op.create_table(
        "stock_transfers",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("house_id", sa.Integer(), sa.ForeignKey("houses.id"), nullable=False, index=True),
        sa.Column("from_type", sa.String(20), nullable=False),
        sa.Column("from_id", sa.Integer(), nullable=False),
        sa.Column("to_type", sa.String(20), nullable=False),
        sa.Column("to_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=False, index=True),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("stock_transfers")
    op.drop_table("house_stock")
