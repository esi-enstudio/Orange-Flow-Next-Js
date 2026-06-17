import asyncio
import json
import os
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.services.db_service import async_session
from app.models.role import Role, Permission
from app.models.subscription import SubscriptionPackage, SubscriptionTier

async def seed_system_data(session=None):
    """
    Reads permissions and roles from config/permissions.json and seeds the database.
    """
    should_close = False
    if session is None:
        session = async_session()
        should_close = True

    try:
        print("🚀 System data seeding started...")
        
        # Load permissions config
        config_path = os.path.join(os.path.dirname(__file__), 'config', 'permissions.json')
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)

        # --- 1. Permissions Seeding ---
        db_perms = {}
        for module_name, module_data in config['modules'].items():
            for perm_name in module_data['permissions']:
                
                perm_res = await session.execute(select(Permission).where(Permission.name == perm_name))
                perm = perm_res.scalar_one_or_none()
                if not perm:
                    perm = Permission(name=perm_name)
                    session.add(perm)
                db_perms[perm_name] = perm
        
        await session.flush() 
        print(f"✅ {len(db_perms)} Permissions seeded/verified.")

        # --- 2. Roles Seeding ---
        all_perms = list(db_perms.values())
        
        for role_config in config['default_roles']:
            r_name = role_config['name']
            
            res = await session.execute(
                select(Role).options(selectinload(Role.permissions)).where(Role.name == r_name)
            )
            role = res.scalar_one_or_none()
            
            if not role:
                role = Role(name=r_name)
                session.add(role)
                print(f"➕ Creating role: {r_name}")
            
            # Assign permissions
            if role_config.get('is_admin'):
                role.permissions = all_perms
            elif 'permissions' in role_config:
                role_perms = []
                for p_name in role_config['permissions']:
                    if p_name in db_perms:
                        role_perms.append(db_perms[p_name])
                role.permissions = role_perms
        
        await session.flush()
        print("✅ Roles seeded.")

        # --- 3. Subscription Packages ---
        packages_data = [
            {
                "name": "Basic",
                "tier": SubscriptionTier.BASIC,
                "duration_days": 30,
                "price": 5000.00,
"description": "Basic features for small teams",
"features": "House management, Retailer management, Basic reports"
            },
            {
                "name": "Standard",
                "tier": SubscriptionTier.STANDARD,
                "duration_days": 30,
                "price": 10000.00,
"description": "Advanced features for mid-sized teams",
"features": "All Basic + Field force management, Excel import, SMS sync"
            },
            {
                "name": "Premium",
                "tier": SubscriptionTier.PREMIUM,
                "duration_days": 30,
                "price": 20000.00,
"description": "Full features for large teams",
"features": "All Standard + DMS integration, Automation, Premium support"
            },
        ]

        for pkg_data in packages_data:
            pkg_res = await session.execute(
                select(SubscriptionPackage).where(SubscriptionPackage.tier == pkg_data["tier"])
            )
            pkg = pkg_res.scalar_one_or_none()
            if not pkg:
                pkg = SubscriptionPackage(**pkg_data)
                session.add(pkg)

        await session.commit()
        print("✅ Subscription packages seeded.")
        print("🎉 System data seeding completed successfully!")

    except Exception as e:
        print(f"❌ Seeding Error: {e}")
        if session:
            await session.rollback()
        raise e
    finally:
        if should_close:
            await session.close()

if __name__ == "__main__":
    asyncio.run(seed_system_data())
