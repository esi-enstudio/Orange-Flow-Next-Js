from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from sqlalchemy.orm import joinedload, selectinload

from app.routers.deps import get_db, has_permission, get_house_context
from app.models.bp_retailer_code import BpRetailerCode
from app.models.employee import Employee
from app.models.user import User
from app.models.role import Role
from app.utils.access_control import is_admin_user

router = APIRouter(prefix="/api/bp-retailer-codes", tags=["bp-retailer-codes"])


class BpRetailerCodeCreate(BaseModel):
    bp_employee_id: int
    retailer_code: str


class BpRetailerCodeOut(BaseModel):
    id: int
    bp_employee_id: int
    retailer_code: str
    house_id: int
    bp_name: str = ""
    bp_dms_code: str = ""

    model_config = {"from_attributes": True}


@router.get("/bp-employees")
async def list_bp_employees(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_reports")),
    house_context: Optional[int] = Depends(get_house_context),
):
    is_admin = is_admin_user(current_user)
    user_house_ids = [h.id for h in current_user.houses]

    query = (
        select(Employee)
        .options(joinedload(Employee.user).selectinload(User.roles))
        .where(Employee.status == "Active")
    )

    if house_context:
        query = query.where(Employee.house_id == house_context)
    elif not is_admin:
        if user_house_ids:
            query = query.where(Employee.house_id.in_(user_house_ids))
        else:
            return []

    result = await db.execute(query)
    employees = result.unique().scalars().all()

    bp_list = []
    for emp in employees:
        user_roles = [r.name.lower() for r in emp.user.roles] if emp.user else []
        if "bp" not in user_roles:
            continue
        bp_list.append({
            "id": emp.id,
            "name": emp.user.name if emp.user else None,
            "dms_code": emp.dms_code,
            "employee_id": emp.employee_id,
        })

    bp_list.sort(key=lambda e: e["name"] or e["dms_code"] or "")
    return bp_list


@router.get("")
async def list_bp_retailer_codes(
    house_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_reports")),
):
    is_admin = is_admin_user(current_user)
    user_house_ids = [h.id for h in current_user.houses]

    query = (
        select(BpRetailerCode)
        .options(joinedload(BpRetailerCode.bp_employee).joinedload(Employee.user))
        .order_by(BpRetailerCode.retailer_code)
    )

    if house_id:
        query = query.where(BpRetailerCode.house_id == house_id)
    elif not is_admin:
        if user_house_ids:
            query = query.where(BpRetailerCode.house_id.in_(user_house_ids))
        else:
            return []

    result = await db.execute(query)
    rows = result.unique().scalars().all()

    out = []
    for r in rows:
        bp_name = ""
        bp_dms_code = ""
        if r.bp_employee:
            bp_dms_code = r.bp_employee.dms_code or ""
            if r.bp_employee.user:
                bp_name = r.bp_employee.user.name or ""
            else:
                bp_name = r.bp_employee.dms_code or f"BP #{r.bp_employee_id}"
        out.append(BpRetailerCodeOut(
            id=r.id,
            bp_employee_id=r.bp_employee_id,
            retailer_code=r.retailer_code,
            house_id=r.house_id,
            bp_name=bp_name,
            bp_dms_code=bp_dms_code,
        ))
    return out


@router.post("", status_code=201)
async def create_bp_retailer_code(
    body: BpRetailerCodeCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("edit_reports")),
    house_context: Optional[int] = Depends(get_house_context),
):
    emp = await db.get(Employee, body.bp_employee_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    target_house_id = house_context or emp.house_id
    is_admin = is_admin_user(current_user)
    if not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if target_house_id not in user_house_ids:
            raise HTTPException(status_code=403, detail="Access denied")

    existing = await db.execute(
        select(BpRetailerCode).where(
            BpRetailerCode.bp_employee_id == body.bp_employee_id,
            BpRetailerCode.retailer_code == body.retailer_code,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="This assignment already exists")

    record = BpRetailerCode(
        bp_employee_id=body.bp_employee_id,
        retailer_code=body.retailer_code,
        house_id=target_house_id,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return {"id": record.id, "message": "BP retailer code assigned"}


@router.delete("/{record_id}")
async def delete_bp_retailer_code(
    record_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("edit_reports")),
):
    record = await db.get(BpRetailerCode, record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Assignment not found")

    is_admin = is_admin_user(current_user)
    if not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if record.house_id not in user_house_ids:
            raise HTTPException(status_code=403, detail="Access denied")

    await db.delete(record)
    await db.commit()
    return {"message": "BP retailer code unassigned"}
