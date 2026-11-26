"""add private template assets

Revision ID: c7d8e9f0a1b2
Revises: b6c7d8e9f0a1
Create Date: 2026-11-26 00:00:00.000000

Private images referenced by manual image blocks in a document template.
``house_id IS NULL`` is a global asset. Paths are relative to private_uploads
so the guarded renderer can embed them without trusting client input.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c7d8e9f0a1b2"
down_revision: Union[str, None] = "b6c7d8e9f0a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "document_template_assets"
SCOPE_INDEX = "ix_document_template_assets_scope"


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _has_index(index_name: str) -> bool:
    return index_name in {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(TABLE)}


def upgrade() -> None:
    if not _has_table(TABLE):
        op.create_table(
            TABLE,
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("template_id", sa.Integer(), nullable=False),
            sa.Column("house_id", sa.Integer(), nullable=True),
            sa.Column("file_name", sa.String(length=255), nullable=False),
            sa.Column("storage_path", sa.String(length=500), nullable=False),
            sa.Column("content_type", sa.String(length=100), nullable=False),
            sa.Column("size_bytes", sa.BigInteger(), nullable=False),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.Column("updated_by", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=False),
            sa.Column("deleted_at", sa.DateTime(), nullable=True),
            sa.Column("deleted_by", sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(["template_id"], ["document_templates.id"]),
            sa.ForeignKeyConstraint(["house_id"], ["houses.id"]),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.ForeignKeyConstraint(["updated_by"], ["users.id"]),
            sa.ForeignKeyConstraint(["deleted_by"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    # Independent indexes are created explicitly so the model and the migration
    # agree even when the table was created by the startup schema migration.
    for column in ("template_id", "house_id", "is_deleted"):
        index_name = f"ix_{TABLE}_{column}"
        if _has_table(TABLE) and not _has_index(index_name):
            op.create_index(index_name, TABLE, [column], unique=False)
    if not _has_index(SCOPE_INDEX):
        op.create_index(SCOPE_INDEX, TABLE, ["house_id", "template_id", "is_deleted"], unique=False)


def downgrade() -> None:
    if not _has_table(TABLE):
        return
    if _has_index(SCOPE_INDEX):
        op.drop_index(SCOPE_INDEX, table_name=TABLE)
    op.drop_table(TABLE)
