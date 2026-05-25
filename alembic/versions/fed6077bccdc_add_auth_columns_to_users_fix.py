"""add auth columns to users fix surgical

Revision ID: fed6077bccdc
Revises: bf359b79f705
Create Date: 2026-05-25 12:51:32.923079

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fed6077bccdc'
down_revision: Union[str, None] = 'bf359b79f705'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Adding columns to users table
    op.add_column('users', sa.Column('username', sa.String(), nullable=True))
    op.add_column('users', sa.Column('hashed_password', sa.String(), nullable=True))
    op.add_column('users', sa.Column('email', sa.String(), nullable=True))
    op.alter_column('users', 'telegram_id',
               existing_type=sa.BIGINT(),
               nullable=True)
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
    op.create_index(op.f('ix_users_username'), 'users', ['username'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_users_username'), table_name='users')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.alter_column('users', 'telegram_id',
               existing_type=sa.BIGINT(),
               nullable=False)
    op.drop_column('users', 'email')
    op.drop_column('users', 'hashed_password')
    op.drop_column('users', 'username')
