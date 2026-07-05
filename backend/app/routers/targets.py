from typing import Optional, List

from fastapi import APIRouter, Depends, Query, Response, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload
from datetime import date, datetime

from app.routers.deps import get_db, has_permission, has_any_permission, get_house_context, get_current_user
from app.schemas.pagination import PaginationParams, PaginatedResponse, PaginationMeta
from app.models.house_target import HouseTarget
from app.models.supervisor_target import SupervisorTarget
from app.models.rso_target import RSOTarget
from app.models.employee import Employee
from app.models.user import User
from app.schemas.house_target import HouseTargetCreate, HouseTargetUpdate
from app.schemas.supervisor_target import SupervisorTargetCreate, SupervisorTargetUpdate
from app.schemas.rso_target import RSOTargetCreate, RSOTargetUpdate
from app.services.Automation.target_excel import (
    export_house_targets_excel,
    export_supervisor_targets_excel,
    export_rso_targets_excel,
    generate_house_target_sample_bytes,
    generate_supervisor_target_sample_bytes,
    generate_rso_target_sample_bytes
)

router = APIRouter(prefix="/api", tags=["targets"])

@router.get("/house-targets")
async def get_house_targets(
    search: Optional[str] = None,
    target_date_param: Optional[str] = Query(None, alias="target_date"),
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(has_permission("targets.view")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(HouseTarget).options(joinedload(HouseTarget.house))
    if house_id: query = query.where(HouseTarget.house_id == house_id)
    if target_date_param:
        query = query.where(HouseTarget.target_date == date.fromisoformat(target_date_param))
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.execute(count_query)
    total_count = total.scalar()
    result = await db.execute(query.offset(skip).limit(limit).order_by(HouseTarget.id.desc()))
    records = result.scalars().all()
    return {"total": total_count, "data": records}

@router.post("/house-targets", status_code=201)
async def create_house_target(
    payload: HouseTargetCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("targets.edit")),
):
    try:
        target_date = datetime.strptime(payload.target_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid target_date format. Use YYYY-MM-DD.")

    exist = await db.execute(
        select(HouseTarget).where(
            HouseTarget.house_id == payload.house_id,
            HouseTarget.target_date == target_date
        )
    )
    if exist.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Target already exists for this house and date")

    total_recharge = (payload.ev_c2c_target or 0) + (payload.sc_primary_target or 0)
    record = HouseTarget(
        house_id=payload.house_id,
        target_date=target_date,
        ev_c2c_target=payload.ev_c2c_target or 0,
        sc_primary_target=payload.sc_primary_target or 0,
        total_recharge_target=total_recharge,
        total_ga_target=payload.total_ga_target or 0,
        bp_ga=payload.bp_ga or 0,
        rso_ga=payload.rso_ga or 0,
        ev_scr=payload.ev_scr or 0,
        sso=payload.sso or 0,
        lso=payload.lso or 0,
        bso=payload.bso or 0,
        ddso=payload.ddso or 0,
        extra_targets=payload.extra_targets or {},
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record

@router.put("/house-targets/{target_id}")
async def update_house_target(
    target_id: int,
    payload: HouseTargetUpdate,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(has_permission("targets.edit")),
):
    query = select(HouseTarget).where(HouseTarget.id == target_id)
    result = await db.execute(query)
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="House target not found")

    update_data = payload.model_dump(exclude_unset=True)
    if 'ev_c2c_target' in update_data or 'sc_primary_target' in update_data:
        ev = update_data.get('ev_c2c_target', record.ev_c2c_target) or 0
        sc = update_data.get('sc_primary_target', record.sc_primary_target) or 0
        update_data['total_recharge_target'] = ev + sc
    for key, value in update_data.items():
        setattr(record, key, value)
    record.updated_at = func.now()
    await db.commit()
    await db.refresh(record)
    return record

@router.delete("/house-targets/{target_id}", status_code=204)
async def delete_house_target(
    target_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("targets.edit")),
):
    query = select(HouseTarget).where(HouseTarget.id == target_id)
    result = await db.execute(query)
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="House target not found")

    await db.delete(record)
    await db.commit()
    return

