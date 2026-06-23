from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.models.employee import Employee
from app.models.user import User
from app.models.house import House


def _make_username(employee: Employee) -> str:
    base = employee.employee_id or employee.dms_code or f"emp_{employee.id}"
    return base.lower().replace(" ", "_")


async def ensure_employee_users(db: AsyncSession) -> dict:
    result = await db.execute(
        select(Employee).where(Employee.user_id.is_(None))
    )
    employees = result.scalars().all()

    created = 0
    for emp in employees:
        username = _make_username(emp)
        existing_user = (await db.execute(
            select(User).where(User.username == username)
        )).scalar_one_or_none()

        if existing_user:
            emp.user_id = existing_user.id
        else:
            user = User(
                username=username,
                name="",
                phone_number=emp.personal_number or emp.pool_number,
                status="Active",
            )
            db.add(user)
            await db.flush()
            emp.user_id = user.id
            house_ids = []
            if emp.house_id:
                house_ids.append(emp.house_id)
            if house_ids:
                user.houses = [
                    h for h in (
                        await db.execute(
                            select(House).where(House.id.in_(house_ids))
                        )
                    ).scalars().all()
                ]
        created += 1

    if created:
        await db.commit()

    return {"total_without_user": len(employees), "linked": created}
