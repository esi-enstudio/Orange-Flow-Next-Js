import os
import uuid
import io
from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from PIL import Image
from pydantic import EmailStr

from config.settings import settings
from app.routers.deps import (
    get_db, get_current_user, has_permission,
    verify_password, get_password_hash, create_access_token,
    create_password_reset_token, verify_password_reset_token,
    check_login_rate_limit
)
from pydantic import BaseModel
from app.schemas.auth import Token, ProfileUpdate

class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str
from app.schemas.user import UserSchema, UserCreate
from app.schemas.role import RoleSchema
from app.schemas.house import HouseSchema
from app.models.user import User
from app.models.role import Role
from app.models.house import House
from app.services.user_employee import ensure_supervisor_employee, conflict_detail
from app.utils.activity_logger import log_activity
from app.utils.validation import validate_image, MAX_FILE_SIZE
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

@router.post("/register", response_model=UserSchema)
async def register(
    user_data: UserCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("users.create")),
):
    username_exists = await db.execute(select(User).where(User.username == user_data.username))
    if username_exists.scalar_one_or_none():
        raise HTTPException(status_code=409, detail={
            "code": "username_already_used",
            "message": "Username is already taken",
            "fields": {"username": "Username is already taken"},
        })

    if user_data.email:
        email_exists = await db.execute(select(User).where(User.email == user_data.email))
        if email_exists.scalar_one_or_none():
            raise HTTPException(status_code=409, detail={
                "code": "email_already_used",
                "message": "Email is already used by another user",
                "fields": {"email": "Email is already used by another user"},
            })

    new_user = User(
        username=user_data.username,
        hashed_password=get_password_hash(user_data.password),
        name=user_data.name,
        email=user_data.email,
        phone_number=user_data.phone_number,
        telegram_id=user_data.telegram_id,
        parent_id=user_data.parent_id,
        status="Active"
    )

    if user_data.role_ids:
        roles_res = await db.execute(select(Role).where(Role.id.in_(user_data.role_ids)))
        new_user.roles = roles_res.scalars().all()
    if user_data.house_ids:
        houses_res = await db.execute(select(House).where(House.id.in_(user_data.house_ids)))
        new_user.houses = houses_res.scalars().all()

    db.add(new_user)

    try:
        # flush() assigns new_user.id so the supervisor profile (created below in
        # the same transaction) can be persisted atomically with the user.
        await db.flush()
        # Auto-create an Employee profile when the user holds a Supervisor role.
        if any("supervisor" in role.name.lower() for role in new_user.roles):
            await ensure_supervisor_employee(db, new_user)
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail=conflict_detail(exc)) from exc

    await db.refresh(new_user)

    try:
        await log_activity(
            db=db,
            user_id=current_user.id,
            user_name=current_user.name or current_user.username,
            module="user",
            action="create",
            record_id=new_user.id,
            record_identifier=new_user.username or new_user.email,
            old_values=None,
            new_values={
                "username": new_user.username,
                "name": new_user.name,
                "email": new_user.email,
                "phone_number": new_user.phone_number,
                "telegram_id": new_user.telegram_id,
                "status": new_user.status,
                "parent_id": new_user.parent_id,
                "role_ids": [r.id for r in new_user.roles],
                "house_ids": [h.id for h in new_user.houses],
            },
            request=request,
            status_code=201,
        )
    except Exception as log_exc:
        logger.warning(f"Activity log failed for user create ({new_user.id}): {log_exc}")

    return new_user

@router.post("/login", response_model=Token)
async def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    client_ip = request.client.host if request.client else "unknown"
    check_login_rate_limit(client_ip)
    result = await db.execute(select(User).where(User.username == form_data.username))
    user = result.scalar_one_or_none()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect username or password")
    access_token = create_access_token(data={"sub": str(user.id)})
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/me", response_model=UserSchema)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user

@router.put("/profile", response_model=UserSchema)
async def update_profile(
    profile_data: ProfileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if profile_data.name is not None: current_user.name = profile_data.name
    if profile_data.email is not None: current_user.email = profile_data.email
    if profile_data.phone_number is not None: current_user.phone_number = profile_data.phone_number
    if profile_data.telegram_id is not None: current_user.telegram_id = profile_data.telegram_id
    if profile_data.password:
        current_user.hashed_password = get_password_hash(profile_data.password)
    await db.commit()
    await db.refresh(current_user)
    return current_user

@router.post("/profile-pic")
async def upload_profile_pic(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    filename = file.filename or "image.jpg"
    if not validate_image(filename):
        raise HTTPException(status_code=400, detail="Invalid file type. Only JPG, JPEG, and PNG files are allowed.")
    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 50 MB.")
    image = Image.open(io.BytesIO(contents))
    if image.mode in ("RGBA", "P"):
        image = image.convert("RGB")
    max_size = (800, 800)
    image.thumbnail(max_size, Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=85, optimize=True)
    file_name = f"{uuid.uuid4()}.jpg"
    file_path = f"uploads/profile_pics/{file_name}"
    with open(file_path, "wb") as f:
        f.write(buffer.getvalue())
    if current_user.profile_pic:
        old_path = current_user.profile_pic
        if old_path.startswith('/'):
            old_path = old_path[1:]
        if os.path.exists(old_path):
            try:
                os.remove(old_path)
            except OSError:
                logger.warning(f"Failed to delete old profile pic: {old_path}")
    current_user.profile_pic = f"/uploads/profile_pics/{file_name}"
    await db.commit()
    await db.refresh(current_user)
    return {"url": current_user.profile_pic}


# --- Password Reset ---

@router.post("/forgot-password")
async def forgot_password(req: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()
    if not user:
        return {"message": "If the email exists, a reset link has been sent."}

    token = create_password_reset_token(user.id)
    reset_link = f"{settings.APP_URL}/reset-password?token={token}"

    from app.utils.email import send_email, build_reset_email
    sent = send_email(
        to_email=user.email,
        subject="OrangeFlow — Password Reset",
        html_body=build_reset_email(reset_link, user.name or user.username or "User"),
    )

    logger.info(f"Password reset token for {user.email}: {token}")
    logger.info(f"Reset link: {reset_link}")

    if not sent:
        logger.warning("SMTP not configured — link only available in logs.")

    return {"message": "If the email exists, a reset link has been sent."}


@router.post("/reset-password")
async def reset_password(req: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    user_id = verify_password_reset_token(req.token)
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token.")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=400, detail="User not found.")

    if len(req.new_password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters.")

    user.hashed_password = get_password_hash(req.new_password)
    await db.commit()
    return {"message": "Password reset successfully. You can now log in with your new password."}
