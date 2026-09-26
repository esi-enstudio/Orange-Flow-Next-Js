"""Restore Point API — create, list, roll back and delete system snapshots.

Every endpoint is admin-only in practice: a restore point can rewrite the code,
the configuration and the entire database, so each one is gated behind its own
permission (see `backend/config/permissions.json`).

A restore point is NOT house-scoped. It is a snapshot of the whole server (repo
+ config + database), which is a platform-level concern like a deploy or a
database backup — it is never about one distribution house's data.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.routers.deps import get_db, has_permission
from app.services import restore_point_service as svc
from app.utils.access_control import is_admin_user
from app.utils.activity_logger import log_activity

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/restore-points", tags=["restore-points"])

# Restoring the database is a privileged, whole-system action. Even with
# `restore_point.restore`, require an admin account: a house manager holding the
# permission must not be able to rewind the shared database under every other
# house.
def _require_admin_for_restore(current_user: User) -> None:
    if not is_admin_user(current_user):
        raise HTTPException(
            status_code=403,
            detail="Restoring a system-wide restore point requires a super admin account.",
        )


@router.get("")
async def list_restore_points(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("restore_point.view")),
):
    """List every restore point, newest first.

    Reads the on-disk manifests (via the deploy-service, falling back to the
    shared mount) and merges them with the registry, so the list still works
    after a rollback has rewound the `restore_points` table.
    """
    return await svc.list_restore_points(
        db, page=page, per_page=per_page, search=search or ""
    )


@router.get("/current-operation")
async def current_operation(
    current_user: User = Depends(has_permission("restore_point.view")),
):
    """Live state of a running snapshot or rollback (for polling / recovery)."""
    return await svc.deploy_service_status()


@router.get("/{snapshot_id}")
async def get_restore_point(
    snapshot_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("restore_point.view")),
):
    if not svc.is_safe_snapshot_id(snapshot_id):
        raise HTTPException(status_code=400, detail="Invalid restore point id")

    manifest = await svc.get_manifest(snapshot_id)
    if manifest is None:
        raise HTTPException(status_code=404, detail="Restore point not found")

    rows = await svc._registry_rows(db)
    return {"success": True, "data": svc._serialize(manifest, rows.get(snapshot_id))}


@router.post("", status_code=202)
async def create_restore_point(
    payload: Optional[dict] = Body(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("restore_point.create")),
):
    """Capture a new restore point of the current state.

    Returns as soon as the capture starts — a full database dump takes time, and
    the deploy-service streams progress to the UI over its websocket. The new row
    appears in the list once the dump finishes.
    """
    label = str((payload or {}).get("label") or "").strip()[:200]
    result = await svc.create_snapshot(current_user, label=label, trigger_source="manual")

    if not result.get("ok"):
        code = result.get("code")
        status = {
            "unreachable": 502,
            "busy": 409,
            "unauthorized": 502,
            "disabled": 503,
            "endpoint_missing": 503,
        }.get(code, 502)
        raise HTTPException(status_code=status, detail=result.get("error") or "Could not start the restore point.")

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="restore_point",
        action="create",
        record_identifier=label or "(auto)",
        new_values={"label": label, "trigger_source": "manual"},
    )
    return {
        "success": True,
        "message": "Restore point capture started. It will appear in the list once the database dump finishes.",
    }


@router.post("/{snapshot_id}/restore", status_code=202)
async def restore_restore_point(
    snapshot_id: str,
    payload: Optional[dict] = Body(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("restore_point.restore")),
):
    """Roll the whole system back to a restore point.

    Destroys everything created after the snapshot: the database is replaced
    wholesale, the code is reset to the captured commit, and the services are
    rebuilt and restarted. Requires `confirm: true` in the body so an accidental
    double-click cannot trigger it.
    """
    _require_admin_for_restore(current_user)

    payload = payload or {}
    if payload.get("confirm") is not True:
        raise HTTPException(
            status_code=400,
            detail="Rolling back is destructive. Send confirm: true to proceed.",
        )
    if not svc.is_safe_snapshot_id(snapshot_id):
        raise HTTPException(status_code=400, detail="Invalid restore point id")

    manifest = await svc.get_manifest(snapshot_id)
    if manifest is None:
        raise HTTPException(status_code=404, detail="Restore point not found")

    layers = {
        "code": payload.get("include_code", True) is not False,
        "database": payload.get("include_database", True) is not False,
        "config": payload.get("include_config", True) is not False,
    }
    if not any(layers.values()):
        raise HTTPException(
            status_code=400,
            detail="Select at least one layer to restore (code, database or config).",
        )

    result = await svc.start_rollback(current_user, snapshot_id, layers)
    if not result.get("ok"):
        code = result.get("code")
        status = {
            "unreachable": 502,
            "busy": 409,
            "not_found": 404,
            "invalid_id": 400,
            "unauthorized": 502,
            "disabled": 503,
        }.get(code, 502)
        raise HTTPException(status_code=status, detail=result.get("error") or "Could not start the rollback.")

    await svc.mark_restored(db, snapshot_id, current_user.id)
    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="restore_point",
        action="restore",
        record_identifier=snapshot_id,
        old_values={"git_sha": manifest.get("git_sha")},
        new_values={
            "restored_to": snapshot_id,
            "target_commit": manifest.get("git_short_sha"),
            "layers": layers,
        },
    )
    return {
        "success": True,
        "message": (
            "Rollback started. The database, code and configuration are being reverted, "
            "then the services are rebuilt and restarted. This takes a few minutes."
        ),
        "snapshot_id": snapshot_id,
    }


@router.post("/cancel")
async def cancel_running_operation(
    current_user: User = Depends(has_permission("restore_point.restore")),
):
    """Stop a running snapshot or rollback."""
    _require_admin_for_restore(current_user)
    result = await svc.cancel_operation(current_user)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error") or "Could not cancel the operation.")
    return {"success": True, "message": "Cancellation requested."}


@router.delete("/{snapshot_id}")
async def delete_restore_point(
    snapshot_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("restore_point.delete")),
):
    """Delete a restore point and its artifacts.

    Refuses to remove the last remaining restore point — with nothing left there
    is no way back from the next bad deploy.
    """
    if not svc.is_safe_snapshot_id(snapshot_id):
        raise HTTPException(status_code=400, detail="Invalid restore point id")

    deleted = await svc.delete_restore_point(db, snapshot_id, current_user.id)
    if not deleted:
        raise HTTPException(
            status_code=400,
            detail="Could not delete this restore point. It may be the last one, or already removed.",
        )

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="restore_point",
        action="delete",
        record_identifier=snapshot_id,
    )
    return {"success": True, "message": "Restore point deleted."}
