"""create sim replacement module tables

Revision ID: abc123def456
Revises: fed6077bccdc
Create Date: 2026-07-16 09:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "abc123def456"
down_revision: Union[str, None] = "fed6077bccdc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- sim_inventory ---
    op.create_table(
        "sim_inventory",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("house_id", sa.Integer(), sa.ForeignKey("houses.id"), nullable=False),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=True),
        sa.Column("sim_type", sa.String(50), nullable=False),
        sa.Column("starting_serial", sa.String(100), nullable=False),
        sa.Column("ending_serial", sa.String(100), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("available_quantity", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("supplier", sa.String(200), nullable=True),
        sa.Column("batch_number", sa.String(100), nullable=True),
        sa.Column("purchase_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(50), nullable=False, server_default="active"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sim_inventory_house_id", "sim_inventory", ["house_id"])
    op.create_index("ix_sim_inventory_status", "sim_inventory", ["status"])

    # --- ev_kit_inventory ---
    op.create_table(
        "ev_kit_inventory",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("house_id", sa.Integer(), sa.ForeignKey("houses.id"), nullable=False),
        sa.Column("kit_serial", sa.String(100), nullable=False),
        sa.Column("kit_type", sa.String(50), nullable=False),
        sa.Column("status", sa.String(50), nullable=False, server_default="available"),
        sa.Column("allocated_to", sa.Integer(), sa.ForeignKey("sim_replacement_requests.id"), nullable=True),
        sa.Column("allocated_at", sa.DateTime(), nullable=True),
        sa.Column("allocated_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("kit_serial"),
    )
    op.create_index("ix_ev_kit_inventory_house_id", "ev_kit_inventory", ["house_id"])
    op.create_index("ix_ev_kit_inventory_status", "ev_kit_inventory", ["status"])

    # --- sim_replacement_requests ---
    op.create_table(
        "sim_replacement_requests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("house_id", sa.Integer(), sa.ForeignKey("houses.id"), nullable=False),
        sa.Column("request_number", sa.String(50), nullable=False),
        sa.Column("retailer_id", sa.Integer(), sa.ForeignKey("retailers.id"), nullable=True),
        sa.Column("retailer_code", sa.String(50), nullable=True),
        sa.Column("retailer_name", sa.String(200), nullable=True),
        sa.Column("customer_name", sa.String(200), nullable=True),
        sa.Column("customer_phone", sa.String(20), nullable=True),
        sa.Column("customer_nid", sa.String(50), nullable=True),
        sa.Column("old_sim_number", sa.String(100), nullable=True),
        sa.Column("old_msisdn", sa.String(20), nullable=True),
        sa.Column("new_sim_number", sa.String(100), nullable=True),
        sa.Column("new_msisdn", sa.String(20), nullable=True),
        sa.Column("sim_type", sa.String(50), nullable=True),
        sa.Column("replacement_reason", sa.String(50), nullable=True),
        sa.Column("reason_details", sa.Text(), nullable=True),
        sa.Column("sim_inventory_id", sa.Integer(), sa.ForeignKey("sim_inventory.id"), nullable=True),
        sa.Column("ev_kit_id", sa.Integer(), sa.ForeignKey("ev_kit_inventory.id"), nullable=True),
        sa.Column("request_status", sa.String(50), nullable=False, server_default="pending"),
        sa.Column("requested_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("requested_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("approved_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.Column("approval_notes", sa.Text(), nullable=True),
        sa.Column("issued_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("issued_at", sa.DateTime(), nullable=True),
        sa.Column("activated_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("activated_at", sa.DateTime(), nullable=True),
        sa.Column("closed_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.Column("old_sim_deactivated", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("old_sim_deactivated_at", sa.DateTime(), nullable=True),
        sa.Column("ev_kit_returned", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("ev_kit_returned_at", sa.DateTime(), nullable=True),
        sa.Column("priority", sa.String(20), nullable=False, server_default="normal"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("request_number"),
    )
    op.create_index("ix_sim_req_house_id", "sim_replacement_requests", ["house_id"])
    op.create_index("ix_sim_req_status", "sim_replacement_requests", ["request_status"])
    op.create_index("ix_sim_req_number", "sim_replacement_requests", ["request_number"])

    # --- sim_replacement_logs ---
    op.create_table(
        "sim_replacement_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("request_id", sa.Integer(), sa.ForeignKey("sim_replacement_requests.id"), nullable=False),
        sa.Column("action", sa.String(50), nullable=False),
        sa.Column("old_status", sa.String(50), nullable=True),
        sa.Column("new_status", sa.String(50), nullable=True),
        sa.Column("performed_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("performed_by_name", sa.String(200), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("extra_data", sa.Text(), nullable=True),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sim_log_request_id", "sim_replacement_logs", ["request_id"])
    op.create_index("ix_sim_log_action", "sim_replacement_logs", ["action"])
    op.create_index("ix_sim_log_created_at", "sim_replacement_logs", ["created_at"])

    # --- sim_stock_movements ---
    op.create_table(
        "sim_stock_movements",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("house_id", sa.Integer(), sa.ForeignKey("houses.id"), nullable=False),
        sa.Column("sim_inventory_id", sa.Integer(), sa.ForeignKey("sim_inventory.id"), nullable=True),
        sa.Column("request_id", sa.Integer(), sa.ForeignKey("sim_replacement_requests.id"), nullable=True),
        sa.Column("movement_type", sa.String(50), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("reference_number", sa.String(100), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("performed_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sim_stock_house_id", "sim_stock_movements", ["house_id"])
    op.create_index("ix_sim_stock_type", "sim_stock_movements", ["movement_type"])


def downgrade() -> None:
    op.drop_table("sim_stock_movements")
    op.drop_table("sim_replacement_logs")
    op.drop_table("sim_replacement_requests")
    op.drop_table("ev_kit_inventory")
    op.drop_table("sim_inventory")
