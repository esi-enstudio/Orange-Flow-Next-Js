import os
import shutil
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Query, Response
from sqlalchemy import select, or_, and_, cast, Float
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.routers.deps import get_db, has_permission, get_current_user, get_house_context
from app.schemas.employee import EmployeeSchema, EmployeeCreate, EmployeeSelfUpdate
from app.models.employee import Employee
from app.models.house import House
from app.models.user import User
from app.models.retailer import Retailer
from pydantic import BaseModel
from app.utils.access_control import is_admin_user
from app.utils.validation import safe_filename, validate_excel
from app.services.Automation.employee_excel import process_employee_excel, export_employees_excel
from app.models.role import Role

router = APIRouter(prefix="/api/employees", tags=["employees"])

PREFIX_MAP = {
    "rso": "RSO", "manager": "MGR", "supervisor": "SUP",
    "bp": "BP", "bsp": "BSP", "rbsp": "RBSP", "unknown": "EMP",
}

async def generate_employee_id(db: AsyncSession, employee_type: str | None) -> str:
    prefix = PREFIX_MAP.get(employee_type or "unknown", "EMP")
    result = await db.execute(
        select(Employee.employee_id)
        .where(Employee.employee_id.like(f"{prefix}-%"))
        .order_by(Employee.employee_id.desc())
        .limit(1)
    )
    last_id = result.scalar_one_or_none()
    if last_id:
        num = int(last_id.split("-")[1]) + 1
    else:
        num = 1
    return f"{prefix}-{num:04d}"


@router.get("/by-house-grouped")
async def list_employees_by_house_grouped(
    house_id: int = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("employees.view")),
):
    """List employees with assisted_retailer_code, grouped by role (RSO/BP/CC)."""
    is_admin = is_admin_user(current_user)
    if not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if house_id not in user_house_ids:
            raise HTTPException(status_code=403, detail="Access denied")

    emp_rows = await db.execute(
        select(Employee)
        .options(joinedload(Employee.user).selectinload(User.roles))
        .where(
            Employee.house_id == house_id,
            Employee.status == "Active",
            Employee.assisted_retailer_code != None,
            Employee.assisted_retailer_code != "",
        )
    )
    employees = emp_rows.unique().scalars().all()

    groups: dict[str, list] = {"rso": [], "bp": [], "cc": []}
    role_names = {"rso", "bp", "cc"}

    for emp in employees:
        user_roles = [r.name.lower() for r in emp.user.roles] if emp.user else []
        primary_role = next((r for r in user_roles if r in role_names), None)
        if not primary_role:
            continue

        groups[primary_role].append({
            "id": emp.id,
            "name": emp.user.name if emp.user else None,
            "dms_code": emp.dms_code,
            "itop_number": emp.itop_number,
            "personal_number": emp.personal_number,
            "assisted_retailer_code": emp.assisted_retailer_code,
            "role": primary_role.upper(),
        })

    for role in groups:
        groups[role].sort(key=lambda e: e["name"] or e["dms_code"] or "")

    return {
        "groups": groups,
        "counts": {role: len(emps) for role, emps in groups.items()},
        "total": sum(len(emps) for emps in groups.values()),
    }

