import asyncio
from sqlalchemy import inspect, text
from app.Services.db_service import engine, init_db
from app.Models.base import Base

async def check():
    print("Initializing DB...")
    await init_db()
    print("Checking tables...")
    
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"))
        tables = result.scalars().all()
        print(f"Tables in DB: {tables}")
        
        if 'users' not in tables:
            print("❌ 'users' table is missing!")
        else:
            print("✅ 'users' table exists.")

if __name__ == "__main__":
    asyncio.run(check())
