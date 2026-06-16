import os
import shutil
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Query, Response
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.routers.deps import get_db, has_permission, get_house_context
from app.schemas.user import UserSchema, UserUpdate, UserFilterParams
from app.models.user import User
from app.models.role import Role
from app.models.house import House
from app.models.employee import Employee
from app.utils.access_control import is_admin_user
from app.utils.validation import safe_filename, validate_excel
from app.services.Automation.user_excel import process_user_excel, export_users_excel

router = APIRouter(prefix="/api/users", tags=["users"])

@router.get("", response_model=list[UserSchema])
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("users.view")),
    house_id: Optional[int] = Depends(get_house_context),
    unassigned: bool = Query(False),
    filters: UserFilterParams = Depends(),
):
    query = select(User).options(joinedload(User.roles), joinedload(User.houses), joinedload(User.employee_profile))
    is_admin = is_admin_user(current_user)
    if house_id:
        query = query.join(User.houses).where(House.id == house_id)
    elif is_admin:
        pass
    else:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.join(User.houses).where(House.id.in_(user_house_ids))
        else:
            query = query.join(User.houses).where(House.id == -1)
    if unassigned:
        subq = select(Employee.user_id).where(Employee.user_id.isnot(None))
        query = query.where(~User.id.in_(subq))

    # --- Master filter logic ---
    if filters.search:
        pattern = f"%{filters.search}%"
        query = query.where(
            User.name.ilike(pattern) |
            User.username.ilike(pattern) |
            User.email.ilike(pattern) |
            User.phone_number.ilike(pattern) |
            User.telegram_id.cast(type=str).ilike(pattern)
        )
    if filters.status:
        query = query.where(User.status == filters.status)
    if filters.role_ids:
        query = query.where(User.roles.any(Role.id.in_(filters.role_ids)))
    if filters.house_ids:
        query = query.where(User.houses.any(House.id.in_(filters.house_ids)))
    if filters.parent_id is not None:
        query = query.where(User.parent_id == filters.parent_id)
    if filters.phone_number:
        query = query.where(User.phone_number.ilike(f"%{filters.phone_number}%"))
    if filters.telegram_id:
        query = query.where(User.telegram_id.cast(type=str).ilike(f"%{filters.telegram_id}%"))
    if filters.has_employee_profile is True:
        query = query.where(User.employee_profile.has())
    elif filters.has_employee_profile is False:
        query = query.where(~User.employee_profile.has())
    if filters.created_from:
        query = query.where(User.created_at >= filters.created_from)
    if filters.created_to:
        query = query.where(User.created_at <= filters.created_to)
    if filters.updated_from:
        query = query.where(User.updated_at >= filters.updated_from)
    if filters.updated_to:
        query = query.where(User.updated_at <= filters.updated_to)
    # --- End filter logic ---

    result = await db.execute(query.order_by(User.id.desc()))
    return result.unique().scalars().all()


@router.get("/filter-options")
async def get_user_filter_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("users.view")),
):
    """Return dynamic filter option lists for the UserMasterFilter component."""
    from sqlalchemy import distinct
    statuses_result = await db.execute(select(distinct(User.status)))
    statuses = [r[0] for r in statuses_result.all() if r[0]]

    roles_result = await db.execute(select(Role).order_by(Role.name))
    roles = [{"id": r.id, "name": r.name} for r in roles_result.scalars().all()]

    parents_result = await db.execute(
        select(User.id, User.name, User.username).where(User.id != current_user.id).order_by(User.name)
    )
    parents = [{"id": r.id, "name": r.name, "username": r.username} for r in parents_result.all()]

    return {
        "statuses": statuses,
        "roles": roles,
        "parents": parents,
    }

@router.put("/{user_id}", response_model=UserSchema)
async def update_user(
    user_id: int,
    user_data: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("users.edit"))
):
    result = await db.execute(
        select(User).options(selectinload(User.roles), selectinload(User.houses))
        .where(User.id == user_id)
    )
    user = result.unique().scalar_one_or_none()
    if not user: raise HTTPException(status_code=404, detail="User not found")
    if user_data.username is not None and user_data.username != user.username:
        existing = await db.execute(select(User).where(User.username == user_data.username))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Username already taken")
        user.username = user_data.username
    if user_data.name is not None: user.name = user_data.name
    if user_data.email is not None: user.email = user_data.email
    if user_data.phone_number is not None: user.phone_number = user_data.phone_number
    if user_data.telegram_id is not None: user.telegram_id = user_data.telegram_id
    if user_data.status is not None: user.status = user_data.status
    if user_data.parent_id is not None: user.parent_id = user_data.parent_id
    if user_data.password:
        from app.routers.deps import get_password_hash
        user.hashed_password = get_password_hash(user_data.password)
    if user_data.role_ids is not None:
        roles_result = await db.execute(select(Role).where(Role.id.in_(user_data.role_ids)))
        user.roles = list(roles_result.scalars().all())
    if user_data.house_ids is not None:
        houses_result = await db.execute(select(House).where(House.id.in_(user_data.house_ids)))
        user.houses = list(houses_result.scalars().all())
    await db.commit()
    await db.refresh(user)
    for role in user.roles:
        if "supervisor" in role.name.lower():
            existing_emp = (await db.execute(select(Employee).where(Employee.user_id == user.id))).scalar_one_or_none()
            if not existing_emp:
                first_house = user.houses[0] if user.houses else (await db.execute(select(House).limit(1))).scalar_one_or_none()
                if first_house:
                    from app.routers.deps import get_password_hash
                    emp = Employee(
                        user_id=user.id,
                        house_id=first_house.id,
                        dms_code=f"SUP-{user.id}",
                        type="Supervisor",
                        status="Active"
                    )
                    db.add(emp)
                    await db.commit()
            break
    return user

@router.delete("/{user_id}")
async def delete_user(user_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("users.delete"))):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user: raise HTTPException(status_code=404, detail="User not found")
    await db.delete(user)
    await db.commit()
    return {"message": "User deleted successfully"}

@router.post("/import")
async def import_users(file: UploadFile = File(...), db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("users.import"))):
    if not os.path.exists("temp_downloads"): os.makedirs("temp_downloads")
    filename = file.filename or "upload.xlsx"
    if not validate_excel(filename):
        raise HTTPException(status_code=400, detail="Invalid file type. Only .xlsx and .xls files are allowed.")
    file_path = f"temp_downloads/{safe_filename(filename)}"
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        success, errors, error_msg = await process_user_excel(file_path)
        if error_msg: raise HTTPException(status_code=400, detail=error_msg)
        return {"message": f"Successfully imported {success} users. Failed: {errors}", "success_count": success, "error_count": errors}
    finally:
        if os.path.exists(file_path): os.remove(file_path)

@router.get("/export")
async def export_users(db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("users.export"))):
    query = select(User).options(joinedload(User.roles), joinedload(User.houses))
    result = await db.execute(query.order_by(User.id.desc()))
    users = result.unique().scalars().all()
    excel_data = await export_users_excel(users)
    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=users_export.xlsx"}
    )