@router.get("", response_model=list[EmployeeSchema])
async def list_employees(
    search: Optional[str] = Query(None, description="Global search across name, dms_code, itop_number"),
    status: Optional[str] = Query(None, description="Filter by status: Active, Resigned, Suspended, Inactive"),
    market_type: Optional[str] = Query(None, description="Filter by market type: Urban, Rural"),
    motor_bike: Optional[str] = Query(None, description="Filter by motor_bike: Yes, No"),
    bicyle: Optional[str] = Query(None, description="Filter by bicycle: Yes, No"),
    driving_license: Optional[str] = Query(None, description="Filter by driving_license: Yes, No"),
    blood_group: Optional[str] = Query(None, description="Filter by blood group"),
    religion: Optional[str] = Query(None, description="Filter by religion"),
    has_assisted_code: Optional[bool] = Query(None, description="Filter by presence of assisted_retailer_code"),
    has_user: Optional[bool] = Query(None, description="Filter by presence of linked user"),
    has_bank_info: Optional[bool] = Query(None, description="Filter by presence of bank_name and bank_account"),
    joining_date_from: Optional[str] = Query(None, description="Joining date range start (YYYY-MM-DD)"),
    joining_date_to: Optional[str] = Query(None, description="Joining date range end (YYYY-MM-DD)"),
    resigned_date_from: Optional[str] = Query(None, description="Resigned date range start (YYYY-MM-DD)"),
    resigned_date_to: Optional[str] = Query(None, description="Resigned date range end (YYYY-MM-DD)"),
    salary_min: Optional[float] = Query(None, description="Minimum salary filter"),
    salary_max: Optional[float] = Query(None, description="Maximum salary filter"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("employees.view")),
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

    conditions = []

    if search:
        search_pattern = f"%{search}%"
        conditions.append(
            or_(
                Employee.dms_code.ilike(search_pattern),
                Employee.itop_number.ilike(search_pattern),
                Employee.personal_number.ilike(search_pattern),
                Employee.pool_number.ilike(search_pattern),
                Employee.assisted_retailer_code.ilike(search_pattern),
                Employee.agency_id.ilike(search_pattern),
                Employee.nid.ilike(search_pattern),
            )
        )

    if status:
        conditions.append(Employee.status == status)
    if market_type:
        conditions.append(Employee.market_type == market_type)
    if motor_bike:
        conditions.append(Employee.motor_bike == motor_bike)
    if bicyle:
        conditions.append(Employee.bicyle == bicyle)
    if driving_license:
        conditions.append(Employee.driving_license == driving_license)
    if blood_group:
        conditions.append(Employee.blood_group == blood_group)
    if religion:
        conditions.append(Employee.religion == religion)

    if has_assisted_code is True:
        conditions.append(Employee.assisted_retailer_code != None)
        conditions.append(Employee.assisted_retailer_code != "")
    elif has_assisted_code is False:
        conditions.append(
            or_(Employee.assisted_retailer_code == None, Employee.assisted_retailer_code == "")
        )

    if has_user is True:
        conditions.append(Employee.user_id != None)
    elif has_user is False:
        conditions.append(Employee.user_id == None)

    if has_bank_info is True:
        conditions.append(Employee.bank_name != None)
        conditions.append(Employee.bank_name != "")
        conditions.append(Employee.bank_account != None)
        conditions.append(Employee.bank_account != "")
    elif has_bank_info is False:
        conditions.append(
            or_(
                Employee.bank_name == None,
                Employee.bank_name == "",
                Employee.bank_account == None,
                Employee.bank_account == "",
            )
        )

    if joining_date_from:
        conditions.append(Employee.joining_date >= joining_date_from)
    if joining_date_to:
        conditions.append(Employee.joining_date <= joining_date_to)
    if resigned_date_from:
        conditions.append(Employee.resigned_date >= resigned_date_from)
    if resigned_date_to:
        conditions.append(Employee.resigned_date <= resigned_date_to)

    if salary_min is not None:
        conditions.append(cast(Employee.salary, Float) >= salary_min)
    if salary_max is not None:
        conditions.append(cast(Employee.salary, Float) <= salary_max)

    if conditions:
        query = query.where(and_(*conditions))

    result = await db.execute(query.order_by(Employee.id.desc()))
    return result.unique().scalars().all()


@router.get("/filter-options")
async def get_employee_filter_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("employees.view")),
):
    """Return distinct values for filter dropdowns."""
    async def _distinct(column):
        res = await db.execute(select(column).distinct().where(column != None, column != "").order_by(column))
        return [r[0] for r in res.all()]

    statuses = await _distinct(Employee.status)
    market_types = await _distinct(Employee.market_type)
    blood_groups = await _distinct(Employee.blood_group)
    religions = await _distinct(Employee.religion)

    return {
        "statuses": statuses,
        "market_types": market_types,
        "blood_groups": blood_groups,
        "religions": religions,
    }

@router.post("", response_model=EmployeeSchema)
async def create_employee(emp_data: EmployeeCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("employees.create"))):
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
    data = emp_data.model_dump()
    employee_type = data.get("employee_type") or "unknown"
    employee_id = await generate_employee_id(db, employee_type)
    data["employee_id"] = employee_id
    data["employee_type"] = employee_type
    new_emp = Employee(**data)
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
async def update_employee(emp_id: int, emp_data: EmployeeCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("employees.edit"))):
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
    current_user: User = Depends(has_permission("employees.view"))
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
    current_user: User = Depends(has_permission("employees.edit"))
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
async def delete_employee(emp_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("employees.delete"))):
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
    current_user: User = Depends(has_permission("employees.import"))
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
    current_user: User = Depends(has_permission("employees.export")),
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


class AssignSupervisorRequest(BaseModel):
    rso_user_id: int
    supervisor_user_id: int

class BatchAssignSupervisorRequest(BaseModel):
    rso_user_ids: list[int]
    supervisor_user_id: int


@router.post("/assign-supervisor")
async def assign_rso_to_supervisor(
    req: AssignSupervisorRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("employees.assign")),
):
    rso_user = await db.get(User, req.rso_user_id)
    if not rso_user:
        raise HTTPException(status_code=404, detail="RSO user not found")
    sup_user = await db.get(User, req.supervisor_user_id)
    if not sup_user:
        raise HTTPException(status_code=404, detail="Supervisor user not found")

    rso_roles = [r.name.lower() for r in rso_user.roles]
    sup_roles = [r.name.lower() for r in sup_user.roles]
    if "rso" not in rso_roles:
        raise HTTPException(status_code=400, detail="Selected user is not an RSO")
    if "supervisor" not in sup_roles:
        raise HTTPException(status_code=400, detail="Selected user is not a Supervisor")

    house_ids_rso = {h.id for h in rso_user.houses}
    house_ids_sup = {h.id for h in sup_user.houses}
    if not house_ids_rso.intersection(house_ids_sup):
        raise HTTPException(status_code=400, detail="RSO and Supervisor must belong to the same house")

    rso_user.parent_id = req.supervisor_user_id
    await db.commit()
    return {"success": True, "message": "RSO assigned to supervisor successfully"}


