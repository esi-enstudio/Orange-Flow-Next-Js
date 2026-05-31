from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.Routers.deps import get_db, has_permission, has_any_permission
from app.Schemas.role import RoleSchema, RoleCreate, PermissionSchema, PermissionCreate
from app.Models.role import Role, Permission

router = APIRouter(prefix="/api", tags=["roles & permissions"])

@router.get("/permissions", response_model=list[PermissionSchema])
async def list_permissions(db: AsyncSession = Depends(get_db), current_user = Depends(has_permission("view_permissions"))):
    result = await db.execute(select(Permission).order_by(Permission.name))
    return result.scalars().all()

@router.post("/permissions", response_model=PermissionSchema)
async def create_permission(perm_data: PermissionCreate, db: AsyncSession = Depends(get_db), current_user = Depends(has_permission("create_permissions"))):
    existing = (await db.execute(select(Permission).where(Permission.name == perm_data.name))).scalar_one_or_none()
    if existing: raise HTTPException(status_code=400, detail="Permission already exists")
    new_perm = Permission(name=perm_data.name)
    db.add(new_perm)
    await db.commit()
    await db.refresh(new_perm)
    return new_perm

@router.delete("/permissions/{perm_id}")
async def delete_permission(perm_id: int, db: AsyncSession = Depends(get_db), current_user = Depends(has_permission("delete_permissions"))):
    result = await db.execute(select(Permission).where(Permission.id == perm_id))
    perm = result.scalar_one_or_none()
    if not perm: raise HTTPException(status_code=404, detail="Permission not found")
    await db.delete(perm)
    await db.commit()
    return {"message": "Permission deleted successfully"}

@router.get("/roles", response_model=list[RoleSchema])
async def list_roles(db: AsyncSession = Depends(get_db), current_user = Depends(has_any_permission(["view_roles", "view_users", "edit_users"]))):
    result = await db.execute(select(Role).order_by(Role.id))
    return result.scalars().all()

@router.post("/roles", response_model=RoleSchema)
async def create_role(role_data: RoleCreate, db: AsyncSession = Depends(get_db), current_user = Depends(has_permission("create_roles"))):
    existing = (await db.execute(select(Role).where(Role.name == role_data.name))).scalar_one_or_none()
    if existing: raise HTTPException(status_code=400, detail="Role already exists")
    new_role = Role(name=role_data.name)
    if role_data.permissions:
        perms = await db.execute(select(Permission).where(Permission.id.in_(role_data.permissions)))
        new_role.permissions = perms.scalars().all()
    db.add(new_role)
    await db.commit()
    await db.refresh(new_role)
    return new_role

@router.put("/roles/{role_id}", response_model=RoleSchema)
async def update_role(role_id: int, role_data: RoleCreate, db: AsyncSession = Depends(get_db), current_user = Depends(has_permission("edit_roles"))):
    result = await db.execute(select(Role).where(Role.id == role_id))
    role = result.scalar_one_or_none()
    if not role: raise HTTPException(status_code=404, detail="Role not found")
    role.name = role_data.name
    perms = await db.execute(select(Permission).where(Permission.id.in_(role_data.permissions)))
    role.permissions = perms.scalars().all()
    await db.commit()
    await db.refresh(role)
    return role

@router.delete("/roles/{role_id}")
async def delete_role(role_id: int, db: AsyncSession = Depends(get_db), current_user = Depends(has_permission("delete_roles"))):
    result = await db.execute(select(Role).where(Role.id == role_id))
    role = result.scalar_one_or_none()
    if not role: raise HTTPException(status_code=404, detail="Role not found")
    if role.name.lower() == "super admin":
        raise HTTPException(status_code=400, detail="Super Admin role cannot be deleted")
    await db.delete(role)
    await db.commit()
    return {"message": "Role deleted successfully"}
