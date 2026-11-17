"""retain the retired GA config revision node

Revision ID: b1b2c3d4e5f6
Revises: dd353c889563
"""
from typing import Sequence, Union

from alembic import op


revision: str = "b1b2c3d4e5f6"
down_revision: Union[str, None] = "dd353c889563"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
