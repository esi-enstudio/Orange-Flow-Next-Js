import asyncio
import fcntl
import json
import logging
import os
import re
import shutil
import tempfile
import uuid
from datetime import datetime
from time import monotonic
from typing import Callable, Optional

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database_backup import DatabaseBackup
from app.models.user import User
from app.utils.timezone import now_naive
from config.settings import settings

logger = logging.getLogger(__name__)

# Backups live inside the backend container on a host bind mount
# (./backend/backups -> /app/backups) so they persist on the host disk.
BACKUP_DIR = "/app/backups"

# Timestamp format used in backup file names
TS_FMT = "%Y%m%d_%H%M%S"

# Live backup progress is kept in memory and mirrored to disk so any worker
# (and a page reload) can read it. Backup rows themselves stay in PostgreSQL.
BACKUP_JOBS_DIR = os.path.join(BACKUP_DIR, ".backup-jobs")
_BACKUP_HEARTBEAT_TIMEOUT = 60.0  # seconds without an update => interrupted
_BACKUP_STARTUP_GRACE = 15.0      # let a just-created row publish its state file
_BACKUP_PERSIST_INTERVAL = 0.5   # throttle state-file writes (seconds)
_backup_jobs: dict[int, dict] = {}
_backup_tasks: dict[int, asyncio.Task] = {}
_backup_last_persisted: dict[int, float] = {}

_restore_jobs: dict[str, dict] = {}
_restore_tasks: dict[str, asyncio.Task] = {}
_restore_last_persisted: dict[str, float] = {}
_active_restore_job_id: Optional[str] = None
_restore_lock_handle = None

_TABLE_PROGRESS_RE = re.compile(r'pg_dump: dumping contents of table\s+"?([^"\n]+)"?')
_PUBLIC_BACKUP_JOB_FIELDS = (
    "id",
    "file_name",
    "status",
    "phase",
    "progress",
    "bytes_written",
    "estimated_bytes",
    "current_item",
    "error",
    "started_at",
    "updated_at",
)


def _ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def _backup_job_path(backup_id: int) -> str:
    return os.path.join(BACKUP_JOBS_DIR, f"{backup_id}.json")


def _persist_backup_job(backup_id: int, *, force: bool = False) -> None:
    job = _backup_jobs.get(backup_id)
    if not job:
        return
    now = monotonic()
    if not force and now - _backup_last_persisted.get(backup_id, 0) < _BACKUP_PERSIST_INTERVAL:
        return
    os.makedirs(BACKUP_JOBS_DIR, mode=0o700, exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix=f".{backup_id}.", suffix=".tmp", dir=BACKUP_JOBS_DIR)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as state_file:
            json.dump(job, state_file)
            state_file.flush()
            os.fsync(state_file.fileno())
        os.replace(temp_path, _backup_job_path(backup_id))
        _backup_last_persisted[backup_id] = now
    except Exception:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise


def _update_backup_job(backup_id: int, **updates) -> None:
    job = _backup_jobs.get(backup_id)
    if not job:
        return
    previous_phase = job.get("phase")
    job.update(updates)
    job["updated_at"] = now_naive().isoformat()
    terminal = job.get("status") in ("success", "failed")
    try:
        _persist_backup_job(
            backup_id,
            force=terminal or job.get("phase") != previous_phase,
        )
    except OSError:
        logger.exception("Could not persist progress for backup job %s", backup_id)


def get_backup_job(backup_id: int) -> Optional[dict]:
    job = _backup_jobs.get(backup_id)
    if job:
        return dict(job)
    try:
        with open(_backup_job_path(backup_id), encoding="utf-8") as state_file:
            return json.load(state_file)
    except FileNotFoundError:
        return None
    except (OSError, json.JSONDecodeError):
        logger.exception("Could not read backup progress for job %s", backup_id)
        return None


