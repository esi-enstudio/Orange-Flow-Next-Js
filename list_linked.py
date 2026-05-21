import asyncio
from sqlalchemy import select
from app.Services.db_service import async_session
from app.Models.field_force import FieldForce
from app.Models.user import User

async def list_linked():
    async with async_session() as session:
        print("--- Linked Members ---")
        res = await session.execute(
            select(FieldForce, User)
            .join(User, FieldForce.user_id == User.id)
        )
        for ff, u in res.all():
            print(f"FF Name: {ff.name} | Linked to User: {u.name} (TG ID: {u.telegram_id})")
            
if __name__ == "__main__":
    asyncio.run(list_linked())
