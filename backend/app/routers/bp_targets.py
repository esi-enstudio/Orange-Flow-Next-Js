from typing import Optional
from datetime import datetime, date

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select, delete, func as sa_func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.routers.deps import get_db, has_permission, get_house_context
from app.models.bp_target import BpTarget
from app.models.employee import Employee
from app.models.house import House
from app.models.house_target import HouseTarget
from app.models.user import User
from app.schemas.bp_target import BpTargetCreate, BpTargetUpdate, BpTargetResponse
from app.utils.access_control import is_admin_user
from app.utils.activity_logger import log_activity

router = APIRouter(prefix="/api/bp-targets", tags=["bp_targets"])


@router.get("")
async def list_bp_targets(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None),
    sort_by: Optional[str] = Query("id"),
    sort_order: Optional[str] = Query("desc"),
    target_date: Optional[str] = Query(None),
    employee_id: Optional[int] = Query(None),
    house_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("bp_targets.view")),
):
    query = (
        select(BpTarget)
        .options(
            joinedload(BpTarget.employee).joinedload(Employee.user),
            joinedload(BpTarget.house),
        )
    )

    if house_id:
        query = query.where(BpTarget.house_id == house_id)
    else:
        user_house_ids = [h.id for h in current_user.houses]
        if not is_admin_user(current_user) and user_house_ids:
            query = query.where(BpTarget.house_id.in_(user_house_ids))

    if employee_id:
        query = query.where(BpTarget.employee_id == employee_id)
    if target_date:
        try:
            td = datetime.strptime(target_date, "%Y-%m-%d").date()
            if td.day != 1:
                td = date(td.year, td.month, 1)
            query = query.where(BpTarget.target_date == td)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format, use YYYY-MM-DD")

    if search:
        query = query.join(BpTarget.employee).where(
            or_(
                Employee.employee_id.ilike(f"%{search}%"),
                Employee.itop_number.ilike(f"%{search}%"),
                Employee.personal_number.ilike(f"%{search}%"),
            )
        )

    total_query = select(sa_func.count()).select_from(query.subquery())
    total_result = await db.execute(total_query)
    total = total_result.scalar() or 0

    sort_column = getattr(BpTarget, sort_by, BpTarget.id)
    order_fn = sort_column.desc if sort_order == "desc" else sort_column.asc
    query = query.order_by(order_fn()).offset((page - 1) * per_page).limit(per_page)

    result = await db.execute(query)
    records = result.unique().scalars().all()

    total_pages = max(1, (total + per_page - 1) // per_page)

    return {
        "success": True,
        "data": [BpTargetResponse.model_validate(r).model_dump() for r in records],
        "pagination": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "total_pages": total_pages,
            "has_next": page < total_pages,
            "has_prev": page > 1,
        },
    }


@router.get("/{target_id}")
async def get_bp_target(
    target_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("bp_targets.view")),
):
    bt = await db.execute(
        select(BpTarget)
        .options(
            joinedload(BpTarget.employee).joinedload(Employee.user),
            joinedload(BpTarget.house),
        )
        .where(BpTarget.id == target_id)
    )
    bt = bt.unique().scalar_one_or_none()
    if not bt:
        raise HTTPException(status_code=404, detail="BP target not found")
    user_house_ids = [h.id for h in current_user.houses]
    if not is_admin_user(current_user) and bt.house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="Access denied")
    return {"success": True, "data": BpTargetResponse.model_validate(bt).model_dump()}


