"""store encrypted Google OAuth settings

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-11-22 22:00:00.000000
"""
from typing import Sequence, Union

from alembic import context, op
import sqlalchemy as sa


revision: str = "f2a3b4c5d6e7"
down_revision: Union[str, None] = "e1f2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    columns = {
        column["name"]
        for column in sa.inspect(op.get_bind()).get_columns("app_settings")
    } if not context.is_offline_mode() else set()
    if context.is_offline_mode() or "google_oauth_client_id" not in columns:
        op.add_column(
            "app_settings",
            sa.Column("google_oauth_client_id", sa.String(length=512), nullable=True),
        )
    if context.is_offline_mode() or "google_oauth_client_secret_encrypted" not in columns:
        op.add_column(
            "app_settings",
            sa.Column("google_oauth_client_secret_encrypted", sa.Text(), nullable=True),
        )
    if context.is_offline_mode() or "google_oauth_redirect_uri" not in columns:
        op.add_column(
            "app_settings",
            sa.Column("google_oauth_redirect_uri", sa.String(length=2048), nullable=True),
        )


def downgrade() -> None:
    op.drop_column("app_settings", "google_oauth_redirect_uri")
    op.drop_column("app_settings", "google_oauth_client_secret_encrypted")
    op.drop_column("app_settings", "google_oauth_client_id")
