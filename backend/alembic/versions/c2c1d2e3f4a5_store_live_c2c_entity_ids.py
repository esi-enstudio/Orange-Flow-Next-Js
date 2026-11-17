"""Store Live C2C entity IDs and route status

Revision ID: c2c1d2e3f4a5
Revises: f4e3d2c1b0a9
Create Date: 2026-11-18 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c2c1d2e3f4a5"
down_revision: Union[str, None] = "f4e3d2c1b0a9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "live_c2c",
        sa.Column("from_employee_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "live_c2c",
        sa.Column("to_retailer_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "live_c2c",
        sa.Column(
            "on_route",
            sa.String(length=1),
            server_default="N",
            nullable=False,
        ),
    )

    op.execute(
        """
        WITH candidates AS (
            SELECT
                c.id AS report_id,
                e.id AS employee_id,
                COUNT(*) OVER (PARTITION BY c.id) AS candidate_count,
                COUNT(*) FILTER (
                    WHERE btrim(e.itop_number) = btrim(c.from_msisdn)
                ) OVER (PARTITION BY c.id) AS exact_count,
                COUNT(*) FILTER (WHERE e.status = 'Active')
                    OVER (PARTITION BY c.id) AS active_count,
                ROW_NUMBER() OVER (
                    PARTITION BY c.id
                    ORDER BY
                        CASE WHEN btrim(e.itop_number) = btrim(c.from_msisdn) THEN 0 ELSE 1 END,
                        CASE WHEN e.status = 'Active' THEN 0 ELSE 1 END,
                        e.id
                ) AS candidate_order
            FROM live_c2c c
            JOIN employees e
              ON e.house_id = c.house_id
             AND e.employee_type = 'rso'
             AND (
                    btrim(e.itop_number) = btrim(c.from_msisdn)
                 OR (
                        c.from_msisdn ~ '^[0-9]+$'
                    AND left(btrim(c.from_msisdn), 1) <> '0'
                    AND btrim(e.itop_number) = '0' || btrim(c.from_msisdn)
                 )
             )
        )
        UPDATE live_c2c c
           SET from_employee_id = candidates.employee_id
          FROM candidates
         WHERE candidates.report_id = c.id
           AND candidates.candidate_order = 1
           AND (
                candidates.exact_count = 1
                OR (
                    candidates.exact_count = 0
                    AND (
                        candidates.active_count = 1
                        OR (
                            candidates.active_count = 0
                            AND candidates.candidate_count = 1
                        )
                    )
                )
           )
        """
    )
    op.execute(
        """
        WITH candidates AS (
            SELECT
                c.id AS report_id,
                r.id AS retailer_id,
                COUNT(*) OVER (PARTITION BY c.id) AS candidate_count,
                COUNT(*) FILTER (
                    WHERE btrim(r.itop_number) = btrim(c.to_msisdn)
                ) OVER (PARTITION BY c.id) AS exact_count,
                ROW_NUMBER() OVER (
                    PARTITION BY c.id
                    ORDER BY
                        CASE WHEN btrim(r.itop_number) = btrim(c.to_msisdn) THEN 0 ELSE 1 END,
                        r.id
                ) AS candidate_order
            FROM live_c2c c
            JOIN retailers r
              ON r.house_id = c.house_id
             AND (
                    btrim(r.itop_number) = btrim(c.to_msisdn)
                 OR (
                        c.to_msisdn ~ '^[0-9]+$'
                    AND left(btrim(c.to_msisdn), 1) <> '0'
                    AND btrim(r.itop_number) = '0' || btrim(c.to_msisdn)
                 )
             )
        )
        UPDATE live_c2c c
           SET to_retailer_id = candidates.retailer_id
          FROM candidates
         WHERE candidates.report_id = c.id
           AND candidates.candidate_order = 1
           AND (
                candidates.exact_count = 1
                OR (
                    candidates.exact_count = 0
                    AND candidates.candidate_count = 1
                )
           )
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                  FROM live_c2c
                 WHERE from_employee_id IS NULL OR to_retailer_id IS NULL
            ) THEN
                RAISE EXCEPTION
                    'Live C2C migration stopped: a stored MSISDN has no unique same-house RSO/retailer match';
            END IF;
        END
        $$
        """
    )

    op.drop_column("live_c2c", "from_msisdn")
    op.drop_column("live_c2c", "to_msisdn")
    op.alter_column(
        "live_c2c",
        "from_employee_id",
        new_column_name="from_msisdn",
        nullable=False,
    )
    op.alter_column(
        "live_c2c",
        "to_retailer_id",
        new_column_name="to_msisdn",
        nullable=False,
    )
    op.alter_column("live_c2c", "on_route", server_default=None)
    op.create_foreign_key(
        "fk_live_c2c_from_msisdn_employees",
        "live_c2c",
        "employees",
        ["from_msisdn"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_live_c2c_to_msisdn_retailers",
        "live_c2c",
        "retailers",
        ["to_msisdn"],
        ["id"],
    )
    op.create_check_constraint(
        "ck_live_c2c_on_route",
        "live_c2c",
        "on_route IN ('Y', 'N')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_live_c2c_on_route", "live_c2c", type_="check")
    op.drop_constraint(
        "fk_live_c2c_to_msisdn_retailers",
        "live_c2c",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_live_c2c_from_msisdn_employees",
        "live_c2c",
        type_="foreignkey",
    )
    op.add_column(
        "live_c2c",
        sa.Column("from_msisdn_number", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "live_c2c",
        sa.Column("to_msisdn_number", sa.String(length=64), nullable=True),
    )
    op.execute(
        """
        UPDATE live_c2c c
           SET from_msisdn_number = e.itop_number
          FROM employees e
         WHERE e.id = c.from_msisdn
        """
    )
    op.execute(
        """
        UPDATE live_c2c c
           SET to_msisdn_number = r.itop_number
          FROM retailers r
         WHERE r.id = c.to_msisdn
        """
    )
    op.drop_column("live_c2c", "from_msisdn")
    op.drop_column("live_c2c", "to_msisdn")
    op.alter_column(
        "live_c2c",
        "from_msisdn_number",
        new_column_name="from_msisdn",
        nullable=False,
    )
    op.alter_column(
        "live_c2c",
        "to_msisdn_number",
        new_column_name="to_msisdn",
        nullable=False,
    )
    op.drop_column("live_c2c", "on_route")
