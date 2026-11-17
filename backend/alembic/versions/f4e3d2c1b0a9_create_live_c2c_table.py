"""create house-scoped live C2C table

Revision ID: f4e3d2c1b0a9
Revises: a90de2a5676c
Create Date: 2026-11-17 23:24:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f4e3d2c1b0a9"
down_revision: Union[str, None] = "a90de2a5676c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "live_c2c",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("house_id", sa.Integer(), nullable=False),
        sa.Column("from_msisdn", sa.String(length=64), nullable=False),
        sa.Column("to_msisdn", sa.String(length=64), nullable=False),
        sa.Column("modified_on", sa.String(length=100), nullable=True),
        sa.Column("transfer_mrp", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("source_filename", sa.String(length=255), nullable=False),
        sa.Column("source_sheet", sa.String(length=255), nullable=False),
        sa.Column(
            "is_deleted",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_by", sa.Integer(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_by", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["house_id"], ["houses.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["deleted_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_live_c2c_id"), "live_c2c", ["id"], unique=False)
    op.create_index(op.f("ix_live_c2c_house_id"), "live_c2c", ["house_id"], unique=False)
    op.create_index(
        op.f("ix_live_c2c_is_deleted"), "live_c2c", ["is_deleted"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_live_c2c_is_deleted"), table_name="live_c2c")
    op.drop_index(op.f("ix_live_c2c_house_id"), table_name="live_c2c")
    op.drop_index(op.f("ix_live_c2c_id"), table_name="live_c2c")
    op.drop_table("live_c2c")
