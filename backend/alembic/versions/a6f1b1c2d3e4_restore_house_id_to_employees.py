"""restore house_id to employees

Revision ID: a6f1b1c2d3e4
Revises: dd353c889563
Create Date: 2026-05-29 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a6f1b1c2d3e4'
down_revision: Union[str, None] = 'dd353c889563'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add house_id column back to employees table
    op.add_column('employees', sa.Column('house_id', sa.Integer(), nullable=True))
    op.create_foreign_key('employees_house_id_fkey', 'employees', 'houses', ['house_id'], ['id'])


def downgrade() -> None:
    # Remove house_id column from employees table
    op.drop_constraint('employees_house_id_fkey', 'employees', type_='foreignkey')
    op.drop_column('employees', 'house_id')
