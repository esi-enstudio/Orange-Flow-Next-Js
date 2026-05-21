import asyncio
from sqlalchemy import select
from app.Services.db_service import async_session
from app.Models.field_force import FieldForce
from app.Models.user import User
from config.settings import SUPER_ADMIN_ID

async def link_admin():
    async with async_session() as session:
        # সুপার এডমিন ইউজার খুঁজে বের করা
        res = await session.execute(select(User).where(User.telegram_id == int(SUPER_ADMIN_ID)))
        admin = res.scalar_one_or_none()
        
        if not admin:
            print("❌ Super Admin user not found in DB!")
            return

        # চেক করা এডমিনের কোনো প্রোফাইল আছে কি না
        ff_res = await session.execute(select(FieldForce).where(FieldForce.user_id == admin.id))
        if ff_res.scalar_one_or_none():
            print("✅ Admin is already linked to a FF profile.")
            return

        # যেকোনো একটি বিদ্যমান FF প্রোফাইল (যার ইউজার নেই) তার সাথে লিঙ্ক করে দেওয়া টেস্টের জন্য
        ff_available = await session.execute(select(FieldForce).where(FieldForce.user_id == None).limit(1))
        ff = ff_available.scalar_one_or_none()
        
        if ff:
            ff.user_id = admin.id
            await session.commit()
            print(f"🚀 Admin linked to Field Force: {ff.name} for testing.")
        else:
            print("❌ No available Field Force profile to link.")

if __name__ == "__main__":
    asyncio.run(link_admin())
