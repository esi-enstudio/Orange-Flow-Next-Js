"""add serial_ranges to sim_inventory

Revision ID: ghi345jkl012
Revises: def789ghi012
Create Date: 2026-07-16 10:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "ghi345jkl012"
down_revision: Union[str, None] = "def789ghi012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("sim_inventory", sa.Column("serial_ranges", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("sim_inventory", "serial_ranges")
