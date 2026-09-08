import os
import shutil
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Query, Request, Response
from sqlalchemy import select, or_, and_, cast, Float, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.routers.deps import get_db, has_permission, get_current_user, get_house_context
from app.schemas.employee import EmployeeSchema, EmployeeCreate, EmployeeSelfUpdate
from app.schemas.pagination import PaginationParams, PaginatedResponse, PaginationMeta
from app.models.employee import Employee
from app.models.house import House
from app.models.user import User, user_roles
from app.models.retailer import Retailer
from app.models.bp_retailer_code import BpRetailerCode
from app.models.rso_target import RSOTarget
from app.models.supervisor_assignment import SupervisorRSOAssignment
from pydantic import BaseModel
from app.utils.access_control import is_admin_user
from app.utils.timezone import now_naive
from app.utils.validation import safe_filename, validate_excel
from app.utils.activity_logger import log_activity
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
    """List active employees, grouped by role (RSO/BP/CC)."""
    is_admin = is_admin_user(current_user)
    if not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if house_id not in user_house_ids:
            raise HTTPException(status_code=403, detail="Access denied")

    emp_rows = await db.execute(
        select(Employee)
        .where(
            Employee.house_id == house_id,
            Employee.status == "Active",
        )
    )
    employees = emp_rows.scalars().all()

    groups: dict[str, list] = {"rso": [], "bp": [], "cc": []}
    role_names = {"rso", "bp", "cc"}

    for emp in employees:
        # Role & name always come from the employees table itself.
        primary_role = (emp.employee_type or "").lower()
        if primary_role not in role_names:
            continue

        groups[primary_role].append({
            "id": emp.id,
            "name": emp.employee_name,
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

@router.get("", response_model=PaginatedResponse)
async def list_employees(
    pagination: PaginationParams = Depends(),
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
    employee_type: Optional[str] = Query(None, description="Filter by employee type: rso, bp, cc, supervisor, manager, bsp, rbsp"),
    filter_house_id: Optional[int] = Query(None, description="Filter by house ID"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("employees.view")),
    house_id: Optional[int] = Depends(get_house_context)
):
    base_query = select(Employee).options(joinedload(Employee.house), joinedload(Employee.user).selectinload(User.roles))

    is_admin = is_admin_user(current_user)
    if house_id:
        base_query = base_query.where(Employee.house_id == house_id)
    elif is_admin:
        pass
    else:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            base_query = base_query.where(Employee.house_id.in_(user_house_ids))
        else:
            base_query = base_query.where(Employee.house_id == -1)

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
                Employee.user.has(User.name.ilike(search_pattern)),
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

    if employee_type:
        conditions.append(Employee.employee_type == employee_type.lower())

    if filter_house_id:
        conditions.append(Employee.house_id == filter_house_id)

    if conditions:
        base_query = base_query.where(and_(*conditions))

    from sqlalchemy import func as sa_func
    house_name_expr = select(House.name).where(House.id == Employee.house_id).scalar_subquery()
    user_name_expr = select(User.name).where(User.id == Employee.user_id).scalar_subquery()
    sort_map = {
        "dms_code": Employee.dms_code,
        "assisted_code": Employee.assisted_retailer_code,
        "status": Employee.status,
        "house": sa_func.lower(house_name_expr),
        "name": sa_func.lower(user_name_expr),
        "id": Employee.id,
    }
    sort_column = sort_map.get(pagination.sort_by, Employee.id)
    order = sort_column.desc() if pagination.sort_order == "desc" else sort_column.asc()
    count_query = select(sa_func.count(Employee.id))
    if base_query.whereclause is not None:
        count_query = count_query.where(base_query.whereclause)
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    offset = (pagination.page - 1) * pagination.per_page
    query = base_query.order_by(order).offset(offset).limit(pagination.per_page)
    result = await db.execute(query)
    items = result.unique().scalars().all()

    retailer_counts: dict[int, int] = {}
    retailer_enabled_counts: dict[int, int] = {}
    retailer_disabled_counts: dict[int, int] = {}
    emp_ids = [e.id for e in items]
    if emp_ids:
        counts_result = await db.execute(
            select(Retailer.employee_id, Retailer.enabled, sa_func.count(Retailer.id))
            .where(Retailer.employee_id.in_(emp_ids))
            .group_by(Retailer.employee_id, Retailer.enabled)
        )
        for emp_id, enabled_val, cnt in counts_result.all():
            retailer_counts[emp_id] = retailer_counts.get(emp_id, 0) + cnt
            if enabled_val == "Yes":
                retailer_enabled_counts[emp_id] = cnt
            else:
                retailer_disabled_counts[emp_id] = retailer_disabled_counts.get(emp_id, 0) + cnt

    data = []
    for e in items:
        schema = EmployeeSchema.model_validate(e)
        schema.retailer_count = retailer_counts.get(e.id, 0)
        schema.retailer_enabled_count = retailer_enabled_counts.get(e.id, 0)
        schema.retailer_disabled_count = retailer_disabled_counts.get(e.id, 0)
        data.append(schema)

    total_pages = max(1, (total + pagination.per_page - 1) // pagination.per_page)

    return PaginatedResponse(
        success=True,
        data=data,
        pagination=PaginationMeta(
            page=pagination.page,
            per_page=pagination.per_page,
            total=total,
            total_pages=total_pages,
            has_next=pagination.page < total_pages,
            has_prev=pagination.page > 1,
        )
    )


@router.get("/status-counts")
async def get_employee_status_counts(
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
    employee_type: Optional[str] = Query(None, description="Filter by employee type: rso, bp, cc, supervisor, manager, bsp, rbsp"),
    filter_house_id: Optional[int] = Query(None, description="Filter by house ID"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("employees.view")),
    house_id: Optional[int] = Depends(get_house_context)
):
    """Get employee counts grouped by status."""
    base_query = select(Employee)
    
    is_admin = is_admin_user(current_user)
    if house_id:
        base_query = base_query.where(Employee.house_id == house_id)
    elif is_admin:
        pass
    else:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            base_query = base_query.where(Employee.house_id.in_(user_house_ids))
        else:
            base_query = base_query.where(Employee.house_id == -1)
    
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
                Employee.user.has(User.name.ilike(search_pattern)),
            )
        )
    
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
    
    if employee_type:
        conditions.append(Employee.employee_type == employee_type.lower())
    
    if filter_house_id:
        conditions.append(Employee.house_id == filter_house_id)
    
    if conditions:
        base_query = base_query.where(and_(*conditions))
    
    from sqlalchemy import func as sa_func
    subq = base_query.subquery()
    count_query = select(subq.c.status, sa_func.count(subq.c.id)).select_from(subq).group_by(subq.c.status)
    result = await db.execute(count_query)
    counts = {row[0]: row[1] for row in result.all()}
    
    return counts


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

async def sync_assisted_code_to_bp_retailer_codes(db: AsyncSession, employee: Employee):
    """Auto-sync BP employee's assisted_retailer_code to bp_retailer_codes table."""
    if not employee.assisted_retailer_code:
        return
    is_bp = employee.employee_type == "bp"
    if not is_bp and employee.user_id:
        user = await db.get(User, employee.user_id)
        if user:
            is_bp = any(r.name.lower() == "bp" for r in user.roles)
    if not is_bp:
        return
    existing = await db.execute(
        select(BpRetailerCode).where(
            BpRetailerCode.bp_employee_id == employee.id,
            BpRetailerCode.retailer_code == employee.assisted_retailer_code,
        )
    )
    if existing.scalar_one_or_none():
        return
    try:
        new_code = BpRetailerCode(
            bp_employee_id=employee.id,
            retailer_code=employee.assisted_retailer_code,
            house_id=employee.house_id,
        )
        db.add(new_code)
        await db.commit()
    except Exception:
        await db.rollback()

async def _count_retailers(db: AsyncSession, emp_id: int) -> int:
    result = await db.execute(
        select(func.count()).select_from(Retailer).where(Retailer.employee_id == emp_id)
    )
    return result.scalar() or 0

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
    await sync_assisted_code_to_bp_retailer_codes(db, new_emp)
    result = await db.execute(
        select(Employee)
        .options(joinedload(Employee.house), joinedload(Employee.user).selectinload(User.roles))
        .where(Employee.id == new_emp.id)
    )
    return result.unique().scalar_one()

@router.put("/{emp_id}", response_model=EmployeeSchema)
async def update_employee(emp_id: int, emp_data: EmployeeCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("employees.edit"))):
    result = await db.execute(
        select(Employee)
        .options(joinedload(Employee.user).selectinload(User.roles))
        .where(Employee.id == emp_id)
    )
    emp = result.unique().scalar_one_or_none()
    if not emp: raise HTTPException(status_code=404, detail="Employee not found")
    house = await db.get(House, emp_data.house_id)
    if not house:
        raise HTTPException(status_code=422, detail=[{"loc": ["body", "house_id"], "msg": "House not found", "type": "value_error"}])
    if emp_data.dms_code and emp_data.dms_code != emp.dms_code:
        existing = (await db.execute(select(Employee).where(Employee.dms_code == emp_data.dms_code))).scalar_one_or_none()
        if existing: raise HTTPException(status_code=422, detail=[{"loc": ["body", "dms_code"], "msg": "DMS code already in use by another employee", "type": "value_error"}])
    if emp_data.user_id:
        user = await db.get(User, emp_data.user_id)
        if not user:
            raise HTTPException(status_code=422, detail=[{"loc": ["body", "user_id"], "msg": "User not found", "type": "value_error"}])
    updates = emp_data.model_dump(exclude_unset=True)
    new_status = updates.get("status", emp.status)
    new_emp_type = updates.get("employee_type", emp.employee_type)
    if new_status in ("Resigned", "Inactive") and (new_emp_type or "").lower() == "rso":
        count = await _count_retailers(db, emp.id)
        if count > 0:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot set status to {new_status} while the RSO still has {count} retailer(s). Reassign retailers first."
            )
    for key, value in updates.items():
        setattr(emp, key, value)
    if emp.status == "Resigned" and not emp.resigned_date:
        emp.resigned_date = now_naive().strftime("%Y-%m-%d")
    await db.commit()
    await db.refresh(emp)
    await sync_assisted_code_to_bp_retailer_codes(db, emp)
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
    if emp.status == "Resigned" and not emp.resigned_date:
        emp.resigned_date = now_naive().strftime("%Y-%m-%d")
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


