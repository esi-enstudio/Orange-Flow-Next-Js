import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.deps import get_db, has_permission, get_current_user
from app.models.user import User
from app.services.permission_sync import sync_permissions_from_config
from app.utils.access_control import is_admin_user
from app.utils.activity_logger import log_activity

router = APIRouter(prefix="/admin", tags=["Admin"])
logger = logging.getLogger(__name__)


@router.get("/health")
async def health_check():
    return {"status": "ok", "module": "admin"}


@router.post("/sync-permissions")
async def sync_permissions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("permissions.create")),
):
    report = await sync_permissions_from_config(db)
    await db.commit()

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="permissions", action="sync",
        new_values={
            "permissions_added": len(report["permissions_added"]),
            "roles_updated": report["roles_updated"],
        },
    )

    return {
        "success": True,
        "message": "Permissions synced successfully",
        **report,
    }
