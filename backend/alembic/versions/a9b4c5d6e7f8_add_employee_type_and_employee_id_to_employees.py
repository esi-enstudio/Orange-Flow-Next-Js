"""add employee_type and employee_id to employees table

Revision ID: a9b4c5d6e7f8
Revises: a9b3c4d5e6f7
Create Date: 2026-06-12 19:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a9b4c5d6e7f8"
down_revision: Union[str, None] = "a9b3c4d5e6f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("employees", sa.Column("employee_type", sa.String(30), default="unknown"))
    op.add_column("employees", sa.Column("employee_id", sa.String(50)))
    op.execute("UPDATE employees SET employee_type = 'unknown' WHERE employee_type IS NULL")
    op.execute("UPDATE employees SET employee_id = 'EMP-' || id WHERE employee_id IS NULL")
    op.create_unique_constraint("uq_employees_employee_id", "employees", ["employee_id"])
    op.create_index("ix_employees_employee_id", "employees", ["employee_id"])


def downgrade() -> None:
    op.drop_constraint("uq_employees_employee_id", "employees", type_="unique")
    op.drop_index("ix_employees_employee_id", table_name="employees")
    op.drop_column("employees", "employee_id")
    op.drop_column("employees", "employee_type")
