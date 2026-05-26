import asyncio
import json
import os
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.Services.db_service import async_session
from app.Models.role import Role, Permission
from app.Models.subscription import SubscriptionPackage, SubscriptionTier

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
        for module in config['modules']:
            module_name = module['name']
            for action in module['actions']:
                perm_name = f"{action}_{module_name}"
                
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
                "name": "बेসিক",
                "tier": SubscriptionTier.BASIC,
                "duration_days": 30,
                "price": 5000.00,
                "description": "ছোট দলের জন্য মৌলিক সুবিধা",
                "features": "হাউজ ম্যানেজমেন্ট, রিটেইলার ম্যানেজমেন্ট, বেসিক রিপোর্ট"
            },
            {
                "name": "স্ট্যান্ডার্ড",
                "tier": SubscriptionTier.STANDARD,
                "duration_days": 30,
                "price": 10000.00,
                "description": "মাঝারি দলের জন্য উন্নত সুবিধা",
                "features": "বেসিক সব + ফিল্ড ফোর্স ম্যানেজমেন্ট, এক্সেল ইমপোর্ট, এসএমএস সিঙ্ক"
            },
            {
                "name": "প্রিমিয়াম",
                "tier": SubscriptionTier.PREMIUM,
                "duration_days": 30,
                "price": 20000.00,
                "description": "বড় দলের জন্য পূর্ণ সুবিধা",
                "features": "স্ট্যান্ডার্ড সব + ডিএমএস ইন্টিগ্রেশন, অটোমেশন, প্রিমিয়াম সাপোর্ট"
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
