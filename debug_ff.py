import asyncio
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.Services.db_service import async_session
from app.Models.user import User

async def debug_user_ff(tg_id):
    async with async_session() as session:
        print(f"--- Debugging for TG ID: {tg_id} ---")
        res = await session.execute(
            select(User).options(selectinload(User.field_force_profile)).where(User.telegram_id == tg_id)
        )
        user = res.scalar_one_or_none()
        if not user:
            print("❌ User not found in 'users' table!")
            return
            
        print(f"✅ User found: {user.name} (DB ID: {user.id})")
        if user.field_force_profile:
            print(f"✅ Field Force Profile found: {user.field_force_profile.name} (FF ID: {user.field_force_profile.id})")
        else:
            print("❌ field_force_profile is NONE for this user object!")
            
            # সরাসরি field_forces টেবিল চেক করা
            from app.Models.field_force import FieldForce
            ff_res = await session.execute(select(FieldForce).where(FieldForce.user_id == user.id))
            ff = ff_res.scalar_one_or_none()
            if ff:
                print(f"⚠️ Direct query found FF: {ff.name} linked to User ID {user.id}, but relationship didn't load.")
            else:
                print(f"❌ No FieldForce record found with user_id = {user.id}")

if __name__ == "__main__":
    # আপনার টেলিগ্রাম আইডি এখানে দিন (উদাহরণ হিসেবে ৬৯০৬৩৩৯৬৪৪ ব্যবহার করছি যা আগে লগে ছিল)
    import sys
    tid = int(sys.argv[1]) if len(sys.argv) > 1 else 6906339644
    asyncio.run(debug_user_ff(tid))
