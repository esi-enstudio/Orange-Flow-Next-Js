"""Add house-scoped Live C2C inbound automation.

Revision ID: c3d4e5f6a7b8
Revises: d7f0c2a15b84
"""

from alembic import op
import sqlalchemy as sa


revision = "c3d4e5f6a7b8"
down_revision = "d7f0c2a15b84"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "live_c2c_automation_configs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("house_id", sa.Integer(), nullable=False),
        sa.Column("source_type", sa.String(length=16), nullable=True),
        sa.Column("is_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("gmail_address", sa.String(length=320), nullable=True),
        sa.Column("gmail_access_token_encrypted", sa.Text(), nullable=True),
        sa.Column("gmail_refresh_token_encrypted", sa.Text(), nullable=True),
        sa.Column("gmail_token_expires_at", sa.DateTime(), nullable=True),
        sa.Column("gmail_history_id", sa.String(length=100), nullable=True),
        sa.Column("gmail_last_polled_at", sa.DateTime(), nullable=True),
        sa.Column("gmail_status", sa.String(length=24), server_default="disconnected", nullable=False),
        sa.Column("gmail_error", sa.String(length=500), nullable=True),
        sa.Column("oauth_state_hash", sa.String(length=64), nullable=True),
        sa.Column("oauth_state_expires_at", sa.DateTime(), nullable=True),
        sa.Column("oauth_state_user_id", sa.Integer(), nullable=True),
        sa.Column("source_group_jid", sa.String(length=128), nullable=True),
        sa.Column("source_group_name", sa.String(length=200), nullable=True),
        sa.Column("destination_group_jid", sa.String(length=128), nullable=True),
        sa.Column("destination_group_name", sa.String(length=200), nullable=True),
        sa.Column("wa_device_id", sa.String(length=100), nullable=True),
        sa.Column("wa_webhook_id", sa.Integer(), nullable=True),
        sa.Column("wa_webhook_secret_encrypted", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column("updated_by", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_by", sa.Integer(), nullable=True),
        sa.CheckConstraint(
            "source_type IS NULL OR source_type IN ('gmail', 'whatsapp')",
            name="ck_live_c2c_automation_source_type",
        ),
        sa.CheckConstraint(
            "is_enabled = false OR source_type IS NOT NULL",
            name="ck_live_c2c_automation_enabled_source",
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["deleted_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["house_id"], ["houses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["oauth_state_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("house_id", name="uq_live_c2c_automation_house"),
    )
    op.create_index(
        "ix_live_c2c_automation_configs_id",
        "live_c2c_automation_configs",
        ["id"],
        unique=False,
    )
    op.create_index(
        "ix_live_c2c_automation_configs_is_deleted",
        "live_c2c_automation_configs",
        ["is_deleted"],
        unique=False,
    )
    op.create_index(
        "uq_live_c2c_automation_active_gmail",
        "live_c2c_automation_configs",
        [sa.text("lower(gmail_address)")],
        unique=True,
        postgresql_where=sa.text(
            "source_type = 'gmail' AND is_enabled IS TRUE AND is_deleted IS FALSE "
            "AND gmail_address IS NOT NULL"
        ),
    )
    op.create_index(
        "uq_live_c2c_automation_active_wa_source",
        "live_c2c_automation_configs",
        ["wa_device_id", "source_group_jid"],
        unique=True,
        postgresql_where=sa.text(
            "source_type = 'whatsapp' AND is_enabled IS TRUE AND is_deleted IS FALSE "
            "AND wa_device_id IS NOT NULL AND source_group_jid IS NOT NULL"
        ),
    )

    op.create_table(
        "live_c2c_inbound_files",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("house_id", sa.Integer(), nullable=False),
        sa.Column("config_id", sa.Integer(), nullable=False),
        sa.Column("source_type", sa.String(length=16), nullable=False),
        sa.Column("source_event_id", sa.String(length=300), nullable=False),
        sa.Column("source_device_id", sa.String(length=100), nullable=True),
        sa.Column("source_group_jid", sa.String(length=128), nullable=True),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=True),
        sa.Column("import_status", sa.String(length=20), server_default="queued", nullable=False),
        sa.Column("delivery_status", sa.String(length=20), server_default="pending", nullable=False),
        sa.Column("import_attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("delivery_attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(), nullable=True),
        sa.Column("received_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("processed_at", sa.DateTime(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column("updated_by", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_by", sa.Integer(), nullable=True),
        sa.CheckConstraint(
            "source_type IN ('gmail', 'whatsapp')",
            name="ck_live_c2c_inbound_source_type",
        ),
        sa.CheckConstraint(
            "import_status IN ('queued', 'processing', 'imported', 'failed')",
            name="ck_live_c2c_inbound_import_status",
        ),
        sa.CheckConstraint(
            "delivery_status IN ('pending', 'sending', 'sent', 'failed')",
            name="ck_live_c2c_inbound_delivery_status",
        ),
        sa.ForeignKeyConstraint(["config_id"], ["live_c2c_automation_configs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["deleted_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["house_id"], ["houses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "house_id",
            "source_type",
            "source_event_id",
            name="uq_live_c2c_inbound_source_event",
        ),
    )
    op.create_index("ix_live_c2c_inbound_files_id", "live_c2c_inbound_files", ["id"], unique=False)
    op.create_index(
        "ix_live_c2c_inbound_house_status",
        "live_c2c_inbound_files",
        ["house_id", "import_status", "delivery_status"],
        unique=False,
    )
    op.create_index(
        "ix_live_c2c_inbound_files_lease",
        "live_c2c_inbound_files",
        ["import_status", "lease_expires_at"],
        unique=False,
    )
    op.create_index(
        "ix_live_c2c_inbound_files_config_id",
        "live_c2c_inbound_files",
        ["config_id"],
        unique=False,
    )
    op.create_index(
        "ix_live_c2c_inbound_files_is_deleted",
        "live_c2c_inbound_files",
        ["is_deleted"],
        unique=False,
    )


def downgrade():
    op.drop_index("ix_live_c2c_inbound_files_is_deleted", table_name="live_c2c_inbound_files")
    op.drop_index("ix_live_c2c_inbound_files_config_id", table_name="live_c2c_inbound_files")
    op.drop_index("ix_live_c2c_inbound_files_lease", table_name="live_c2c_inbound_files")
    op.drop_index("ix_live_c2c_inbound_house_status", table_name="live_c2c_inbound_files")
    op.drop_index("ix_live_c2c_inbound_files_id", table_name="live_c2c_inbound_files")
    op.drop_table("live_c2c_inbound_files")
    op.drop_index("uq_live_c2c_automation_active_wa_source", table_name="live_c2c_automation_configs")
    op.drop_index("uq_live_c2c_automation_active_gmail", table_name="live_c2c_automation_configs")
    op.drop_index("ix_live_c2c_automation_configs_is_deleted", table_name="live_c2c_automation_configs")
    op.drop_index("ix_live_c2c_automation_configs_id", table_name="live_c2c_automation_configs")
    op.drop_table("live_c2c_automation_configs")