def _backup_job_is_alive(job: Optional[dict]) -> bool:
    if not job or job.get("status") != "running":
        return False
    try:
        updated_at = datetime.fromisoformat(job["updated_at"])
    except (KeyError, TypeError, ValueError):
        return False
    return (now_naive() - updated_at).total_seconds() <= _BACKUP_HEARTBEAT_TIMEOUT


def backup_progress_payload(row: DatabaseBackup) -> Optional[dict]:
    """Return a safe progress payload for a running backup row."""
    job = get_backup_job(row.id)
    if not job or job.get("status") != "running":
        return None
    payload = {key: job.get(key) for key in _PUBLIC_BACKUP_JOB_FIELDS}
    payload["id"] = row.id
    payload["file_name"] = job.get("file_name") or row.file_name
    return payload


async def reconcile_running_backups(db: AsyncSession) -> int:
    """Mark backups that no longer have a live worker as failed.

    A running row without a fresh heartbeat state file was interrupted (server
    restart, killed worker, etc.) and would otherwise stay "running" forever.
    """
    rows = (
        await db.execute(
            select(DatabaseBackup).where(
                DatabaseBackup.status == "running",
                DatabaseBackup.is_deleted.is_(False),
            )
        )
    ).scalars().all()
    if not rows:
        return 0

    changed = 0
    for row in rows:
        task = _backup_tasks.get(row.id)
        if task and not task.done():
            continue
        job = get_backup_job(row.id)
        if _backup_job_is_alive(job):
            continue
        if row.created_at and (now_naive() - row.created_at).total_seconds() < _BACKUP_STARTUP_GRACE:
            # The record is committed just before its first state file is
            # written; do not fail a job that is still starting up.
            continue

        row.status = "failed"
        row.error_message = (
            "Backup was interrupted before it could finish (the server restarted "
            "or the backup process stopped). Please create a new backup."
        )
        temp_path = (job or {}).get("temp_path")
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                logger.warning("Could not remove interrupted backup temp file %s", temp_path)
        if row.id in _backup_jobs:
            _update_backup_job(
                row.id,
                status="failed",
                phase="failed",
                progress=0,
                current_item="",
                error=row.error_message,
            )
        else:
            try:
                os.remove(_backup_job_path(row.id))
            except FileNotFoundError:
                pass
            except OSError:
                logger.warning("Could not remove stale backup job state %s", row.id)
        changed += 1
        logger.warning("Marked interrupted backup %s as failed", row.file_name)

    if changed:
        await db.commit()
    return changed


