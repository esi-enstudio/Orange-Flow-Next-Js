"""add_dsso_dso_dlso_to_house_targets

Revision ID: 990b631e3558
Revises: 1696416c1d77
Create Date: 2026-07-02 20:24:30.018583

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '990b631e3558'
down_revision: Union[str, None] = '1696416c1d77'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('house_targets', sa.Column('dsso', sa.Integer(), server_default='0', nullable=False))
    op.add_column('house_targets', sa.Column('dso', sa.Integer(), server_default='0', nullable=False))
    op.add_column('house_targets', sa.Column('dlso', sa.Integer(), server_default='0', nullable=False))
    op.alter_column('house_targets', 'dsso', server_default=None)
    op.alter_column('house_targets', 'dso', server_default=None)
    op.alter_column('house_targets', 'dlso', server_default=None)


def downgrade() -> None:
    op.drop_column('house_targets', 'dlso')
    op.drop_column('house_targets', 'dso')
    op.drop_column('house_targets', 'dsso')
