"""Seed permissions from ``config/permissions.json`` into the database.

The config file is the source of truth for permission keys and for the default
grants of the shipped roles. This module is called on every boot so a deploy
that adds a permission never needs a manual ``POST /admin/sync-permissions``.
"""

import json
import logging
from pathlib import Path
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.role import Permission, Role

logger = logging.getLogger(__name__)

PERMISSIONS_CONFIG_PATH = (
    Path(__file__).resolve().parents[2] / "config" / "permissions.json"
)
# Arbitrary, stable key so parallel workers serialize the startup sync.
PERMISSION_SYNC_LOCK_KEY = 731_940_215


def load_permissions_config() -> dict[str, Any]:
    return json.loads(PERMISSIONS_CONFIG_PATH.read_text(encoding="utf-8"))


async def sync_permissions_from_config(
    db: AsyncSession,
    *,
    grant_all_defaults: bool = False,
) -> dict[str, Any]:
    """Add missing permissions and grant configured defaults.

    Only ever adds: a permission or a role grant is never removed here.
    The caller owns the commit; this function only flushes.

    ``grant_all_defaults=False`` (boot) hands a role only the permission keys
    that this run *created*. Existing keys are never re-granted, because
    ``seed_db.seed_system_data`` guarantees that an existing role's permission
    set is managed from the Roles UI and must survive a restart. The manual
    ``POST /admin/sync-permissions`` endpoint passes ``True`` for the full
    top-up it has always performed.
    """
    config = load_permissions_config()

    bind = db.bind
    if bind is not None and bind.dialect.name == "postgresql":
        await db.execute(
            text("SELECT pg_advisory_xact_lock(:key)"),
            {"key": PERMISSION_SYNC_LOCK_KEY},
        )

    db_perms: dict[str, Permission] = {}
    permissions_added: list[str] = []
    for module in config["modules"].values():
        for permission_name in module["permissions"]:
            permission = await db.scalar(
                select(Permission).where(Permission.name == permission_name)
            )
            if permission is None:
                permission = Permission(name=permission_name)
                db.add(permission)
                permissions_added.append(permission_name)
            db_perms[permission_name] = permission

    await db.flush()

    created_names = set(permissions_added)
    all_permissions = list(db_perms.values())
    roles_updated: list[str] = []
    for role_config in config.get("default_roles", []):
        role = await db.scalar(
            select(Role)
            .options(selectinload(Role.permissions))
            .where(Role.name == role_config["name"])
        )
        if role is None:
            continue

        existing_names = {permission.name for permission in role.permissions}
        if role_config.get("is_admin"):
            wanted = [permission.name for permission in all_permissions]
        else:
            wanted = list(role_config.get("permissions") or [])

        missing = [
            db_perms[permission_name]
            for permission_name in wanted
            if permission_name in db_perms
            and permission_name not in existing_names
            and (grant_all_defaults or permission_name in created_names)
        ]
        if missing:
            role.permissions = list(role.permissions) + missing
            roles_updated.append(role_config["name"])

    await db.flush()

    if permissions_added or roles_updated:
        logger.info(
            "Permissions synced: %d added, roles updated: %s",
            len(permissions_added),
            ", ".join(roles_updated) or "none",
        )

    return {
        "total_permissions": len(db_perms),
        "permissions_added": permissions_added,
        "roles_updated": roles_updated,
    }
