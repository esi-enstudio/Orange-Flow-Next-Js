import asyncio
from sqlalchemy import select
from app.Services.db_service import async_session
from app.Models.field_force import FieldForce
from app.Models.user import User
from config.settings import SUPER_ADMIN_ID

async def unlink_admin():
    async with async_session() as session:
        # সুপার এডমিন ইউজার খুঁজে বের করা
        res = await session.execute(select(User).where(User.telegram_id == int(SUPER_ADMIN_ID)))
        admin = res.scalar_one_or_none()
        
        if not admin:
            print("❌ Super Admin user not found in DB!")
            return

        # এডমিনের সাথে লিঙ্ক করা ফিল্ড ফোর্স প্রোফাইল খুঁজে বের করা
        ff_res = await session.execute(select(FieldForce).where(FieldForce.user_id == admin.id))
        ff = ff_res.scalar_one_or_none()
        
        if ff:
            name = ff.name
            ff.user_id = None
            await session.commit()
            print(f"✅ Unlinked: {name} is no longer associated with Super Admin.")
        else:
            print("ℹ️ No Field Force profile was linked to Super Admin.")

if __name__ == "__main__":
    asyncio.run(unlink_admin())
