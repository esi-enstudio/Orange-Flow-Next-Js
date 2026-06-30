"""add composite index on sc_serials (house_id, status, product_id)

Revision ID: 1696416c1d77
Revises: fb7a8d4e5f6e
Create Date: 2026-06-30 21:09:42.787534

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1696416c1d77'
down_revision: Union[str, None] = 'fb7a8d4e5f6e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        'ix_scratch_card_serials_house_status_product',
        'scratch_card_serials',
        ['house_id', 'status', 'product_id'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index('ix_scratch_card_serials_house_status_product',
                  table_name='scratch_card_serials')
