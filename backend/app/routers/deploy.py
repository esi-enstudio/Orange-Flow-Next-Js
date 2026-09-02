import json
import logging
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.routers.deps import get_current_user, oauth2_scheme
from app.models.user import User
from app.utils.access_control import is_admin_user
from app.utils.timezone import now_naive
from config.settings import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/deploy", tags=["deploy"])

# Shared with host via the backend bind mount (/opt/.../backend/.deploy -> /app/.deploy)
DEPLOY_DIR = "/app/.deploy"
COMMITS_FILE = os.path.join(DEPLOY_DIR, "commits.json")
STATUS_FILE = os.path.join(DEPLOY_DIR, "status.json")
LOG_FILE = os.path.join(DEPLOY_DIR, "deploy.log")
TRIGGER_FILE = os.path.join(DEPLOY_DIR, "deploy-trigger")


def _require_admin(current_user: User):
    if not is_admin_user(current_user):
        raise HTTPException(
            status_code=403,
            detail="Super admin access required for deployment operations",
        )


def _read_json(path: str) -> dict:
    try:
        with open(path, "r") as f:
            return json.loads(f.read())
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def _state() -> str:
    return _read_json(STATUS_FILE).get("state", "idle")


@router.get("/pending-commits")
async def pending_commits(current_user: User = Depends(get_current_user)):
    _require_admin(current_user)
    data = _read_json(COMMITS_FILE)
    return {
        "count": data.get("count", 0),
        "commits": data.get("commits", []),
        "local_head": data.get("local_head", ""),
        "remote_head": data.get("remote_head", ""),
    }


@router.get("/status")
async def deploy_status(current_user: User = Depends(get_current_user)):
    _require_admin(current_user)
    return _read_json(STATUS_FILE)


@router.post("/trigger")
async def trigger_deploy(current_user: User = Depends(get_current_user)):
    _require_admin(current_user)

    if _state() == "running":
        raise HTTPException(status_code=409, detail="A deploy is already in progress")

    if os.path.exists(TRIGGER_FILE):
        raise HTTPException(status_code=409, detail="Deploy already queued. Please wait.")

    # Write trigger file that the host worker picks up
    try:
        with open(TRIGGER_FILE, "w") as f:
            f.write(json.dumps({
                "triggered_by": current_user.name or current_user.username,
                "triggered_at": now_naive().isoformat(),
            }))
    except OSError as e:
        logger.error(f"Failed to write trigger file: {e}")
        raise HTTPException(status_code=500, detail="Failed to queue deploy")

    return {"success": True, "message": "Deploy queued. The server will start shortly."}


@router.get("/stream")
async def stream_deploy(token: str = Query(..., description="JWT auth token")):
    """SSE endpoint that tails the shared deploy.log written by the host.
    EventSource can't send headers, so token comes as query param."""
    current_user = await _get_user_from_token(token)
    _require_admin(current_user)

    async def event_generator():
        import asyncio

        # Wait for the host worker to begin (trigger -> worker picks up in ~30s)
        for _ in range(60):
            if os.path.exists(LOG_FILE) and os.path.getsize(LOG_FILE) > 0:
                break
            await asyncio.sleep(2)

        yield f"event: started\ndata: {json.dumps({'ok': True})}\n\n"

        last_size = 0
        while True:
            st = _state()

            # flush new log lines
            try:
                if os.path.exists(LOG_FILE) and os.path.getsize(LOG_FILE) > last_size:
                    with open(LOG_FILE, "r") as f:
                        content = f.read()
                    for line in content[last_size:].splitlines():
                        if line.strip():
                            yield f"event: log\ndata: {json.dumps({'line': line})}\n\n"
                    last_size = len(content)
            except OSError:
                pass

            if st in ("completed", "failed"):
                # flush any remaining log then end
                try:
                    if os.path.exists(LOG_FILE) and os.path.getsize(LOG_FILE) > last_size:
                        with open(LOG_FILE, "r") as f:
                            content = f.read()
                        for line in content[last_size:].splitlines():
                            if line.strip():
                                yield f"event: log\ndata: {json.dumps({'line': line})}\n\n"
                except OSError:
                    pass
                if st == "completed":
                    yield f"event: completed\ndata: {json.dumps({'exit_code': 0})}\n\n"
                else:
                    yield f"event: failed\ndata: {json.dumps({'exit_code': 1})}\n\n"
                return

            if st in ("idle", "") and last_size == 0 and os.path.exists(TRIGGER_FILE) is False:
                # nothing running
                yield f"event: error\ndata: {json.dumps({'message': 'No deploy is running or queued'})}\n\n"
                return

            yield f": heartbeat\n\n"
            await asyncio.sleep(2)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )



async def _get_user_from_token(token: str) -> User:
    from jose import JWTError, jwt
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from app.services.db_service import async_session
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
