import json
from pathlib import Path

from sqlalchemy import select

from app.models.role import Role
from app.services.permission_sync import sync_permissions_from_config

CONFIG = json.loads(
    (Path(__file__).resolve().parents[1] / "config" / "permissions.json").read_text(
        encoding="utf-8"
    )
)
CONFIGURED_PERMISSIONS = [
    permission
    for module in CONFIG["modules"].values()
    for permission in module["permissions"]
]


async def test_sync_permissions_seeds_missing_permission_and_is_idempotent(db):
    first = await sync_permissions_from_config(db)

    assert first["total_permissions"] == len(CONFIGURED_PERMISSIONS)
    assert set(first["permissions_added"]) == set(CONFIGURED_PERMISSIONS)

    second = await sync_permissions_from_config(db)

    assert second["permissions_added"] == []
    assert second["roles_updated"] == []


async def test_sync_permissions_grants_default_role_permissions(db):
    role_config = next(
        role for role in CONFIG["default_roles"] if role.get("permissions")
    )
    role = Role(name=role_config["name"])
    db.add(role)
    await db.commit()

    report = await sync_permissions_from_config(db)

    stored = await db.scalar(select(Role).where(Role.name == role_config["name"]))
    granted = {permission.name for permission in stored.permissions}
    assert set(role_config["permissions"]) <= granted
    assert role_config["name"] in report["roles_updated"]


async def test_sync_permissions_never_removes_a_grant(db):
    from app.models.role import Permission

    role_config = next(
        role
        for role in CONFIG["default_roles"]
        if role.get("permissions") and not role.get("is_admin")
    )
    custom = Permission(name="custom.extra")
    role = Role(name=role_config["name"], permissions=[custom])
    db.add(role)
    await db.commit()

    await sync_permissions_from_config(db)

    stored = await db.scalar(select(Role).where(Role.name == role_config["name"]))
    granted = {permission.name for permission in stored.permissions}
    assert "custom.extra" in granted
    assert set(role_config["permissions"]) <= granted


async def test_boot_sync_does_not_regrant_an_existing_default_permission(db):
    from app.models.role import Permission

    role_config = next(
        role
        for role in CONFIG["default_roles"]
        if role.get("permissions") and not role.get("is_admin")
    )
    already_granted, withheld = role_config["permissions"][0], role_config["permissions"][1]
    db.add(Permission(name=already_granted))
    db.add(Role(name=role_config["name"], permissions=[]))
    await db.commit()

    await sync_permissions_from_config(db)

    stored = await db.scalar(select(Role).where(Role.name == role_config["name"]))
    granted = {permission.name for permission in stored.permissions}
    assert already_granted not in granted
    assert withheld in granted


async def test_endpoint_sync_tops_up_existing_default_permissions(db):
    role_config = next(
        role
        for role in CONFIG["default_roles"]
        if role.get("permissions") and not role.get("is_admin")
    )
    already_granted = role_config["permissions"][0]
    from app.models.role import Permission

    db.add(Permission(name=already_granted))
    db.add(Role(name=role_config["name"], permissions=[]))
    await db.commit()

    await sync_permissions_from_config(db, grant_all_defaults=True)

    stored = await db.scalar(select(Role).where(Role.name == role_config["name"]))
    granted = {permission.name for permission in stored.permissions}
    assert set(role_config["permissions"]) <= granted