@router.post("", status_code=201)
async def create_bp_target(
    payload: BpTargetCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("bp_targets.create")),
    house_context: Optional[int] = Depends(get_house_context),
):
    try:
        td = datetime.strptime(payload.target_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format, use YYYY-MM-DD")

    if td.day != 1:
        td = date(td.year, td.month, 1)

    target_house_id = house_context
    if not target_house_id:
        if is_admin_user(current_user):
            if not payload.house_id:
                raise HTTPException(status_code=400, detail="House is required for admin users")
            target_house_id = payload.house_id
        else:
            user_house_ids = [h.id for h in current_user.houses]
            if not user_house_ids:
                raise HTTPException(status_code=400, detail="No house found for user")
            target_house_id = user_house_ids[0]

    emp_result = await db.execute(select(Employee).where(Employee.id == payload.employee_id))
    emp = emp_result.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    existing = await db.execute(
        select(BpTarget).where(
            BpTarget.employee_id == payload.employee_id,
            BpTarget.target_date == td,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="BP target already exists for this employee and month")

    bt = BpTarget(
        house_id=target_house_id,
        employee_id=payload.employee_id,
        ga_target=payload.ga_target,
        ev_secondary=payload.ev_secondary,
        sc_secondary=payload.sc_secondary,
        total_recharge=payload.total_recharge,
        extra_targets=payload.extra_targets or {},
        target_date=td,
    )
    db.add(bt)
    await db.commit()
    await db.refresh(bt)

    r = await db.execute(
        select(BpTarget)
        .options(joinedload(BpTarget.employee), joinedload(BpTarget.house))
        .where(BpTarget.id == bt.id)
    )
    bt = r.unique().scalar_one()
    new_values = jsonable_encoder(BpTargetResponse.model_validate(bt).model_dump())
    record_identifier = emp.employee_id or emp.itop_number or f"BP #{payload.employee_id}"
    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="bp_targets",
        action="create",
        record_id=bt.id,
        record_identifier=record_identifier,
        new_values=new_values,
        request=request,
        status_code=201,
    )

    return {
        "success": True,
        "data": new_values,
        "message": "BP target created successfully",
    }


@router.put("/{target_id}")
async def update_bp_target(
    target_id: int,
    payload: BpTargetUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("bp_targets.edit")),
):
    bt = await db.execute(
        select(BpTarget)
        .options(joinedload(BpTarget.employee), joinedload(BpTarget.house))
        .where(BpTarget.id == target_id)
    )
    bt = bt.unique().scalar_one_or_none()
    if not bt:
        raise HTTPException(status_code=404, detail="BP target not found")

    user_house_ids = [h.id for h in current_user.houses]
    if not is_admin_user(current_user) and bt.house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="Access denied")

    old_values = jsonable_encoder(BpTargetResponse.model_validate(bt).model_dump())

    if payload.ga_target is not None:
        bt.ga_target = payload.ga_target
    if payload.ev_secondary is not None:
        bt.ev_secondary = payload.ev_secondary
    if payload.sc_secondary is not None:
        bt.sc_secondary = payload.sc_secondary
    if payload.total_recharge is not None:
        bt.total_recharge = payload.total_recharge
    if payload.extra_targets is not None:
        bt.extra_targets = payload.extra_targets
    bt.updated_at = datetime.utcnow()

    await db.commit()

    r = await db.execute(
        select(BpTarget)
        .options(joinedload(BpTarget.employee), joinedload(BpTarget.house))
        .where(BpTarget.id == target_id)
    )
    bt = r.unique().scalar_one()
    new_values = jsonable_encoder(BpTargetResponse.model_validate(bt).model_dump())
    emp_result = await db.execute(select(Employee).where(Employee.id == bt.employee_id))
    emp = emp_result.scalar_one_or_none()
    record_identifier = emp.employee_id if emp else f"BP #{bt.employee_id}"

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="bp_targets",
        action="edit",
        record_id=bt.id,
        record_identifier=record_identifier,
        old_values=old_values,
        new_values=new_values,
        request=request,
        status_code=200,
    )

    return {
        "success": True,
        "data": new_values,
        "message": "BP target updated successfully",
    }


@router.delete("/{target_id}")
async def delete_bp_target(
    target_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("bp_targets.delete")),
):
    bt = await db.execute(
        select(BpTarget)
        .options(joinedload(BpTarget.employee), joinedload(BpTarget.house))
        .where(BpTarget.id == target_id)
    )
    bt = bt.unique().scalar_one_or_none()
    if not bt:
        raise HTTPException(status_code=404, detail="BP target not found")

    user_house_ids = [h.id for h in current_user.houses]
    if not is_admin_user(current_user) and bt.house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="Access denied")

    old_values = jsonable_encoder(BpTargetResponse.model_validate(bt).model_dump())

    emp_result = await db.execute(select(Employee).where(Employee.id == bt.employee_id))
    emp = emp_result.scalar_one_or_none()
    record_identifier = emp.employee_id if emp else f"BP #{bt.employee_id}"

    await db.delete(bt)
    await db.commit()

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="bp_targets",
        action="delete",
        record_id=target_id,
        record_identifier=record_identifier,
        old_values=old_values,
        request=request,
        status_code=200,
    )

    return {"success": True, "message": "BP target deleted successfully"}


