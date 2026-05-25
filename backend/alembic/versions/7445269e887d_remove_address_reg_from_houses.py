"""remove address_reg from houses

Revision ID: 7445269e887d
Revises: fed6077bccdc
Create Date: 2026-05-25 18:47:03.107112

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7445269e887d'
down_revision: Union[str, None] = 'fed6077bccdc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('houses', 'address_reg')


def downgrade() -> None:
    op.add_column('houses', sa.Column('address_reg', sa.String(), nullable=True))