async def trigger_backup(db: AsyncSession, user_id: int, user_name: str) -> DatabaseBackup:
    """Create a 'running' record immediately, then run pg_dump in the background.

    Returns the record right away so the API does not block during the dump.
    Live progress is exposed through ``backup_progress_payload`` and the
    ``/database-backups/current-job`` endpoint.
    """
    from fastapi import HTTPException

    _ensure_dir(BACKUP_DIR)

    await reconcile_running_backups(db)
    already_running = (
        await db.execute(
            select(DatabaseBackup.id)
            .where(
                DatabaseBackup.status == "running",
                DatabaseBackup.is_deleted.is_(False),
            )
            .limit(1)
        )
    ).scalar()
    if already_running:
        raise HTTPException(
            status_code=409,
            detail="A database backup is already running. Please wait for it to finish.",
        )

    ts = now_naive().strftime(TS_FMT)
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

    _backup_jobs[record.id] = {
        "id": record.id,
        "file_name": file_name,
        "status": "running",
        "phase": "starting",
        "progress": 0,
        "bytes_written": 0,
        "estimated_bytes": 0,
        "current_item": "",
        "error": None,
        "started_at": now_naive().isoformat(),
        "updated_at": now_naive().isoformat(),
        "temp_path": None,
    }
    try:
        _persist_backup_job(record.id, force=True)
    except OSError:
        logger.exception("Could not persist initial progress for backup %s", record.id)

    from app.services.db_service import async_session as _session_maker

    async def _run():
        # Work in a fresh session so commit/rollback doesn't clash with the
        # request's session while holding the record object.
        try:
            async with _session_maker() as s:
                rec = await s.get(DatabaseBackup, record.id)
                if not rec:
                    _update_backup_job(
                        record.id,
                        status="failed",
                        phase="failed",
                        error="Backup record was removed before the dump started.",
                    )
                    return
                try:
                    await _do_backup(
                        s,
                        rec,
                        progress_callback=lambda **updates: _update_backup_job(record.id, **updates),
                    )
                except asyncio.CancelledError:
                    logger.warning("Backup %s was cancelled by server shutdown", record.file_name)
                    try:
                        rec.status = "failed"
                        rec.error_message = "Backup was interrupted because the server shut down."
                        await s.commit()
                    except Exception:  # noqa: BLE001
                        logger.exception("Could not persist cancelled backup state")
                    _update_backup_job(
                        record.id,
                        status="failed",
                        phase="failed",
                        error="Backup was interrupted because the server shut down.",
                    )
                    raise
                except Exception as e:  # noqa: BLE001
                    logger.exception("Backup %s failed", record.file_name)
                    rec.status = "failed"
                    rec.error_message = str(e)[:1000]
                    await s.commit()
                    _update_backup_job(
                        record.id,
                        status="failed",
                        phase="failed",
                        error=rec.error_message,
                    )
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("Backup finalization error")
            _update_backup_job(
                record.id,
                status="failed",
                phase="failed",
                error="Backup finalization failed. Please try again.",
            )
        finally:
            _backup_tasks.pop(record.id, None)
            _backup_last_persisted.pop(record.id, None)

    try:
        # Keep a strong reference: the event loop only holds weak references
        # and an unreferenced task can be garbage-collected mid-dump.
        _backup_tasks[record.id] = asyncio.get_running_loop().create_task(_run())
    except RuntimeError:
        # No running loop (e.g. called from a sync context) — run inline.
        await _run()

    return record


async def _expected_dump_size(db: AsyncSession, db_size: int) -> int:
    """Best-effort expected dump size for byte-based progress."""
    try:
        last_size = (
            await db.execute(
                select(DatabaseBackup.file_size)
                .where(
                    DatabaseBackup.status == "success",
                    DatabaseBackup.is_deleted.is_(False),
                    DatabaseBackup.file_size > 0,
                )
                .order_by(DatabaseBackup.id.desc())
                .limit(1)
            )
        ).scalar()
    except Exception:  # noqa: BLE001
        last_size = None
    if last_size and last_size > 0:
        return int(last_size)
    # Custom-format dumps are usually ~30% of the logical database size.
    return max(int(db_size * 0.35), 1024 * 1024)


