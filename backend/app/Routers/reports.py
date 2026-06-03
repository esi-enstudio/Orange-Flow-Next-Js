from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload
from datetime import datetime, date, timedelta
from calendar import monthrange

from app.Routers.deps import get_db, has_permission, get_house_context, get_current_user
from app.Models.user import User
from app.Models.activation import Activation
from app.Models.live_activation import LiveActivation
from app.Models.itopup_detail import ITopUpDetail
from app.Models.scratch_card_issue import ScratchCardIssue
from app.Models.sim_issue import SimIssue
from app.Models.ga_filter import RetailerFilter, FilterTag, RetailerFilter as RetailerFilterModel
from app.Models.retailer import Retailer
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
    query = select(Activation)
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
async def export_itopup_details(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    report_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("export_itopup")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(ITopUpDetail)
    if house_id: query = query.where(ITopUpDetail.house_id == house_id)
    if report_type: query = query.where(ITopUpDetail.report_type == report_type)
    if start_date:
        try: sd = datetime.strptime(start_date, "%Y-%m-%d").date()
        except: return Response("Invalid start_date", status_code=400)
        query = query.where(ITopUpDetail.report_date >= sd)
    if end_date:
        try: ed = datetime.strptime(end_date, "%Y-%m-%d").date()
        except: return Response("Invalid end_date", status_code=400)
        query = query.where(ITopUpDetail.report_date <= ed)
    result = await db.execute(query.order_by(ITopUpDetail.id.desc()).limit(50000))
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
async def export_live_activations(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("export_live_activations")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(LiveActivation)
    if house_id: query = query.where(LiveActivation.house_id == house_id)
    if start_date:
        try: sd = datetime.strptime(start_date, "%Y-%m-%d").date()
        except: return Response("Invalid start_date", status_code=400)
        query = query.where(LiveActivation.activation_date >= sd)
    if end_date:
        try: ed = datetime.strptime(end_date, "%Y-%m-%d").date()
        except: return Response("Invalid end_date", status_code=400)
        query = query.where(LiveActivation.activation_date <= ed)
    result = await db.execute(query.order_by(LiveActivation.id.desc()).limit(50000))
    records = result.scalars().all()
    excel_data = await export_live_activations_excel(records)
    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=live_activations.xlsx"}
    )

@router.delete("/live-activations/truncate")
async def truncate_live_activations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("import_live_activations")),
):
    await db.execute(LiveActivation.__table__.delete())
    await db.commit()
    return {"message": "All live activations deleted successfully"}

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
async def export_scratch_card(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("export_scratch_card")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(ScratchCardIssue)
    if house_id: query = query.where(ScratchCardIssue.house_id == house_id)
    if start_date:
        try: sd = datetime.strptime(start_date, "%Y-%m-%d").date()
        except: return Response("Invalid start_date", status_code=400)
        query = query.where(ScratchCardIssue.issue_date >= sd)
    if end_date:
        try: ed = datetime.strptime(end_date, "%Y-%m-%d").date()
        except: return Response("Invalid end_date", status_code=400)
        query = query.where(ScratchCardIssue.issue_date <= ed)
    result = await db.execute(query.order_by(ScratchCardIssue.id.desc()).limit(50000))
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
async def export_sim_issues(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("export_sim_issues")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(SimIssue)
    if house_id: query = query.where(SimIssue.house_id == house_id)
    if start_date:
        try: sd = datetime.strptime(start_date, "%Y-%m-%d").date()
        except: return Response("Invalid start_date", status_code=400)
        query = query.where(SimIssue.issue_date >= sd)
    if end_date:
        try: ed = datetime.strptime(end_date, "%Y-%m-%d").date()
        except: return Response("Invalid end_date", status_code=400)
        query = query.where(SimIssue.issue_date <= ed)
    result = await db.execute(query.order_by(SimIssue.id.desc()).limit(50000))
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
    house_id: Optional[int] = Depends(get_house_context),
    q_house_id: Optional[int] = Query(None, alias="house_id"),
):
    from app.Services.cache_service import cache_service
    target_house_id = q_house_id or house_id
    if not search and page == 1 and page_size <= 50:
        cache_key = cache_service.cache_key("report", start_date, end_date, exclude_tags, target_house_id)
        cached = await cache_service.get(cache_key)
        if cached:
            return cached
    if q_house_id and not is_admin_user(current_user):
        user_house_ids = [h.id for h in current_user.houses]
        if q_house_id not in user_house_ids:
            raise HTTPException(status_code=403, detail="You do not have access to this house")
    excluded_codes = await get_excluded_codes(db)
    query = select(Activation)
    is_admin = is_admin_user(current_user)
    effective_house_id = target_house_id
    user_house_ids = []
    if not effective_house_id and not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(Activation.house_id.in_(user_house_ids))
    elif effective_house_id:
        query = query.where(Activation.house_id == effective_house_id)
    clause = exclude_clause(Activation, excluded_codes)
    if clause is not None:
        query = query.where(clause)
    today_dt = date.today()
    if not start_date:
        start_date = today_dt.replace(day=1).isoformat()
    if not end_date:
        last = monthrange(today_dt.year, today_dt.month)[1]
        end_date = today_dt.replace(day=last).isoformat()
    if start_date:
        try: sd = datetime.strptime(start_date, "%Y-%m-%d").date()
        except: raise HTTPException(status_code=400, detail="Invalid start_date format, use YYYY-MM-DD")
        query = query.where(Activation.activation_date >= sd)
    if end_date:
        try: ed = datetime.strptime(end_date, "%Y-%m-%d").date()
        except: raise HTTPException(status_code=400, detail="Invalid end_date format, use YYYY-MM-DD")
        query = query.where(Activation.activation_date <= ed)
    if search:
        p = f"%{search}%"
        query = query.where((Activation.sim_no.ilike(p)) | (Activation.retailer_code.ilike(p)) | (Activation.retailer_name.ilike(p)) | (Activation.msisdn.ilike(p)))
    excluded_tags_list = []
    excluded_retailer_ids = []
    if exclude_tags:
        excluded_tags_list = [t.strip() for t in exclude_tags.split(",") if t.strip()]
        if excluded_tags_list:
            house_ids_for_exclusion = [effective_house_id] if effective_house_id else (user_house_ids if not is_admin else None)
            excl_query = select(RetailerFilter.retailer_id).join(FilterTag, RetailerFilter.tag_id == FilterTag.id).where(FilterTag.name.in_(excluded_tags_list))
            if house_ids_for_exclusion:
                excl_query = excl_query.where(RetailerFilter.house_id.in_(house_ids_for_exclusion))
            excluded_ids_result = await db.execute(excl_query)
            excluded_retailer_ids = [row[0] for row in excluded_ids_result.all()]
            if excluded_retailer_ids:
                query = query.where(Activation.retailer_id.notin_(excluded_retailer_ids))
    # Single count query with all filters applied
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total_count = total_result.scalar()
    excluded_count = len(excluded_retailer_ids)  # approximate, not exact
    offset = (page - 1) * page_size
    result = await db.execute(query.offset(offset).limit(page_size).order_by(Activation.id.desc()))
    records = result.scalars().all()

    # Bulk fetch retailer tags
    retailer_ids = [r.retailer_id for r in records if r.retailer_id]
    tags_map: dict[int, list[str]] = {}
    if retailer_ids:
        tag_rows = await db.execute(
            select(RetailerFilter.retailer_id, FilterTag.name)
            .join(FilterTag, RetailerFilter.tag_id == FilterTag.id)
            .where(RetailerFilter.retailer_id.in_(retailer_ids))
        )
        for rid, tname in tag_rows.all():
            tags_map.setdefault(rid, []).append(tname)

    # Bulk fetch RSO info
    rso_map: dict[int, dict] = {}
    if retailer_ids:
        rso_rows = await db.execute(
            select(Retailer.id, Employee.user_id, User.name, Employee.itop_number)
            .join(Employee, Retailer.employee_id == Employee.id)
            .join(User, Employee.user_id == User.id)
            .where(Retailer.id.in_(retailer_ids))
        )
        for rid, uid, uname, itop in rso_rows.all():
            rso_map[rid] = {"name": uname, "itop": itop}

    data = []
    for r in records:
        item = {
            "id": r.id, "house_id": r.house_id, "retailer_id": r.retailer_id,
            "activation_date": r.activation_date.isoformat() if r.activation_date else None,
            "retailer_code": r.retailer_code, "retailer_name": r.retailer_name,
            "retailer_tags": tags_map.get(r.retailer_id, []) if r.retailer_id else [],
            "rso": rso_map.get(r.retailer_id),
            "sim_no": r.sim_no, "msisdn": r.msisdn, "product_name": r.product_name,
            "product_code": r.product_code, "selling_price": r.selling_price, "thana": r.thana,
            "house": {"id": r.house.id, "name": r.house.name, "code": r.house.code} if r.house else None
        }
        data.append(item)
    result = {
        "total_activations": total_count, "excluded_count": excluded_count,
        "filtered_total": total_count - excluded_count, "excluded_tags": excluded_tags_list,
        "page": page, "page_size": page_size, "data": data
    }
    if not search and page == 1 and page_size <= 50:
        await cache_service.set(cache_key, result, ttl=120)
    return result


@router.get("/activations/daily-stats")
async def get_activation_daily_stats(
    month: int = Query(..., ge=1, le=12),
    year: int = Query(..., ge=2020),
    exclude_tags: Optional[str] = Query(None),
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_reports")),
    house_id: Optional[int] = Depends(get_house_context),
    q_house_id: Optional[int] = Query(None, alias="house_id"),
):
    from app.Services.cache_service import cache_service
    target_house_id = q_house_id or house_id
    if q_house_id and not is_admin_user(current_user):
        user_house_ids = [h.id for h in current_user.houses]
        if q_house_id not in user_house_ids:
            raise HTTPException(status_code=403, detail="You do not have access to this house")
    cache_key = cache_service.cache_key("daily_stats", year, month, exclude_tags, target_house_id)
    if not search:
        cached = await cache_service.get(cache_key)
        if cached:
            return cached
    from calendar import monthrange
    start_date = date(year, month, 1)
    last_day = monthrange(year, month)[1]
    end_date = date(year, month, last_day)

    excluded_codes = await get_excluded_codes(db)
    query = (
        select(Activation.activation_date, func.count())
        .select_from(Activation)
        .where(Activation.activation_date >= start_date)
        .where(Activation.activation_date <= end_date)
        .group_by(Activation.activation_date)
        .order_by(Activation.activation_date)
    )
    is_admin = is_admin_user(current_user)
    if not target_house_id and not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(Activation.house_id.in_(user_house_ids))
    elif target_house_id:
        query = query.where(Activation.house_id == target_house_id)
    clause = exclude_clause(Activation, excluded_codes)
    if clause is not None:
        query = query.where(clause)
    if search:
        p = f"%{search}%"
        query = query.where((Activation.sim_no.ilike(p)) | (Activation.retailer_code.ilike(p)) | (Activation.retailer_name.ilike(p)) | (Activation.msisdn.ilike(p)))
    excluded_tags_list = []
    if exclude_tags:
        excluded_tags_list = [t.strip() for t in exclude_tags.split(",") if t.strip()]
        if excluded_tags_list:
            house_ids_for_exclusion = [target_house_id] if target_house_id else ([h.id for h in current_user.houses] if not is_admin else None)
            excl_query = select(RetailerFilter.retailer_id).join(RetailerFilter.tag).where(FilterTag.name.in_(excluded_tags_list))
            if house_ids_for_exclusion:
                excl_query = excl_query.where(RetailerFilter.house_id.in_(house_ids_for_exclusion))
            excluded_ids_result = await db.execute(excl_query)
            excluded_retailer_ids = [row[0] for row in excluded_ids_result.all()]
            if excluded_retailer_ids:
                query = query.where(Activation.retailer_id.notin_(excluded_retailer_ids))
    rows = (await db.execute(query)).all()
    data_map: dict[str, int] = {}
    for row in rows:
        d = row.activation_date
        ds = d.isoformat() if isinstance(d, date) else str(d)
        data_map[ds] = row[1]
    result = []
    d = start_date
    while d <= end_date:
        ds = d.isoformat()
        result.append({"date": ds, "count": data_map.get(ds, 0)})
        d += timedelta(days=1)
    if not search:
        await cache_service.set(cache_key, result, ttl=300)
    return result
