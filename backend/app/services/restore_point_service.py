"""Restore Point service — the backend half of the rollback feature.

Division of labour with the deploy-service (see `deploy-service/snapshot.sh`):

    deploy-service   executes everything: git capture/reset, .env copies,
                     pg_dump / pg_restore, the rebuild and the service restarts.
                     It is the only process that can see the repo, the docker
                     socket and the database at the same time.

    backend (here)   owns identity and safety: permissions, the `restore_points`
                     registry, the audit trail, and the confirmation rules
                     around a destructive rollback.

The artifacts live on a host bind mount that BOTH services can see:

    host      backend/backups/restore_points/<snapshot_id>/
    backend   /app/backups/restore_points/<snapshot_id>/
    deploy    /project/backend/backups/restore_points/<snapshot_id>/

Because a rollback runs `pg_restore --clean`, it replaces the whole database —
including the `restore_points` table. The registry is therefore treated as a
cache that is always merged with (and can be rebuilt from) the on-disk
`manifest.json` files. See `list_restore_points`.
"""

import logging
import shutil
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.restore_point import RestorePoint
from app.models.user import User
from app.utils.timezone import now_naive
from config.settings import settings

logger = logging.getLogger(__name__)

# Same directory the deploy-service writes to (shared host bind mount).
BACKUP_DIR = "/app/backups"
RESTORE_POINT_DIR = f"{BACKUP_DIR}/restore_points"

TS_FMT = "%Y%m%d_%H%M%S"

# Timeout budget. Creating a restore point dumps the whole database and a
# rollback additionally rebuilds the frontend, so both are slow but bounded.
REQUEST_TIMEOUT = 30.0
LIST_TIMEOUT = 15.0

# A snapshot id reaches the filesystem, so it is validated against a strict
# allowlist before being used to build a path.
_SAFE_ID_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")


def is_safe_snapshot_id(snapshot_id: str) -> bool:
    return bool(snapshot_id) and len(snapshot_id) <= 64 and set(snapshot_id) <= _SAFE_ID_CHARS


# ── deploy-service client ───────────────────────────────────────────────────


def _base_url() -> str:
    return settings.DEPLOY_SERVICE_URL.rstrip("/")


async def _mint_ticket(user: User) -> str:
    """Mint a short-lived admin deploy ticket for the deploy-service.

    Same mechanism as `POST /api/v1/deploy/authorize`: the deploy-service cannot
    query the database for roles, so it trusts a signed, 60-second claim that
    only this backend can mint.
    """
    from datetime import timedelta

    from jose import jwt as jose_jwt

    from app.utils.timezone import utc_now

    return jose_jwt.encode(
        {
            "sub": str(user.id),
            "type": "deploy",
            "admin": True,
            "exp": utc_now() + timedelta(minutes=1),
        },
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )


async def _call(
    path: str,
    *,
    method: str = "GET",
    payload: Optional[dict] = None,
    ticket: Optional[str] = None,
    timeout: float = REQUEST_TIMEOUT,
) -> Dict[str, Any]:
    """Call the deploy-service, normalising every failure mode.

    The deploy-service is a separate container that may be down, still building
    its old image, or blocked on a running deploy. All of those are reported to
    the caller as a structured `{"ok": False, "error": ...}` instead of an
    exception, so the API can answer with a meaningful 502/409.
    """
    url = f"{_base_url()}{path}"
    headers = {"Content-Type": "application/json"}
    if ticket:
        headers["X-Deploy-Ticket"] = ticket

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.request(method, url, headers=headers, json=payload)
    except httpx.TimeoutException:
        logger.warning("deploy-service timed out on %s %s", method, path)
        return {"ok": False, "error": "The deploy service did not respond in time.", "code": "unreachable"}
    except httpx.HTTPError as e:
        logger.warning("deploy-service request failed on %s %s: %s", method, path, e)
        return {
            "ok": False,
            "error": "The deploy service is unreachable. It may be restarting.",
            "code": "unreachable",
        }

    if response.status_code == 401:
        return {"ok": False, "error": "Deploy service rejected the authorization ticket.", "code": "unauthorized"}
    if response.status_code == 404:
        # Two very different 404s land here and the body tells them apart:
        #   - {"error": "Not found"}                  -> the deploy-service is
        #     running an image that predates the restore-point routes. Nothing
        #     is wrong with the request; the service just needs a rebuild.
        #   - {"error": "Restore point not found", ..} -> a real missing
        #     snapshot, only ever returned by the rollback routes.
        # Collapsing both into "Restore point not found" made a stale image look
        # like a missing snapshot, which is what the Create button was reporting.
        detail = _safe_json(response).get("error") or ""
        if detail.lower() == "restore point not found":
            return {"ok": False, "error": "Restore point not found.", "code": "not_found"}
        return {
            "ok": False,
            "error": (
                "The deploy service is running an older image that does not support "
                "restore points. Rebuild the deploy service to enable this action."
            ),
            "code": "endpoint_missing",
        }
    if response.status_code == 409:
        detail = _safe_json(response).get("error") or "Another operation is already running."
        return {"ok": False, "error": detail, "code": "busy"}
    if response.status_code >= 400:
        detail = _safe_json(response).get("error") or f"Deploy service returned {response.status_code}."
        return {"ok": False, "error": detail, "code": "deploy_service_error"}

    return _safe_json(response)