async def _do_backup(
    db: AsyncSession,
    record: DatabaseBackup,
    progress_callback: Optional[Callable[..., None]] = None,
) -> None:
    """Run pg_dump in PostgreSQL custom-compressed format with live progress."""
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".dump", dir=BACKUP_DIR)
    os.close(tmp_fd)

    def notify(**updates) -> None:
        if not progress_callback:
            return
        try:
            progress_callback(**updates)
        except Exception:  # noqa: BLE001
            logger.exception("Backup progress callback failed")

    db_size = 0
    total_tables = 0
    expected_dump_bytes = 1024 * 1024
    try:
        try:
            db_size = int(
                (
                    await db.execute(text("SELECT pg_database_size(current_database())"))
                ).scalar()
                or 0
            )
        except Exception:  # noqa: BLE001
            logger.warning("Could not estimate database size for backup progress")
        try:
            total_tables = int(
                (
                    await db.execute(
                        text(
                            "SELECT count(*) FROM information_schema.tables "
                            "WHERE table_schema NOT IN ('pg_catalog', 'information_schema') "
                            "AND table_type = 'BASE TABLE'"
                        )
                    )
                ).scalar()
                or 0
            )
        except Exception:  # noqa: BLE001
            logger.warning("Could not count database tables for backup progress")
        expected_dump_bytes = await _expected_dump_size(db, db_size)
        await db.commit()

        notify(
            phase="starting",
            progress=1,
            bytes_written=0,
            estimated_bytes=expected_dump_bytes,
            current_item="",
            temp_path=tmp_path,
        )

        cmd = [
            "pg_dump",
            "-h", settings.DB_HOST,
            "-p", str(settings.DB_PORT),
            "-U", settings.DB_USER,
            "-d", settings.DB_NAME,
            "-Fc",
            "--verbose",
            "--no-owner",
            "--no-privileges",
            "-f", tmp_path,
        ]
        env = {**os.environ, "PGPASSWORD": settings.DB_PASS}

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            env=env,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )

        error_lines: list[str] = []
        processed_tables = 0
        current_item = ""

        async def _consume_stderr() -> None:
            nonlocal processed_tables, current_item
            assert proc.stderr is not None
            async for raw_line in proc.stderr:
                line = raw_line.decode("utf-8", errors="replace").rstrip()
                if len(error_lines) < 200 and "pg_dump: error" in line:
                    error_lines.append(line[:2000])
                match = _TABLE_PROGRESS_RE.search(line)
                if match:
                    processed_tables += 1
                    current_item = match.group(1).strip()[:180]

        reader = asyncio.create_task(_consume_stderr())
        notify(phase="dumping", progress=3)
        try:
            while proc.returncode is None:
                await asyncio.sleep(0.4)
                try:
                    written = os.path.getsize(tmp_path)
                except OSError:
                    written = 0
                table_pct = (processed_tables / total_tables) if total_tables else 0.0
                file_pct = min(written / expected_dump_bytes, 1.0) if expected_dump_bytes else 0.0
                progress = min(95, 3 + int(round(max(table_pct, file_pct) * 92)))
                notify(
                    phase="dumping",
                    progress=progress,
                    bytes_written=written,
                    estimated_bytes=expected_dump_bytes,
                    current_item=current_item,
                )
            await proc.wait()
            await reader
        finally:
            if not reader.done():
                reader.cancel()

        if proc.returncode != 0:
            err_msg = "\n".join(error_lines).strip()
            raise RuntimeError(err_msg or "pg_dump exited with non-zero code")

        file_size = os.path.getsize(tmp_path)
        if file_size == 0:
            raise RuntimeError("pg_dump produced an empty backup")

        notify(phase="finalizing", progress=97, bytes_written=file_size)
        shutil.move(tmp_path, record.file_path)
        os.chmod(record.file_path, 0o644)
        record.file_size = file_size
        record.pg_version = "custom-compressed"
        record.status = "success"
        record.error_message = None
        await db.commit()
        notify(
            status="success",
            phase="success",
            progress=100,
            bytes_written=file_size,
            current_item="",
            error=None,
            temp_path=None,
        )
        logger.info("Backup created: %s (%d bytes)", record.file_name, file_size)
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
    ts = now_naive().strftime(TS_FMT)
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


def get_restore_job(job_id: str) -> Optional[dict]:
    if not re.fullmatch(r"[a-f0-9]{32}", job_id):
        return None
    job = _restore_jobs.get(job_id)
    if job:
        return dict(job)
    state_path = os.path.join(BACKUP_DIR, ".restore-jobs", f"{job_id}.json")
    try:
        with open(state_path, encoding="utf-8") as state_file:
            return json.load(state_file)
    except FileNotFoundError:
        return None
    except (OSError, json.JSONDecodeError):
        logger.exception("Could not read restore progress for job %s", job_id)
        return None


