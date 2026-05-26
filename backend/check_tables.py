import asyncio
from app.Services.db_service import async_session
from sqlalchemy import text

async def check():
    async with async_session() as s:
        res = await s.execute(text("SELECT table_name FROM information_schema.tables WHERE table_schema='public'"))
        for row in res.all():
            print(row[0])

if __name__ == "__main__":
    asyncio.run(check())
