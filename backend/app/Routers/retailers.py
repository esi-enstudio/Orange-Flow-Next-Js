import os
import shutil
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, Query, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.Routers.deps import get_db, has_permission, get_house_context
from app.Schemas.retailer import RetailerSchema
from app.Models.retailer import Retailer
from app.Models.employee import Employee
from app.Models.user import User
from app.Utils.access_control import is_admin_user
from app.Utils.validation import safe_filename, validate_excel
from app.Services.Automation.retailer_excel import process_retailer_excel, export_retailers_excel

router = APIRouter(prefix="/api/retailers", tags=["retailers"])

@router.get("")
async def get_retailers(
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 5000,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_retailers")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(Retailer).options(
        joinedload(Retailer.house),
        joinedload(Retailer.employee).selectinload(Employee.user)
    )
    is_admin = is_admin_user(current_user)
    if house_id:
        query = query.where(Retailer.house_id == house_id)
    elif is_admin:
        pass
    else:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(Retailer.house_id.in_(user_house_ids))
        else:
            query = query.where(Retailer.house_id == -1)
    if search:
        search_pattern = f"%{search}%"
        query = query.where(
            (Retailer.name.ilike(search_pattern)) |
            (Retailer.retailer_code.ilike(search_pattern)) |
            (Retailer.itop_number.ilike(search_pattern))
        )
    result = await db.execute(query.offset(skip).limit(limit).order_by(Retailer.id.desc()))
    retailers = result.scalars().unique().all()
    output = []
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
        output.append(item)
    return output

@router.post("/import")
async def import_retailers(file: UploadFile = File(...), db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("import_retailers"))):
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
    current_user: User = Depends(has_permission("export_retailers")),
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
