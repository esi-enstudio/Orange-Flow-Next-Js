"""drop customer_nid and sim_type from sim_replacement_requests

Revision ID: remove_customer_nid_sim_type
Revises: a0b1c2d3e4f5
Create Date: 2026-07-18 10:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "remove_customer_nid_sim_type"
down_revision: Union[str, None] = "a0b1c2d3e4f5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("sim_replacement_requests", "customer_nid")
    op.drop_column("sim_replacement_requests", "sim_type")


def downgrade() -> None:
    op.add_column("sim_replacement_requests", sa.Column("customer_nid", sa.String(50), nullable=True))
    op.add_column("sim_replacement_requests", sa.Column("sim_type", sa.String(50), nullable=True))
