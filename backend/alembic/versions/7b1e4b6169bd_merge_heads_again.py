"""merge heads again

Revision ID: 7b1e4b6169bd
Revises: b32a0811da36
Create Date: 2026-06-23 20:30:34.582556

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7b1e4b6169bd'
down_revision: Union[str, None] = 'b32a0811da36'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
