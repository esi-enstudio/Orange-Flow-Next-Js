"""fix stock timestamps from UTC to BST (+6 hours)

Revision ID: fix_stock_timestamps_to_bst
Revises: acd8a9e914c0
Create Date: 2026-07-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = "fix_stock_timestamps_to_bst"
down_revision: Union[str, None] = "acd8a9e914c0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE stock_movements "
        "SET created_at = created_at + INTERVAL '6 hours' "
        "WHERE created_at IS NOT NULL"
    )
    op.execute(
        "UPDATE house_stock "
        "SET created_at = created_at + INTERVAL '6 hours', "
        "    updated_at = updated_at + INTERVAL '6 hours' "
        "WHERE created_at IS NOT NULL"
    )
    op.execute(
        "UPDATE employee_stock "
        "SET created_at = created_at + INTERVAL '6 hours', "
        "    updated_at = updated_at + INTERVAL '6 hours' "
        "WHERE created_at IS NOT NULL"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE stock_movements "
        "SET created_at = created_at - INTERVAL '6 hours' "
        "WHERE created_at IS NOT NULL"
    )
    op.execute(
        "UPDATE house_stock "
        "SET created_at = created_at - INTERVAL '6 hours', "
        "    updated_at = updated_at - INTERVAL '6 hours' "
        "WHERE created_at IS NOT NULL"
    )
    op.execute(
        "UPDATE employee_stock "
        "SET created_at = created_at - INTERVAL '6 hours', "
        "    updated_at = updated_at - INTERVAL '6 hours' "
        "WHERE created_at IS NOT NULL"
    )