def _safe_json(response: httpx.Response) -> Dict[str, Any]:
    try:
        data = response.json()
        return data if isinstance(data, dict) else {}
    except ValueError:
        return {}


async def list_manifests() -> Dict[str, Any]:
    """Read every manifest from the deploy-service (or from disk if it is down)."""
    result = await _call("/api/restore-point/list", timeout=LIST_TIMEOUT)
    if result.get("ok") is False and result.get("code") == "unreachable":
        return {"reachable": False, "snapshots": [], "keep": None, "error": result.get("error")}
    if result.get("ok") is False and result.get("code") == "endpoint_missing":
        # Deploy service is up but too old to serve this route. Say so explicitly
        # instead of reporting an empty list, which reads as "nothing captured".
        return {
            "reachable": False,
            "endpoint_missing": True,
            "snapshots": [],
            "keep": None,
            "error": result.get("error"),
        }
    return {
        "reachable": True,
        "snapshots": result.get("snapshots") or [],
        "keep": result.get("keep"),
        "deployed_sha": result.get("deployed_sha") or "",
    }


def _manifests_from_disk() -> List[Dict[str, Any]]:
    """Fallback listing straight off the shared mount.

    The backend and the deploy-service see the same directory, so the backend can
    still show the restore point list when the deploy-service container is down.
    """
    import json
    import os

    items: List[Dict[str, Any]] = []
    try:
        names = sorted(os.listdir(RESTORE_POINT_DIR), reverse=True)
    except OSError:
        return items

    for name in names:
        manifest_path = os.path.join(RESTORE_POINT_DIR, name, "manifest.json")
        if not os.path.isfile(manifest_path):
            continue
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
        except (OSError, ValueError):
            continue
        manifest["snapshot_id"] = manifest.get("snapshot_id") or name
        manifest["has_restore_result"] = os.path.isfile(
            os.path.join(RESTORE_POINT_DIR, name, "restore-result.json")
        )
        items.append(manifest)
    return items


async def deploy_service_status() -> Dict[str, Any]:
    """Live state of any running snapshot / rollback."""
    return await _call("/api/restore-point/status", timeout=LIST_TIMEOUT)


async def create_snapshot(user: User, label: str = "", trigger_source: str = "manual") -> Dict[str, Any]:
    """Ask the deploy-service to capture a restore point.

    Returns as soon as the capture has been *started* — a database dump takes
    time, and the deploy-service streams the progress over its own websocket,
    which the UI is already connected to.
    """
    if not settings.RESTORE_POINTS_ENABLED:
        return {"ok": False, "error": "Restore points are disabled on this server.", "code": "disabled"}
    if trigger_source not in ("manual", "auto_deploy"):
        trigger_source = "manual"

    ticket = await _mint_ticket(user)
    result = await _call(
        "/api/restore-point/capture",
        method="POST",
        payload={"label": (label or "").strip()[:200], "trigger_source": trigger_source},
        ticket=ticket,
    )
    if result.get("ok"):
        logger.info("Restore point capture queued by %s (%s)", user.username, trigger_source)
    return result


