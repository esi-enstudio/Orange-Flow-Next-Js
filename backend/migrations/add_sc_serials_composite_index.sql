-- Run this SQL directly on your PostgreSQL database to add the composite index
-- that speeds up the serial allocation query significantly.

CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_scratch_card_serials_house_status_product
    ON scratch_card_serials (house_id, status, product_id);
