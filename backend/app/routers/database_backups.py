import logging
import os
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from app.models.user import User
from app.routers.deps import get_db, get_current_user, has_permission
from app.services.database_backup_service import (
    BACKUP_DIR,
    create_uploaded_backup,
    delete_backup,
    get_backup_or_404,
    list_backups,
    restore_backup,
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
            "file_size": record.file_size,
            "db_name": record.db_name,
            "pg_version": record.pg_version,
            "status": record.status,
            "error_message": record.error_message,
            "created_at": record.created_at.isoformat() + "+06:00" if record.created_at else None,
            "created_by": record.created_by,
            "created_by_name": current_user.name,
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


@router.post("/upload-restore")
async def upload_and_restore_backup(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("database_backup.restore")),
):
    """Upload a dump file from the user's computer and restore the database from it.

    A fresh safety backup is taken automatically before restoring, then
    pg_restore drops & recreates all objects from the uploaded dump.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file selected")
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in (".dump", ".backup", ".bak", ".tar", ".gz"):
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Please upload a PostgreSQL custom-format dump (.dump / .backup).",
        )

    backup = await create_uploaded_backup(db, file.filename, file, current_user.id)
    result = await restore_backup(db, backup, current_user.id, current_user.name)

    try:
        await log_activity(
            db=db,
            user_id=current_user.id,
            user_name=current_user.name,
            module="database_backup",
            action="restore",
            record_id=backup.id,
            record_identifier=backup.file_name,
            new_values={
                "restored_from_upload": backup.file_name,
                "safety_file": result.get("safety_file"),
            },
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to write upload-restore activity log")
    return {"success": True, **result}


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


@router.post("/{backup_id}/restore")
async def restore_database_backup(
    backup_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("database_backup.restore")),
):
    """Restore the database from a backup file (destructive operation).

    A fresh safety backup is taken automatically before restoring, then
    pg_restore drops & recreates all objects from the selected dump.
    """
    backup = await get_backup_or_404(db, backup_id)
    result = await restore_backup(db, backup, current_user.id, current_user.name)

    try:
        await log_activity(
            db=db,
            user_id=current_user.id,
            user_name=current_user.name,
            module="database_backup",
            action="restore",
            record_id=backup.id,
            record_identifier=backup.file_name,
            new_values={"restored_from": backup.file_name, "safety_file": result.get("safety_file")},
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to write restore activity log")
    return {"success": True, **result}


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