def get_active_restore_job(user_id: int) -> Optional[dict]:
    job_ids = set(_restore_jobs)
    state_dir = os.path.join(BACKUP_DIR, ".restore-jobs")
    try:
        job_ids.update(
            entry.name[:-5]
            for entry in os.scandir(state_dir)
            if entry.is_file() and entry.name.endswith(".json")
        )
    except FileNotFoundError:
        pass
    for job_id in job_ids:
        job = get_restore_job(job_id)
        if job and job["status"] == "running" and job["owner_id"] == user_id:
            job.pop("owner_id", None)
            return job
    return None


def _persist_restore_job(job_id: str, *, force: bool = False) -> None:
    now = monotonic()
    if not force and now - _restore_last_persisted.get(job_id, 0) < 0.2:
        return
    state_dir = os.path.join(BACKUP_DIR, ".restore-jobs")
    os.makedirs(state_dir, mode=0o700, exist_ok=True)
    os.chmod(state_dir, 0o700)
    fd, temp_path = tempfile.mkstemp(prefix=f".{job_id}.", suffix=".tmp", dir=state_dir)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as state_file:
            json.dump(_restore_jobs[job_id], state_file)
            state_file.flush()
            os.fsync(state_file.fileno())
        os.replace(temp_path, os.path.join(state_dir, f"{job_id}.json"))
        _restore_last_persisted[job_id] = now
    except Exception:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise


def _update_restore_job(job_id: str, **updates) -> None:
    job = _restore_jobs[job_id]
    previous_phase = job["phase"]
    job.update(updates)
    try:
        _persist_restore_job(
            job_id,
            force=job["status"] != "running" or job["phase"] != previous_phase,
        )
    except OSError:
        logger.exception("Could not persist progress for restore job %s", job_id)


def start_restore_job(
    file_path: str,
    file_name: str,
    user_id: int,
    user_name: str,
    source_file_name: Optional[str] = None,
) -> dict:
    """Queue a database restore and return its live progress record."""
    from fastapi import HTTPException

    global _active_restore_job_id, _restore_lock_handle

    if _active_restore_job_id:
        active = _restore_jobs.get(_active_restore_job_id)
        if active and active["status"] == "running":
            raise HTTPException(status_code=409, detail="Another database restore is already running")

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Backup file not found on disk")

    state_dir = os.path.join(BACKUP_DIR, ".restore-jobs")
    os.makedirs(state_dir, mode=0o700, exist_ok=True)
    os.chmod(state_dir, 0o700)
    lock_handle = open(os.path.join(BACKUP_DIR, ".restore.lock"), "a")
    try:
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock_handle.close()
        raise HTTPException(status_code=409, detail="Another database restore is already running")

    job_id = uuid.uuid4().hex
    job = {
        "id": job_id,
        "owner_id": user_id,
        "file_name": file_name,
        "source_file_name": source_file_name,
        "status": "running",
        "phase": "preparing_safety_backup",
        "progress": 0,
        "started_at": now_naive().isoformat(),
        "completed": 0,
        "total": 0,
        "current_item": "",
        "safety_file": None,
        "error": None,
    }
    _restore_jobs[job_id] = job
    _active_restore_job_id = job_id
    _restore_lock_handle = lock_handle
    try:
        _persist_restore_job(job_id, force=True)
        task = asyncio.get_running_loop().create_task(
            _run_restore_job(job_id, file_path, file_name, user_id, user_name)
        )
        _restore_tasks[job_id] = task
    except Exception:
        _active_restore_job_id = None
        _restore_lock_handle = None
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)
        lock_handle.close()
        raise
    return {key: value for key, value in job.items() if key != "owner_id"}


