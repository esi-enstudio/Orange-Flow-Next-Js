"""merge_all_heads

Revision ID: a90de2a5676c
Revises: ae371697f9b1, jkl456mno789, remove_customer_nid_sim_type
Create Date: 2026-07-23 20:43:12.996919

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a90de2a5676c'
down_revision: Union[str, None] = ('ae371697f9b1', 'jkl456mno789', 'remove_customer_nid_sim_type')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
