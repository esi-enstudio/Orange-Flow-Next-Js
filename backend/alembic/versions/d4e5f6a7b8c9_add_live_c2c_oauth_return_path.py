"""add oauth_return_path to live_c2c_automation_configs

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-11-20 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "live_c2c_automation_configs",
        sa.Column("oauth_return_path", sa.String(length=100), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("live_c2c_automation_configs", "oauth_return_path")
