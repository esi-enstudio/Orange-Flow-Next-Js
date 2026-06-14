from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload
from datetime import datetime, date, timedelta
from calendar import monthrange

from app.routers.deps import get_db, has_permission, get_house_context, get_current_user
from app.models.user import User
from app.models.activation import Activation
from app.models.live_activation import LiveActivation
from app.models.itopup_detail import ITopUpDetail
from app.models.scratch_card_issue import ScratchCardIssue
from app.models.sim_issue import SimIssue
from app.models.ga_filter import RetailerFilter, FilterTag, RetailerFilter as RetailerFilterModel
from app.models.retailer import Retailer
from app.models.employee import Employee
from app.models.role import Role
from app.utils.access_control import is_admin_user
from app.utils.activation_rules import get_excluded_codes, exclude_clause
from app.services.Automation.activation_excel import export_activations_excel
from app.services.Automation.dms_report_excel import export_itopup_details_excel
from app.services.Automation.live_activation_excel import export_live_activations_excel
from app.services.Automation.issue_reports_excel import export_scratch_card_excel, export_sim_issue_excel

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
    activation_date_from: Optional[str] = None,
    activation_date_to: Optional[str] = None,
    activation_time: Optional[str] = None,
    retailer_code: Optional[str] = None,
    retailer_name: Optional[str] = None,
    bts_code: Optional[str] = None,
    thana: Optional[str] = None,
    promotion: Optional[str] = None,
    product_code: Optional[str] = None,
    product_name: Optional[str] = None,
    sim_no: Optional[str] = None,
    msisdn: Optional[str] = None,
    selling_price_min: Optional[str] = None,
    selling_price_max: Optional[str] = None,
    bp_flag: Optional[str] = None,
    bp_number: Optional[str] = None,
    fc_bts_code: Optional[str] = None,
    bio_bts_code: Optional[str] = None,
    dh_lifting_date: Optional[str] = None,
    issue_date: Optional[str] = None,
    subscription_type: Optional[str] = None,
    service_class: Optional[str] = None,
    customer_second_contact: Optional[str] = None,
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
    if activation_date_from:
        try:
            sd = datetime.strptime(activation_date_from, "%Y-%m-%d").date()
            query = query.where(LiveActivation.activation_date >= sd)
        except:
            pass
    if activation_date_to:
        try:
            ed = datetime.strptime(activation_date_to, "%Y-%m-%d").date()
            query = query.where(LiveActivation.activation_date <= ed)
        except:
            pass
    if activation_time: query = query.where(LiveActivation.activation_time.ilike(f"%{activation_time}%"))
    if retailer_code: query = query.where(LiveActivation.retailer_code.ilike(f"%{retailer_code}%"))
    if retailer_name: query = query.where(LiveActivation.retailer_name.ilike(f"%{retailer_name}%"))
    if bts_code: query = query.where(LiveActivation.bts_code.ilike(f"%{bts_code}%"))
    if thana: query = query.where(LiveActivation.thana.ilike(f"%{thana}%"))
    if promotion: query = query.where(LiveActivation.promotion == promotion)
    if product_code: query = query.where(LiveActivation.product_code.ilike(f"%{product_code}%"))
    if product_name: query = query.where(LiveActivation.product_name.ilike(f"%{product_name}%"))
    if sim_no: query = query.where(LiveActivation.sim_no.ilike(f"%{sim_no}%"))
    if msisdn: query = query.where(LiveActivation.msisdn.ilike(f"%{msisdn}%"))
    if selling_price_min: query = query.where(LiveActivation.selling_price >= selling_price_min)
    if selling_price_max: query = query.where(LiveActivation.selling_price <= selling_price_max)
    if bp_flag: query = query.where(LiveActivation.bp_flag == bp_flag)
    if bp_number: query = query.where(LiveActivation.bp_number.ilike(f"%{bp_number}%"))
    if fc_bts_code: query = query.where(LiveActivation.fc_bts_code.ilike(f"%{fc_bts_code}%"))
    if bio_bts_code: query = query.where(LiveActivation.bio_bts_code.ilike(f"%{bio_bts_code}%"))
    if dh_lifting_date: query = query.where(LiveActivation.dh_lifting_date.ilike(f"%{dh_lifting_date}%"))
    if issue_date: query = query.where(LiveActivation.issue_date.ilike(f"%{issue_date}%"))
    if subscription_type: query = query.where(LiveActivation.subscription_type == subscription_type)
    if service_class: query = query.where(LiveActivation.service_class == service_class)
    if customer_second_contact: query = query.where(LiveActivation.customer_second_contact.ilike(f"%{customer_second_contact}%"))
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.execute(count_query)
    total_count = total.scalar()
    result = await db.execute(query.offset(skip).limit(limit).order_by(LiveActivation.id.desc()))
    records = result.scalars().all()
    return {"total": total_count, "data": records}

@router.get("/live-activations/filter-options")
async def get_live_activation_filter_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_live_activations")),
    house_id: Optional[int] = Depends(get_house_context)
):
    base = select(LiveActivation)
    if house_id: base = base.where(LiveActivation.house_id == house_id)

    async def get_distinct(column):
        q = select(column).distinct().where(column.isnot(None)).where(column != "").order_by(column)
        result = await db.execute(q)
        return [row[0] for row in result.all()]

    promotions = await get_distinct(LiveActivation.promotion)
    product_codes = await get_distinct(LiveActivation.product_code)
    product_names = await get_distinct(LiveActivation.product_name)
    subscription_types = await get_distinct(LiveActivation.subscription_type)
    service_classes = await get_distinct(LiveActivation.service_class)
    bp_flags = await get_distinct(LiveActivation.bp_flag)

    return {
        "promotions": promotions,
        "product_codes": product_codes,
        "product_names": product_names,
        "subscription_types": subscription_types,
        "service_classes": service_classes,
        "bp_flags": bp_flags,
    }

@router.get("/live-activations/export")
async def export_live_activations(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    house_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("export_live_activations")),
    header_house_id: Optional[int] = Depends(get_house_context),
):
    if not house_id:
        house_id = header_house_id
    query = select(LiveActivation).options(selectinload(LiveActivation.house), selectinload(LiveActivation.retailer))
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
    from app.services.cache_service import cache_service
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
    from app.services.cache_service import cache_service
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


@router.get("/reports/live-activations")
async def get_ga_live_report(
    house_id: Optional[int] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_live_activations")),
):
    from app.services.ga_live_service import GaLiveQueryBuilder

    is_admin = is_admin_user(current_user)
    user_houses_raw = current_user.houses

    target_house_id = house_id
    if not target_house_id:
        if is_admin:
            raise HTTPException(status_code=400, detail="house_id is required for admin users")
        if len(user_houses_raw) == 1:
            target_house_id = user_houses_raw[0].id
        else:
            raise HTTPException(status_code=400, detail="house_id is required when user has multiple houses")
    else:
        if not is_admin:
            user_house_ids = [h.id for h in user_houses_raw]
            if target_house_id not in user_house_ids:
                raise HTTPException(status_code=403, detail="You do not have access to this house")

    today = date.today()
    if not start_date:
        start_date = today
    else:
        start_date = datetime.strptime(start_date, "%Y-%m-%d").date()
    if not end_date:
        end_date = today
    else:
        end_date = datetime.strptime(end_date, "%Y-%m-%d").date()

    builder = GaLiveQueryBuilder(db, target_house_id, start_date, end_date)
    return await builder.build_all()
