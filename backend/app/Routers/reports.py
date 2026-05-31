from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload
from datetime import datetime, date

from app.Routers.deps import get_db, has_permission, get_house_context, get_current_user
from app.Models.user import User
from app.Models.activation import Activation
from app.Models.live_activation import LiveActivation
from app.Models.itopup_detail import ITopUpDetail
from app.Models.scratch_card_issue import ScratchCardIssue
from app.Models.sim_issue import SimIssue
from app.Models.ga_filter import RetailerFilter
from app.Models.employee import Employee
from app.Utils.access_control import is_admin_user
from app.Utils.activation_rules import get_excluded_codes, exclude_clause
from app.Services.Automation.activation_excel import export_activations_excel
from app.Services.Automation.dms_report_excel import export_itopup_details_excel
from app.Services.Automation.live_activation_excel import export_live_activations_excel
from app.Services.Automation.issue_reports_excel import export_scratch_card_excel, export_sim_issue_excel

router = APIRouter(prefix="/api", tags=["reports"])

@router.get("/activations")
async def get_activations(
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_activations")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(Activation).options(joinedload(Activation.house))
    if house_id: query = query.where(Activation.house_id == house_id)
    if search:
        p = f"%{search}%"
        query = query.where(
            (Activation.sim_no.ilike(p)) | (Activation.retailer_code.ilike(p)) |
            (Activation.retailer_name.ilike(p)) | (Activation.msisdn.ilike(p))
        )
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.execute(count_query)
    total_count = total.scalar()
    result = await db.execute(query.offset(skip).limit(limit).order_by(Activation.id.desc()))
    records = result.scalars().all()
    return {"total": total_count, "data": records}

@router.get("/activations/export")
async def export_activations(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("export_activations")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(Activation).options(joinedload(Activation.house))
    if house_id: query = query.where(Activation.house_id == house_id)
    if start_date:
        try: sd = datetime.strptime(start_date, "%Y-%m-%d").date()
        except: return Response("Invalid start_date format", status_code=400)
        query = query.where(Activation.activation_date >= sd)
    if end_date:
        try: ed = datetime.strptime(end_date, "%Y-%m-%d").date()
        except: return Response("Invalid end_date format", status_code=400)
        query = query.where(Activation.activation_date <= ed)
    result = await db.execute(query.order_by(Activation.id.desc()))
    records = result.scalars().all()
    excel_data = await export_activations_excel(records)
    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=activations.xlsx"}
    )

@router.get("/itopup-details")
async def get_itopup_details(
    search: Optional[str] = None,
    report_type: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_itopup")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(ITopUpDetail).options(joinedload(ITopUpDetail.house), joinedload(ITopUpDetail.retailer))
    if house_id: query = query.where(ITopUpDetail.house_id == house_id)
    if report_type: query = query.where(ITopUpDetail.report_type == report_type)
    if search:
        p = f"%{search}%"
        query = query.where(ITopUpDetail.report_type.ilike(p))
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.execute(count_query)
    total_count = total.scalar()
    result = await db.execute(query.offset(skip).limit(limit).order_by(ITopUpDetail.id.desc()))
    records = result.scalars().all()
    return {"total": total_count, "data": records}

@router.get("/itopup-details/export")
async def export_itopup_details(db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("export_itopup")), house_id: Optional[int] = Depends(get_house_context)):
    query = select(ITopUpDetail).options(joinedload(ITopUpDetail.house), joinedload(ITopUpDetail.retailer))
    if house_id: query = query.where(ITopUpDetail.house_id == house_id)
    result = await db.execute(query.order_by(ITopUpDetail.id.desc()))
    records = result.scalars().all()
    excel_data = await export_itopup_details_excel(records)
    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=itopup_details.xlsx"}
    )

