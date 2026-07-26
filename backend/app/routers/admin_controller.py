import json
import os
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.routers.deps import get_db, has_permission, get_current_user
from app.models.role import Role, Permission
from app.models.user import User
from app.utils.access_control import is_admin_user
from app.utils.activity_logger import log_activity

router = APIRouter(prefix="/admin", tags=["Admin"])
logger = logging.getLogger(__name__)


@router.get("/health")
async def health_check():
    return {"status": "ok", "module": "admin"}


@router.post("/sync-permissions")
async def sync_permissions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("permissions.create")),
):
    config_path = os.path.join(os.path.dirname(__file__), '..', '..', 'config', 'permissions.json')
    with open(config_path, 'r', encoding='utf-8') as f:
        config = json.load(f)

    db_perms = {}
    for module_name, module_data in config['modules'].items():
        for perm_name in module_data['permissions']:
            perm_res = await db.execute(select(Permission).where(Permission.name == perm_name))
            perm = perm_res.scalar_one_or_none()
            if not perm:
                perm = Permission(name=perm_name)
                db.add(perm)
                logger.info(f"➕ Added new permission: {perm_name}")
            db_perms[perm_name] = perm

    await db.flush()

    all_perms = list(db_perms.values())
    updated_roles = []

    for role_config in config['default_roles']:
        r_name = role_config['name']
        res = await db.execute(
            select(Role).options(selectinload(Role.permissions)).where(Role.name == r_name)
        )
        role = res.scalar_one_or_none()
        if not role:
            continue

        existing_names = {p.name for p in role.permissions}
        if role_config.get('is_admin'):
            new_perms = [p for p in all_perms if p.name not in existing_names]
            if new_perms:
                role.permissions = all_perms
                updated_roles.append(r_name)
        elif 'permissions' in role_config:
            new_perms = []
            for p_name in role_config['permissions']:
                if p_name in db_perms and p_name not in existing_names:
                    new_perms.append(db_perms[p_name])
            if new_perms:
                role.permissions = list(role.permissions) + new_perms
                updated_roles.append(r_name)

    await db.commit()

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="permissions", action="sync",
        new_values={"permissions_added": len(db_perms), "roles_updated": updated_roles},
    )

    return {
        "success": True,
        "message": "Permissions synced successfully",
        "total_permissions": len(db_perms),
        "roles_updated": updated_roles,
    }