async def _run_restore_job(
    job_id: str,
    file_path: str,
    file_name: str,
    user_id: int,
    user_name: str,
) -> None:
    global _active_restore_job_id, _restore_lock_handle

    try:
        from app.services.db_service import async_session

        async with async_session() as db:
            result = await restore_backup(
                db,
                file_path,
                file_name,
                user_id,
                user_name,
                progress_callback=lambda **updates: _update_restore_job(job_id, **updates),
            )
        cleanup_warning = None
        try:
            async with async_session() as db:
                await _finalize_backup_records(
                    db,
                    file_path,
                    file_name,
                    result["safety_file"],
                    user_id,
                    source_file_name=_restore_jobs[job_id].get("source_file_name"),
                )
        except Exception:
            cleanup_warning = "BACKUP_RECORD_CLEANUP_FAILED"
            logger.exception("Could not finalize backup records after restore job %s", job_id)
        _update_restore_job(
            job_id,
            status="success",
            phase="completed",
            progress=100,
            completed=_restore_jobs[job_id]["total"],
            remaining=0,
            current_item="",
            safety_file=result["safety_file"],
            warning=cleanup_warning,
        )
        try:
            from app.services.db_service import async_session as session_maker
            from app.utils.activity_logger import log_activity

            async with session_maker() as db:
                await log_activity(
                    db=db,
                    user_id=user_id,
                    user_name=user_name,
                    module="database_backup",
                    action="restore",
                    record_identifier=file_name,
                    new_values={"restored_from": file_name, "safety_file": result["safety_file"]},
                )
        except Exception:
            logger.exception("Failed to write restore activity log")
    except Exception as exc:
        logger.exception("Database restore job %s failed", job_id)
        detail = getattr(exc, "detail", None)
        _update_restore_job(
            job_id,
            status="failed",
            phase="failed",
            error=str(detail or exc)[:1000],
            current_item="",
        )
    finally:
        if _active_restore_job_id == job_id:
            _active_restore_job_id = None
        _restore_tasks.pop(job_id, None)
        _restore_last_persisted.pop(job_id, None)
        if _restore_lock_handle:
            fcntl.flock(_restore_lock_handle.fileno(), fcntl.LOCK_UN)
            _restore_lock_handle.close()
            _restore_lock_handle = None


async def _finalize_backup_records(
    db: AsyncSession,
    restored_file_path: str,
    restored_file_name: str,
    safety_file_name: str,
    user_id: int,
    source_file_name: Optional[str] = None,
) -> None:
    """Repair in-progress backup rows captured in a database snapshot."""
    from app.models.base import Base

    connection = await db.connection()
    await connection.run_sync(Base.metadata.create_all)

    restored_size = os.path.getsize(restored_file_path)
    if restored_size <= 0:
        raise RuntimeError("Restored backup file is empty")
    creator_id = (
        await db.execute(select(User.id).where(User.id == user_id))
    ).scalar_one_or_none()

    running_rows = (
        await db.execute(
            select(DatabaseBackup).where(
                DatabaseBackup.status == "running",
                DatabaseBackup.is_deleted.is_(False),
            )
        )
    ).scalars().all()
    source_row_name = source_file_name or restored_file_name
    restored_row = next(
        (
            row
            for row in running_rows
            if row.file_name in {restored_file_name, source_row_name}
        ),
        None,
    )
    for row in running_rows:
        row.status = "failed"
        row.error_message = "Backup was interrupted by restoring a database snapshot."

    if restored_row:
        restored_row.status = "success"
        restored_row.file_path = restored_file_path
        restored_row.file_size = restored_size
        restored_row.error_message = None
    else:
        restored_row = (
            await db.execute(
                select(DatabaseBackup).where(
                    DatabaseBackup.file_name.in_({restored_file_name, source_row_name})
                )
            )
        ).scalars().first()
        if restored_row:
            restored_row.status = "success"
            restored_row.file_path = restored_file_path
            restored_row.file_size = restored_size
            restored_row.error_message = None
        else:
            db.add(
                DatabaseBackup(
                    file_name=restored_file_name,
                    file_path=restored_file_path,
                    file_size=restored_size,
                    db_name=settings.DB_NAME,
                    pg_version="restored",
                    status="success",
                    created_by=creator_id,
                )
            )
    if restored_row and source_file_name:
        # Reuse the database's pre-existing row for the uploaded dump when
        # its original filename matches, rather than listing the same backup
        # twice under both its original and upload-prefixed names.
        restored_row.file_name = source_row_name
        restored_row.pg_version = restored_row.pg_version or "uploaded"

    safety_path = os.path.join(BACKUP_DIR, safety_file_name)
    safety_row = (
        await db.execute(
            select(DatabaseBackup).where(DatabaseBackup.file_name == safety_file_name)
        )
    ).scalar_one_or_none()
    if safety_row:
        safety_row.file_path = safety_path
        safety_row.file_size = os.path.getsize(safety_path)
        safety_row.status = "success"
        safety_row.error_message = None
    else:
        db.add(
            DatabaseBackup(
                file_name=safety_file_name,
                file_path=safety_path,
                file_size=os.path.getsize(safety_path),
                db_name=settings.DB_NAME,
                pg_version="custom-compressed",
                status="success",
                created_by=creator_id,
            )
        )
    await db.commit()


