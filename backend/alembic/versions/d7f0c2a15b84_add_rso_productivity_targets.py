"""Add productivity target columns to RSO targets.

Revision ID: d7f0c2a15b84
Revises: c2c1d2e3f4a5
"""

from alembic import op
import sqlalchemy as sa


revision = "d7f0c2a15b84"
down_revision = "c2c1d2e3f4a5"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "rso_targets",
        sa.Column(
            "productivity_c2c_tgt",
            sa.Float(),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )
    op.add_column(
        "rso_targets",
        sa.Column(
            "productivity_trans_tgt",
            sa.Float(),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )
    op.alter_column("rso_targets", "productivity_c2c_tgt", server_default=None)
    op.alter_column("rso_targets", "productivity_trans_tgt", server_default=None)


def downgrade():
    op.drop_column("rso_targets", "productivity_trans_tgt")
    op.drop_column("rso_targets", "productivity_c2c_tgt")
