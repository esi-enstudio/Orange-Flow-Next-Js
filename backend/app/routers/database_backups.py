import logging
import os
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from jose import JWTError, jwt

from app.models.user import User
from app.routers.deps import get_db, get_current_user, has_permission, oauth2_scheme
from app.services.database_backup_service import (
    BACKUP_DIR,
    create_uploaded_backup,
    delete_backup,
    get_restore_job,
    get_active_restore_job,
    get_backup_or_404,
    get_latest_running_backup,
    list_backups,
    start_restore_job,
    trigger_backup,
)
from app.utils.activity_logger import log_activity
from config.settings import settings
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/database-backups", tags=["database-backups"])


def _restore_job_owner_id(token: str) -> int:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return int(payload["sub"])
    except (JWTError, KeyError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Could not validate credentials")


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
        "message": "Backup started. Live progress is available while it runs in the background.",
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


@router.get("/current-job")
async def get_current_backup_job(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("database_backup.view")),
):
    """Return the newest running backup with live progress, if any."""
    return {"success": True, "job": await get_latest_running_backup(db)}


@router.post("/upload-restore")
async def upload_and_restore_backup(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("database_backup.restore")),
):
    """Upload a dump file, start its restore job and return its progress handle."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file selected")
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in (".dump", ".backup", ".bak", ".tar", ".gz"):
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Please upload a PostgreSQL custom-format dump (.dump / .backup).",
        )

    backup = await create_uploaded_backup(db, file.filename, file, current_user.id)
    job = start_restore_job(
        backup.file_path,
        backup.file_name,
        current_user.id,
        current_user.name,
        source_file_name=os.path.basename(file.filename).replace(" ", "_").replace("\\", "_").replace("/", "_")[:120],
    )
    return {"success": True, "job": job}


@router.get("/restore-jobs/current")
async def get_current_restore_job(
    token: str = Depends(oauth2_scheme),
):
    user_id = _restore_job_owner_id(token)
    return {"success": True, "job": get_active_restore_job(user_id)}


@router.get("/restore-jobs/{job_id}")
async def get_restore_job_status(
    job_id: str,
    token: str = Depends(oauth2_scheme),
):
    """Return progress for the caller's active restore without querying the DB.

    The database is temporarily unavailable while pg_restore replaces its
    tables, so this endpoint validates the signed token and job ownership
    without loading the user record from PostgreSQL.
    """
    user_id = _restore_job_owner_id(token)

    job = get_restore_job(job_id)
    if not job or job["owner_id"] != user_id:
        raise HTTPException(status_code=404, detail="Restore job not found")
    job.pop("owner_id", None)
    return {"success": True, "job": job}


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
    """Start a destructive restore job after verifying the selected backup."""
    backup = await get_backup_or_404(db, backup_id)
    if backup.status != "success":
        raise HTTPException(
            status_code=400,
            detail="Only successfully finished backups can be restored",
        )
    job = start_restore_job(
        backup.file_path,
        backup.file_name,
        current_user.id,
        current_user.name,
    )
    return {"success": True, "job": job}


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