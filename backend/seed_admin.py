import asyncio
from app.services.db_service import init_db, async_session
from app.models.user import User
from app.models.role import Role
from sqlalchemy import select
from passlib.context import CryptContext
from sqlalchemy.orm import joinedload

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

async def seed_super_admin():
    await init_db()
    
    async with async_session() as session:
        # 1. Ensure "Super Admin" role exists
        result = await session.execute(select(Role).where(Role.name == "Super Admin"))
        super_admin_role = result.scalar_one_or_none()
        
        if not super_admin_role:
            print("Creating 'Super Admin' role...")
            super_admin_role = Role(name="Super Admin")
            session.add(super_admin_role)
            await session.flush()
        else:
            print("'Super Admin' role already exists.")

        # 2. Check if user exists
        result = await session.execute(
            select(User)
            .where(User.username == "neelemil")
            .options(joinedload(User.roles))
        )
        user = result.unique().scalar_one_or_none()
        
        if user:
            print("User 'neelemil' already exists. Updating info and role...")
            user.hashed_password = pwd_context.hash("Admin#123456")
            user.name = "Sadekin Islam Emil"
            user.email = "sadekinislam6@gmail.com"
            user.status = "Active"
            
            if super_admin_role not in user.roles:
                user.roles.append(super_admin_role)
        else:
            print("Creating Super Admin user 'neelemil'...")
            user = User(
                username="neelemil",
                hashed_password=pwd_context.hash("Admin#123456"),
                name="Sadekin Islam Emil",
                email="sadekinislam6@gmail.com",
                status="Active"
            )
            user.roles.append(super_admin_role)
            session.add(user)
        
        await session.commit()
        print("✅ Super Admin setup complete with 'Super Admin' role!")

if __name__ == "__main__":
    asyncio.run(seed_super_admin())
