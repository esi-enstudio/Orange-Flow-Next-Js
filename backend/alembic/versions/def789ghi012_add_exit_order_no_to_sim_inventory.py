"""add exit_order_no to sim_inventory

Revision ID: def789ghi012
Revises: abc123def456
Create Date: 2026-07-16 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "def789ghi012"
down_revision: Union[str, None] = "abc123def456"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("sim_inventory", sa.Column("exit_order_no", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("sim_inventory", "exit_order_no")
