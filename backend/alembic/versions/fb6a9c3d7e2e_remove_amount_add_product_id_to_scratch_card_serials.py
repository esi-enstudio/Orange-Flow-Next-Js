"""remove amount, add product_id to scratch_card_serials

Revision ID: fb6a9c3d7e2e
Revises: e6f5e05b1869
Create Date: 2026-06-29 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'fb6a9c3d7e2e'
down_revision: Union[str, None] = 'e6f5e05b1869'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop old unique constraint that references amount
    op.drop_constraint('uq_house_amount_serial', 'scratch_card_serials', type_='unique')

    # Drop index on amount
    op.drop_index(op.f('ix_scratch_card_serials_amount'), table_name='scratch_card_serials')

    # Drop amount column
    op.drop_column('scratch_card_serials', 'amount')

    # Add product_id column
    op.add_column('scratch_card_serials',
        sa.Column('product_id', sa.Integer(), nullable=False, index=True)
    )

    # Create foreign key
    op.create_foreign_key(
        'fk_scratch_card_serials_product_id',
        'scratch_card_serials', 'products',
        ['product_id'], ['id']
    )

    # Create new unique constraint
    op.create_unique_constraint(
        'uq_house_product_serial',
        'scratch_card_serials',
        ['house_id', 'product_id', 'serial_number']
    )


def downgrade() -> None:
    # Drop new unique constraint
    op.drop_constraint('uq_house_product_serial', 'scratch_card_serials', type_='unique')

    # Drop foreign key
    op.drop_constraint('fk_scratch_card_serials_product_id', 'scratch_card_serials', type_='foreignkey')

    # Drop product_id column
    op.drop_column('scratch_card_serials', 'product_id')

    # Add amount column back
    op.add_column('scratch_card_serials',
        sa.Column('amount', sa.Integer(), nullable=False,
                  comment='Denomination in BDT (e.g. 19, 50, 100)')
    )

    # Re-create amount index
    op.create_index(op.f('ix_scratch_card_serials_amount'), 'scratch_card_serials', ['amount'], unique=False)

    # Re-create old unique constraint
    op.create_unique_constraint(
        'uq_house_amount_serial',
        'scratch_card_serials',
        ['house_id', 'amount', 'serial_number']
    )
