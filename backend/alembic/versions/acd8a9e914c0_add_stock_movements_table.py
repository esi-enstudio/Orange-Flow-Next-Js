"""add_stock_movements_table

Revision ID: acd8a9e914c0
Revises: add_house_stock_transfers
Create Date: 2026-07-25 20:49:59.783838

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'acd8a9e914c0'
down_revision: Union[str, None] = 'add_house_stock_transfers'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('stock_movements',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('product_id', sa.Integer(), nullable=False),
    sa.Column('house_id', sa.Integer(), nullable=True),
    sa.Column('employee_id', sa.Integer(), nullable=True),
    sa.Column('quantity_change', sa.Integer(), nullable=False),
    sa.Column('before_qty', sa.Integer(), nullable=False),
    sa.Column('after_qty', sa.Integer(), nullable=False),
    sa.Column('movement_type', sa.String(length=50), nullable=False),
    sa.Column('reference_id', sa.Integer(), nullable=True),
    sa.Column('note', sa.String(length=500), nullable=True),
    sa.Column('created_by', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ),
    sa.ForeignKeyConstraint(['house_id'], ['houses.id'], ),
    sa.ForeignKeyConstraint(['product_id'], ['products.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_stock_movements_employee_id'), 'stock_movements', ['employee_id'], unique=False)
    op.create_index(op.f('ix_stock_movements_house_id'), 'stock_movements', ['house_id'], unique=False)
    op.create_index(op.f('ix_stock_movements_product_id'), 'stock_movements', ['product_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_stock_movements_product_id'), table_name='stock_movements')
    op.drop_index(op.f('ix_stock_movements_house_id'), table_name='stock_movements')
    op.drop_index(op.f('ix_stock_movements_employee_id'), table_name='stock_movements')
    op.drop_table('stock_movements')
