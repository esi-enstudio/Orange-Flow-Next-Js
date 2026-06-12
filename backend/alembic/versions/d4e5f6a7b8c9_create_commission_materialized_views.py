"""create commission materialized views and aggregation indexes

Revision ID: d4e5f6a7b8c9
Revises: f1e2d3c4b5a6
Create Date: 2026-06-12 16:30:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, None] = "f1e2d3c4b5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE MATERIALIZED VIEW mv_commission_daily_summary AS
        SELECT
            sb.statement_date,
            d.id AS distributor_id,
            d.dd_code,
            d.distributor_name,
            ct.category AS campaign_category,
            COUNT(camt.id) AS transaction_count,
            COALESCE(SUM(camt.amount), 0) AS total_campaign_amount,
            COALESCE(SUM(fe_gross.amount), 0) AS total_gross_commission,
            COALESCE(SUM(fe_vat.amount), 0) AS total_vat,
            COALESCE(SUM(fe_ait.amount), 0) AS total_ait,
            COALESCE(SUM(fe_net.amount), 0) AS total_net_payable,
            COALESCE(SUM(fe_airtime.amount), 0) AS total_airtime,
            COALESCE(SUM(fe_pos.amount), 0) AS total_pos_upload
        FROM campaign_transactions camt
        JOIN statement_batches sb ON sb.id = camt.statement_batch_id
        JOIN distributors d ON d.id = camt.distributor_id
        JOIN campaign_types ct ON ct.id = camt.campaign_type_id
        LEFT JOIN financial_entries fe_gross
            ON fe_gross.campaign_transaction_id = camt.id
            AND fe_gross.entry_type = 'gross_commission'
        LEFT JOIN financial_entries fe_vat
            ON fe_vat.campaign_transaction_id = camt.id
            AND fe_vat.entry_type = 'vat'
        LEFT JOIN financial_entries fe_ait
            ON fe_ait.campaign_transaction_id = camt.id
            AND fe_ait.entry_type = 'ait'
        LEFT JOIN financial_entries fe_net
            ON fe_net.campaign_transaction_id = camt.id
            AND fe_net.entry_type = 'net_payable'
        LEFT JOIN financial_entries fe_airtime
            ON fe_airtime.campaign_transaction_id = camt.id
            AND fe_airtime.entry_type = 'airtime'
        LEFT JOIN financial_entries fe_pos
            ON fe_pos.campaign_transaction_id = camt.id
            AND fe_pos.entry_type = 'pos_upload'
        GROUP BY sb.statement_date, d.id, d.dd_code, d.distributor_name, ct.category
        ORDER BY sb.statement_date DESC;
    """)

    op.execute("""
        CREATE UNIQUE INDEX idx_mv_commission_daily_unique
        ON mv_commission_daily_summary (statement_date, distributor_id, campaign_category);
    """)

    op.execute("""
        CREATE MATERIALIZED VIEW mv_commission_monthly_trend AS
        SELECT
            DATE_TRUNC('month', sb.statement_date)::DATE AS month,
            d.id AS distributor_id,
            d.dd_code,
            COUNT(DISTINCT camt.id) AS transaction_count,
            COALESCE(SUM(camt.amount), 0) AS total_campaign_amount,
            COALESCE(SUM(fe.amount) FILTER (WHERE fe.entry_type = 'gross_commission'), 0)
                AS total_gross_commission,
            COALESCE(SUM(fe.amount) FILTER (WHERE fe.entry_type = 'net_payable'), 0)
                AS total_net_payable,
            COALESCE(SUM(fe.amount) FILTER (WHERE fe.entry_type = 'vat'), 0)
                AS total_vat,
            COALESCE(SUM(fe.amount) FILTER (WHERE fe.entry_type = 'ait'), 0)
                AS total_ait
        FROM campaign_transactions camt
        JOIN statement_batches sb ON sb.id = camt.statement_batch_id
        JOIN distributors d ON d.id = camt.distributor_id
        LEFT JOIN financial_entries fe ON fe.campaign_transaction_id = camt.id
        GROUP BY DATE_TRUNC('month', sb.statement_date), d.id, d.dd_code
        ORDER BY DATE_TRUNC('month', sb.statement_date) DESC;
    """)

    op.execute("""
        CREATE UNIQUE INDEX idx_mv_monthly_trend_unique
        ON mv_commission_monthly_trend (month, distributor_id);
    """)

    op.execute("""
        CREATE INDEX idx_mv_daily_statement_date
        ON mv_commission_daily_summary (statement_date);
    """)

    op.execute("""
        CREATE INDEX idx_mv_daily_dd_code
        ON mv_commission_daily_summary (dd_code);
    """)

    op.execute("""
        CREATE INDEX idx_mv_daily_net_payable
        ON mv_commission_daily_summary (total_net_payable DESC);
    """)

    op.execute("""
        CREATE INDEX idx_mv_monthly_distributor
        ON mv_commission_monthly_trend (dd_code);
    """)

    op.execute("""
        CREATE INDEX idx_mv_monthly_net_payable
        ON mv_commission_monthly_trend (total_net_payable DESC);
    """)


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS mv_commission_monthly_trend CASCADE")
    op.execute("DROP MATERIALIZED VIEW IF EXISTS mv_commission_daily_summary CASCADE")
