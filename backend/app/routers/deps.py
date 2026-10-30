import logging
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import Depends, HTTPException, Header, status, Request
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from config.settings import settings
from app.services.db_service import async_session
from app.models.user import User
from app.models.role import Role
from app.models.house import House
from app.utils.access_control import is_admin_user, is_admin_role, is_super_admin_user
from app.utils.timezone import utc_now

logger = logging.getLogger(__name__)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")

LOGIN_RATE_LIMIT = 5
LOGIN_WINDOW_SECONDS = 300
login_attempts: dict = {}

def check_login_rate_limit(ip: str):
    now = utc_now()
    window_start = now - timedelta(seconds=LOGIN_WINDOW_SECONDS)
    if ip in login_attempts:
        login_attempts[ip] = [t for t in login_attempts[ip] if t > window_start]
        if len(login_attempts[ip]) >= LOGIN_RATE_LIMIT:
            raise HTTPException(status_code=429, detail="Too many login attempts. Please try again later.")
    else:
        login_attempts[ip] = []
    login_attempts[ip].append(now)

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = utc_now() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

def create_password_reset_token(user_id: int) -> str:
    expire = utc_now() + timedelta(minutes=settings.PASSWORD_RESET_EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": str(user_id), "type": "password_reset", "exp": expire},
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )

def verify_password_reset_token(token: str) -> Optional[int]:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        if payload.get("type") != "password_reset":
            return None
        return int(payload["sub"])
    except (JWTError, ValueError, KeyError):
        return None

async def get_db():
    async with async_session() as session:
        yield session

async def get_current_user(token: str = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id_str: str = payload.get("sub")
        if user_id_str is None:
            raise credentials_exception
        user_id = int(user_id_str)
    except (JWTError, ValueError):
        raise credentials_exception

    result = await db.execute(
        select(User).options(
            selectinload(User.roles).selectinload(Role.permissions),
            selectinload(User.houses),
            # Async sessions cannot lazy-load; several routers (inventory scope,
            # reports) read the linked employee without an extra query.
            selectinload(User.employee_profile),
        ).where(User.id == user_id)
    )
    user = result.unique().scalar_one_or_none()
    if user is None:
        raise credentials_exception
    return user

async def get_house_context(
    x_house_id: Optional[int] = Header(None, alias="X-House-ID"),
    current_user: User = Depends(get_current_user)
):
    """Resolve the active house from `X-House-ID`.

    Tenant isolation is deny-by-default: only a **super admin** may name a
    house they do not belong to. A tenant "admin"/"manager"/"house manager"
    role is still scoped to its own houses — otherwise a header value would be
    a cross-tenant data leak. `TENANT_STRICT_HOUSE_ISOLATION=false` restores
    the old platform-wide admin bypass for single-company deployments.
    """
    if not x_house_id:
        return None
    if is_super_admin_user(current_user):
        return x_house_id
    user_house_ids = [h.id for h in current_user.houses]
    if x_house_id in user_house_ids:
        return x_house_id
    if not settings.TENANT_STRICT_HOUSE_ISOLATION and is_admin_user(current_user):
        return x_house_id
    raise HTTPException(status_code=403, detail="You do not have access to this house context")


async def require_house_context(
    x_house_id: Optional[int] = Header(None, alias="X-House-ID"),
    current_user: User = Depends(get_current_user)
):
    """Like `get_house_context`, but a house must always be resolvable."""
    if not x_house_id:
        if is_super_admin_user(current_user) or not current_user.houses:
            raise HTTPException(status_code=400, detail="Please select a house first (X-House-ID header required)")
        return current_user.houses[0].id
    if is_super_admin_user(current_user):
        return x_house_id
    user_house_ids = [h.id for h in current_user.houses]
    if x_house_id in user_house_ids:
        return x_house_id
    if not settings.TENANT_STRICT_HOUSE_ISOLATION and is_admin_user(current_user):
        return x_house_id
    raise HTTPException(status_code=403, detail="You do not have access to this house context")

def has_any_permission(permissions: List[str]):
    async def permission_dependency(current_user: User = Depends(get_current_user)):
        user_permissions = set()
        for role in current_user.roles:
            if is_admin_role([role.name.lower()]):
                return current_user
            for perm in role.permissions:
                user_permissions.add(perm.name)
        if any(p in user_permissions for p in permissions):
            return current_user
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to perform this action."
        )
    return permission_dependency

def has_permission(required_permission: str):
    return has_any_permission([required_permission])

require_permission = has_permission
