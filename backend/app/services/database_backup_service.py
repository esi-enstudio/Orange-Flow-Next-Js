import asyncio
import logging
import os
import shutil
import tempfile
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database_backup import DatabaseBackup
from app.utils.timezone import now_naive
from config.settings import settings

logger = logging.getLogger(__name__)

# Backups live inside the backend container on a host bind mount
# (./backend/backups -> /app/backups) so they persist on the host disk.
BACKUP_DIR = "/app/backups"

# Timestamp format used in backup file names
TS_FMT = "%Y%m%d_%H%M%S"


def _ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


async def trigger_backup(db: AsyncSession, user_id: int, user_name: str) -> DatabaseBackup:
    """Create a 'running' record immediately, then run pg_dump in the background.

    Returns the record right away so the API does not block during the dump.
    """
    _ensure_dir(BACKUP_DIR)

    ts = datetime.now().strftime(TS_FMT)
    file_name = f"orange_flow_backup_{ts}.dump"
    file_path = os.path.join(BACKUP_DIR, file_name)

    record = DatabaseBackup(
        file_name=file_name,
        file_path=file_path,
        file_size=0,
        db_name=settings.DB_NAME,
        pg_version=None,
        status="running",
        created_by=user_id,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

    from app.services.db_service import async_session as _session_maker
    from app.utils.activity_logger import log_activity

    async def _run():
        # Work in a fresh session so commit/rollback doesn't clash with the
        # request's session while holding the record object.
        try:
            async with _session_maker() as s:
                rec = await s.get(DatabaseBackup, record.id)
                if not rec:
                    return
                try:
                    await _do_backup(s, rec)
                except Exception as e:  # noqa: BLE001
                    logger.exception("Backup %s failed", record.file_name)
                    rec.status = "failed"
                    rec.error_message = str(e)[:1000]
                    await s.commit()
        except Exception:  # noqa: BLE001
            logger.exception("Backup finalization error")

    try:
        asyncio.get_running_loop().create_task(_run())
    except RuntimeError:
        # No running loop (e.g. called from a sync context) — run inline.
        await _run()

    return record


async def _do_backup(db: AsyncSession, record: DatabaseBackup) -> None:
    """Run pg_dump in PostgreSQL custom-compressed format."""
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".dump", dir=BACKUP_DIR)
    os.close(tmp_fd)
    try:
        cmd = [
            "pg_dump",
            "-h", settings.DB_HOST,
            "-p", str(settings.DB_PORT),
            "-U", settings.DB_USER,
            "-d", settings.DB_NAME,
            "-Fc",
            "--no-owner",
            "--no-privileges",
            "-f", tmp_path,
        ]
        env = {**os.environ, "PGPASSWORD": settings.DB_PASS}

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()

        if proc.returncode != 0:
            err_msg = stderr.decode("utf-8", errors="replace").strip()
            raise RuntimeError(err_msg or "pg_dump exited with non-zero code")

        file_size = os.path.getsize(tmp_path)
        if file_size == 0:
            raise RuntimeError("pg_dump produced an empty backup")

        shutil.move(tmp_path, record.file_path)
        os.chmod(record.file_path, 0o644)
        record.file_size = file_size
        record.pg_version = "custom-compressed"
        record.status = "success"
        record.error_message = None
        logger.info("Backup created: %s (%d bytes)", record.file_name, file_size)
        await db.commit()
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