class SupervisorAssignRequest(BaseModel):
    rso_employee_ids: list[int]


async def _upsert_pivot_assignment(
    db: AsyncSession,
    sup_emp: Employee,
    rso_emp: Employee,
    assigned_by: Optional[int],
) -> SupervisorRSOAssignment:
    """Create (or re-point) the pivot row. The pivot is the source of truth;
    User.parent_id is kept in sync as a convenience column."""
    result = await db.execute(
        select(SupervisorRSOAssignment).where(SupervisorRSOAssignment.rso_employee_id == rso_emp.id)
    )
    row = result.scalar_one_or_none()
    if row:
        row.supervisor_employee_id = sup_emp.id
        row.house_id = rso_emp.house_id
        row.assigned_by = assigned_by
        db.add(row)
        return row
    row = SupervisorRSOAssignment(
        supervisor_employee_id=sup_emp.id,
        rso_employee_id=rso_emp.id,
        house_id=rso_emp.house_id,
        assigned_by=assigned_by,
    )
    db.add(row)
    return row


@router.get("/rso-list")
async def get_rso_list(
    selected_house_id: Optional[int] = Query(None, alias="house_id"),
    exclude_month: Optional[str] = Query(None, alias="exclude_month"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("employees.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    filter_house_id = selected_house_id or house_id
    query = (
        select(Employee)
        .options(joinedload(Employee.user))
        .where(
            Employee.employee_id.ilike("RSO-%"),
            Employee.status == "Active",
        )
    )
    if filter_house_id:
        query = query.where(Employee.house_id == filter_house_id)
    else:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(Employee.house_id.in_(user_house_ids))

    if exclude_month:
        try:
            exclude_date = date.fromisoformat(exclude_month + "-01")
        except ValueError:
            exclude_date = None
        if exclude_date:
            exclude_subq = select(RSOTarget.employee_id).where(RSOTarget.target_date == exclude_date)
            query = query.where(Employee.id.not_in(exclude_subq))

    result = await db.execute(query.order_by(Employee.dms_code))
    employees = result.unique().scalars().all()

    rso_list = []
    for emp in employees:
        rso_list.append({
            "id": emp.id,
            "user_id": emp.user_id,
            "name": emp.user.name if emp.user else None,
            "employee_id": emp.employee_id,
            "dms_code": emp.dms_code,
            "itop_number": emp.itop_number,
            "pool_number": emp.pool_number,
        })
    return {"success": True, "data": rso_list}

@router.get("/supervisors-list")
async def get_supervisors_list(
    selected_house_id: Optional[int] = Query(None, alias="house_id"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("employees.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    filter_house_id = selected_house_id or house_id
    query = (
        select(User)
        .options(selectinload(User.roles), selectinload(User.employee_profile), selectinload(User.subordinates))
    )
    if filter_house_id:
        query = query.where(User.houses.any(id=filter_house_id))

    result = await db.execute(query)
    users = result.unique().scalars().all()

    assigned_counts: dict[int, int] = {}
    rows = (
        await db.execute(select(SupervisorRSOAssignment.supervisor_employee_id))
    ).scalars().all()
    for sup_id in rows:
        assigned_counts[sup_id] = assigned_counts.get(sup_id, 0) + 1

    supervisors = []
    for u in users:
        if "supervisor" in [r.name.lower() for r in u.roles]:
            emp = u.employee_profile
            rso_count = assigned_counts.get(emp.id if emp else None, 0) if emp else 0
            supervisors.append({
                "id": emp.id if emp else None,
                "user_id": u.id,
                "name": u.name,
                "username": u.username,
                "employee_id": emp.employee_id if emp else None,
                "dms_code": emp.dms_code if emp else None,
                "itop_number": emp.itop_number if emp else None,
                "pool_number": emp.pool_number if emp else None,
                "assigned_rso_count": rso_count,
            })
    return {"success": True, "data": supervisors}


@router.get("/supervisors")
async def get_supervisors_with_teams(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("employees.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    """List supervisors (employee-centric) with their full assigned RSO teams from the pivot table."""
    sup_query = (
        select(Employee)
        .options(selectinload(Employee.user).selectinload(User.roles))
        .where(Employee.employee_type == "supervisor")
    )
    if house_id:
        sup_query = sup_query.where(Employee.house_id == house_id)
    else:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            sup_query = sup_query.where(Employee.house_id.in_(user_house_ids))

    sups = (await db.execute(sup_query.order_by(Employee.house_id, Employee.dms_code))).unique().scalars().all()

    sup_ids = [s.id for s in sups]
    rows = []
    if sup_ids:
        rows = (
            await db.execute(
                select(SupervisorRSOAssignment).where(
                    SupervisorRSOAssignment.supervisor_employee_id.in_(sup_ids)
                )
            )
        ).scalars().all()

    rso_by_id: dict[int, Employee] = {}
    rso_ids = [r.rso_employee_id for r in rows]
    if rso_ids:
        rso_emps = (
            await db.execute(
                select(Employee)
                .options(selectinload(Employee.user).selectinload(User.roles))
                .where(Employee.id.in_(rso_ids))
            )
        ).unique().scalars().all()
        rso_by_id = {e.id: e for e in rso_emps}

    row_map: dict[int, list] = {}
    for row in rows:
        row_map.setdefault(row.supervisor_employee_id, []).append(row)

    data = []
    for sup in sups:
        sup_user = sup.user
        team = []
        for row in row_map.get(sup.id, []):
            rso_emp = rso_by_id.get(row.rso_employee_id)
            if not rso_emp:
                continue
            ru = rso_emp.user
            team.append({
                "rso_employee_id": rso_emp.id,
                "rso_user_id": ru.id if ru else None,
                "name": (ru.name if ru else None) or rso_emp.employee_name or rso_emp.employee_id,
                "employee_id": rso_emp.employee_id,
                "dms_code": rso_emp.dms_code,
                "itop_number": rso_emp.itop_number,
                "pool_number": rso_emp.pool_number,
                "status": rso_emp.status,
                "assigned_at": row.created_at.isoformat() if row.created_at else None,
            })
        data.append({
            "id": sup.id,
            "user_id": sup_user.id if sup_user else None,
            "name": (sup_user.name if sup_user else None) or sup.employee_name or sup.employee_id,
            "employee_id": sup.employee_id,
            "dms_code": sup.dms_code,
            "itop_number": sup.itop_number,
            "pool_number": sup.pool_number,
            "status": sup.status,
            "rso_count": len(team),
            "assigned_rsos": team,
        })
    return {"success": True, "data": data}


@router.get("/supervisors/unassigned-rsos")
async def get_supervisors_unassigned(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("employees.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    """List RSO employees that are NOT tagged under any supervisor (house-scoped)."""
    assigned_ids = (
        await db.execute(select(SupervisorRSOAssignment.rso_employee_id))
    ).scalars().all()
    assigned_set = set(assigned_ids)

    rso_user_subq = select(User.id).join(user_roles).join(Role).where(func.lower(Role.name) == "rso")
    emp_query = (
        select(Employee)
        .options(selectinload(Employee.user))
        .where(or_(Employee.employee_type == "rso", Employee.user_id.in_(rso_user_subq)))
    )
    if house_id:
        emp_query = emp_query.where(Employee.house_id == house_id)
    else:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            emp_query = emp_query.where(Employee.house_id.in_(user_house_ids))

    employees = (await db.execute(emp_query.order_by(Employee.dms_code))).unique().scalars().all()

    unassigned = []
    for emp in employees:
        if emp.id in assigned_set:
            continue
        ru = emp.user
        unassigned.append({
            "rso_employee_id": emp.id,
            "rso_user_id": ru.id if ru else None,
            "name": (ru.name if ru else None) or emp.employee_name or emp.employee_id,
            "employee_id": emp.employee_id,
            "dms_code": emp.dms_code,
            "itop_number": emp.itop_number,
            "pool_number": emp.pool_number,
            "status": emp.status,
        })
    return {"success": True, "data": unassigned, "total": len(unassigned)}


@router.post("/supervisors/{supervisor_employee_id}/assign")
async def assign_rsos_to_supervisor(
    supervisor_employee_id: int,
    req: SupervisorAssignRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("employees.assign")),
):
    """Tag one or more RSO employees under a supervisor (pivot is source of truth;
    User.parent_id synced for backward compatibility)."""
    sup_emp = (
        await db.execute(
            select(Employee).options(selectinload(Employee.user)).where(Employee.id == supervisor_employee_id)
        )
    ).scalar_one_or_none()
    if not sup_emp:
        raise HTTPException(status_code=404, detail="Supervisor employee not found")
    if sup_emp.employee_type != "supervisor":
        raise HTTPException(status_code=400, detail="Employee is not a supervisor")

    sup_user = sup_emp.user
    success_count = 0
    errors = []
    assigned_labels = []

    for rso_id in req.rso_employee_ids:
        rso_emp = (
            await db.execute(
                select(Employee).options(selectinload(Employee.user)).where(Employee.id == rso_id)
            )
        ).scalar_one_or_none()
        if not rso_emp:
            errors.append({"rso_employee_id": rso_id, "error": "RSO not found"})
            continue
        rso_user = rso_emp.user
        if rso_emp.employee_type != "rso" and not (
            rso_user and "rso" in [r.name.lower() for r in rso_user.roles]
        ):
            errors.append({"rso_employee_id": rso_id, "error": "Employee is not an RSO"})
            continue
        if rso_emp.house_id != sup_emp.house_id:
            errors.append({"rso_employee_id": rso_id, "error": "RSO and Supervisor must belong to the same house"})
            continue

        await _upsert_pivot_assignment(db, sup_emp, rso_emp, current_user.id)
        if rso_user and sup_user:
            rso_user.parent_id = sup_user.id
        elif rso_user:
            rso_user.parent_id = None
        success_count += 1
        assigned_labels.append(rso_emp.employee_id or rso_emp.dms_code or str(rso_emp.id))

    await db.commit()
    await log_activity(
        db, current_user.id, current_user.name, "employees", "assign",
        record_id=sup_emp.id,
        record_identifier=sup_emp.employee_id or sup_emp.dms_code,
        new_values={"rso_employee_ids": req.rso_employee_ids, "assigned": assigned_labels},
        request=request, status_code=200,
    )
    return {
        "success": True,
        "message": f"{success_count} RSO(s) assigned successfully",
        "assigned": success_count,
        "errors": errors,
    }


@router.delete("/supervisors/assignments/{rso_employee_id}")
async def remove_supervisor_assignment(
    rso_employee_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("employees.assign")),
):
    """Remove an RSO from its supervisor (pivot row deleted + parent_id cleared)."""
    rso_emp = (
        await db.execute(
            select(Employee).options(selectinload(Employee.user)).where(Employee.id == rso_employee_id)
        )
    ).scalar_one_or_none()
    if not rso_emp:
        raise HTTPException(status_code=404, detail="RSO not found")
    row = (
        await db.execute(
            select(SupervisorRSOAssignment).where(SupervisorRSOAssignment.rso_employee_id == rso_emp.id)
        )
    ).scalar_one_or_none()
    removed_supervisor = row.supervisor_employee_id if row else None
    if row:
        await db.delete(row)
    if rso_emp.user and rso_emp.user.parent_id is not None:
        rso_emp.user.parent_id = None
    await db.commit()
    await log_activity(
        db, current_user.id, current_user.name, "employees", "unassign",
        record_id=rso_emp.id,
        record_identifier=rso_emp.employee_id or rso_emp.dms_code,
        old_values={"supervisor_employee_id": removed_supervisor},
        request=request, status_code=200,
    )
    return {"success": True, "message": "Assignment removed"}


@router.post("/link-users")
async def link_employees_to_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("employees.edit")),
):
    from app.utils.employee_user_linker import ensure_employee_users
    result = await ensure_employee_users(db)
    return {"success": True, **result}