async def start_rollback(user: User, snapshot_id: str, layers: Dict[str, bool]) -> Dict[str, Any]:
    """Roll the whole system back to `snapshot_id`."""
    if not settings.RESTORE_POINTS_ENABLED:
        return {"ok": False, "error": "Restore points are disabled on this server.", "code": "disabled"}
    if not is_safe_snapshot_id(snapshot_id):
        return {"ok": False, "error": "Invalid restore point id.", "code": "invalid_id"}

    ticket = await _mint_ticket(user)
    result = await _call(
        "/api/restore-point/rollback",
        method="POST",
        payload={
            "snapshot_id": snapshot_id,
            "include_code": layers.get("code", True),
            "include_database": layers.get("database", True),
            "include_config": layers.get("config", True),
        },
        ticket=ticket,
    )
    if result.get("ok"):
        logger.warning("ROLLBACK started by %s -> %s", user.username, snapshot_id)
    return result


async def cancel_operation(user: User) -> Dict[str, Any]:
    ticket = await _mint_ticket(user)
    return await _call("/api/restore-point/cancel", method="POST", ticket=ticket)


# ── Registry ────────────────────────────────────────────────────────────────


def _manifest_to_row_fields(manifest: Dict[str, Any]) -> Dict[str, Any]:
    """Map an on-disk manifest onto the registry columns."""
    config_files = manifest.get("config_files") or ""
    return {
        "git_sha": manifest.get("git_sha"),
        "git_short_sha": manifest.get("git_short_sha"),
        "git_branch": manifest.get("git_branch"),
        "git_subject": (manifest.get("git_subject") or None),
        "git_dirty_files": int(manifest.get("git_dirty_files") or 0),
        "has_database_dump": bool(manifest.get("has_database_dump")),
        "database_size": int(manifest.get("database_size") or 0),
        "config_files": config_files or None,
        "total_size": int(manifest.get("total_size") or 0),
        "status": manifest.get("status") or "success",
    }


def _serialize(
    manifest: Dict[str, Any],
    row: Optional[RestorePoint],
    *,
    deployed: bool = False,
) -> Dict[str, Any]:
    """Merge the on-disk manifest with its registry row.

    The manifest is the source of truth for *what is restorable*; the row adds
    who created it, its label and the audit trail. A snapshot with no row is
    still listed — that is exactly the state after a rollback has rewound the
    database — but it is flagged `registered: false`.
    """
    snapshot_id = manifest.get("snapshot_id")
    data = {
        "snapshot_id": snapshot_id,
        "label": (row.label if row and row.label else manifest.get("label") or ""),
        "trigger_source": (row.trigger_source if row else manifest.get("trigger_source") or "unknown"),
        "created_at": manifest.get("created_at"),
        "git_sha": manifest.get("git_sha"),
        "git_short_sha": manifest.get("git_short_sha"),
        "git_branch": manifest.get("git_branch"),
        "git_subject": manifest.get("git_subject"),
        "git_dirty_files": manifest.get("git_dirty_files") or 0,
        "has_database_dump": bool(manifest.get("has_database_dump")),
        "database_size": manifest.get("database_size") or 0,
        "config_files": [f for f in (manifest.get("config_files") or "").split(",") if f],
        "total_size": manifest.get("total_size") or 0,
        "status": manifest.get("status") or "success",
        "registered": row is not None,
        "is_deployed": deployed,
        "can_restore": bool(snapshot_id) and is_safe_snapshot_id(str(snapshot_id)),
        "created_by": row.created_by if row else None,
        "created_by_name": (row.creator.name if row and row.creator else None),
        "restored_at": row.restored_at.isoformat() if row and row.restored_at else None,
        "restored_by_name": (row.restorer.name if row and row.restorer else None),
        "has_restore_result": bool(manifest.get("has_restore_result")),
    }
    if row and row.id:
        data["id"] = row.id
    return data


