import os
import shutil
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Query, Response, Request
from sqlalchemy import select, delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.routers.deps import get_db, has_permission, get_house_context
from app.schemas.user import UserSchema, UserUpdate, UserFilterParams
from app.models.user import User, user_roles, user_houses
from app.models.role import Role
from app.models.house import House
from app.models.employee import Employee
from app.utils.access_control import is_admin_user
from app.utils.validation import safe_filename, validate_excel
from app.utils.activity_logger import log_activity
from app.services.user_employee import ensure_supervisor_employee, conflict_detail
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
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("users.edit"))
):
    result = await db.execute(
        select(User).options(selectinload(User.roles), selectinload(User.houses))
        .where(User.id == user_id)
    )
    user = result.unique().scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    old_values = {
        "username": user.username,
        "name": user.name,
        "email": user.email,
        "phone_number": user.phone_number,
        "telegram_id": user.telegram_id,
        "status": user.status,
        "parent_id": user.parent_id,
        "role_ids": [r.id for r in user.roles],
        "house_ids": [h.id for h in user.houses],
    }

    # Only apply fields that were explicitly present in the request body.
    fields = user_data.model_fields_set

    try:
        # Username — uniqueness check (case-insensitive)
        if "username" in fields and user_data.username and user_data.username != user.username:
            existing = await db.execute(
                select(User).where(User.username == user_data.username, User.id != user_id)
            )
            if existing.scalar_one_or_none():
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "username_already_used",
                        "message": "Username is already taken",
                        "fields": {"username": "Username is already taken"},
                    },
                )
            user.username = user_data.username

        if "name" in fields and user_data.name is not None:
            user.name = user_data.name

        # Email — uniqueness check + ability to clear (empty string / null clears it)
        if "email" in fields:
            new_email = (user_data.email or "").strip() or None
            if new_email != user.email:
                if new_email is not None:
                    existing = await db.execute(
                        select(User).where(User.email == new_email, User.id != user_id)
                    )
                    if existing.scalar_one_or_none():
                        raise HTTPException(
                            status_code=409,
                            detail={
                                "code": "email_already_used",
                                "message": "Email is already used by another user",
                                "fields": {"email": "Email is already used by another user"},
                            },
                        )
                user.email = new_email

        if "phone_number" in fields and user_data.phone_number is not None:
            user.phone_number = user_data.phone_number

        # Telegram ID — uniqueness check + ability to clear (null clears it)
        if "telegram_id" in fields:
            new_telegram = user_data.telegram_id
            if new_telegram != user.telegram_id:
                if new_telegram is not None:
                    existing = await db.execute(
                        select(User).where(User.telegram_id == new_telegram, User.id != user_id)
                    )
                    if existing.scalar_one_or_none():
                        raise HTTPException(
                            status_code=409,
                            detail={
                                "code": "telegram_id_already_used",
                                "message": "Telegram ID is already used by another user",
                                "fields": {"telegram_id": "Telegram ID is already used by another user"},
                            },
                        )
                user.telegram_id = new_telegram

        if "status" in fields and user_data.status is not None:
            user.status = user_data.status
        if "parent_id" in fields:
            user.parent_id = user_data.parent_id
        if user_data.password:
            from app.routers.deps import get_password_hash
            user.hashed_password = get_password_hash(user_data.password)
        if user_data.role_ids is not None:
            roles_result = await db.execute(select(Role).where(Role.id.in_(user_data.role_ids)))
            user.roles = list(roles_result.scalars().all())
        if user_data.house_ids is not None:
            houses_result = await db.execute(select(House).where(House.id.in_(user_data.house_ids)))
            user.houses = list(houses_result.scalars().all())

        # Auto-create an Employee profile when the user holds a Supervisor role.
        # Added in the SAME transaction so the user update and the employee
        # profile commit atomically — no partial success / misleading error.
        if any("supervisor" in role.name.lower() for role in user.roles):
            await ensure_supervisor_employee(db, user)

        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail=conflict_detail(exc)) from exc

    await db.refresh(user)

    try:
        await log_activity(
            db=db,
            user_id=current_user.id,
            user_name=current_user.name or current_user.username,
            module="user",
            action="edit",
            record_id=user.id,
            record_identifier=user.username or user.email,
            old_values=old_values,
            new_values={
                "username": user.username,
                "name": user.name,
                "email": user.email,
                "phone_number": user.phone_number,
                "telegram_id": user.telegram_id,
                "status": user.status,
                "parent_id": user.parent_id,
                "role_ids": [r.id for r in user.roles],
                "house_ids": [h.id for h in user.houses],
            },
            request=request,
            status_code=200,
        )
    except Exception as log_exc:
        import logging
        logging.getLogger(__name__).warning(f"Activity log failed for user update ({user_id}): {log_exc}")

    return user

@router.delete("/{user_id}")
async def delete_user(
    user_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("users.delete")),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.id == current_user.id:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "cannot_delete_self",
                "message": "You cannot delete your own account",
                "fields": {},
            },
        )

    # A linked Employee profile holds business data (links, performance) —
    # deleting it silently would destroy data. Require unassignment first.
    emp_result = await db.execute(select(Employee.id, Employee.employee_id, Employee.dms_code).where(Employee.user_id == user_id).limit(1))
    emp_row = emp_result.first()
    if emp_row is not None:
        emp_label = emp_row.employee_id or emp_row.dms_code or f"#{user_id}"
        raise HTTPException(
            status_code=409,
            detail={
                "code": "user_has_employee_profile",
                "message": f"Cannot delete user: a linked employee profile ({emp_label}) exists. Unassign the employee first.",
                "fields": {},
            },
        )

    # Block deletion while other users report to this user.
    child_result = await db.execute(select(User.id).where(User.parent_id == user_id).limit(1))
    if child_result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "user_has_subordinates",
                "message": "Cannot delete user: other users report to this user. Reassign them before deleting.",
                "fields": {},
            },
        )

    old_values = {
        "username": user.username,
        "name": user.name,
        "email": user.email,
        "phone_number": user.phone_number,
        "telegram_id": user.telegram_id,
        "status": user.status,
        "parent_id": user.parent_id,
        "role_ids": [r.id for r in user.roles],
        "house_ids": [h.id for h in user.houses],
    }

    try:
        # Clear pivot rows so DB-level FKs don't block the hard delete.
        await db.execute(delete(user_roles).where(user_roles.c.user_id == user_id))
        await db.execute(delete(user_houses).where(user_houses.c.user_id == user_id))
        await db.delete(user)
        await db.commit()

        await log_activity(
            db=db,
            user_id=current_user.id,
            user_name=current_user.name or current_user.username,
            module="user",
            action="delete",
            record_id=user.id,
            record_identifier=user.username or user.email,
            old_values=old_values,
            new_values=None,
            request=request,
            status_code=200,
        )
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail=conflict_detail(exc)) from exc
    except Exception as log_exc:
        import logging
        logging.getLogger(__name__).warning(f"Activity log failed for user delete ({user_id}): {log_exc}")

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
