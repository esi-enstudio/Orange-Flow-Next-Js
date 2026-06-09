"""add is_live_sync_enabled to app_settings

Revision ID: a8f3d5e6b7c8
Revises: fed6077bccdc
Create Date: 2026-06-07 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a8f3d5e6b7c8'
down_revision: Union[str, None] = 'fed6077bccdc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('app_settings', sa.Column('is_live_sync_enabled', sa.Integer(), server_default='1', nullable=False))
    op.execute("UPDATE app_settings SET is_live_sync_enabled = 1 WHERE is_live_sync_enabled IS NULL")


def downgrade() -> None:
    op.drop_column('app_settings', 'is_live_sync_enabled')
