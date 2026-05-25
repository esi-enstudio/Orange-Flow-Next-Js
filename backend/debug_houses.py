import asyncio
from app.Services.db_service import init_db, async_session
from app.Models.house import House
from sqlalchemy import select

async def check_houses():
    await init_db()
    async with async_session() as session:
        result = await session.execute(select(House))
        houses = result.scalars().all()
        print(f"Total Houses found in database: {len(houses)}")
        for h in houses:
            print(f"- ID: {h.id}, Name: {h.name}, Code: {h.house_code}")

if __name__ == "__main__":
    asyncio.run(check_houses())
