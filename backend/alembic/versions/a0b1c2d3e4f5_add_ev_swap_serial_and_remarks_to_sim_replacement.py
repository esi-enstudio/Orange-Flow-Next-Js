"""add ev_swap_serial and remarks to sim_replacement_requests

Revision ID: a0b1c2d3e4f5
Revises: abc123def456_create_sim_replacement_module
Create Date: 2026-07-16 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a0b1c2d3e4f5"
down_revision: Union[str, None] = "abc123def456"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("sim_replacement_requests", sa.Column("ev_swap_serial", sa.String(100), nullable=True))
    op.add_column("sim_replacement_requests", sa.Column("remarks", sa.Text(), nullable=True))
    op.drop_column("sim_replacement_requests", "old_msisdn")
    op.drop_column("sim_replacement_requests", "old_sim_number")
    op.drop_column("sim_replacement_requests", "customer_phone")
    op.drop_column("sim_replacement_requests", "customer_name")


def downgrade() -> None:
    op.add_column("sim_replacement_requests", sa.Column("customer_name", sa.String(200), nullable=True))
    op.add_column("sim_replacement_requests", sa.Column("customer_phone", sa.String(20), nullable=True))
    op.add_column("sim_replacement_requests", sa.Column("old_sim_number", sa.String(100), nullable=True))
    op.add_column("sim_replacement_requests", sa.Column("old_msisdn", sa.String(20), nullable=True))
    op.drop_column("sim_replacement_requests", "remarks")
    op.drop_column("sim_replacement_requests", "ev_swap_serial")
