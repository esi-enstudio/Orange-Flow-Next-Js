"""reorder product_id column next to house_id

Revision ID: fb7a8d4e5f6e
Revises: fb6a9c3d7e2e
Create Date: 2026-06-29 12:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'fb7a8d4e5f6e'
down_revision: Union[str, None] = 'fb6a9c3d7e2e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create a new table with the correct column order (product_id after house_id)
    op.execute("""
    CREATE TABLE scratch_card_serials_new (
        id BIGSERIAL NOT NULL,
        house_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        serial_number VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'available',
        batch_id VARCHAR(50),
        notes VARCHAR(500),
        used_at TIMESTAMP WITHOUT TIME ZONE,
        used_by INTEGER,
        created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITHOUT TIME ZONE
    )
    """)

    # Copy all data from old table
    op.execute("""
    INSERT INTO scratch_card_serials_new (
        id, house_id, product_id, serial_number, status, batch_id, notes,
        used_at, used_by, created_at, updated_at
    )
    SELECT
        id, house_id, product_id, serial_number, status, batch_id, notes,
        used_at, used_by, created_at, updated_at
    FROM scratch_card_serials
    """)

    # Drop old table (cascades to drop all dependent objects)
    op.execute("DROP TABLE scratch_card_serials CASCADE")

    # Rename new table
    op.execute("ALTER TABLE scratch_card_serials_new RENAME TO scratch_card_serials")

    # Set sequence
    op.execute("ALTER SEQUENCE scratch_card_serials_new_id_seq RENAME TO scratch_card_serials_id_seq")

    # Recreate primary key
    op.execute("""
    ALTER TABLE scratch_card_serials ADD CONSTRAINT scratch_card_serials_pkey
        PRIMARY KEY (id)
    """)

    # Recreate foreign keys
    op.execute("""
    ALTER TABLE scratch_card_serials ADD CONSTRAINT scratch_card_serials_house_id_fkey
        FOREIGN KEY (house_id) REFERENCES houses(id)
    """)
    op.execute("""
    ALTER TABLE scratch_card_serials ADD CONSTRAINT fk_scratch_card_serials_product_id
        FOREIGN KEY (product_id) REFERENCES products(id)
    """)
    op.execute("""
    ALTER TABLE scratch_card_serials ADD CONSTRAINT scratch_card_serials_used_by_fkey
        FOREIGN KEY (used_by) REFERENCES users(id)
    """)

    # Recreate unique constraints
    op.execute("""
    ALTER TABLE scratch_card_serials ADD CONSTRAINT uq_serial_number
        UNIQUE (serial_number)
    """)
    op.execute("""
    ALTER TABLE scratch_card_serials ADD CONSTRAINT uq_house_product_serial
        UNIQUE (house_id, product_id, serial_number)
    """)

    # Recreate indexes
    op.execute("CREATE INDEX ix_scratch_card_serials_batch_id ON scratch_card_serials (batch_id)")
    op.execute("CREATE INDEX ix_scratch_card_serials_house_id ON scratch_card_serials (house_id)")
    op.execute("CREATE INDEX ix_scratch_card_serials_id ON scratch_card_serials (id)")
    op.execute("CREATE INDEX ix_scratch_card_serials_serial_number ON scratch_card_serials (serial_number)")
    op.execute("CREATE INDEX ix_scratch_card_serials_status ON scratch_card_serials (status)")
    op.execute("CREATE INDEX ix_scratch_card_serials_product_id ON scratch_card_serials (product_id)")


def downgrade() -> None:
    # Reverse: create table with product_id at the end
    op.execute("""
    CREATE TABLE scratch_card_serials_old (
        id BIGSERIAL NOT NULL,
        house_id INTEGER NOT NULL,
        serial_number VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'available',
        batch_id VARCHAR(50),
        notes VARCHAR(500),
        used_at TIMESTAMP WITHOUT TIME ZONE,
        used_by INTEGER,
        created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(),
        updated_at TIMESTAMP WITHOUT TIME ZONE,
        product_id INTEGER NOT NULL
    )
    """)

    op.execute("""
    INSERT INTO scratch_card_serials_old (
        id, house_id, serial_number, status, batch_id, notes,
        used_at, used_by, created_at, updated_at, product_id
    )
    SELECT
        id, house_id, serial_number, status, batch_id, notes,
        used_at, used_by, created_at, updated_at, product_id
    FROM scratch_card_serials
    """)

    op.execute("DROP TABLE scratch_card_serials CASCADE")
    op.execute("ALTER TABLE scratch_card_serials_old RENAME TO scratch_card_serials")
    op.execute("ALTER SEQUENCE scratch_card_serials_old_id_seq RENAME TO scratch_card_serials_id_seq")

    op.execute("ALTER TABLE scratch_card_serials ADD CONSTRAINT scratch_card_serials_pkey PRIMARY KEY (id)")
    op.execute("ALTER TABLE scratch_card_serials ADD CONSTRAINT scratch_card_serials_house_id_fkey FOREIGN KEY (house_id) REFERENCES houses(id)")
    op.execute("ALTER TABLE scratch_card_serials ADD CONSTRAINT fk_scratch_card_serials_product_id FOREIGN KEY (product_id) REFERENCES products(id)")
    op.execute("ALTER TABLE scratch_card_serials ADD CONSTRAINT scratch_card_serials_used_by_fkey FOREIGN KEY (used_by) REFERENCES users(id)")
    op.execute("ALTER TABLE scratch_card_serials ADD CONSTRAINT uq_serial_number UNIQUE (serial_number)")
    op.execute("ALTER TABLE scratch_card_serials ADD CONSTRAINT uq_house_product_serial UNIQUE (house_id, product_id, serial_number)")

    op.execute("CREATE INDEX ix_scratch_card_serials_batch_id ON scratch_card_serials (batch_id)")
    op.execute("CREATE INDEX ix_scratch_card_serials_house_id ON scratch_card_serials (house_id)")
    op.execute("CREATE INDEX ix_scratch_card_serials_id ON scratch_card_serials (id)")
    op.execute("CREATE INDEX ix_scratch_card_serials_serial_number ON scratch_card_serials (serial_number)")
    op.execute("CREATE INDEX ix_scratch_card_serials_status ON scratch_card_serials (status)")
    op.execute("CREATE INDEX ix_scratch_card_serials_product_id ON scratch_card_serials (product_id)")
