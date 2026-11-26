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


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("selected_house_id", sa.Integer(), nullable=True),
    )
    op.create_index(INDEX_NAME, "users", ["selected_house_id"], unique=False)
    op.create_foreign_key(
        FK_NAME,
        "users",
        "houses",
        ["selected_house_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(FK_NAME, "users", type_="foreignkey")
    op.drop_index(INDEX_NAME, table_name="users")
    op.drop_column("users", "selected_house_id")
