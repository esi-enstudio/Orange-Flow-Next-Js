from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.Services.db_service import async_session
from seed_db import seed_system_data
from seed_admin import seed_super_admin
import logging

router = APIRouter(prefix="/admin/setup", tags=["Admin Setup"])
logger = logging.getLogger(__name__)

async def get_db():
    async with async_session() as session:
        yield session

@router.get("/status")
async def get_system_status(db: AsyncSession = Depends(get_db)):
    """
    Checks if the system has been initialized (at least one user exists).
    """
    from app.Models.user import User
    from sqlalchemy import func, select
    
    result = await db.execute(select(func.count()).select_from(User))
    user_count = result.scalar()
    
    return {
        "initialized": user_count > 0,
        "user_count": user_count
    }

@router.post("/initialize-system")
async def initialize_system(db: AsyncSession = Depends(get_db)):
    """
    Initializes the system by seeding permissions, roles, and creating the Super Admin.
    """
    try:
        # Seed permissions and roles
        await seed_system_data(db)
        
        # Seed super admin
        await seed_super_admin()
        
        return {"message": "System initialized successfully with permissions, roles, and super admin."}
    except Exception as e:
        logger.error(f"Initialization Error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"System initialization failed: {str(e)}"
        )