@router.post("/assign-supervisor/batch")
async def batch_assign_rso_to_supervisor(
    req: BatchAssignSupervisorRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("employees.assign")),
):
    sup_user = await db.get(User, req.supervisor_user_id)
    if not sup_user:
        raise HTTPException(status_code=404, detail="Supervisor user not found")
    if "supervisor" not in [r.name.lower() for r in sup_user.roles]:
        raise HTTPException(status_code=400, detail="Selected user is not a Supervisor")

    sup_house_ids = {h.id for h in sup_user.houses}
    success_count = 0
    errors = []

    for rso_id in req.rso_user_ids:
        rso_user = await db.get(User, rso_id)
        if not rso_user:
            errors.append({"rso_id": rso_id, "error": "User not found"})
            continue
        if "rso" not in [r.name.lower() for r in rso_user.roles]:
            errors.append({"rso_id": rso_id, "error": "User is not an RSO"})
            continue
        rso_house_ids = {h.id for h in rso_user.houses}
        if not rso_house_ids.intersection(sup_house_ids):
            errors.append({"rso_id": rso_id, "error": "RSO and Supervisor must belong to the same house"})
            continue
        rso_user.parent_id = req.supervisor_user_id
        success_count += 1

    await db.commit()
    return {
        "success": True,
        "message": f"{success_count} RSO(s) assigned successfully",
        "assigned": success_count,
        "errors": errors,
    }


@router.post("/remove-assignment/{rso_user_id}")
async def remove_rso_assignment(
    rso_user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("employees.assign")),
):
    rso_user = await db.get(User, rso_user_id)
    if not rso_user:
        raise HTTPException(status_code=404, detail="User not found")
    rso_user.parent_id = None
    await db.commit()
    return {"success": True, "message": "Assignment removed"}


@router.get("/supervisor-team/{supervisor_user_id}")
async def get_supervisor_team(
    supervisor_user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("employees.view")),
):
    sup_user = await db.get(User, supervisor_user_id)
    if not sup_user:
        raise HTTPException(status_code=404, detail="Supervisor not found")

    rso_users = (
        await db.execute(
            select(User).options(selectinload(User.roles), selectinload(User.employee_profile))
            .where(User.parent_id == supervisor_user_id)
        )
    ).unique().scalars().all()

    team = []
    for ru in rso_users:
        if "rso" in [r.name.lower() for r in ru.roles]:
            emp = ru.employee_profile
            team.append({
                "user_id": ru.id,
                "name": ru.name,
                "username": ru.username,
                "phone": ru.phone_number,
                "employee_id": emp.employee_id if emp else None,
                "dms_code": emp.dms_code if emp else None,
                "status": emp.status if emp else None,
            })
    return {"success": True, "data": team, "total": len(team)}


@router.get("/unassigned-rsos")
async def get_unassigned_rsos(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("employees.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    query = (
        select(User)
        .options(selectinload(User.roles), selectinload(User.employee_profile))
        .where(User.parent_id == None)
    )
    if house_id:
        query = query.where(User.houses.any(id=house_id))

    result = await db.execute(query)
    users = result.unique().scalars().all()

    unassigned = []
    for u in users:
        if "rso" in [r.name.lower() for r in u.roles]:
            emp = u.employee_profile
            unassigned.append({
                "user_id": u.id,
                "name": u.name,
                "username": u.username,
                "employee_id": emp.employee_id if emp else None,
                "dms_code": emp.dms_code if emp else None,
                "itop_number": emp.itop_number if emp else None,
            })
    return {"success": True, "data": unassigned, "total": len(unassigned)}


@router.get("/supervisors-list")
async def get_supervisors_list(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("employees.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    query = (
        select(User)
        .options(selectinload(User.roles), selectinload(User.employee_profile), selectinload(User.subordinates))
    )
    if house_id:
        query = query.where(User.houses.any(id=house_id))

    result = await db.execute(query)
    users = result.unique().scalars().all()

    supervisors = []
    for u in users:
        if "supervisor" in [r.name.lower() for r in u.roles]:
            emp = u.employee_profile
            rso_count = len([s for s in (u.subordinates or []) if "rso" in [r.name.lower() for r in s.roles]])
            supervisors.append({
                "user_id": u.id,
                "name": u.name,
                "username": u.username,
                "employee_id": emp.employee_id if emp else None,
                "dms_code": emp.dms_code if emp else None,
                "itop_number": emp.itop_number if emp else None,
                "assigned_rso_count": rso_count,
            })
    return {"success": True, "data": supervisors}


@router.post("/link-users")
async def link_employees_to_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("employees.edit")),
):
    from app.utils.employee_user_linker import ensure_employee_users
    result = await ensure_employee_users(db)
    return {"success": True, **result}
