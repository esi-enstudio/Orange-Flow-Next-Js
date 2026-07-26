from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.routers.deps import get_db, has_permission, get_current_user, get_house_context
from app.schemas.shift import ShiftSchema, ShiftCreate, EmployeeShiftSchema, EmployeeShiftCreate, MyShiftResponse
from app.models.shift import Shift, EmployeeShift
from app.models.employee import Employee
from app.models.user import User
from app.utils.access_control import is_admin_user
from app.utils.activity_logger import log_activity
from app.utils.timezone import now_naive

router = APIRouter(prefix="/api/v1/shifts", tags=["Shifts"])


@router.get("", response_model=List[ShiftSchema])
async def list_shifts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("shifts.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    query = select(Shift)
    if house_id:
        query = query.where(Shift.house_id == house_id)
    elif not is_admin_user(current_user):
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(Shift.house_id.in_(user_house_ids))
    result = await db.execute(query.where(Shift.is_deleted == False))
    return result.scalars().all()


@router.post("", response_model=ShiftSchema)
async def create_shift(
    data: ShiftCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("shifts.create")),
):
    shift = Shift(**data.model_dump())
    db.add(shift)
    await db.commit()
    await db.refresh(shift)

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="shifts", action="create", record_id=shift.id,
        new_values=data.model_dump(), request=request,
    )
    return shift


@router.put("/{shift_id}", response_model=ShiftSchema)
async def update_shift(
    shift_id: int,
    data: ShiftCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("shifts.edit")),
):
    result = await db.execute(select(Shift).where(Shift.id == shift_id, Shift.is_deleted == False))
    shift = result.scalar_one_or_none()
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")

    old = {c.name: getattr(shift, c.name) for c in shift.__table__.columns}
    for key, val in data.model_dump().items():
        setattr(shift, key, val)
    await db.commit()

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="shifts", action="edit", record_id=shift.id,
        old_values=old, new_values=data.model_dump(), request=request,
    )
    return shift


@router.delete("/{shift_id}")
async def delete_shift(
    shift_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("shifts.delete")),
):
    result = await db.execute(select(Shift).where(Shift.id == shift_id))
    shift = result.scalar_one_or_none()
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")
    shift.is_deleted = True
    shift.deleted_at = now_naive()
    shift.deleted_by = current_user.id
    await db.commit()

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="shifts", action="delete", record_id=shift.id, request=request,
    )
    return {"message": "Shift deleted successfully"}


@router.post("/assign", response_model=EmployeeShiftSchema)
async def assign_shift(
    data: EmployeeShiftCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("shifts.assign")),
):
    emp = await db.get(Employee, data.employee_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    shift = await db.get(Shift, data.shift_id)
    if not shift:
        raise HTTPException(status_code=404, detail="Shift not found")

    existing = await db.execute(
        select(EmployeeShift).where(
            EmployeeShift.employee_id == data.employee_id,
            EmployeeShift.is_active == True,
        )
    )
    for es in existing.scalars().all():
        es.is_active = False

    es = EmployeeShift(**data.model_dump())
    db.add(es)
    await db.commit()
    await db.refresh(es)

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="shifts", action="assign", record_id=es.id,
        new_values=data.model_dump(), request=request,
    )
    return EmployeeShiftSchema(
        id=es.id,
        employee_id=es.employee_id,
        shift_id=es.shift_id,
        shift_name=shift.name,
        effective_from=es.effective_from,
        effective_to=es.effective_to,
        is_active=es.is_active,
    )


@router.get("/my")
async def get_my_shift(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Employee).where(Employee.user_id == current_user.id)
    )
    emp = result.scalar_one_or_none()
    if not emp:
        return MyShiftResponse()

    today = now_naive().date()
    es_result = await db.execute(
        select(EmployeeShift).options(joinedload(EmployeeShift.shift))
        .where(
            EmployeeShift.employee_id == emp.id,
            EmployeeShift.is_active == True,
            EmployeeShift.effective_from <= today,
            (EmployeeShift.effective_to >= today) | (EmployeeShift.effective_to == None),
        )
        .order_by(EmployeeShift.effective_from.desc())
        .limit(1)
    )
    es = es_result.unique().scalar_one_or_none()
    if not es:
        return MyShiftResponse()

    return MyShiftResponse(
        shift_id=es.shift.id,
        shift_name=es.shift.name,
        start_time=es.shift.start_time.strftime("%H:%M"),
        end_time=es.shift.end_time.strftime("%H:%M"),
        grace_period_minutes=es.shift.grace_period_minutes,
    )


@router.get("/employee/{employee_id}", response_model=List[EmployeeShiftSchema])
async def get_employee_shifts(
    employee_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("shifts.view")),
):
    result = await db.execute(
        select(EmployeeShift).options(joinedload(EmployeeShift.shift))
        .where(
            EmployeeShift.employee_id == employee_id,
            EmployeeShift.is_deleted == False,
        )
        .order_by(EmployeeShift.effective_from.desc())
    )
    items = result.unique().scalars().all()
    return [
        EmployeeShiftSchema(
            id=es.id,
            employee_id=es.employee_id,
            shift_id=es.shift_id,
            shift_name=es.shift.name,
            effective_from=es.effective_from,
            effective_to=es.effective_to,
            is_active=es.is_active,
        )
        for es in items
    ]
