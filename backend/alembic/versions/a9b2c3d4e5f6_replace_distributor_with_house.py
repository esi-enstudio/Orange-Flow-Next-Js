"""replace distributor with house references in commission tables

Revision ID: a9b2c3d4e5f6
Revises: a9b1c2d3e4f5
Create Date: 2026-06-12 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a9b2c3d4e5f6"
down_revision: Union[str, None] = "a9b1c2d3e4f5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add house_id columns referencing houses.id
    op.execute("ALTER TABLE statement_batches ADD COLUMN house_id INTEGER REFERENCES houses(id) ON DELETE CASCADE")
    op.execute("ALTER TABLE campaign_transactions ADD COLUMN house_id INTEGER REFERENCES houses(id) ON DELETE CASCADE")
    op.execute("ALTER TABLE financial_entries ADD COLUMN house_id INTEGER REFERENCES houses(id) ON DELETE CASCADE")

    # 2. Migrate data: map distributor.dd_code -> house.code
    op.execute("""
        UPDATE statement_batches sb
        SET house_id = h.id
        FROM distributors d
        JOIN houses h ON h.code = d.dd_code
        WHERE sb.distributor_id = d.id
    """)
    op.execute("""
        UPDATE campaign_transactions ct
        SET house_id = h.id
        FROM distributors d
        JOIN houses h ON h.code = d.dd_code
        WHERE ct.distributor_id = d.id
    """)
    op.execute("""
        UPDATE financial_entries fe
        SET house_id = h.id
        FROM distributors d
        JOIN houses h ON h.code = d.dd_code
        WHERE fe.distributor_id = d.id
    """)

    # 3. Drop old distributor FK columns and indexes
    op.execute("ALTER TABLE statement_batches DROP CONSTRAINT IF EXISTS statement_batches_distributor_id_fkey")
    op.execute("DROP INDEX IF EXISTS ix_statement_batches_distributor_date")
    op.execute("ALTER TABLE statement_batches DROP COLUMN distributor_id")

    op.execute("ALTER TABLE campaign_transactions DROP CONSTRAINT IF EXISTS campaign_transactions_distributor_id_fkey")
    op.execute("DROP INDEX IF EXISTS ix_campaign_txn_dist_campaign")
    op.execute("ALTER TABLE campaign_transactions DROP COLUMN distributor_id")

    op.execute("ALTER TABLE financial_entries DROP CONSTRAINT IF EXISTS financial_entries_distributor_id_fkey")
    op.execute("DROP INDEX IF EXISTS ix_financial_entries_distributor_type")
    op.execute("ALTER TABLE financial_entries DROP COLUMN distributor_id")

    # 4. Create new indexes
    op.execute("CREATE INDEX IF NOT EXISTS ix_statement_batches_house_date ON statement_batches(house_id, statement_date)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_campaign_txn_house_campaign ON campaign_transactions(house_id, campaign_type_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_financial_entries_house_type ON financial_entries(house_id, entry_type)")

    # 5. Rename columns in commission_staging
    op.execute("ALTER TABLE commission_staging RENAME COLUMN dd_code TO house_code")
    op.execute("ALTER TABLE commission_staging RENAME COLUMN distributor_name TO house_name")
    op.execute("DROP INDEX IF EXISTS ix_staging_dd_code")
    op.execute("CREATE INDEX IF NOT EXISTS ix_staging_house_code ON commission_staging(house_code)")

    # 6. Drop distributors table
    op.execute("DROP TABLE IF EXISTS distributors CASCADE")


def downgrade() -> None:
    op.execute("""
        CREATE TABLE distributors (
            id SERIAL PRIMARY KEY,
            dd_code VARCHAR(50) UNIQUE NOT NULL,
            distributor_name VARCHAR(255) NOT NULL,
            territory VARCHAR(255),
            status VARCHAR(20) DEFAULT 'active',
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    """)

    op.execute("ALTER TABLE statement_batches ADD COLUMN distributor_id INTEGER REFERENCES distributors(id) ON DELETE CASCADE")
    op.execute("ALTER TABLE campaign_transactions ADD COLUMN distributor_id INTEGER REFERENCES distributors(id) ON DELETE CASCADE")
    op.execute("ALTER TABLE financial_entries ADD COLUMN distributor_id INTEGER REFERENCES distributors(id) ON DELETE CASCADE")

    op.execute("""
        UPDATE statement_batches sb
        SET distributor_id = d.id
        FROM houses h
        JOIN distributors d ON d.dd_code = h.code
        WHERE sb.house_id = h.id
    """)
    op.execute("""
        UPDATE campaign_transactions ct
        SET distributor_id = d.id
        FROM houses h
        JOIN distributors d ON d.dd_code = h.code
        WHERE ct.house_id = h.id
    """)
    op.execute("""
        UPDATE financial_entries fe
        SET distributor_id = d.id
        FROM houses h
        JOIN distributors d ON d.dd_code = h.code
        WHERE fe.house_id = h.id
    """)

    op.execute("ALTER TABLE statement_batches DROP COLUMN house_id")
    op.execute("ALTER TABLE campaign_transactions DROP COLUMN house_id")
    op.execute("ALTER TABLE financial_entries DROP COLUMN house_id")

    op.execute("DROP INDEX IF EXISTS ix_statement_batches_house_date")
    op.execute("DROP INDEX IF EXISTS ix_campaign_txn_house_campaign")
    op.execute("DROP INDEX IF EXISTS ix_financial_entries_house_type")

    op.execute("ALTER TABLE commission_staging RENAME COLUMN house_code TO dd_code")
    op.execute("ALTER TABLE commission_staging RENAME COLUMN house_name TO distributor_name")
    op.execute("DROP INDEX IF EXISTS ix_staging_house_code")
    op.execute("CREATE INDEX IF NOT EXISTS ix_staging_dd_code ON commission_staging(dd_code)")
