"""add_employee_stock_table

Revision ID: 6d450dc015db
Revises: a90de2a5676c
Create Date: 2026-07-23 20:43:32.717100

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '6d450dc015db'
down_revision: Union[str, None] = 'a90de2a5676c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('employee_stock',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('house_id', sa.Integer(), nullable=False),
        sa.Column('employee_id', sa.Integer(), nullable=False),
        sa.Column('product_id', sa.Integer(), nullable=False),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('is_deleted', sa.Boolean(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_by', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['deleted_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ),
        sa.ForeignKeyConstraint(['house_id'], ['houses.id'], ),
        sa.ForeignKeyConstraint(['product_id'], ['products.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('house_id', 'employee_id', 'product_id', name='uq_emp_stock_house_emp_product')
    )
    op.create_index(op.f('ix_employee_stock_employee_id'), 'employee_stock', ['employee_id'], unique=False)
    op.create_index(op.f('ix_employee_stock_house_id'), 'employee_stock', ['house_id'], unique=False)
    op.create_index(op.f('ix_employee_stock_id'), 'employee_stock', ['id'], unique=False)
    op.create_index(op.f('ix_employee_stock_is_deleted'), 'employee_stock', ['is_deleted'], unique=False)
    op.create_index(op.f('ix_employee_stock_product_id'), 'employee_stock', ['product_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_employee_stock_product_id'), table_name='employee_stock')
    op.drop_index(op.f('ix_employee_stock_is_deleted'), table_name='employee_stock')
    op.drop_index(op.f('ix_employee_stock_id'), table_name='employee_stock')
    op.drop_index(op.f('ix_employee_stock_house_id'), table_name='employee_stock')
    op.drop_index(op.f('ix_employee_stock_employee_id'), table_name='employee_stock')
    op.drop_table('employee_stock')
