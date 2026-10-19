"""In-memory background job store for lifting PreRF pulls.

Playwright pulls can take several minutes (DMS login, status check, create form
and save confirmation), so the HTTP start endpoint returns immediately and the
client polls a status endpoint. This mirrors the DMS job store but is kept
separate so lifting routes do not depend on the DMS router.

Single-process uvicorn only, same assumption as the existing DMS jobs.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from typing import Optional

_JOB_TTL = 1800  # seconds before an unconsumed job is purged
_jobs: dict[str, dict] = {}
_tasks: set[asyncio.Task] = set()

# A record/house can only have one pull running at a time. The actual DMS
# session is shared per house, so serialising per house also prevents two tabs
# from fighting over the same distributor session.
_running_records: set[int] = set()
_running_houses: set[int] = set()


def _purge_stale_jobs() -> None:
    now = time.time()
    for job_id, job in list(_jobs.items()):
        if now - float(job.get("started_at", now)) > _JOB_TTL:
            _jobs.pop(job_id, None)


def start_job(
    *,
    kind: str,
    house_id: int,
    record_id: int,
    user_id: Optional[int] = None,
) -> str:
    _purge_stale_jobs()
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {
        "kind": kind,
        "events": [],
        "done": False,
        "error": None,
        "result": None,
        "house_id": house_id,
        "record_id": record_id,
        "user_id": user_id,
        "started_at": time.time(),
    }
    return job_id


def push_event(
    job_id: str,
    code: str,
    message: Optional[str] = None,
    params: Optional[dict] = None,
) -> None:
    job = _jobs.get(job_id)
    if job is not None:
        job["events"].append(
            {
                "code": code,
                "msg": message or code,
                "params": params or {},
                "ts": time.time(),
            }
        )


def track_task(coro) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return task


def get_job(job_id: str, kind: str) -> Optional[dict]:
    _purge_stale_jobs()
    job = _jobs.get(job_id)
    if job is None or job.get("kind") != kind:
        return None
    return job


def complete_job(job_id: str, result: dict) -> None:
    job = _jobs.get(job_id)
    if job is None:
        return
    job["result"] = result
    job["done"] = True


def fail_job(job_id: str, message: str, result: Optional[dict] = None) -> None:
    job = _jobs.get(job_id)
    if job is None:
        return
    job["error"] = message
    job["result"] = result
    job["done"] = True


def mark_record_running(record_id: int, house_id: int) -> bool:
    """Reserve a record/house. Returns False when a pull is already running."""
    if record_id in _running_records or house_id in _running_houses:
        return False
    _running_records.add(record_id)
    _running_houses.add(house_id)
    return True


def release_record_running(record_id: int, house_id: int) -> None:
    _running_records.discard(record_id)
    _running_houses.discard(house_id)


def is_record_running(record_id: int) -> bool:
    return record_id in _running_records


def is_house_running(house_id: int) -> bool:
    return house_id in _running_houses
