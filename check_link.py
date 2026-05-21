import asyncio
from sqlalchemy import select
from app.Services.db_service import async_session
from app.Models.user import User
from app.Models.field_force import FieldForce

async def check_link():
    async with async_session() as session:
        print("--- Checking Users ---")
        users_res = await session.execute(select(User))
        users = users_res.scalars().all()
        for u in users:
            print(f"User: {u.name}, Phone: {u.phone_number}, TG ID: {u.telegram_id}")
            
        print("\n--- Checking Field Force ---")
        ff_res = await session.execute(select(FieldForce))
        ffs = ff_res.scalars().all()
        for f in ffs:
            print(f"FF: {f.name}, Personal: {f.personal_number}, Linked User ID: {f.user_id}")
            
if __name__ == "__main__":
    asyncio.run(check_link())
