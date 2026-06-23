"""final merge

Revision ID: dd0629b9c741
Revises: 696a33059037
Create Date: 2026-06-23 20:34:17.998798

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'dd0629b9c741'
down_revision: Union[str, None] = '696a33059037'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
