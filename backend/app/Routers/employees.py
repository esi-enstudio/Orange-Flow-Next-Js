import os
import shutil
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Query, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.Routers.deps import get_db, has_permission, get_current_user, get_house_context
from app.Schemas.employee import EmployeeSchema, EmployeeCreate, EmployeeSelfUpdate
from app.Models.employee import Employee
from app.Models.house import House
from app.Models.user import User
from app.Models.retailer import Retailer
from pydantic import BaseModel
from app.Utils.access_control import is_admin_user
from app.Utils.validation import safe_filename, validate_excel
from app.Services.Automation.employee_excel import process_employee_excel, export_employees_excel

router = APIRouter(prefix="/api/employees", tags=["employees"])

@router.get("", response_model=list[EmployeeSchema])
async def list_employees(
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_employees")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(Employee).options(joinedload(Employee.house), joinedload(Employee.user).selectinload(User.roles))
    is_admin = is_admin_user(current_user)
    if house_id:
        query = query.where(Employee.house_id == house_id)
    elif is_admin:
        pass
    else:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(Employee.house_id.in_(user_house_ids))
        else:
            query = query.where(Employee.house_id == -1)
    if search:
        search_pattern = f"%{search}%"
        query = query.where(
            (Employee.dms_code.ilike(search_pattern)) |
            (Employee.itop_number.ilike(search_pattern))
        )
    result = await db.execute(query.order_by(Employee.id.desc()))
    return result.unique().scalars().all()

@router.post("", response_model=EmployeeSchema)
async def create_employee(emp_data: EmployeeCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("create_employees"))):
    house = await db.get(House, emp_data.house_id)
    if not house:
        raise HTTPException(status_code=422, detail=[{"loc": ["body", "house_id"], "msg": "House not found", "type": "value_error"}])
    if emp_data.dms_code:
        existing = (await db.execute(select(Employee).where(Employee.dms_code == emp_data.dms_code))).scalar_one_or_none()
        if existing: raise HTTPException(status_code=422, detail=[{"loc": ["body", "dms_code"], "msg": "Employee with this DMS code already exists", "type": "value_error"}])
    if emp_data.user_id:
        user = await db.get(User, emp_data.user_id)
        if not user:
            raise HTTPException(status_code=422, detail=[{"loc": ["body", "user_id"], "msg": "User not found", "type": "value_error"}])
    new_emp = Employee(**emp_data.model_dump())
    db.add(new_emp)
    await db.commit()
    await db.refresh(new_emp)
    result = await db.execute(
        select(Employee)
        .options(joinedload(Employee.house), joinedload(Employee.user).selectinload(User.roles))
        .where(Employee.id == new_emp.id)
    )
    return result.unique().scalar_one()

@router.put("/{emp_id}", response_model=EmployeeSchema)
async def update_employee(emp_id: int, emp_data: EmployeeCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("edit_employees"))):
    result = await db.execute(select(Employee).where(Employee.id == emp_id))
    emp = result.scalar_one_or_none()
    if not emp: raise HTTPException(status_code=404, detail="Employee not found")
    house = await db.get(House, emp_data.house_id)
    if not house:
        raise HTTPException(status_code=422, detail=[{"loc": ["body", "house_id"], "msg": "House not found", "type": "value_error"}])
    if emp_data.dms_code != emp.dms_code:
        existing = (await db.execute(select(Employee).where(Employee.dms_code == emp_data.dms_code))).scalar_one_or_none()
        if existing: raise HTTPException(status_code=422, detail=[{"loc": ["body", "dms_code"], "msg": "DMS code already in use by another employee", "type": "value_error"}])
    if emp_data.user_id:
        user = await db.get(User, emp_data.user_id)
        if not user:
            raise HTTPException(status_code=422, detail=[{"loc": ["body", "user_id"], "msg": "User not found", "type": "value_error"}])
    for key, value in emp_data.model_dump().items():
        setattr(emp, key, value)
    await db.commit()
    await db.refresh(emp)
    result = await db.execute(
        select(Employee)
        .options(joinedload(Employee.house), joinedload(Employee.user).selectinload(User.roles))
        .where(Employee.id == emp.id)
    )
    return result.unique().scalar_one()

