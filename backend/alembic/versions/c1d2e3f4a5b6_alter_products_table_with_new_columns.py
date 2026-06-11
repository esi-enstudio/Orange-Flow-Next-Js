"""alter products table with new columns (category, subcategory, product_name, status)

Revision ID: c1d2e3f4a5b6
Revises: a1b2c3d4e5f6
Create Date: 2026-06-11 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'c1d2e3f4a5b6'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
depends_on: Union[str, Sequence[str], None] = ('a8f3d5e6b7c8', 'b1b2c3d4e5f6')
branch_labels: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add new columns
    op.add_column('products', sa.Column('category', sa.String(), nullable=False, server_default='Other'))
    op.add_column('products', sa.Column('subcategory', sa.String(), nullable=True))
    op.add_column('products', sa.Column('product_name', sa.String(), nullable=True))
    op.add_column('products', sa.Column('status', sa.String(), nullable=False, server_default='Active'))

    # Migrate data: set product_name from product_code where NULL
    op.execute("UPDATE products SET product_name = product_code WHERE product_name IS NULL")
    op.alter_column('products', 'product_name', nullable=False)

    # Drop old column
    op.drop_column('products', 'product_type')


def downgrade() -> None:
    # Restore old column
    op.add_column('products', sa.Column('product_type', sa.VARCHAR(), autoincrement=False, nullable=True))

    # Drop new columns
    op.drop_column('products', 'status')
    op.drop_column('products', 'subcategory')
    op.drop_column('products', 'product_name')
    op.drop_column('products', 'category')
