import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from config.settings import settings

async def test_connection():
    print(f"🔍 Testing connection to: {settings.DB_HOST}:{settings.DB_PORT}")
    print(f"👤 User: {settings.DB_USER}")
    # We won't print the full password for security, but we'll show its length
    print(f"🔑 Password length: {len(settings.DB_PASS)}")
    
    engine = create_async_engine(settings.DATABASE_URL)
    
    try:
        async with engine.connect() as conn:
            result = await conn.execute(text("SELECT 1"))
            print("✅ Database connection successful!")
    except Exception as e:
        print(f"❌ Connection failed: {e}")
    finally:
        await engine.dispose()

if __name__ == "__main__":
    asyncio.run(test_connection())
