import asyncio
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.Services.db_service import async_session
from app.Models.role import Role, Permission
from app.Models.subscription import SubscriptionPackage, SubscriptionTier

async def seed_system_data(session=None):
    """
    সিস্টেমের প্রয়োজনীয় ডাটা (Permissions, Roles, Packages) সিড করবে।
    """
    should_close = False
    if session is None:
        session = async_session()
        should_close = True

    try:
        print("🚀 System data seeding started...")

        # --- ১. পারমিশন সিডিং ---
        permissions_list = [
            "view_houses", "create_house", "renew_subscription", "view_users", 
            "create_user", "edit_user", "delete_user", "itopup_replace",
            "dms_access", "sim_status_check", "sim_issue", "sim_return",
            "report_access", "view_ga_live", "search_retailer", "create_field_force",
            "view_field_force", "edit_field_force", "delete_field_force",
            "manage_field_force", "upload_retailer_excel", "manage_retailers",
            "create_retailers", "view_retailers", "edit_retailers", "delete_retailers",
            "create_bts", "view_bts", "edit_bts", "delete_bts", "create_mela",
            "view_mela", "edit_mela", "delete_mela", "create_new_role",
            "create_new_permission", "manage_role_and_permission_list",
            "manage_ga_filter", "dms_report", "upload_scratch_card",
            "upload_sim_issue", "upload_activation", "upload_targets",
            "manage_mela_settings", "manage_settings", "apply_leave", "manage_leaves",
            "create_product", "view_product", "update_product", "delete_product",
        ]
        
        db_perms = {}
        for p_name in permissions_list:
            perm_res = await session.execute(select(Permission).where(Permission.name == p_name))
            perm = perm_res.scalar_one_or_none()
            if not perm:
                perm = Permission(name=p_name)
                session.add(perm)
            db_perms[p_name] = perm
        
        await session.flush() 
        print("✅ Permissions seeded.")

        # --- ২. রোল সিডিং ---
        roles_list = [
            "Distributor", "Zm", "Szm", "Mdo", "Manager", 
            "Supervisor", "Rso", "Bp", "Accountant", "DMS Operator", "CC"
        ]
        all_perms = list(db_perms.values())

        # বিদ্যমান সব রোল একবারে লোড করা
        existing_roles_res = await session.execute(
            select(Role).options(selectinload(Role.permissions))
        )
        existing_roles = {r.name: r for r in existing_roles_res.scalars().all()}

        for r_name in roles_list:
            role = existing_roles.get(r_name)
            
            if not role:
                # নতুন রোল তৈরি (পারমিশনসহ)
                role = Role(name=r_name, permissions=[])
                session.add(role)
                print(f"➕ Creating role: {r_name}")
            
            # Manager বা Distributor হলে সব পারমিশন দিয়ে দেওয়া হচ্ছে
            if r_name in ["Manager", "Distributor"]:
                # এখানে সরাসরি লিস্ট অ্যাসাইন করা নিরাপদ কারণ আমরা eager load করেছি বা নতুন অবজেক্ট
                role.permissions = all_perms
        
        await session.flush()
        print("✅ Roles seeded.")

        # --- ৩. সাবস্ক্রিপশন প্যাকেজ সিডিং ---
        packages_data = [
            {
                "name": "বেসিক",
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
        await session.rollback()
        raise e
    finally:
        if should_close:
            await session.close()

if __name__ == "__main__":
    asyncio.run(seed_system_data())
