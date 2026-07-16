"""add exit_order_no and rf_no to scratch_card_serials

Revision ID: jkl456mno789
Revises: ghi345jkl012
Create Date: 2026-07-16 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "jkl456mno789"
down_revision: Union[str, None] = "ghi345jkl012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("scratch_card_serials", sa.Column("exit_order_no", sa.String(100), nullable=True))
    op.add_column("scratch_card_serials", sa.Column("rf_no", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("scratch_card_serials", "rf_no")
    op.drop_column("scratch_card_serials", "exit_order_no")