@router.get("/house-targets/sample")
async def download_house_target_sample(
    current_user = Depends(has_any_permission(["targets.view", "targets.import"])),
):
    excel_data = generate_house_target_sample_bytes()
    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=house_targets_sample.xlsx"}
    )

@router.get("/house-targets/export")
async def export_house_targets(db: AsyncSession = Depends(get_db), current_user = Depends(has_permission("targets.export")), house_id: Optional[int] = Depends(get_house_context)):
    query = select(HouseTarget).options(joinedload(HouseTarget.house))
    if house_id: query = query.where(HouseTarget.house_id == house_id)
    result = await db.execute(query.order_by(HouseTarget.id.desc()))
    records = result.scalars().all()
    excel_data = await export_house_targets_excel(records)
    return Response(content=excel_data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=house_targets.xlsx"})

@router.get("/house-targets/{target_id}")
async def get_house_target(
    target_id: int,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(has_permission("targets.view")),
):
    query = select(HouseTarget).options(joinedload(HouseTarget.house)).where(
        HouseTarget.id == target_id
    )
    result = await db.execute(query)
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="House target not found")
    return record

@router.get("/supervisor-targets")
async def get_supervisor_targets(
    pagination: PaginationParams = Depends(),
    target_date_param: Optional[str] = Query(None, alias="target_date"),
    db: AsyncSession = Depends(get_db),
    current_user = Depends(has_permission("targets.view")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = (
        select(SupervisorTarget)
        .options(joinedload(SupervisorTarget.house), joinedload(SupervisorTarget.employee).joinedload(Employee.user))
    )
    if house_id: query = query.where(SupervisorTarget.house_id == house_id)
    if target_date_param:
        query = query.where(SupervisorTarget.target_date == date.fromisoformat(target_date_param))
    if pagination.search:
        query = query.where(SupervisorTarget.employee.has(Employee.dms_code.ilike(f"%{pagination.search}%")))
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.execute(count_query)
    total_count = total.scalar()
    offset = (pagination.page - 1) * pagination.per_page
    result = await db.execute(query.offset(offset).limit(pagination.per_page).order_by(SupervisorTarget.id.desc()))
    records = result.unique().scalars().all()
    total_pages = max(1, (total_count + pagination.per_page - 1) // pagination.per_page)
    return {
        "success": True,
        "data": records,
        "pagination": {
            "page": pagination.page,
            "per_page": pagination.per_page,
            "total": total_count,
            "total_pages": total_pages,
            "has_next": pagination.page < total_pages,
            "has_prev": pagination.page > 1,
        }
    }

@router.get("/supervisor-targets/sample")
async def download_supervisor_target_sample(
    current_user = Depends(has_any_permission(["targets.view", "targets.import"])),
):
    excel_data = generate_supervisor_target_sample_bytes()
    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=supervisor_targets_sample.xlsx"}
    )

@router.get("/supervisor-targets/export")
async def export_supervisor_targets(db: AsyncSession = Depends(get_db), current_user = Depends(has_permission("targets.export")), house_id: Optional[int] = Depends(get_house_context)):
    query = select(SupervisorTarget).options(joinedload(SupervisorTarget.house))
    if house_id: query = query.where(SupervisorTarget.house_id == house_id)
    result = await db.execute(query.order_by(SupervisorTarget.id.desc()))
    records = result.scalars().all()
    excel_data = await export_supervisor_targets_excel(records)
    return Response(content=excel_data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=supervisor_targets.xlsx"})

@router.post("/supervisor-targets", status_code=201)
async def create_supervisor_target(
    payload: SupervisorTargetCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("targets.edit")),
    house_id: Optional[int] = Depends(get_house_context),
):
    try:
        target_date = datetime.strptime(payload.target_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid target_date format. Use YYYY-MM-DD.")

    target_house_id = payload.house_id or house_id
    if not target_house_id:
        employee = await db.get(Employee, payload.employee_id)
        if employee: target_house_id = employee.house_id

    exist = await db.execute(
        select(SupervisorTarget).where(
            SupervisorTarget.employee_id == payload.employee_id,
            SupervisorTarget.target_date == target_date
        )
    )
    if exist.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Target already exists for this supervisor and date")

    total_recharge = (payload.ev_secondary or 0) + (payload.sc_secondary or 0)
    record = SupervisorTarget(
        house_id=target_house_id,
        employee_id=payload.employee_id,
        target_date=target_date,
        ev_secondary=payload.ev_secondary or 0,
        sc_secondary=payload.sc_secondary or 0,
        total_recharge=total_recharge,
        total_ga=payload.total_ga or 0,
        bp_ga=payload.bp_ga or 0,
        rso_ga=payload.rso_ga or 0,
        sso=payload.sso or 0,
        lso=payload.lso or 0,
        bso=payload.bso or 0,
        ddso=payload.ddso or 0,
        dsso=payload.dsso or 0,
        dso=payload.dso or 0,
        dlso=payload.dlso or 0,
        extra_targets=payload.extra_targets or {},
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record

@router.put("/supervisor-targets/{target_id}")
async def update_supervisor_target(
    target_id: int,
    payload: SupervisorTargetUpdate,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(has_permission("targets.edit")),
):
    query = select(SupervisorTarget).where(SupervisorTarget.id == target_id)
    result = await db.execute(query)
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Supervisor target not found")

    update_data = payload.model_dump(exclude_unset=True)
    if 'ev_secondary' in update_data or 'sc_secondary' in update_data:
        ev = update_data.get('ev_secondary', record.ev_secondary) or 0
        sc = update_data.get('sc_secondary', record.sc_secondary) or 0
        update_data['total_recharge'] = ev + sc
    for key, value in update_data.items():
        setattr(record, key, value)
    record.updated_at = func.now()
    await db.commit()
    await db.refresh(record)
    return record

@router.delete("/supervisor-targets/{target_id}", status_code=204)
async def delete_supervisor_target(
    target_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("targets.edit")),
):
    query = select(SupervisorTarget).where(SupervisorTarget.id == target_id)
    result = await db.execute(query)
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Supervisor target not found")

    await db.delete(record)
    await db.commit()
    return

@router.get("/rso-targets")
async def get_rso_targets(
    pagination: PaginationParams = Depends(),
    target_date_param: Optional[str] = Query(None, alias="target_date"),
    market_type: Optional[str] = Query(None),
    filter_house_id: Optional[int] = Query(None, alias="house_id"),
    db: AsyncSession = Depends(get_db),
    current_user = Depends(has_permission("targets.view")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = (
        select(RSOTarget)
        .options(
            joinedload(RSOTarget.house),
            joinedload(RSOTarget.employee).joinedload(Employee.user),
            joinedload(RSOTarget.supervisor).joinedload(Employee.user),
        )
    )
    active_house = filter_house_id or house_id
    if active_house: query = query.where(RSOTarget.house_id == active_house)
    if target_date_param:
        query = query.where(RSOTarget.target_date == date.fromisoformat(target_date_param))
    if market_type:
        query = query.where(RSOTarget.market_type == market_type)
    if pagination.search:
        query = query.where(
            RSOTarget.employee.has(Employee.dms_code.ilike(f"%{pagination.search}%"))
        )
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.execute(count_query)
    total_count = total.scalar()
    offset = (pagination.page - 1) * pagination.per_page
    result = await db.execute(query.offset(offset).limit(pagination.per_page).order_by(RSOTarget.id.desc()))
    records = result.unique().scalars().all()
    total_pages = max(1, (total_count + pagination.per_page - 1) // pagination.per_page)
    return {
        "success": True,
        "data": records,
        "pagination": {
            "page": pagination.page,
            "per_page": pagination.per_page,
            "total": total_count,
            "total_pages": total_pages,
            "has_next": pagination.page < total_pages,
            "has_prev": pagination.page > 1,
        }
    }

@router.get("/rso-targets/sample")
async def download_rso_target_sample(
    current_user = Depends(has_any_permission(["targets.view", "targets.import"])),
):
    excel_data = generate_rso_target_sample_bytes()
    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=rso_targets_sample.xlsx"}
    )

@router.get("/rso-targets/export")
async def export_rso_targets(db: AsyncSession = Depends(get_db), current_user = Depends(has_permission("targets.export")), house_id: Optional[int] = Depends(get_house_context)):
    query = select(RSOTarget).options(joinedload(RSOTarget.house))
    if house_id: query = query.where(RSOTarget.house_id == house_id)
    result = await db.execute(query.order_by(RSOTarget.id.desc()))
    records = result.scalars().all()
    excel_data = await export_rso_targets_excel(records)
    return Response(content=excel_data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=rso_targets.xlsx"})

@router.get("/rso-targets/{target_id}")
async def get_rso_target(
    target_id: int,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(has_permission("targets.view")),
):
    query = select(RSOTarget).options(
        joinedload(RSOTarget.house),
        joinedload(RSOTarget.employee).joinedload(Employee.user),
        joinedload(RSOTarget.supervisor).joinedload(Employee.user),
    ).where(RSOTarget.id == target_id)
    result = await db.execute(query)
    record = result.unique().scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="RSO target not found")
    return record

@router.post("/rso-targets", status_code=201)
async def create_rso_target(
    payload: RSOTargetCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("targets.edit")),
    house_id: Optional[int] = Depends(get_house_context),
):
    try:
        target_date = datetime.strptime(payload.target_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid target_date format. Use YYYY-MM-DD.")

    employee = await db.get(Employee, payload.employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    target_house_id = payload.house_id or house_id or employee.house_id

    exist = await db.execute(
        select(RSOTarget).where(
            RSOTarget.employee_id == payload.employee_id,
            RSOTarget.target_date == target_date
        )
    )
    if exist.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Target already exists for this RSO and date")

    total_recharge = (payload.ev_secondary or 0) + (payload.sc_secondary or 0)
    record = RSOTarget(
        house_id=target_house_id,
        employee_id=payload.employee_id,
        supervisor_id=payload.supervisor_id,
        target_date=target_date,
        ev_secondary=payload.ev_secondary or 0,
        sc_secondary=payload.sc_secondary or 0,
        total_recharge=total_recharge,
        ga=payload.ga or 0,
        sso=payload.sso or 0,
        lso=payload.lso or 0,
        bso=payload.bso or 0,
        ddso=payload.ddso or 0,
        dsso=payload.dsso or 0,
        dso=payload.dso or 0,
        dlso=payload.dlso or 0,
        service_route=payload.service_route,
        market_type=payload.market_type,
        thana_name=payload.thana_name,
        ga_target_modified=payload.ga_target_modified or 0,
        ev_secondary_modified=payload.ev_secondary_modified or 0,
        sc_secondary_modified=payload.sc_secondary_modified or 0,
        recharge_target_modified=payload.recharge_target_modified or 0,
        lso_target_modified=payload.lso_target_modified or 0,
        sso_target_modified=payload.sso_target_modified or 0,
        bso_target_modified=payload.bso_target_modified or 0,
        daily_dso_target_modified=payload.daily_dso_target_modified or 0,
        extra_targets=payload.extra_targets or {},
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record

@router.put("/rso-targets/{target_id}")
async def update_rso_target(
    target_id: int,
    payload: RSOTargetUpdate,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(has_permission("targets.edit")),
):
    query = select(RSOTarget).where(RSOTarget.id == target_id)
    result = await db.execute(query)
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="RSO target not found")

    update_data = payload.model_dump(exclude_unset=True)
    if 'ev_secondary' in update_data or 'sc_secondary' in update_data:
        ev = update_data.get('ev_secondary', record.ev_secondary) or 0
        sc = update_data.get('sc_secondary', record.sc_secondary) or 0
        update_data['total_recharge'] = ev + sc
    for key, value in update_data.items():
        setattr(record, key, value)
    record.updated_at = func.now()
    await db.commit()
    await db.refresh(record)
    return record

@router.delete("/rso-targets/{target_id}", status_code=204)
async def delete_rso_target(
    target_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("targets.edit")),
):
    query = select(RSOTarget).where(RSOTarget.id == target_id)
    result = await db.execute(query)
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="RSO target not found")

    await db.delete(record)
    await db.commit()
    return
