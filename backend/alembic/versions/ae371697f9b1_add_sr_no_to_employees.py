"""add_sr_no_to_employees

Revision ID: ae371697f9b1
Revises: a1b2c3d4e5f7
Create Date: 2026-07-12 19:18:56.814176

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ae371697f9b1'
down_revision: Union[str, None] = 'a1b2c3d4e5f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('employees', sa.Column('sr_no', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('employees', 'sr_no')
