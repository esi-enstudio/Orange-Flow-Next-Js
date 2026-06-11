import asyncio
from app.services.db_service import init_db, async_session
from app.models.role import Permission
from sqlalchemy import select

async def seed_permissions():
    await init_db()
    
    permissions = [
        # User Management
        "view_users", "create_users", "edit_users", "delete_users", "import_users", "export_users",
        # Role Management
        "view_roles", "create_roles", "edit_roles", "delete_roles",
        # Retailer Management
        "view_retailers", "create_retailers", "edit_retailers", "delete_retailers", "import_retailers", "export_retailers",
        # BTS Management
        "view_bts", "create_bts", "edit_bts", "delete_bts", "import_bts", "export_bts",
        # Employees
        "view_employees", "create_employees", "edit_employees", "delete_employees", "import_employees", "export_employees",
        # Reports
        "view_reports", "download_reports",
        # Houses
        "view_houses", "create_houses", "edit_houses", "delete_houses", "import_houses", "export_houses",
        # Products
        "view_products", "create_products", "edit_products", "delete_products", "import_products", "export_products",
        # Lifting
        "view_lifting", "create_lifting", "edit_lifting", "delete_lifting", "approve_lifting", "import_lifting", "export_lifting",
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
