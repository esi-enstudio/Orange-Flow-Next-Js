"""merge all heads

Revision ID: b8188802aa04
Revises: a8f3d5e6b7c8, b1b2c3d4e5f6, fd81fa03a67d
Create Date: 2026-06-29 07:03:55.267615

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8188802aa04'
down_revision: Union[str, None] = ('a8f3d5e6b7c8', 'b1b2c3d4e5f6', 'fd81fa03a67d')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
