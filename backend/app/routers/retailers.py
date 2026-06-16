import os
import shutil
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Query, Response
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.routers.deps import get_db, has_permission, get_house_context
from app.schemas.pagination import PaginationParams, PaginatedResponse, PaginationMeta
from app.models.retailer import Retailer
from app.models.employee import Employee
from app.models.user import User
from app.utils.access_control import is_admin_user
from app.utils.validation import safe_filename, validate_excel
from app.services.Automation.retailer_excel import process_retailer_excel, export_retailers_excel

router = APIRouter(prefix="/api/retailers", tags=["retailers"])

@router.get("")
async def get_retailers(
    pagination: PaginationParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("retailers.view")),
    house_id: Optional[int] = Depends(get_house_context)
):
    base_query = select(Retailer).options(
        joinedload(Retailer.house),
        joinedload(Retailer.employee).selectinload(Employee.user)
    )
    is_admin = is_admin_user(current_user)
    if house_id:
        base_query = base_query.where(Retailer.house_id == house_id)
    elif is_admin:
        pass
    else:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            base_query = base_query.where(Retailer.house_id.in_(user_house_ids))
        else:
            base_query = base_query.where(Retailer.house_id == -1)
    if pagination.search:
        search_pattern = f"%{pagination.search}%"
        base_query = base_query.where(
            (Retailer.name.ilike(search_pattern)) |
            (Retailer.retailer_code.ilike(search_pattern)) |
            (Retailer.itop_number.ilike(search_pattern))
        )

    count_query = select(func.count()).select_from(base_query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    sort_column = getattr(Retailer, pagination.sort_by, Retailer.id)
    order = sort_column.asc() if pagination.sort_order == "asc" else sort_column.desc()
    offset = (pagination.page - 1) * pagination.per_page
    result = await db.execute(base_query.offset(offset).limit(pagination.per_page).order_by(order))
    retailers = result.scalars().unique().all()

    total_pages = max(1, -(-total // pagination.per_page))
    data = []
    for r in retailers:
        item = {
            "id": r.id, "house_id": r.house_id, "retailer_code": r.retailer_code,
            "name": r.name, "type": r.type, "enabled": r.enabled,
            "sim_seller": r.sim_seller, "tran_mobile_no": r.tran_mobile_no,
            "itop_sr_number": r.itop_sr_number, "itop_number": r.itop_number,
            "service_point": r.service_point, "category": r.category,
            "owner_name": r.owner_name, "contact_no": r.contact_no,
            "district": r.district, "thana": r.thana, "address": r.address,
            "nid": r.nid, "bp_code": r.bp_code, "bp_number": r.bp_number,
            "dob": r.dob, "route": r.route, "house": None, "employee": None
        }
        if r.house:
            item["house"] = {"id": r.house.id, "name": r.house.name, "code": r.house.code}
        if r.employee:
            item["employee"] = {
                "id": r.employee.id,
                "name": r.employee.user.name if r.employee.user else r.employee.dms_code,
                "itop_number": r.employee.itop_number,
                "dms_code": r.employee.dms_code
            }
        data.append(item)

    return PaginatedResponse(
        success=True,
        data=data,
        pagination=PaginationMeta(
            page=pagination.page,
            per_page=pagination.per_page,
            total=total,
            total_pages=total_pages,
            has_next=pagination.page < total_pages,
            has_prev=pagination.page > 1
        )
    )

@router.get("/by-house/{house_id}")
async def get_retailers_by_house(
    house_id: int,
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("retailers.view"))
):
    is_admin = is_admin_user(current_user)
    if not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if house_id not in user_house_ids:
            raise HTTPException(status_code=403, detail="You do not have access to this house")
    query = select(Retailer).where(Retailer.house_id == house_id)
    if search:
        pattern = f"%{search}%"
        query = query.where(
            (Retailer.name.ilike(pattern)) |
            (Retailer.retailer_code.ilike(pattern)) |
            (Retailer.itop_number.ilike(pattern))
        )
    query = query.order_by(Retailer.name)
    result = await db.execute(query)
    retailers = result.scalars().all()
    return [
        {"id": r.id, "retailer_code": r.retailer_code, "name": r.name, "itop_number": r.itop_number}
        for r in retailers
    ]

@router.post("/import")
async def import_retailers(file: UploadFile = File(...), db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("retailers.import"))):
    if not os.path.exists("temp_downloads"): os.makedirs("temp_downloads")
    filename = file.filename or "upload.xlsx"
    if not validate_excel(filename):
        raise HTTPException(status_code=400, detail="Invalid file type. Only .xlsx and .xls files are allowed.")
    file_path = f"temp_downloads/{safe_filename(filename)}"
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        count, error = await process_retailer_excel(file_path)
        if error: raise HTTPException(status_code=400, detail=error)
        return {"message": f"Successfully imported {count} retailers", "count": count}
    finally:
        if os.path.exists(file_path): os.remove(file_path)

@router.get("/export")
async def export_retailers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("retailers.export")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(Retailer).options(
        joinedload(Retailer.house),
        joinedload(Retailer.employee).selectinload(Employee.user)
    )
    is_admin = is_admin_user(current_user)
    if house_id:
        query = query.where(Retailer.house_id == house_id)
    elif not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(Retailer.house_id.in_(user_house_ids))
        else:
            query = query.where(Retailer.house_id == -1)
    result = await db.execute(query.order_by(Retailer.id.desc()))
    retailers = result.unique().scalars().all()
    excel_data = await export_retailers_excel(retailers)
    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=retailers_export.xlsx"}
    )