async def create_uploaded_backup(
    db: AsyncSession,
    original_name: str,
    file,
    user_id: int,
) -> DatabaseBackup:
    """Stream an uploaded dump file to disk and register it as a backup record.

    Returns the record with status "success" so restore_backup() can use it.
    ``file`` must be an object exposing an async ``read()`` (FastAPI UploadFile).
    """
    from fastapi import HTTPException

    _ensure_dir(BACKUP_DIR)

    base = os.path.basename(original_name or "uploaded_backup.dump")
    safe_name = base.replace(" ", "_").replace("\\", "_").replace("/", "_")[:120]
    ts = datetime.now().strftime(TS_FMT)
    file_name = f"upload_{ts}_{safe_name}"
    file_path = os.path.join(BACKUP_DIR, file_name)

    size = 0
    try:
        with open(file_path, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
                size += len(chunk)
    except Exception:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise

    if size == 0:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    record = DatabaseBackup(
        file_name=file_name,
        file_path=file_path,
        file_size=size,
        db_name=settings.DB_NAME,
        pg_version="uploaded",
        status="success",
        created_by=user_id,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    logger.info("Uploaded backup saved: %s (%d bytes)", file_name, size)
    return record


async def restore_backup(db: AsyncSession, backup: DatabaseBackup, user_id: int, user_name: str) -> dict:
    """Restore the database from a backup file.

    A fresh safety backup is created first so there is always a fallback if the
    restore fails. Then pg_restore drops and recreates all objects from the dump.

    NOTE: restoring naturally wipes/replaces the whole database (including backup
    records and audit logs); any data created after the backup was taken is lost.
    """
    from fastapi import HTTPException

    if backup.status != "success":
        raise HTTPException(
            status_code=400,
            detail="Only successfully finished backups can be restored",
        )
    if not os.path.exists(backup.file_path):
        raise HTTPException(status_code=404, detail="Backup file not found on disk")

    # 1) Pre-restore safety snapshot (synchronous so restore is aborted on failure)
    ts = datetime.now().strftime(TS_FMT)
    safety = DatabaseBackup(
        file_name=f"pre_restore_safety_{ts}.dump",
        file_path=os.path.join(BACKUP_DIR, f"pre_restore_safety_{ts}.dump"),
        file_size=0,
        db_name=settings.DB_NAME,
        pg_version=None,
        status="running",
        created_by=user_id,
    )
    db.add(safety)
    await db.commit()
    await db.refresh(safety)
    try:
        await _do_backup(db, safety)
    except Exception:
        logger.exception("Pre-restore safety backup failed")
        raise HTTPException(
            status_code=500,
            detail="Pre-restore safety backup failed. Restore was aborted to protect current data.",
        )

    # 2) Run pg_restore (drop & recreate all objects from the dump)
    cmd = [
        "pg_restore",
        "-h", settings.DB_HOST,
        "-p", str(settings.DB_PORT),
        "-U", settings.DB_USER,
        "-d", settings.DB_NAME,
        "-Fc",
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        backup.file_path,
    ]
    env = {**os.environ, "PGPASSWORD": settings.DB_PASS}
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    err_text = stderr.decode("utf-8", errors="replace") if stderr else ""
    err_msg = err_text.strip()

    if proc.returncode != 0:
        # pg_restore exit codes: 1 = some errors were non-fatal and ignored,
        # 2 = fatal error. Cross-version dumps (e.g. PG17 archive onto a PG15
        # server) commonly emit harmless "unrecognized configuration parameter"
        # warnings (e.g. `SET transaction_timeout = 0`). Those are only session
        # settings on the source server and the restore still completes, so we
        # accept them as a successful (version-compatible) restore.
        version_warning_guc = "unrecognized configuration parameter"
        if proc.returncode == 1 and err_text:
            real_errors = [
                ln
                for ln in err_text.splitlines()
                if "pg_restore: error" in ln and version_warning_guc not in ln
            ]
            if not real_errors:
                logger.warning(
                    "Restore completed with ignored version-compat warnings: %s",
                    err_msg,
                )
                proc.returncode = 0
                err_msg = ""

        if proc.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=f"Restore failed. The database may be partially restored. "
                       f"A safety backup was taken first and can be used to recover. Error: {err_msg[:1000]}",
            )

    logger.info("Database restored from %s (safety backup: %s)", backup.file_name, safety.file_name)
    return {
        "restored_from": backup.file_name,
        "safety_file": safety.file_name,
        "message": f"Database restored successfully from {backup.file_name}. "
                   f"A pre-restore safety backup was saved as {safety.file_name}.",
    }


async def list_backups(
    db: AsyncSession,
    page: int = 1,
    per_page: int = 20,
    search: str = "",
    sort_by: str = "id",
    sort_order: str = "desc",
):
    from sqlalchemy import func, select
    from sqlalchemy.orm import selectinload

    base_q = select(DatabaseBackup).where(DatabaseBackup.is_deleted.is_(False))
    if search:
        like = f"%{search}%"
        base_q = base_q.where(DatabaseBackup.file_name.ilike(like))

    count_q = select(func.count()).select_from(base_q.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    order_col = getattr(DatabaseBackup, sort_by, DatabaseBackup.id)
    if sort_order == "asc":
        base_q = base_q.order_by(order_col.asc())
    else:
        base_q = base_q.order_by(order_col.desc())

    rows = (
        (await db.execute(base_q.options(selectinload(DatabaseBackup.creator)).offset((page - 1) * per_page).limit(per_page)))
        .scalars()
        .all()
    )

    total_pages = (total + per_page - 1) // per_page if per_page else 0
    return {
        "success": True,
        "data": [
            {
                "id": r.id,
                "file_name": r.file_name,
                "file_size": r.file_size,
                "db_name": r.db_name,
                "pg_version": r.pg_version,
                "status": r.status,
                "error_message": r.error_message,
                "created_at": r.created_at.isoformat() + "+06:00" if r.created_at else None,
                "created_by": r.created_by,
                "created_by_name": r.creator.name if r.creator else None,
            }
            for r in rows
        ],
        "pagination": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "total_pages": total_pages,
            "has_next": page < total_pages,
            "has_prev": page > 1,
        },
    }


async def get_backup_or_404(db: AsyncSession, backup_id: int) -> DatabaseBackup:
    from fastapi import HTTPException

    row = await db.get(DatabaseBackup, backup_id)
    if not row or row.is_deleted:
        raise HTTPException(status_code=404, detail="Backup not found")
    return row


async def delete_backup(db: AsyncSession, backup: DatabaseBackup, user_id: int, user_name: str):
    from fastapi import HTTPException
    from app.utils.activity_logger import log_activity

    old_values = {
        "file_name": backup.file_name,
        "file_size": backup.file_size,
        "status": backup.status,
    }
    backup.is_deleted = True
    backup.deleted_at = now_naive()
    backup.deleted_by = user_id
    if os.path.exists(backup.file_path):
        try:
            os.remove(backup.file_path)
        except OSError as e:
            logger.error("Failed to remove backup file %s: %s", backup.file_path, e)
            await db.commit()
            raise HTTPException(status_code=500, detail="Backup record deleted but file removal failed")

    await db.commit()
    await log_activity(
        db=db,
        user_id=user_id,
        user_name=user_name,
        module="database_backup",
        action="delete",
        record_id=backup.id,
        record_identifier=backup.file_name,
        old_values=old_values,
    )
    return backup


async def _read_file(path: str):
    """Yield file in chunks to avoid loading a large dump into memory."""
    chunk_size = 1024 * 1024
    with open(path, "rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            yield chunk