@router.get("/check-distributed")
async def check_bp_targets_distributed(
    target_date: str = Query(...),
    query_house_id: Optional[int] = Query(None, alias="house_id"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("bp_targets.view")),
    house_context: Optional[int] = Depends(get_house_context),
):
    try:
        td = datetime.strptime(target_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")
    if td.day != 1:
        td = date(td.year, td.month, 1)

    target_house_id = query_house_id or house_context
    if not target_house_id:
        return {"distributed": False, "count": 0}

    result = await db.execute(
        select(sa_func.count()).where(
            BpTarget.house_id == target_house_id,
            BpTarget.target_date == td,
        )
    )
    count = result.scalar() or 0
    return {"distributed": count > 0, "count": count}


@router.post("/distribute")
async def distribute_bp_targets(
    request: Request,
    target_date: str = Query(...),
    overwrite: bool = Query(False),
    query_house_id: Optional[int] = Query(None, alias="house_id"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("bp_targets.edit")),
    house_context: Optional[int] = Depends(get_house_context),
):
    try:
        td = datetime.strptime(target_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format, use YYYY-MM-DD")

    if td.day != 1:
        td = date(td.year, td.month, 1)

    target_house_id = query_house_id or house_context
    if not target_house_id:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            target_house_id = user_house_ids[0]
        elif is_admin_user(current_user):
            result = await db.execute(select(House).order_by(House.id).limit(1))
            first_house = result.scalar_one_or_none()
            if not first_house:
                raise HTTPException(status_code=400, detail="No house found")
            target_house_id = first_house.id
        else:
            raise HTTPException(status_code=400, detail="No house found")

    house_target_res = await db.execute(
        select(HouseTarget).where(
            HouseTarget.house_id == target_house_id,
            HouseTarget.target_date == td,
        )
    )
    house_target = house_target_res.scalar_one_or_none()
    if not house_target or not house_target.bp_ga:
        raise HTTPException(status_code=404, detail="No BP GA target found for this house/month")

    all_house_emps = await db.execute(
        select(Employee)
        .options(joinedload(Employee.user).selectinload(User.roles))
        .where(
            Employee.house_id == target_house_id,
            (Employee.status == "Active") | (Employee.status.is_(None)),
        )
    )
    all_emps = all_house_emps.unique().scalars().all()
    bp_list = []
    for emp in all_emps:
        user_roles = [r.name.lower() for r in emp.user.roles] if emp.user else []
        if "bp" in user_roles:
            bp_list.append(emp)
    if not bp_list:
        raise HTTPException(status_code=404, detail="No active BPs found in this house")

    per_bp_target = house_target.bp_ga // len(bp_list)
    created = 0

    if overwrite:
        await db.execute(
            delete(BpTarget).where(
                BpTarget.house_id == target_house_id,
                BpTarget.target_date == td,
            )
        )

    for bp in bp_list:
        if not overwrite:
            existing = await db.execute(
                select(BpTarget).where(
                    BpTarget.employee_id == bp.id,
                    BpTarget.target_date == td,
                )
            )
            if existing.scalar_one_or_none():
                continue
        bt = BpTarget(
            house_id=target_house_id,
            employee_id=bp.id,
            ga_target=per_bp_target,
            target_date=td,
        )
        db.add(bt)
        created += 1

    await db.commit()

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="bp_targets",
        action="create",
        record_identifier=f"Distributed {created} BP targets for {td}",
        new_values={"target_date": str(td), "house_id": target_house_id, "created": created},
        request=request,
        status_code=200,
    )

    return {
        "success": True,
        "message": f"Distributed {house_target.bp_ga} BP GA target among {len(bp_list)} BPs ({per_bp_target} each)",
        "created": created,
    }