async def _registry_rows(db: AsyncSession) -> Dict[str, RestorePoint]:
    result = await db.execute(
        select(RestorePoint)
        .options(selectinload(RestorePoint.creator), selectinload(RestorePoint.restorer))
        .where(RestorePoint.is_deleted.is_(False))
    )
    return {row.snapshot_id: row for row in result.scalars().all()}


async def _current_deployed_sha(live: Optional[Dict[str, Any]] = None) -> str:
    """The commit the system is running right now, for the 'Currently deployed' badge.

    The deploy container has the repo mounted, so it can answer this exactly and
    does so on every list. Only if the deploy service is unreachable do we fall
    back to the newest manifest, which is a guess: it is wrong after a deploy
    that skipped capture, and after a rollback of a *non*-newest restore point.
    """
    if live and live.get("reachable"):
        sha = (live.get("deployed_sha") or "").strip()
        if sha:
            return sha
        return ""  # service answered authoritatively: nothing is checked out
    for manifest in _manifests_from_disk():
        if manifest.get("git_sha"):
            return manifest["git_sha"]
    return ""


async def list_restore_points(
    db: AsyncSession,
    *,
    page: int = 1,
    per_page: int = 20,
    search: str = "",
) -> Dict[str, Any]:
    """Paginated list of restore points, newest first."""
    live = await list_manifests()
    manifests = live["snapshots"] if live.get("reachable") else _manifests_from_disk()
    reachable = bool(live.get("reachable"))

    rows = await _registry_rows(db)
    deployed_sha = await _current_deployed_sha(live)

    # Self-healing registration. Snapshots taken by `deploy.sh` never come
    # through this backend, and a database rollback rewinds the registry, so on
    # every list we adopt any manifest that has no row yet. `created_by` stays
    # null for those: the deploy ran as a system process, not as a user action.
    for manifest in manifests:
        snapshot_id = manifest.get("snapshot_id")
        if not snapshot_id or snapshot_id in rows:
            continue
        if manifest.get("status") not in (None, "success"):
            continue
        adopted = await register_snapshot(
            db,
            manifest,
            user_id=None,
            label=str(manifest.get("label") or ""),
            trigger_source=str(manifest.get("trigger_source") or "auto_deploy"),
        )
        if adopted is not None:
            rows[snapshot_id] = adopted

    items = [_serialize(m, rows.get(m.get("snapshot_id")), deployed=bool(deployed_sha) and m.get("git_sha") == deployed_sha) for m in manifests]
    # Any registry row whose directory vanished (deleted from disk outside the
    # UI) must not linger in the list as a phantom.
    known_ids = {str(m.get("snapshot_id")) for m in manifests}
    for snapshot_id, row in rows.items():
        if snapshot_id not in known_ids:
            items.append(_serialize({"snapshot_id": snapshot_id, "status": "missing"}, row))

    if search:
        needle = search.strip().lower()
        items = [
            i
            for i in items
            if needle in (i.get("label") or "").lower()
            or needle in (i.get("git_subject") or "").lower()
            or needle in (i.get("git_short_sha") or "").lower()
            or needle in (i.get("snapshot_id") or "").lower()
        ]

    items.sort(key=lambda i: str(i.get("snapshot_id") or ""), reverse=True)

    total = len(items)
    total_pages = (total + per_page - 1) // per_page if per_page else 0
    start = (page - 1) * per_page
    return {
        "success": True,
        "data": items[start : start + per_page],
        "pagination": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "total_pages": total_pages,
            "has_next": page < total_pages,
            "has_prev": page > 1,
        },
        "meta": {
            "deploy_service_reachable": reachable,
            "deploy_service_outdated": bool(live.get("endpoint_missing")),
            "error": live.get("error"),
            "keep": live.get("keep"),
            "enabled": settings.RESTORE_POINTS_ENABLED,
            "deployed_sha": deployed_sha,
        },
    }


