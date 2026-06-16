import asyncio
from app.services.db_service import init_db, async_session
from app.models.role import Permission
from sqlalchemy import select

async def seed_permissions():
    await init_db()
    
    permissions = [
        # User Management
        "users.view", "users.create", "users.edit", "users.delete", "users.import", "users.export",
        # Role Management
        "roles.view", "roles.create", "roles.edit", "roles.delete",
        # Permissions Management
        "permissions.view", "permissions.create", "permissions.edit", "permissions.delete",
        # Retailer Management
        "retailers.view", "retailers.create", "retailers.edit", "retailers.delete", "retailers.import", "retailers.export",
        # BTS Management
        "bts.view", "bts.create", "bts.edit", "bts.delete", "bts.import", "bts.export",
        # Employees
        "employees.view", "employees.create", "employees.edit", "employees.delete", "employees.import", "employees.export",
        # Reports
        "reports.view", "reports.edit", "reports.download", "reports.dms_access",
        # Houses
        "houses.view", "houses.create", "houses.edit", "houses.delete", "houses.import", "houses.export",
        # Products
        "products.view", "products.create", "products.edit", "products.delete", "products.import", "products.export",
        # Lifting
        "lifting.view", "lifting.create", "lifting.edit", "lifting.delete", "lifting.approve", "lifting.import", "lifting.export",
        # Commission
        "commission.view", "commission.manage", "commission.import", "commission.export",
        # Leaves
        "leaves.view", "leaves.create", "leaves.edit", "leaves.delete", "leaves.import", "leaves.export",
        # SIM Status
        "sim_status.view",
        # Navigation/UI permissions
        "imports.data",
        "settings.view",
        # Automation
        "automation.ga_sync", "automation.dms_sync", "automation.settings",
        # Mela
        "mela.view", "mela.create", "mela.edit", "mela.delete", "mela.settings", "mela.import", "mela.export",
        # Additional report-level permissions
        "activations.view", "activations.export", "activations.import",
        "itopup.view", "itopup.export", "itopup.import",
        "live_activations.view", "live_activations.export", "live_activations.import",
        "scratch_card.view", "scratch_card.export", "scratch_card.import",
        "sim_issues.view", "sim_issues.export", "sim_issues.import",
        "targets.view", "targets.export", "targets.import",
        "bts.export",
        "products.export",
        "app_settings.manage",
        "bp_retailer_codes.edit",
        "ga_section_configs.edit",
        "dms.sim_status", "dms.sim_return", "dms.sim_issue",
        "filters.edit",
    ]
    
    async with async_session() as session:
        for p_name in permissions:
            # Check if exists
            result = await session.execute(select(Permission).where(Permission.name == p_name))
            if not result.scalar_one_or_none():
                print(f"Adding permission: {p_name}")
                session.add(Permission(name=p_name))
        
        await session.commit()
        print("✅ Permissions seeded successfully!")

if __name__ == "__main__":
    asyncio.run(seed_permissions())