@router.get("/live-activations")
async def get_live_activations(
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_live_activations")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(LiveActivation).options(joinedload(LiveActivation.house))
    if house_id: query = query.where(LiveActivation.house_id == house_id)
    if search:
        p = f"%{search}%"
        query = query.where(
            (LiveActivation.sim_no.ilike(p)) | (LiveActivation.retailer_code.ilike(p)) |
            (LiveActivation.retailer_name.ilike(p)) | (LiveActivation.msisdn.ilike(p))
        )
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.execute(count_query)
    total_count = total.scalar()
    result = await db.execute(query.offset(skip).limit(limit).order_by(LiveActivation.id.desc()))
    records = result.scalars().all()
    return {"total": total_count, "data": records}

@router.get("/live-activations/export")
async def export_live_activations(db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("export_live_activations")), house_id: Optional[int] = Depends(get_house_context)):
    query = select(LiveActivation).options(joinedload(LiveActivation.house))
    if house_id: query = query.where(LiveActivation.house_id == house_id)
    result = await db.execute(query.order_by(LiveActivation.id.desc()))
    records = result.scalars().all()
    excel_data = await export_live_activations_excel(records)
    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=live_activations.xlsx"}
    )

@router.get("/scratch-card")
async def get_scratch_card(
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_scratch_card")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(ScratchCardIssue)
    if house_id: query = query.where(ScratchCardIssue.house_id == house_id)
    if search:
        p = f"%{search}%"
        query = query.where(
            (ScratchCardIssue.distributor_code.ilike(p)) | (ScratchCardIssue.retailer_code.ilike(p)) |
            (ScratchCardIssue.retailer_name.ilike(p)) | (ScratchCardIssue.product_name.ilike(p))
        )
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.execute(count_query)
    total_count = total.scalar()
    result = await db.execute(query.offset(skip).limit(limit).order_by(ScratchCardIssue.id.desc()))
    records = result.scalars().all()
    return {"total": total_count, "data": records}

@router.get("/scratch-card/export")
async def export_scratch_card(db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("export_scratch_card")), house_id: Optional[int] = Depends(get_house_context)):
    query = select(ScratchCardIssue)
    if house_id: query = query.where(ScratchCardIssue.house_id == house_id)
    result = await db.execute(query.order_by(ScratchCardIssue.id.desc()))
    records = result.scalars().all()
    excel_data = await export_scratch_card_excel(records)
    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=scratch_card.xlsx"}
    )

@router.get("/sim-issues")
async def get_sim_issues(
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_sim_issues")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(SimIssue)
    if house_id: query = query.where(SimIssue.house_id == house_id)
    if search:
        p = f"%{search}%"
        query = query.where(
            (SimIssue.sim_no.ilike(p)) | (SimIssue.distributor_code.ilike(p)) |
            (SimIssue.retailer_code.ilike(p)) | (SimIssue.retailer_name.ilike(p)) |
            (SimIssue.product_name.ilike(p))
        )
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.execute(count_query)
    total_count = total.scalar()
    result = await db.execute(query.offset(skip).limit(limit).order_by(SimIssue.id.desc()))
    records = result.scalars().all()
    return {"total": total_count, "data": records}

@router.get("/sim-issues/export")
async def export_sim_issues(db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("export_sim_issues")), house_id: Optional[int] = Depends(get_house_context)):
    query = select(SimIssue)
    if house_id: query = query.where(SimIssue.house_id == house_id)
    result = await db.execute(query.order_by(SimIssue.id.desc()))
    records = result.scalars().all()
    excel_data = await export_sim_issue_excel(records)
    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=sim_issues.xlsx"}
    )

