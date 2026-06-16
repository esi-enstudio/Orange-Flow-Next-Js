"""rename permissions from action_module to module.action format

Revision ID: a0b1c2d3e4f0
Revises: a9b5c6d7e8f9
Create Date: 2026-06-16 12:00:00.000000

"""
from typing import Sequence, Union
from alembic import op

revision: str = "a0b1c2d3e4f0"
down_revision: Union[str, None] = "a9b5c6d7e8f9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PERMISSION_MAP = {
    # User Management
    "view_users": "users.view",
    "create_users": "users.create",
    "edit_users": "users.edit",
    "delete_users": "users.delete",
    "import_users": "users.import",
    "export_users": "users.export",
    # Role Management
    "view_roles": "roles.view",
    "create_roles": "roles.create",
    "edit_roles": "roles.edit",
    "delete_roles": "roles.delete",
    # Permission Management
    "view_permissions": "permissions.view",
    "create_permissions": "permissions.create",
    "edit_permissions": "permissions.edit",
    "delete_permissions": "permissions.delete",
    # Retailer Management
    "view_retailers": "retailers.view",
    "create_retailers": "retailers.create",
    "edit_retailers": "retailers.edit",
    "delete_retailers": "retailers.delete",
    "import_retailers": "retailers.import",
    "export_retailers": "retailers.export",
    # BTS Management
    "view_bts": "bts.view",
    "create_bts": "bts.create",
    "edit_bts": "bts.edit",
    "delete_bts": "bts.delete",
    "import_bts": "bts.import",
    "export_bts": "bts.export",
    # Employees
    "view_employees": "employees.view",
    "create_employees": "employees.create",
    "edit_employees": "employees.edit",
    "delete_employees": "employees.delete",
    "import_employees": "employees.import",
    "export_employees": "employees.export",
    # Reports
    "view_reports": "reports.view",
    "edit_reports": "reports.edit",
    "download_reports": "reports.download",
    "dms_access": "reports.dms_access",
    # Houses
    "view_houses": "houses.view",
    "create_houses": "houses.create",
    "edit_houses": "houses.edit",
    "delete_houses": "houses.delete",
    "import_houses": "houses.import",
    "export_houses": "houses.export",
    # Products
    "view_products": "products.view",
    "create_products": "products.create",
    "edit_products": "products.edit",
    "delete_products": "products.delete",
    "import_products": "products.import",
    "export_products": "products.export",
    # Lifting
    "view_lifting": "lifting.view",
    "create_lifting": "lifting.create",
    "edit_lifting": "lifting.edit",
    "delete_lifting": "lifting.delete",
    "approve_lifting": "lifting.approve",
    "import_lifting": "lifting.import",
    "export_lifting": "lifting.export",
    # Sub-report view permissions
    "view_activations": "activations.view",
    "export_activations": "activations.export",
    "import_activations": "activations.import",
    "view_itopup": "itopup.view",
    "export_itopup": "itopup.export",
    "import_itopup": "itopup.import",
    "view_live_activations": "live_activations.view",
    "export_live_activations": "live_activations.export",
    "import_live_activations": "live_activations.import",
    "view_scratch_card": "scratch_card.view",
    "export_scratch_card": "scratch_card.export",
    "import_scratch_card": "scratch_card.import",
    "view_sim_issues": "sim_issues.view",
    "export_sim_issues": "sim_issues.export",
    "import_sim_issues": "sim_issues.import",
    # DMS
    "view_sim_status": "dms.sim_status",
    "view_sim_return": "dms.sim_return",
    "view_sim_issue": "dms.sim_issue",
    # Targets
    "view_targets": "targets.view",
    "export_targets": "targets.export",
    "import_targets": "targets.import",
    # Settings
    "manage_settings": "app_settings.manage",
    # Leaves
    "view_leaves": "leaves.view",
    "create_leaves": "leaves.create",
    "edit_leaves": "leaves.edit",
    "delete_leaves": "leaves.delete",
    "import_leaves": "leaves.import",
    "export_leaves": "leaves.export",
    # SIM Status (standalone)
    "view_sim_status_only": "sim_status.view",
    # Automation
    "ga_sync": "automation.ga_sync",
    "dms_sync": "automation.dms_sync",
    "automation_settings": "automation.settings",
    # Mela
    "view_mela": "mela.view",
    "create_mela": "mela.create",
    "edit_mela": "mela.edit",
    "delete_mela": "mela.delete",
    "mela_settings": "mela.settings",
    "import_mela": "mela.import",
    "export_mela": "mela.export",
    # Commission (already dotted, keep as-is)
    "commission.view": "commission.view",
    "commission.manage": "commission.manage",
    "commission.import": "commission.import",
    "commission.export": "commission.export",
    # Filters
    "view_filter_tags": "filters.view",
    "edit_filter_tags": "filters.edit",
    "edit_retailers": "filters.edit",
    # BP Retailer Codes
    "view_bp_retailer_codes": "bp_retailer_codes.view",
    "edit_bp_retailer_codes": "bp_retailer_codes.edit",
    "edit_reports": "bp_retailer_codes.edit",
    # GA Section Configs
    "view_ga_section_configs": "ga_section_configs.view",
    "edit_ga_section_configs": "ga_section_configs.edit",
}

def upgrade() -> None:
    conn = op.get_bind()
    for old_name, new_name in PERMISSION_MAP.items():
        if old_name != new_name:
            conn.execute(
                f"UPDATE permissions SET name = '{new_name}' WHERE name = '{old_name}'"
            )

def downgrade() -> None:
    conn = op.get_bind()
    for old_name, new_name in PERMISSION_MAP.items():
        if old_name != new_name:
            conn.execute(
                f"UPDATE permissions SET name = '{old_name}' WHERE name = '{new_name}'"
            )
