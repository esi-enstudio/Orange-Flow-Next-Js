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


async def list_backups(
    db: AsyncSession,
    page: int = 1,
    per_page: int = 20,
    search: str = "",
    sort_by: str = "id",
    sort_order: str = "desc",
):
    from sqlalchemy import func, select

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

    rows = (await db.execute(base_q.offset((page - 1) * per_page).limit(per_page))).scalars().all()

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