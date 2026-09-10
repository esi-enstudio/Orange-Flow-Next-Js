import logging
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from app.models.user import User
from app.routers.deps import get_db, get_current_user, has_permission
from app.services.database_backup_service import (
    BACKUP_DIR,
    delete_backup,
    get_backup_or_404,
    list_backups,
    trigger_backup,
)
from app.utils.activity_logger import log_activity
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/database-backups", tags=["database-backups"])


@router.post("")
async def create_backup(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("database_backup.create")),
):
    """Create a full database backup (pg_dump, custom-compressed format)."""
    record = await trigger_backup(db, current_user.id, current_user.name)
    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="database_backup",
        action="create",
        record_id=record.id,
        record_identifier=record.file_name,
        request=None,
    )
    return {
        "success": True,
        "message": "Backup started. It runs in the background and will appear in the list once finished.",
        "backup": {
            "id": record.id,
            "file_name": record.file_name,
            "status": record.status,
            "created_at": record.created_at.isoformat() + "+06:00" if record.created_at else None,
        },
    }


@router.get("")
async def list_all_backups(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    sort_by: str = Query("id"),
    sort_order: str = Query("desc"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("database_backup.view")),
):
    """List all database backups with pagination."""
    return await list_backups(
        db,
        page=page,
        per_page=per_page,
        search=search or "",
        sort_by=sort_by,
        sort_order=sort_order,
    )


@router.get("/{backup_id}/download")
async def download_backup(
    backup_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("database_backup.download")),
):
    """Download a database backup file."""
    backup = await get_backup_or_404(db, backup_id)
    if not os.path.exists(backup.file_path):
        raise HTTPException(status_code=404, detail="Backup file not found on disk")

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="database_backup",
        action="download",
        record_id=backup.id,
        record_identifier=backup.file_name,
        request=None,
    )
    return FileResponse(
        backup.file_path,
        media_type="application/octet-stream",
        filename=backup.file_name,
    )


@router.delete("/{backup_id}")
async def remove_backup(
    backup_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("database_backup.delete")),
):
    """Soft-delete a backup and remove its file from disk."""
    backup = await get_backup_or_404(db, backup_id)
    await delete_backup(db, backup, current_user.id, current_user.name)
    return {"success": True, "message": "Backup deleted"}