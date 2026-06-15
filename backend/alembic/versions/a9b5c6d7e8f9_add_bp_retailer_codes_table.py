"""add bp_retailer_codes table

Revision ID: a9b5c6d7e8f9
Revises: a9b4c5d6e7f8_add_employee_type_and_employee_id_to_employees
Create Date: 2026-06-15 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a9b5c6d7e8f9"
down_revision: Union[str, None] = "a9b4c5d6e7f8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "bp_retailer_codes",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("bp_employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
        sa.Column("retailer_code", sa.String(), nullable=False, index=True),
        sa.Column("house_id", sa.Integer(), sa.ForeignKey("houses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), onupdate=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("bp_employee_id", "retailer_code", name="uq_bp_employee_retailer_code"),
    )


def downgrade() -> None:
    op.drop_table("bp_retailer_codes")
