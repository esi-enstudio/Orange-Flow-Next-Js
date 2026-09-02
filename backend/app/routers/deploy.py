import asyncio
import json
import logging
import os
import fcntl
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from jose import JWTError, jwt

from app.routers.deps import get_current_user, oauth2_scheme
from app.models.user import User
from app.utils.access_control import is_admin_user
from app.utils.timezone import now_naive
from config.settings import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/deploy", tags=["deploy"])

PROJECT_DIR = "/opt/Orange-Flow-Next-Js"
DEPLOY_SCRIPT = os.path.join(PROJECT_DIR, "deploy.sh")
LOCK_FILE = "/tmp/orangeflow-auto-deploy.lock"
STATUS_FILE = "/tmp/orangeflow-deploy-status.json"

_deploy_state = {
    "state": "idle",
    "started_at": None,
    "ended_at": None,
    "exit_code": None,
    "triggered_by": None,
}


def _read_status_file() -> dict:
    try:
        with open(STATUS_FILE, "r") as f:
            return json.loads(f.read())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _write_status_file(data: dict):
    with open(STATUS_FILE, "w") as f:
        f.write(json.dumps(data))


def _require_admin(current_user: User):
    if not is_admin_user(current_user):
        raise HTTPException(
            status_code=403,
            detail="Super admin access required for deployment operations",
        )


async def _get_user_from_token(token: str) -> User:
    """Decode JWT token and return User — used for SSE endpoint where
    EventSource can't send Authorization headers."""
    from app.services.db_service import async_session
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from app.models.role import Role
    from app.models.house import House

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id_str: str = payload.get("sub")
        if user_id_str is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        user_id = int(user_id_str)
    except (JWTError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    async with async_session() as session:
        result = await session.execute(
            select(User).options(
                selectinload(User.roles).selectinload(Role.permissions),
                selectinload(User.houses),
            ).where(User.id == user_id)
        )
        user = result.unique().scalar_one_or_none()
        if user is None:
            raise HTTPException(status_code=401, detail="User not found")
        return user


async def _get_pending_commit_count() -> int:
    try:
        proc = await asyncio.create_subprocess_exec(
            "git", "-C", PROJECT_DIR, "fetch", "--quiet", "origin", "main",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.wait()

        local = await asyncio.create_subprocess_exec(
            "git", "-C", PROJECT_DIR, "rev-parse", "HEAD",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await local.communicate()
        local_head = stdout.decode().strip()

        remote = await asyncio.create_subprocess_exec(
            "git", "-C", PROJECT_DIR, "rev-parse", "FETCH_HEAD",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await remote.communicate()
        remote_head = stdout.decode().strip()

        if not remote_head or local_head == remote_head:
            return 0

        count_proc = await asyncio.create_subprocess_exec(
            "git", "-C", PROJECT_DIR, "rev-list", "--count", f"{local_head}..{remote_head}",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await count_proc.communicate()
        return int(stdout.decode().strip() or 0)
    except Exception as e:
        logger.error(f"Failed to get pending commit count: {e}")
        return 0


@router.get("/pending-commits")
async def pending_commits(current_user: User = Depends(get_current_user)):
    _require_admin(current_user)
    count = await _get_pending_commit_count()
    return {"count": count}


@router.get("/status")
async def deploy_status(current_user: User = Depends(get_current_user)):
    _require_admin(current_user)
    file_status = _read_status_file()
    return {
        "state": _deploy_state["state"],
        "started_at": _deploy_state["started_at"],
        "ended_at": _deploy_state["ended_at"],
        "exit_code": _deploy_state["exit_code"],
        "triggered_by": _deploy_state["triggered_by"],
        **file_status,
    }


@router.post("/trigger")
async def trigger_deploy(current_user: User = Depends(get_current_user)):
    _require_admin(current_user)

    if _deploy_state["state"] == "running":
        raise HTTPException(status_code=409, detail="A deploy is already in progress")

    if os.path.exists(LOCK_FILE):
        try:
            with open(LOCK_FILE, "r") as f:
                fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                fcntl.flock(f, fcntl.LOCK_UN)
        except (IOError, OSError):
            raise HTTPException(
                status_code=409,
                detail="Another deploy process is holding the lock file",
            )

    _deploy_state.update({
        "state": "running",
        "started_at": now_naive().isoformat(),
        "ended_at": None,
        "exit_code": None,
        "triggered_by": current_user.name or current_user.username,
    })
    _write_status_file(_deploy_state)

    return {"success": True, "message": "Deploy started"}


async def _run_deploy_stream():
    try:
        proc = await asyncio.create_subprocess_exec(
            "bash", DEPLOY_SCRIPT,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=PROJECT_DIR,
            env={**os.environ, "PATH": f"/root/.nvm/versions/node/v24.20.0/bin:{os.environ.get('PATH', '')}"},
        )

        yield f"event: started\ndata: {json.dumps({'pid': proc.pid})}\n\n"

        async for line in proc.stdout:
            decoded = line.decode("utf-8", errors="replace").rstrip("\n")
            yield f"event: log\ndata: {json.dumps({'line': decoded})}\n\n"

        exit_code = await proc.wait()
        _deploy_state.update({
            "state": "completed" if exit_code == 0 else "failed",
            "ended_at": now_naive().isoformat(),
            "exit_code": exit_code,
        })
        _write_status_file(_deploy_state)

        event = "completed" if exit_code == 0 else "failed"
        yield f"event: {event}\ndata: {json.dumps({'exit_code': exit_code})}\n\n"

    except Exception as e:
        logger.error(f"Deploy stream error: {e}")
        _deploy_state.update({
            "state": "failed",
            "ended_at": now_naive().isoformat(),
            "exit_code": -1,
        })
        _write_status_file(_deploy_state)
        yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"


@router.get("/stream")
async def stream_deploy(token: str = Query(..., description="JWT auth token")):
    """SSE endpoint for real-time deploy logs.
    Accepts token as query parameter since EventSource can't send headers."""
    current_user = await _get_user_from_token(token)
    _require_admin(current_user)

    if _deploy_state["state"] == "running":
        raise HTTPException(status_code=409, detail="A deploy is already in progress")

    _deploy_state["state"] = "running"
    _deploy_state["started_at"] = now_naive().isoformat()
    _deploy_state["ended_at"] = None
    _deploy_state["exit_code"] = None
    _deploy_state["triggered_by"] = current_user.name or current_user.username
    _write_status_file(_deploy_state)

    return StreamingResponse(
        _run_deploy_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
