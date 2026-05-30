"""remove_house_id_from_employees

Revision ID: dd353c889563
Revises: 45af86028a43
Create Date: 2026-05-29 10:06:36.562760

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'dd353c889563'
down_revision: Union[str, None] = '45af86028a43'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Remove house_id column from employees table
    op.drop_column('employees', 'house_id')


def downgrade() -> None:
    # Add house_id column back to employees table
    op.add_column('employees', sa.Column('house_id', sa.INTEGER(), autoincrement=False, nullable=True))
    op.create_foreign_key('employees_house_id_fkey', 'employees', 'houses', ['house_id'], ['id'])
