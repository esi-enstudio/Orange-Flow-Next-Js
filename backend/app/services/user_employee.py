from typing import Optional

from sqlalchemy import select, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.house import House
from app.models.employee import Employee

# Database constraint name -> (field, error_code, message)
CONSTRAINT_ERRORS = {
    "ix_users_username": ("username", "username_already_used", "Username is already taken"),
    "ix_users_email": ("email", "email_already_used", "Email is already used by another user"),
    "ix_users_telegram_id": ("telegram_id", "telegram_id_already_used", "Telegram ID is already used by another user"),
    "employees_dms_code_key": ("dms_code", "conflict", "This employee code is already in use by another employee"),
    "employees_employee_id_key": ("employee_id", "conflict", "Could not generate a unique employee ID"),
}


def conflict_detail(exc: IntegrityError) -> dict:
    """Map a DB IntegrityError to a structured, user-friendly 409 detail."""
    text = str(getattr(exc, "orig", exc)).lower()
    field, code, message = None, "conflict", "Another user already has this username, email or Telegram ID"
    for constraint, (fname, fcode, fmsg) in CONSTRAINT_ERRORS.items():
        if constraint.lower() in text:
            field, code, message = fname, fcode, fmsg
            break
    return {
        "code": code,
        "error_code": code,
        "message": message,
        "fields": {field: message} if field else {},
    }


async def ensure_supervisor_employee(db: AsyncSession, user: User) -> Optional[Employee]:
    """Create a Supervisor Employee profile for the user if none exists.

    Idempotent — safe to call on every create/update. Existing profiles are
    matched by ``user_id`` OR by the auto-generated ``SUP-{user.id}`` DMS code.

    This helper only *adds* the new ``Employee`` to the session; it does NOT
    commit. The caller commits so the user changes and the employee profile
    are persisted atomically in a single transaction.
    """
    if not user or not user.id:
        return None

    dms_code = f"SUP-{user.id}"
    result = await db.execute(
        select(Employee).where(
            or_(Employee.user_id == user.id, Employee.dms_code == dms_code)
        )
    )
    existing = result.scalars().all()
    if existing:
        return existing[0]

    first_house = user.houses[0] if user.houses else (
        await db.execute(select(House).limit(1))
    ).scalar_one_or_none()
    if not first_house:
        return None

    from app.routers.employees import generate_employee_id

    employee_id = await generate_employee_id(db, "supervisor")
    emp = Employee(
        user_id=user.id,
        house_id=first_house.id,
        dms_code=dms_code,
        employee_id=employee_id,
        employee_type="supervisor",
        status="Active",
    )
    db.add(emp)
    return emp