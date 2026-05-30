"""rename dms_reports to itopup_details

Revision ID: a1b2c3d4e5f6
Revises: fed6077bccdc
Create Date: 2026-05-30 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '9ac1b708051a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.rename_table('dms_reports', 'itopup_details')
    op.execute('ALTER INDEX dms_reports_pkey RENAME TO itopup_details_pkey')
    op.execute('ALTER INDEX ix_dms_reports_report_date RENAME TO ix_itopup_details_report_date')
    op.execute('ALTER INDEX ix_dms_reports_report_type RENAME TO ix_itopup_details_report_type')
    op.execute('ALTER INDEX ix_dms_reports_retailer_id RENAME TO ix_itopup_details_retailer_id')


def downgrade() -> None:
    op.execute('ALTER INDEX ix_itopup_details_retailer_id RENAME TO ix_dms_reports_retailer_id')
    op.execute('ALTER INDEX ix_itopup_details_report_type RENAME TO ix_dms_reports_report_type')
    op.execute('ALTER INDEX ix_itopup_details_report_date RENAME TO ix_dms_reports_report_date')
    op.execute('ALTER INDEX itopup_details_pkey RENAME TO dms_reports_pkey')
    op.rename_table('itopup_details', 'dms_reports')
