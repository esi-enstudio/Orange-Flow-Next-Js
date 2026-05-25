import asyncio
from app.Services.db_service import init_db, async_session
from app.Models.role import Permission
from sqlalchemy import select

async def seed_permissions():
    await init_db()
    
    permissions = [
        # User Management
        "view_users", "create_users", "edit_users", "delete_users",
        # Role Management
        "view_roles", "create_roles", "edit_roles", "delete_roles",
        # Retailer Management
        "view_retailers", "create_retailers", "edit_retailers", "delete_retailers",
        # BTS Management
        "view_bts", "create_bts", "edit_bts", "delete_bts",
        # Field Force
        "view_field_force", "manage_field_force",
        # Reports
        "view_reports", "download_reports",
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
