"""add is_live_sync_enabled to houses

Revision ID: a1b2c3d4e5f7
Revises: 990b631e3558
Create Date: 2026-07-11 09:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f7'
down_revision: Union[str, None] = '990b631e3558'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('houses', sa.Column('is_live_sync_enabled', sa.Boolean(), server_default='true', nullable=False))
    op.execute("UPDATE houses SET is_live_sync_enabled = true")


def downgrade() -> None:
    op.drop_column('houses', 'is_live_sync_enabled')
