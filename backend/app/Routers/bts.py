import os
import shutil
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Query, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.Routers.deps import get_db, has_permission, get_house_context
from app.Schemas.bts import BTSSchema
from app.Models.bts import BTS
from app.Models.user import User
from app.Utils.access_control import is_admin_user
from app.Utils.validation import safe_filename, validate_excel
from app.Services.Automation.bts_excel import process_bts_excel, export_bts_excel
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/bts", tags=["bts"])

@router.get("", response_model=list[BTSSchema])
async def get_bts(
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 20,
    thana: Optional[str] = None,
    filter_house_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_bts")),
    house_id: Optional[int] = Depends(get_house_context)
):
    effective_house_id = filter_house_id or house_id
    query = select(BTS)
    is_admin = is_admin_user(current_user)
    if effective_house_id:
        query = query.where(BTS.house_id == effective_house_id)
    elif is_admin:
        pass
    else:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(BTS.house_id.in_(user_house_ids))
        else:
            query = query.where(BTS.house_id == -1)
    if thana:
        query = query.where(BTS.thana.ilike(f"%{thana}%"))
    if search:
        search_pattern = f"%{search}%"
        query = query.where(
            (BTS.site_id.ilike(search_pattern)) |
            (BTS.bts_code.ilike(search_pattern)) |
            (BTS.address.ilike(search_pattern))
        )
    result = await db.execute(query.offset(skip).limit(limit).order_by(BTS.site_id))
    return result.scalars().all()

@router.post("/import")
async def import_bts(file: UploadFile = File(...), db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("import_bts"))):
    if not os.path.exists("temp_downloads"): os.makedirs("temp_downloads")
    filename = file.filename or "upload.xlsx"
    if not validate_excel(filename):
        raise HTTPException(status_code=400, detail="Invalid file type. Only .xlsx and .xls files are allowed.")
    file_path = f"temp_downloads/{safe_filename(filename)}"
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        async def progress(msg: str):
            logger.info(f"BTS Import: {msg}")
        count, error = await process_bts_excel(file_path, progress)
        if error: raise HTTPException(status_code=400, detail=error)
        return {"message": f"Successfully imported {count} BTS stations", "count": count}
    finally:
        if os.path.exists(file_path): os.remove(file_path)

@router.get("/export")
async def export_bts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("export_bts")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(BTS)
    is_admin = is_admin_user(current_user)
    if house_id:
        query = query.where(BTS.house_id == house_id)
    elif not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(BTS.house_id.in_(user_house_ids))
        else:
            query = query.where(BTS.house_id == -1)
    result = await db.execute(query.order_by(BTS.site_id))
    bts_list = result.scalars().all()
    excel_data = await export_bts_excel(bts_list)
    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=bts_export.xlsx"}
    )

@router.get("/filters")
async def get_bts_filters(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_bts")),
    filter_house_id: Optional[int] = Query(None),
    house_id: Optional[int] = Depends(get_house_context)
):
    effective_house_id = filter_house_id or house_id
    query = select(BTS.thana).distinct()
    is_admin = is_admin_user(current_user)
    if effective_house_id:
        query = query.where(BTS.house_id == effective_house_id)
    elif not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(BTS.house_id.in_(user_house_ids))
        else:
            query = query.where(BTS.house_id == -1)
    result = await db.execute(query.order_by(BTS.thana))
    thanas = [row[0] for row in result.all() if row[0]]
    return {"thanas": thanas}