async def register_snapshot(
    db: AsyncSession,
    manifest: Dict[str, Any],
    *,
    user_id: Optional[int],
    label: str = "",
    trigger_source: str = "manual",
) -> Optional[RestorePoint]:
    """Insert or refresh the registry row for a manifest that was just written.

    Called by the polling `GET` after a capture finishes, so the registry fills
    in even for snapshots taken by `deploy.sh` (whose request never came through
    this backend).
    """
    snapshot_id = manifest.get("snapshot_id")
    if not snapshot_id or not is_safe_snapshot_id(str(snapshot_id)):
        return None

    existing = (
        await db.execute(select(RestorePoint).where(RestorePoint.snapshot_id == snapshot_id))
    ).scalar_one_or_none()

    fields = _manifest_to_row_fields(manifest)

    if existing:
        for key, value in fields.items():
            setattr(existing, key, value)
        if label and not existing.label:
            existing.label = label[:200]
        await db.commit()
        return existing

    row = RestorePoint(
        snapshot_id=snapshot_id,
        label=(label or manifest.get("label") or "")[:200] or None,
        trigger_source=trigger_source if trigger_source in ("manual", "auto_deploy") else "manual",
        created_by=user_id,
        **fields,
    )
    db.add(row)
    try:
        await db.commit()
    except Exception:  # noqa: BLE001 — a duplicate from a concurrent request
        await db.rollback()
        logger.debug("Restore point %s already registered", snapshot_id)
        return None
    await db.refresh(row)
    logger.info("Registered restore point %s", snapshot_id)
    return row


async def get_manifest(snapshot_id: str) -> Optional[Dict[str, Any]]:
    for manifest in await _list_all_manifests():
        if manifest.get("snapshot_id") == snapshot_id:
            return manifest
    return None


async def _list_all_manifests() -> List[Dict[str, Any]]:
    live = await list_manifests()
    if live.get("reachable"):
        return live["snapshots"]
    return _manifests_from_disk()


async def mark_restored(db: AsyncSession, snapshot_id: str, user_id: int) -> None:
    """Record that a rollback was started.

    Written *after* the rollback completes in practice (the DB is replaced during
    the rollback), so this is best-effort bookkeeping: if the row is gone because
    the database was rewound, the on-disk `restore-result.json` remains the
    audit trail.
    """
    row = (
        await db.execute(select(RestorePoint).where(RestorePoint.snapshot_id == snapshot_id))
    ).scalar_one_or_none()
    if row:
        row.restored_at = now_naive()
        row.restored_by = user_id
        await db.commit()


async def delete_restore_point(db: AsyncSession, snapshot_id: str, user_id: int) -> bool:
    """Remove a restore point: soft-delete the row, delete the artifacts.

    Refuses to delete the restore point the system is currently running, and
    refuses outright if it is the only one left — a restore point you cannot roll
    back to is not a safety net.
    """
    if not is_safe_snapshot_id(snapshot_id):
        return False

    row = (
        await db.execute(select(RestorePoint).where(RestorePoint.snapshot_id == snapshot_id))
    ).scalar_one_or_none()
    if row is None:
        return False

    # Never delete the restore point the system is currently running. Deleting
    # the artifacts would leave `is_deployed` pointing at nothing, and rolling
    # back to the live commit mid-deploy is exactly the confusion this feature
    # exists to prevent.
    live = await list_manifests()
    deployed_sha = await _current_deployed_sha(live)
    if deployed_sha and row.git_sha == deployed_sha:
        logger.warning("Refusing to delete the currently deployed restore point %s", snapshot_id)
        return False

    remaining = (
        await db.execute(
            select(RestorePoint).where(
                RestorePoint.is_deleted.is_(False),
                RestorePoint.snapshot_id != snapshot_id,
            )
        )
    ).scalars().all()
    if not remaining:
        logger.warning("Refusing to delete the last restore point %s", snapshot_id)
        return False

    row.is_deleted = True
    row.deleted_at = now_naive()
    row.deleted_by = user_id
    await db.commit()

    target = f"{RESTORE_POINT_DIR}/{snapshot_id}"
    if is_safe_snapshot_id(snapshot_id):
        try:
            shutil.rmtree(target)
        except FileNotFoundError:
            pass
        except OSError as e:
            logger.error("Failed to remove restore point directory %s: %s", target, e)
    return True


def format_size(num_bytes: Optional[int]) -> str:
    """Human readable byte size. Shared by the API and the export label."""
    size = float(num_bytes or 0)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} GB"
