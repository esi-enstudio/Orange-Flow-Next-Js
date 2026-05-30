"""remove name column from employees

Revision ID: a7f2c2d4e5f6
Revises: a6f1b1c2d3e4
Create Date: 2026-05-29 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7f2c2d4e5f6'
down_revision: Union[str, None] = 'a6f1b1c2d3e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('employees', 'name')


def downgrade() -> None:
    op.add_column('employees', sa.Column('name', sa.String(), nullable=False))
