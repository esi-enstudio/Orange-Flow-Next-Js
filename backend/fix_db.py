import asyncio
from sqlalchemy import text
from app.Services.db_service import engine

async def check_columns():
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name='users'"))
        columns = [row[0] for row in result]
        print(f"Columns in users table: {columns}")
        
        if 'profile_pic' not in columns:
            print("Adding profile_pic column...")
            await conn.execute(text("ALTER TABLE users ADD COLUMN profile_pic VARCHAR"))
            await conn.commit()
            print("Column added!")
        else:
            print("profile_pic column already exists.")

if __name__ == "__main__":
    asyncio.run(check_columns())