async def _count_restore_items(file_path: str) -> int:
    cmd = ["pg_restore", "--list", file_path]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        detail = stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(detail or "Could not read the backup archive contents")
    return sum(
        1
        for line in stdout.decode("utf-8", errors="replace").splitlines()
        if re.match(r"^\s*\d+;\s+\d+\s+\d+\s+", line)
    )


async def _reconcile_interrupted_upload_rows(db: AsyncSession) -> None:
    interrupted_rows = (
        await db.execute(
            select(DatabaseBackup).where(
                DatabaseBackup.status == "failed",
                DatabaseBackup.error_message
                == "Backup was interrupted by restoring a database snapshot.",
                DatabaseBackup.is_deleted.is_(False),
            )
        )
    ).scalars().all()
    if not interrupted_rows:
        return

    uploaded_rows = (
        await db.execute(
            select(DatabaseBackup).where(
                DatabaseBackup.file_name.startswith("upload_"),
                DatabaseBackup.status == "success",
                DatabaseBackup.is_deleted.is_(False),
            )
        )
    ).scalars().all()
    changed = False
    for interrupted in interrupted_rows:
        duplicate = next(
            (
                row
                for row in uploaded_rows
                if row.file_name.endswith(f"_{interrupted.file_name}")
                and os.path.isfile(row.file_path)
            ),
            None,
        )
        if not duplicate:
            continue
        interrupted.status = "success"
        interrupted.file_path = duplicate.file_path
        interrupted.file_size = os.path.getsize(duplicate.file_path)
        interrupted.pg_version = interrupted.pg_version or "uploaded"
        interrupted.error_message = None
        duplicate.is_deleted = True
        duplicate.deleted_at = now_naive()
        changed = True
    if changed:
        await db.commit()


