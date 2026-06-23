"""merge heads

Revision ID: b32a0811da36
Revises: 5e6f7a8b9c0d
Create Date: 2026-06-23 20:28:37.266668

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b32a0811da36'
down_revision: Union[str, None] = '5e6f7a8b9c0d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
