"""add selected_house_id to users

Revision ID: b6c7d8e9f0a1
Revises: f2a3b4c5d6e7
Create Date: 2026-11-26 00:00:00.000000

Stores the workspace house chosen by a user. NULL keeps the existing behaviour
(use the first assigned house). The FK uses ON DELETE SET NULL so deleting a
house cannot leave a user pointing at a missing house.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b6c7d8e9f0a1"
down_revision: Union[str, None] = "f2a3b4c5d6e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INDEX_NAME = "ix_users_selected_house_id"
FK_NAME = "users_selected_house_id_fkey"


def _has_column(table_name: str, column_name: str) -> bool:
    """`Inspector.has_column` does not exist in SQLAlchemy 2.x."""
    return column_name in {
        column["name"]
        for column in sa.inspect(op.get_bind()).get_columns(table_name)
    }


def _create_column() -> None:
    op.add_column(
        "users",
        sa.Column("selected_house_id", sa.Integer(), nullable=True),
    )


def _create_index() -> None:
    op.create_index(INDEX_NAME, "users", ["selected_house_id"], unique=False)


def _create_foreign_key() -> None:
    # Batch mode is a plain ALTER on PostgreSQL and a copy-and-move on SQLite,
    # which cannot ALTER constraints in place.
    with op.batch_alter_table("users") as batch_op:
        batch_op.create_foreign_key(
            FK_NAME, "houses", ["selected_house_id"], ["id"], ondelete="SET NULL"
        )


def upgrade() -> None:
    # The boot path does not stamp alembic_version, so `alembic upgrade head`
    # can legitimately replay this revision. Repair each object independently:
    # a database may carry the column but lack the index or FK.
    if op.get_context().as_sql:
        _create_column()
        _create_index()
        _create_foreign_key()
        return

    bind = op.get_bind()
    if not _has_column("users", "selected_house_id"):
        _create_column()
    inspector = sa.inspect(bind)
    if INDEX_NAME not in {index["name"] for index in inspector.get_indexes("users")}:
        _create_index()
    if FK_NAME not in {fk["name"] for fk in inspector.get_foreign_keys("users")}:
        _create_foreign_key()


def downgrade() -> None:
    op.drop_constraint(FK_NAME, "users", type_="foreignkey")
    op.drop_index(INDEX_NAME, table_name="users")
    op.drop_column("users", "selected_house_id")
