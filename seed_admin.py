import asyncio
from app.Services.db_service import init_db, async_session
from app.Models.user import User
from sqlalchemy import select
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

async def seed_super_admin():
    await init_db()
    
    async with async_session() as session:
        # Check if super admin already exists
        result = await session.execute(select(User).where(User.username == "neelemil"))
        existing_user = result.scalar_one_or_none()
        
        if existing_user:
            print("Super Admin already exists. Updating password...")
            existing_user.hashed_password = pwd_context.hash("Admin#123456")
            existing_user.name = "Sadekin Islam Emil"
            existing_user.email = "sadekinislam6@gmail.com"
            existing_user.phone_number = "01732547755"
            existing_user.status = "Active"
        else:
            print("Creating Super Admin...")
            new_user = User(
                username="neelemil",
                hashed_password=pwd_context.hash("Admin#123456"),
                name="Sadekin Islam Emil",
                email="sadekinislam6@gmail.com",
                phone_number="01732547755",
                status="Active"
            )
            session.add(new_user)
        
        await session.commit()
        print("✅ Super Admin setup complete!")

if __name__ == "__main__":
    asyncio.run(seed_super_admin())