@router.get("/activations/report")
async def get_activation_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    exclude_tags: Optional[str] = Query(None, description="Comma-separated tag names to exclude (e.g. DRC,RSP,BSP)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_reports")),
    house_id: Optional[int] = Depends(get_house_context)
):
    excluded_codes = await get_excluded_codes(db)
    query = select(Activation).options(joinedload(Activation.house), joinedload(Activation.retailer))
    count_query = select(func.count()).select_from(Activation)
    is_admin = is_admin_user(current_user)
    effective_house_id = house_id
    if not effective_house_id and not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(Activation.house_id.in_(user_house_ids))
            count_query = count_query.where(Activation.house_id.in_(user_house_ids))
    elif effective_house_id:
        query = query.where(Activation.house_id == effective_house_id)
        count_query = count_query.where(Activation.house_id == effective_house_id)
    clause = exclude_clause(Activation, excluded_codes)
    if clause is not None:
        query = query.where(clause)
        count_query = count_query.where(clause)
    if start_date:
        try: sd = datetime.strptime(start_date, "%Y-%m-%d").date()
        except: raise HTTPException(status_code=400, detail="Invalid start_date format, use YYYY-MM-DD")
        query = query.where(Activation.activation_date >= sd)
        count_query = count_query.where(Activation.activation_date >= sd)
    if end_date:
        try: ed = datetime.strptime(end_date, "%Y-%m-%d").date()
        except: raise HTTPException(status_code=400, detail="Invalid end_date format, use YYYY-MM-DD")
        query = query.where(Activation.activation_date <= ed)
        count_query = count_query.where(Activation.activation_date <= ed)
    if search:
        p = f"%{search}%"
        query = query.where((Activation.sim_no.ilike(p)) | (Activation.retailer_code.ilike(p)) | (Activation.retailer_name.ilike(p)) | (Activation.msisdn.ilike(p)))
        count_query = count_query.where((Activation.sim_no.ilike(p)) | (Activation.retailer_code.ilike(p)) | (Activation.retailer_name.ilike(p)) | (Activation.msisdn.ilike(p)))
    total_result = await db.execute(count_query)
    total_count = total_result.scalar()
    excluded_tags_list = []
    excluded_count = 0
    if exclude_tags:
        excluded_tags_list = [t.strip() for t in exclude_tags.split(",") if t.strip()]
        if excluded_tags_list and (effective_house_id or user_house_ids):
            house_ids_for_exclusion = [effective_house_id] if effective_house_id else (user_house_ids if not is_admin else None)
            excl_query = select(RetailerFilter.retailer_id).where(RetailerFilter.tag.in_(excluded_tags_list))
            if house_ids_for_exclusion:
                excl_query = excl_query.where(RetailerFilter.house_id.in_(house_ids_for_exclusion))
            excluded_ids_result = await db.execute(excl_query)
            excluded_retailer_ids = [row[0] for row in excluded_ids_result.all()]
            if excluded_retailer_ids:
                query = query.where(Activation.retailer_id.notin_(excluded_retailer_ids))
                excl_count_query = select(func.count()).select_from(Activation).where(Activation.retailer_id.in_(excluded_retailer_ids))
                if effective_house_id:
                    excl_count_query = excl_count_query.where(Activation.house_id == effective_house_id)
                if start_date:
                    excl_count_query = excl_count_query.where(Activation.activation_date >= sd)
                if end_date:
                    excl_count_query = excl_count_query.where(Activation.activation_date <= ed)
                excl_total = await db.execute(excl_count_query)
                excluded_count = excl_total.scalar()
    offset = (page - 1) * page_size
    result = await db.execute(query.offset(offset).limit(page_size).order_by(Activation.id.desc()))
    records = result.unique().scalars().all()
    data = []
    for r in records:
        item = {
            "id": r.id, "house_id": r.house_id, "retailer_id": r.retailer_id,
            "activation_date": r.activation_date.isoformat() if r.activation_date else None,
            "retailer_code": r.retailer_code, "retailer_name": r.retailer_name,
            "sim_no": r.sim_no, "msisdn": r.msisdn, "product_name": r.product_name,
            "selling_price": r.selling_price, "thana": r.thana,
            "house": {"id": r.house.id, "name": r.house.name} if r.house else None
        }
        data.append(item)
    return {
        "total_activations": total_count, "excluded_count": excluded_count,
        "filtered_total": total_count - excluded_count, "excluded_tags": excluded_tags_list,
        "page": page, "page_size": page_size, "data": data
    }
