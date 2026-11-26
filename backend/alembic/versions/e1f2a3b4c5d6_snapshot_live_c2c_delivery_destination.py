"""Merge automation migrations and snapshot each inbound delivery destination.

Revision ID: e1f2a3b4c5d6
Revises: e2f3a4b5c6d7, d4e5f6a7b8c9
"""

from alembic import op
import sqlalchemy as sa


revision = "e1f2a3b4c5d6"
down_revision = ("e2f3a4b5c6d7", "d4e5f6a7b8c9")
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    """`Inspector.has_column` does not exist in SQLAlchemy 2.x."""
    return column_name in {
        column["name"]
        for column in sa.inspect(op.get_bind()).get_columns(table_name)
    }


def upgrade():
    if op.get_context().as_sql or not _has_column(
        "live_c2c_inbound_files", "destination_group_jid"
    ):
        op.add_column(
            "live_c2c_inbound_files",
            sa.Column("destination_group_jid", sa.String(length=128), nullable=True),
        )
    op.execute(
        """
        UPDATE live_c2c_inbound_files
        SET destination_group_jid = (
            SELECT destination_group_jid
            FROM live_c2c_automation_configs
            WHERE live_c2c_automation_configs.id = live_c2c_inbound_files.config_id
        )
        WHERE destination_group_jid IS NULL
        """
    )


def downgrade():
    op.drop_column("live_c2c_inbound_files", "destination_group_jid")
