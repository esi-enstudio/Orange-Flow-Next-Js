import asyncio
from sqlalchemy import select
from app.Services.db_service import async_session
from app.Models.user import User
from app.Models.field_force import FieldForce

async def repair_links():
    async with async_session() as session:
        print("⏳ Repairing links between Users and Field Force...")
        
        # ১. সব ইউজার এবং এফএফ লোড করা
        users_res = await session.execute(select(User))
        users = users_res.scalars().all()
        
        ff_res = await session.execute(select(FieldForce))
        ffs = ff_res.scalars().all()
        
        user_map_phone = {}
        for u in users:
            if u.phone_number:
                # জিরো থাকলেও বা না থাকলেও ম্যাচ করার জন্য
                clean_phone = u.phone_number[-10:] 
                user_map_phone[clean_phone] = u.id
        
        repaired_count = 0
        for f in ffs:
            if f.user_id: continue # অলরেডি লিঙ্ক করা থাকলে স্কিপ
            
            target_id = None
            
            # ক. ফোন নাম্বার দিয়ে চেষ্টা
            if f.personal_number:
                clean_f_phone = str(f.personal_number)[-10:]
                target_id = user_map_phone.get(clean_f_phone)
            
            if target_id:
                f.user_id = target_id
                repaired_count += 1
                print(f"✅ Linked: {f.name} (by Phone)")
            else:
                # খ. নাম দিয়ে চেষ্টা (যদি ফোন না মিলে)
                for u in users:
                    if u.name and f.name and u.name.strip().lower() == f.name.strip().lower():
                        f.user_id = u.id
                        repaired_count += 1
                        print(f"✅ Linked: {f.name} (by Name)")
                        break
        
        await session.commit()
        print(f"\n🎉 Repair completed! Total {repaired_count} members linked.")

if __name__ == "__main__":
    asyncio.run(repair_links())
