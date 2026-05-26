import asyncio
from app.Services.db_service import async_session
from sqlalchemy import text

async def check():
    async with async_session() as s:
        res = await s.execute(text("SELECT schema_name FROM information_schema.schemata"))
        print("Schemas:")
        for row in res.all():
            print(row[0])
        
        res = await s.execute(text("SELECT table_name, table_schema FROM information_schema.tables WHERE table_schema NOT IN ('information_schema', 'pg_catalog')"))
        print("\nTables:")
        for row in res.all():
            print(f"{row[0]} ({row[1]})")

if __name__ == "__main__":
    asyncio.run(check())
