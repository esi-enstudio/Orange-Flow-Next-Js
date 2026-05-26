"""rename_field_force_to_employee

Revision ID: 45af86028a43
Revises: 2a12a2614aff
Create Date: 2026-05-26 16:55:20.253235

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '45af86028a43'
down_revision: Union[str, None] = '2a12a2614aff'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Rename table
    op.rename_table('field_forces', 'employees')
    
    # 2. Update foreign key in retailers
    op.alter_column('retailers', 'field_force_id', new_column_name='employee_id')
    
    # 3. Update foreign key in leave_management (if exists, check table name)
    # Based on models, it seems table name is 'leave_requests'
    op.alter_column('leave_requests', 'field_force_id', new_column_name='employee_id')
    
    # 4. Update foreign keys in targets
    op.alter_column('rso_targets', 'field_force_id', new_column_name='employee_id')
    op.alter_column('supervisor_targets', 'field_force_id', new_column_name='employee_id')
    
    # 5. Update self-referencing foreign key in employees (previously field_forces)
    op.alter_column('employees', 'supervisor_id', type_=sa.Integer(), existing_type=sa.Integer())

def downgrade() -> None:
    # 1. Rename table back
    op.rename_table('employees', 'field_forces')
    
    # 2. Update foreign key in retailers
    op.alter_column('retailers', 'employee_id', new_column_name='field_force_id')
    
    # 3. Update foreign key in leave_management
    op.alter_column('leave_requests', 'employee_id', new_column_name='field_force_id')
    
    # 4. Update foreign keys in targets
    op.alter_column('rso_targets', 'employee_id', new_column_name='field_force_id')
    op.alter_column('supervisor_targets', 'employee_id', new_column_name='field_force_id')
