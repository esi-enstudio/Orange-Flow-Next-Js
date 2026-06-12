"""add employee_id to campaign_transactions

Revision ID: a9b3c4d5e6f7
Revises: a9b2c3d4e5f6
Create Date: 2026-06-12 18:45:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = "a9b3c4d5e6f7"
down_revision: Union[str, None] = "a9b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE campaign_transactions
        ADD COLUMN employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_campaign_txn_employee
        ON campaign_transactions(employee_id)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_campaign_txn_employee")
    op.execute("ALTER TABLE campaign_transactions DROP COLUMN IF EXISTS employee_id")