class ReassignRequest(BaseModel):
    new_employee_id: int
    status: str

@router.get("/{emp_id}/retailer-count")
async def get_employee_retailer_count(
    emp_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_employees"))
):
    result = await db.execute(select(Employee).where(Employee.id == emp_id))
    emp = result.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    count_result = await db.execute(
        select(Retailer.id).where(Retailer.employee_id == emp_id)
    )
    count = len(count_result.all())
    return {"count": count}

@router.post("/{emp_id}/reassign")
async def reassign_employee_retailers(
    emp_id: int,
    req: ReassignRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("edit_employees"))
):
    result = await db.execute(select(Employee).where(Employee.id == emp_id))
    emp = result.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    new_emp_result = await db.execute(select(Employee).where(Employee.id == req.new_employee_id))
    new_emp = new_emp_result.scalar_one_or_none()
    if not new_emp:
        raise HTTPException(status_code=404, detail="New employee not found")
    if emp.house_id != new_emp.house_id:
        raise HTTPException(status_code=422, detail="Employees must be in the same house")
    if req.status not in ("Active", "Resigned", "Suspended", "Inactive"):
        raise HTTPException(status_code=422, detail="Invalid status")
    # Transfer all retailers
    await db.execute(
        Retailer.__table__.update().where(Retailer.employee_id == emp_id).values(employee_id=req.new_employee_id)
    )
    # Update employee status
    emp.status = req.status
    await db.commit()
    await db.refresh(emp)
    return {"message": f"Transferred retailers to {new_emp.dms_code or new_emp.id} and status set to {req.status}"}

@router.delete("/{emp_id}")
async def delete_employee(emp_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("delete_employees"))):
    result = await db.execute(select(Employee).where(Employee.id == emp_id))
    emp = result.scalar_one_or_none()
    if not emp: raise HTTPException(status_code=404, detail="Employee member not found")
    await db.delete(emp)
    await db.commit()
    return {"message": "Employee member deleted successfully"}

@router.get("/me", response_model=EmployeeSchema)
async def get_my_employee_profile(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(
        select(Employee)
        .options(joinedload(Employee.house), joinedload(Employee.user).selectinload(User.roles))
        .where(Employee.user_id == current_user.id)
    )
    emp = result.unique().scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="No employee profile found")
    return emp

@router.put("/me", response_model=EmployeeSchema)
async def update_my_employee_profile(emp_data: EmployeeSelfUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(
        select(Employee)
        .options(joinedload(Employee.house), joinedload(Employee.user).selectinload(User.roles))
        .where(Employee.user_id == current_user.id)
    )
    emp = result.unique().scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="No employee profile found")
    for key, value in emp_data.model_dump(exclude_unset=True).items():
        setattr(emp, key, value)
    await db.commit()
    await db.refresh(emp)
    result = await db.execute(
        select(Employee)
        .options(joinedload(Employee.house), joinedload(Employee.user).selectinload(User.roles))
        .where(Employee.id == emp.id)
    )
    return result.unique().scalar_one()

@router.post("/import")
async def import_employees(
    file: UploadFile = File(...),
    house_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("import_employees"))
):
    if not os.path.exists("temp_downloads"): os.makedirs("temp_downloads")
    filename = file.filename or "upload.xlsx"
    if not validate_excel(filename):
        raise HTTPException(status_code=400, detail="Invalid file type. Only .xlsx and .xls files are allowed.")
    file_path = f"temp_downloads/{safe_filename(filename)}"
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        count, error = await process_employee_excel(file_path, house_id)
        if error: raise HTTPException(status_code=400, detail=error)
        return {"message": f"Successfully imported {count} employees", "count": count}
    finally:
        if os.path.exists(file_path): os.remove(file_path)

@router.get("/export")
async def export_employees(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("export_employees")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(Employee).options(joinedload(Employee.user))
    is_admin = is_admin_user(current_user)
    if house_id:
        query = query.where(Employee.house_id == house_id)
    elif not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(Employee.house_id.in_(user_house_ids))
        else:
            query = query.where(Employee.house_id == -1)
    result = await db.execute(query.order_by(Employee.id.desc()))
    employees = result.unique().scalars().all()
    excel_data = await export_employees_excel(employees)
    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=employees_export.xlsx"}
    )