async def restore_backup(
    db: AsyncSession,
    file_path: str,
    file_name: str,
    user_id: int,
    user_name: str,
    progress_callback: Optional[Callable[..., None]] = None,
) -> dict:
    """Restore the database from a backup file.

    A fresh safety backup is created first so there is always a fallback if the
    restore fails. Then pg_restore drops and recreates all objects from the dump.

    NOTE: restoring naturally wipes/replaces the whole database (including backup
    records and audit logs); any data created after the backup was taken is lost.
    """
    from fastapi import HTTPException

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Backup file not found on disk")

    # 1) Pre-restore safety snapshot (synchronous so restore is aborted on failure)
    ts = now_naive().strftime(TS_FMT)
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

    if progress_callback:
        progress_callback(
            phase="removing_existing_objects",
            progress=12,
            completed=0,
            total=0,
            safety_file=safety.file_name,
        )
    # A plain pg_restore --clean cannot drop objects when dependencies exist
    # outside the archive. Clear the schema first because restore replaces the
    # entire database, including objects not present in the selected dump.
    db_user = db.get_bind().dialect.identifier_preparer.quote(settings.DB_USER)
    await db.execute(text("DROP SCHEMA public CASCADE"))
    await db.execute(text(f"CREATE SCHEMA public AUTHORIZATION {db_user}"))
    await db.commit()

    if progress_callback:
        progress_callback(
            phase="reading_archive",
            progress=16,
            completed=0,
            total=0,
            safety_file=safety.file_name,
        )
    total_items = await _count_restore_items(file_path)
    processed_items = 0
    if progress_callback:
        progress_callback(
            phase="restoring",
            progress=22,
            completed=0,
            total=total_items,
        )

    # 2) Run pg_restore (drop & recreate all objects from the dump)
    cmd = [
        "pg_restore",
        "--verbose",
        "-h", settings.DB_HOST,
        "-p", str(settings.DB_PORT),
        "-U", settings.DB_USER,
        "-d", settings.DB_NAME,
        "-Fc",
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        file_path,
    ]
    env = {**os.environ, "PGPASSWORD": settings.DB_PASS}
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        env=env,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    error_lines = []
    item_pattern = re.compile(r"processing item\s+\d+\s+(.*)")
    while line := await proc.stderr.readline():
        text_line = line.decode("utf-8", errors="replace").rstrip()
        if (
            len(error_lines) < 1000
            and ("pg_restore: error" in text_line or "pg_restore: warning" in text_line)
        ):
            error_lines.append(text_line[:2000])
        item_match = item_pattern.search(text_line)
        if item_match:
            processed_items = min(processed_items + 1, total_items) if total_items else processed_items + 1
            progress = (
                min(22 + int(73 * processed_items / total_items), 95)
                if total_items
                else min(22 + processed_items, 95)
            )
            if progress_callback:
                progress_callback(
                    phase="restoring",
                    progress=progress,
                    completed=processed_items,
                    total=total_items,
                    current_item=item_match.group(1)[:180],
                )
    await proc.wait()
    err_text = "\n".join(error_lines)
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

    if progress_callback:
        progress_callback(
            phase="finalizing",
            progress=98,
            completed=processed_items,
            total=total_items,
            current_item="",
        )
    logger.info("Database restored from %s (safety backup: %s)", file_name, safety.file_name)
    return {
        "restored_from": file_name,
        "safety_file": safety.file_name,
        "message": f"Database restored successfully from {file_name}. "
                   f"A pre-restore safety backup was saved as {safety.file_name}.",
    }


async def get_latest_running_backup(db: AsyncSession) -> Optional[dict]:
    """Return the newest running backup with its live progress, if any."""
    await reconcile_running_backups(db)
    row = (
        await db.execute(
            select(DatabaseBackup)
            .where(
                DatabaseBackup.status == "running",
                DatabaseBackup.is_deleted.is_(False),
            )
            .order_by(DatabaseBackup.id.desc())
            .limit(1)
        )
    ).scalars().first()
    if not row:
        return None
    payload = backup_progress_payload(row)
    if payload:
        return payload
    # The worker exists but has not written its first state file yet.
    return {
        "id": row.id,
        "file_name": row.file_name,
        "status": "running",
        "phase": "starting",
        "progress": 0,
        "bytes_written": 0,
        "estimated_bytes": 0,
        "current_item": "",
        "error": None,
        "started_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.created_at.isoformat() if row.created_at else None,
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

    await _reconcile_interrupted_upload_rows(db)
    await reconcile_running_backups(db)
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
                "progress": backup_progress_payload(r),
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

    if backup.status == "running":
        raise HTTPException(
            status_code=409,
            detail="This backup is still running. Please wait for it to finish before deleting it.",
        )

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

    _backup_jobs.pop(backup.id, None)
    _backup_last_persisted.pop(backup.id, None)
    try:
        os.remove(_backup_job_path(backup.id))
    except FileNotFoundError:
        pass
    except OSError:
        logger.warning("Could not remove backup job state for %s", backup.id)

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