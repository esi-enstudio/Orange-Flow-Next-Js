"""add zoom_in module tables

Revision ID: 5e6f7a8b9c0d
Revises: 4e937d648bfc
Create Date: 2026-06-20 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '5e6f7a8b9c0d'
down_revision: Union[str, None] = '4e937d648bfc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # zoom_in_event_types
    op.create_table('zoom_in_event_types',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('name_bn', sa.String(length=100), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name'),
    )

    # zoom_in_activities
    op.create_table('zoom_in_activities',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('name_bn', sa.String(length=100), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name'),
    )

    # zoom_in_allocations
    op.create_table('zoom_in_allocations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('house_id', sa.Integer(), nullable=False),
        sa.Column('month', sa.Date(), nullable=False),
        sa.Column('event_type_id', sa.Integer(), nullable=False),
        sa.Column('count', sa.Integer(), nullable=True),
        sa.Column('budget_per_unit', sa.Float(), nullable=True),
        sa.Column('total_budget', sa.Float(), nullable=True),
        sa.Column('is_deleted', sa.Boolean(), nullable=True),
        sa.Column('deleted_at', sa.DateTime(), nullable=True),
        sa.Column('deleted_by', sa.Integer(), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['house_id'], ['houses.id'], ),
        sa.ForeignKeyConstraint(['event_type_id'], ['zoom_in_event_types.id'], ),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['updated_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['deleted_by'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('house_id', 'month', 'event_type_id', 'is_deleted', name='uq_alloc_house_month_event'),
    )
    op.create_index(op.f('ix_zoom_in_allocations_id'), 'zoom_in_allocations', ['id'], unique=False)
    op.create_index(op.f('ix_zoom_in_allocations_house_id'), 'zoom_in_allocations', ['house_id'], unique=False)
    op.create_index(op.f('ix_zoom_in_allocations_month'), 'zoom_in_allocations', ['month'], unique=False)
    op.create_index(op.f('ix_zoom_in_allocations_is_deleted'), 'zoom_in_allocations', ['is_deleted'], unique=False)

    # zoom_in_events
    op.create_table('zoom_in_events',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('house_id', sa.Integer(), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('event_type_id', sa.Integer(), nullable=False),
        sa.Column('activity_id', sa.Integer(), nullable=False),
        sa.Column('thana', sa.String(length=100), nullable=False),
        sa.Column('created_by', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['house_id'], ['houses.id'], ),
        sa.ForeignKeyConstraint(['event_type_id'], ['zoom_in_event_types.id'], ),
        sa.ForeignKeyConstraint(['activity_id'], ['zoom_in_activities.id'], ),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['updated_by'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_zoom_in_events_id'), 'zoom_in_events', ['id'], unique=False)
    op.create_index(op.f('ix_zoom_in_events_house_id'), 'zoom_in_events', ['house_id'], unique=False)
    op.create_index(op.f('ix_zoom_in_events_date'), 'zoom_in_events', ['date'], unique=False)

    # zoom_in_event_bts
    op.create_table('zoom_in_event_bts',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('zoom_in_event_id', sa.Integer(), nullable=False),
        sa.Column('bts_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['zoom_in_event_id'], ['zoom_in_events.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['bts_id'], ['bts_list.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_zoom_in_event_bts_zoom_in_event_id'), 'zoom_in_event_bts', ['zoom_in_event_id'], unique=False)
    op.create_index(op.f('ix_zoom_in_event_bts_bts_id'), 'zoom_in_event_bts', ['bts_id'], unique=False)

    # zoom_in_event_rsos
    op.create_table('zoom_in_event_rsos',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('zoom_in_event_id', sa.Integer(), nullable=False),
        sa.Column('employee_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['zoom_in_event_id'], ['zoom_in_events.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_zoom_in_event_rsos_zoom_in_event_id'), 'zoom_in_event_rsos', ['zoom_in_event_id'], unique=False)
    op.create_index(op.f('ix_zoom_in_event_rsos_employee_id'), 'zoom_in_event_rsos', ['employee_id'], unique=False)

    # zoom_in_event_bps
    op.create_table('zoom_in_event_bps',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('zoom_in_event_id', sa.Integer(), nullable=False),
        sa.Column('employee_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['zoom_in_event_id'], ['zoom_in_events.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_zoom_in_event_bps_zoom_in_event_id'), 'zoom_in_event_bps', ['zoom_in_event_id'], unique=False)
    op.create_index(op.f('ix_zoom_in_event_bps_employee_id'), 'zoom_in_event_bps', ['employee_id'], unique=False)

    # zoom_in_event_retailers
    op.create_table('zoom_in_event_retailers',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('zoom_in_event_id', sa.Integer(), nullable=False),
        sa.Column('retailer_code', sa.String(length=50), nullable=False),
        sa.ForeignKeyConstraint(['zoom_in_event_id'], ['zoom_in_events.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_zoom_in_event_retailers_zoom_in_event_id'), 'zoom_in_event_retailers', ['zoom_in_event_id'], unique=False)
    op.create_index(op.f('ix_zoom_in_event_retailers_retailer_code'), 'zoom_in_event_retailers', ['retailer_code'], unique=False)

    # Add is_eligible to bts_list
    op.add_column('bts_list', sa.Column('is_eligible', sa.Boolean(), nullable=True, server_default=sa.text('true')))
    op.create_index(op.f('ix_bts_list_is_eligible'), 'bts_list', ['is_eligible'], unique=False)

    # Seed event types
    op.execute("""
        INSERT INTO zoom_in_event_types (id, name, name_bn, is_active) VALUES
        (1, 'Zoom In', 'জুম ইন', true),
        (2, 'Zoom In Mini', 'জুম ইন মিনি', true),
        (3, 'Zoom In Nano', 'জুম ইন ন্যানো', true)
    """)

    # Seed activities
    op.execute("""
        INSERT INTO zoom_in_activities (id, name, name_bn, is_active) VALUES
        (1, 'Local Games', 'লোকাল গেমস', true),
        (2, 'Customer Engagement', 'কাস্টমার এনগেজমেন্ট', true)
    """)


def downgrade() -> None:
    op.drop_table('zoom_in_event_retailers')
    op.drop_table('zoom_in_event_bps')
    op.drop_table('zoom_in_event_rsos')
    op.drop_table('zoom_in_event_bts')
    op.drop_table('zoom_in_events')
    op.drop_table('zoom_in_allocations')
    op.drop_table('zoom_in_activities')
    op.drop_table('zoom_in_event_types')
    op.drop_index(op.f('ix_bts_list_is_eligible'), table_name='bts_list')
    op.drop_column('bts_list', 'is_eligible')
