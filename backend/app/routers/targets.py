from typing import Optional

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload
from datetime import date

from app.routers.deps import get_db, has_permission, has_any_permission, get_house_context
from app.models.house_target import HouseTarget
from app.models.supervisor_target import SupervisorTarget
from app.models.rso_target import RSOTarget
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

@router.get("/supervisor-targets")
async def get_supervisor_targets(
    search: Optional[str] = None,
    target_date_param: Optional[str] = Query(None, alias="target_date"),
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(has_permission("targets.view")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(SupervisorTarget).options(joinedload(SupervisorTarget.house))
    if house_id: query = query.where(SupervisorTarget.house_id == house_id)
    if target_date_param:
        query = query.where(SupervisorTarget.target_date == date.fromisoformat(target_date_param))
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.execute(count_query)
    total_count = total.scalar()
    result = await db.execute(query.offset(skip).limit(limit).order_by(SupervisorTarget.id.desc()))
    records = result.scalars().all()
    return {"total": total_count, "data": records}

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

@router.get("/rso-targets")
async def get_rso_targets(
    search: Optional[str] = None,
    target_date_param: Optional[str] = Query(None, alias="target_date"),
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(has_permission("targets.view")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(RSOTarget).options(joinedload(RSOTarget.house))
    if house_id: query = query.where(RSOTarget.house_id == house_id)
    if target_date_param:
        query = query.where(RSOTarget.target_date == date.fromisoformat(target_date_param))
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.execute(count_query)
    total_count = total.scalar()
    result = await db.execute(query.offset(skip).limit(limit).order_by(RSOTarget.id.desc()))
    records = result.scalars().all()
    return {"total": total_count, "data": records}

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
