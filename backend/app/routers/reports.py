import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select, func, or_
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
from app.models.bp_retailer_code import BpRetailerCode
from app.models.role import Role
from app.utils.access_control import is_admin_user
from app.utils.activation_rules import get_excluded_codes, exclude_clause
from app.services.Automation.activation_excel import export_activations_excel
from app.services.Automation.dms_report_excel import export_itopup_details_excel
from app.services.Automation.live_activation_excel import export_live_activations_excel
from app.services.Automation.ga_live_performance_excel import export_ga_live_performance_excel
from app.services.Automation.issue_reports_excel import export_scratch_card_excel, export_sim_issue_excel
from app.services.target_achievement_service import TargetAchievementService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["reports"])

@router.get("/activations")
async def get_activations(
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
    product_codes: Optional[str] = None,
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
    employee_id: Optional[int] = None,
    filter_house_id: Optional[int] = Query(None, alias="house_id"),

    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("activations.view")),
    header_house_id: Optional[int] = Depends(get_house_context)
):
    effective_house_id = filter_house_id or header_house_id
    query = select(Activation).options(
        joinedload(Activation.retailer).joinedload(Retailer.employee).joinedload(Employee.user)
    )
    if effective_house_id: query = query.where(Activation.house_id == effective_house_id)

    if employee_id:
        retailer_ids_subq = select(Retailer.id).where(Retailer.employee_id == employee_id)
        query = query.where(Activation.retailer_id.in_(retailer_ids_subq))

    if activation_date_from:
        try: sd = datetime.strptime(activation_date_from, "%Y-%m-%d").date()
        except: pass
        else: query = query.where(Activation.activation_date >= sd)
    if activation_date_to:
        try: ed = datetime.strptime(activation_date_to, "%Y-%m-%d").date()
        except: pass
        else: query = query.where(Activation.activation_date <= ed)
    if activation_time:
        p = f"%{activation_time}%"
        query = query.where(Activation.activation_time.ilike(p))
    if retailer_code:
        p = f"%{retailer_code}%"
        query = query.where(Activation.retailer_code.ilike(p))
    if retailer_name:
        p = f"%{retailer_name}%"
        query = query.where(Activation.retailer_name.ilike(p))
    if bts_code:
        p = f"%{bts_code}%"
        query = query.where(Activation.bts_code.ilike(p))
    if thana:
        p = f"%{thana}%"
        query = query.where(Activation.thana.ilike(p))
    if promotion:
        query = query.where(Activation.promotion == promotion)
    if product_code:
        query = query.where(Activation.product_code == product_code)
    if product_codes:
        codes_list = [c.strip() for c in product_codes.split(",") if c.strip()]
        if codes_list:
            query = query.where(Activation.product_code.in_(codes_list))
    if product_name:
        query = query.where(Activation.product_name == product_name)
    if sim_no:
        p = f"%{sim_no}%"
        query = query.where(Activation.sim_no.ilike(p))
    if msisdn:
        p = f"%{msisdn}%"
        query = query.where(Activation.msisdn.ilike(p))
    if selling_price_min:
        query = query.where(Activation.selling_price >= selling_price_min)
    if selling_price_max:
        query = query.where(Activation.selling_price <= selling_price_max)
    if bp_flag:
        query = query.where(Activation.bp_flag == bp_flag)
    if bp_number:
        p = f"%{bp_number}%"
        query = query.where(Activation.bp_number.ilike(p))
    if fc_bts_code:
        p = f"%{fc_bts_code}%"
        query = query.where(Activation.fc_bts_code.ilike(p))
    if bio_bts_code:
        p = f"%{bio_bts_code}%"
        query = query.where(Activation.bio_bts_code.ilike(p))
    if dh_lifting_date:
        p = f"%{dh_lifting_date}%"
        query = query.where(Activation.dh_lifting_date.ilike(p))
    if issue_date:
        p = f"%{issue_date}%"
        query = query.where(Activation.issue_date.ilike(p))
    if subscription_type:
        query = query.where(Activation.subscription_type == subscription_type)
    if service_class:
        query = query.where(Activation.service_class == service_class)
    if customer_second_contact:
        p = f"%{customer_second_contact}%"
        query = query.where(Activation.customer_second_contact.ilike(p))

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
    records = result.unique().scalars().all()

    data = []
    for r in records:
        item = {
            "id": r.id, "sim_no": r.sim_no, "activation_date": r.activation_date,
            "activation_time": r.activation_time, "retailer_code": r.retailer_code,
            "retailer_name": r.retailer_name, "bts_code": r.bts_code, "thana": r.thana,
            "promotion": r.promotion, "product_code": r.product_code, "product_name": r.product_name,
            "msisdn": r.msisdn, "selling_price": r.selling_price,
            "bp_flag": r.bp_flag, "bp_number": r.bp_number,
            "fc_bts_code": r.fc_bts_code, "bio_bts_code": r.bio_bts_code,
            "dh_lifting_date": r.dh_lifting_date, "issue_date": r.issue_date,
            "subscription_type": r.subscription_type, "service_class": r.service_class,
            "customer_second_contact": r.customer_second_contact,
            "house_id": r.house_id, "rso_name": None, "rso_employee_id": None,
            "rso_dms_code": None, "rso_itop_number": None,
        }
        if r.retailer and r.retailer.employee:
            emp = r.retailer.employee
            item["rso_name"] = emp.user.name if emp.user else emp.dms_code
            item["rso_employee_id"] = emp.id
            item["rso_dms_code"] = emp.dms_code
            item["rso_itop_number"] = emp.itop_number
        data.append(item)

    return {"total": total_count, "data": data}

@router.get("/activations/filter-options")
async def get_activation_filter_options(
    filter_house_id: Optional[int] = Query(None, alias="house_id"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("activations.view")),
    header_house_id: Optional[int] = Depends(get_house_context)
):
    effective_house_id = filter_house_id or header_house_id
    base = select(Activation)
    if effective_house_id: base = base.where(Activation.house_id == effective_house_id)

    async def get_distinct(column):
        q = select(column).distinct().where(column.isnot(None)).where(column != "").order_by(column)
        result = await db.execute(q)
        return [row[0] for row in result.all()]

    promotions = await get_distinct(Activation.promotion)
    product_codes = await get_distinct(Activation.product_code)
    product_names = await get_distinct(Activation.product_name)
    subscription_types = await get_distinct(Activation.subscription_type)
    service_classes = await get_distinct(Activation.service_class)
    bp_flags = await get_distinct(Activation.bp_flag)

    return {
        "promotions": promotions,
        "product_codes": product_codes,
        "product_names": product_names,
        "subscription_types": subscription_types,
        "service_classes": service_classes,
        "bp_flags": bp_flags,
    }

@router.get("/activations/rso-list")
async def get_activation_rso_list(
    filter_house_id: Optional[int] = Query(None, alias="house_id"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("activations.view")),
    header_house_id: Optional[int] = Depends(get_house_context)
):
    effective_house_id = filter_house_id or header_house_id
    base = select(Employee).options(joinedload(Employee.user)).where(Employee.employee_type == "rso")
    if effective_house_id:
        base = base.where(Employee.house_id == effective_house_id)
    result = await db.execute(base.order_by(Employee.id))
    employees = result.scalars().unique().all()
    return [
        {
            "id": e.id,
            "name": e.user.name if e.user else e.dms_code,
            "employee_id": e.employee_id,
            "dms_code": e.dms_code,
        }
        for e in employees
    ]

@router.get("/activations/export")
async def export_activations(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("activations.export")),
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
    current_user: User = Depends(has_permission("itopup.view")),
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
    current_user: User = Depends(has_permission("itopup.export")),
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
    current_user: User = Depends(has_permission("live_activations.view")),
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
    current_user: User = Depends(has_permission("live_activations.view")),
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
    current_user: User = Depends(has_permission("live_activations.export")),
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


@router.get("/reports/live-activations/export-performance")
async def export_ga_live_performance(
    house_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("live_activations.export")),
):
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
    excel_data = await export_ga_live_performance_excel(db, target_house_id, today)
    filename = f"ga_live_performance_{today}.xlsx"
    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@router.delete("/live-activations/truncate")
async def truncate_live_activations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("live_activations.import")),
):
    await db.execute(LiveActivation.__table__.delete())
    await db.commit()
    return {"message": "All live activations deleted successfully"}

@router.delete("/activations/truncate")
async def truncate_activations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("activations.import")),
):
    await db.execute(Activation.__table__.delete())
    await db.commit()
    return {"message": "All activations deleted successfully"}

@router.get("/scratch-card")
async def get_scratch_card(
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card.view")),
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
    current_user: User = Depends(has_permission("scratch_card.export")),
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
    current_user: User = Depends(has_permission("sim_issues.view")),
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
    current_user: User = Depends(has_permission("sim_issues.export")),
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
    current_user: User = Depends(has_permission("reports.view")),
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
    current_user: User = Depends(has_permission("reports.view")),
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
    current_user: User = Depends(has_permission("live_activations.view")),
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

    try:
        builder = GaLiveQueryBuilder(db, target_house_id, start_date, end_date)
        result = await builder.build_all()
        return result
    except Exception as e:
        logger.error(f"GaLive report failed for house_id={target_house_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate report: {str(e)}")


@router.get("/reports/live-activations/live-activations-details")
async def get_employee_activation_details(
    employee_id: int = Query(..., description="Employee (not user) ID"),
    role_type: str = Query(..., description="rso or bp"),
    house_id: Optional[int] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("live_activations.view")),
):
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

    emp = await db.execute(
        select(Employee).where(
            Employee.id == employee_id,
            Employee.house_id == target_house_id,
        )
    )
    emp = emp.scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    base_q = select(LiveActivation).where(
        LiveActivation.house_id == target_house_id,
        LiveActivation.activation_date >= start_date,
        LiveActivation.activation_date <= end_date,
    )

    retailer_codes: list[str] = []
    retailer_ids: list[int] = []

    if role_type == "rso":
        if emp.assisted_retailer_code:
            retailer_codes.append(emp.assisted_retailer_code)
        ret_rows = await db.execute(
            select(Retailer.id, Retailer.retailer_code, Retailer.name)
            .where(Retailer.house_id == target_house_id, Retailer.employee_id == employee_id)
        )
        for r in ret_rows.all():
            if r.id:
                retailer_ids.append(r.id)
            if r.retailer_code and r.retailer_code not in retailer_codes:
                retailer_codes.append(r.retailer_code)
    elif role_type == "bp":
        bp_code_rows = await db.execute(
            select(BpRetailerCode.retailer_code).where(
                BpRetailerCode.house_id == target_house_id,
                BpRetailerCode.bp_employee_id == employee_id,
            )
        )
        for (code,) in bp_code_rows.all():
            if code:
                retailer_codes.append(code)
        if emp.assisted_retailer_code:
            retailer_codes.append(emp.assisted_retailer_code)
    else:
        raise HTTPException(status_code=400, detail="Invalid role_type. Use 'rso' or 'bp'.")

    retailer_codes = list(set(c for c in retailer_codes if c))

    if not retailer_codes and not retailer_ids:
        return {"employee": {"id": emp.id, "name": emp.dms_code or f"#{emp.id}"}, "groups": []}

    filters = []
    if retailer_codes:
        filters.append(LiveActivation.retailer_code.in_(retailer_codes))
    if retailer_ids:
        filters.append(LiveActivation.retailer_id.in_(retailer_ids))

    base_q = base_q.where(or_(*filters))
    base_q = base_q.order_by(LiveActivation.retailer_code, LiveActivation.product_code, LiveActivation.activation_time)

    result = await db.execute(base_q)
    records = result.scalars().all()

    emp_name = (
        (await db.execute(select(User.name).where(User.id == emp.user_id))).scalar()
        if emp.user_id else emp.dms_code or f"#{emp.id}"
    )

    groups: dict[str, dict] = {}
    for rec in records:
        rc = rec.retailer_code or "UNKNOWN"
        pc = rec.product_code or "UNKNOWN"
        if rc not in groups:
            groups[rc] = {"retailer_code": rc, "retailer_name": rec.retailer_name or "", "products": {}}
        if pc not in groups[rc]["products"]:
            groups[rc]["products"][pc] = {"product_code": pc, "product_name": rec.product_name or "", "records": []}
        groups[rc]["products"][pc]["records"].append({
            "retailer_code": rec.retailer_code,
            "retailer_name": rec.retailer_name,
            "activation_time": rec.activation_time,
            "product_code": rec.product_code,
            "product_name": rec.product_name,
            "sim_no": rec.sim_no,
            "msisdn": rec.msisdn,
            "dh_lifting_date": rec.dh_lifting_date,
            "issue_date": rec.issue_date,
            "selling_price": rec.selling_price,
            "subscription_type": rec.subscription_type,
            "service_class": rec.service_class,
        })

    result_groups = []
    for rc in sorted(groups.keys()):
        g = groups[rc]
        product_list = []
        for pc in sorted(g["products"].keys()):
            p = g["products"][pc]
            product_list.append({
                "product_code": p["product_code"],
                "product_name": p["product_name"],
                "count": len(p["records"]),
                "records": p["records"],
            })
        result_groups.append({
            "retailer_code": g["retailer_code"],
            "retailer_name": g["retailer_name"],
            "count": sum(pr["count"] for pr in product_list),
            "products": product_list,
        })

    return {
        "employee": {"id": emp.id, "name": emp_name, "assisted_code": emp.assisted_retailer_code},
        "groups": result_groups,
        "total_count": sum(g["count"] for g in result_groups),
    }


@router.get("/reports/target-achievement")
async def get_target_achievement(
    house_id: Optional[int] = Query(None),
    target_date: Optional[str] = Query(None),
    role_type: Optional[str] = Query(None, description="house, supervisor, or rso"),
    employee_id: Optional[int] = Query(None, description="Employee ID for supervisor or rso level"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("reports.target_achievement")),
):
    is_admin = is_admin_user(current_user)
    user_houses_raw = current_user.houses

    target_house_id = house_id
    if not target_house_id:
        if is_admin:
            raise HTTPException(status_code=400, detail="house_id is required")
        if len(user_houses_raw) == 1:
            target_house_id = user_houses_raw[0].id
        else:
            raise HTTPException(status_code=400, detail="house_id is required when user has multiple houses")
    else:
        if not is_admin:
            user_house_ids = [h.id for h in user_houses_raw]
            if target_house_id not in user_house_ids:
                raise HTTPException(status_code=403, detail="You do not have access to this house")

    if target_date:
        td = datetime.strptime(target_date, "%Y-%m-%d").date()
    else:
        today = date.today()
        td = date(today.year, today.month, 1)

    if td.day != 1:
        td = date(td.year, td.month, 1)

    service = TargetAchievementService(db, target_house_id, td)

    if role_type == "supervisor":
        if not employee_id:
            raise HTTPException(status_code=400, detail="employee_id is required for supervisor level")
        result = await service.get_supervisor_progress(employee_id)
    elif role_type == "rso":
        if not employee_id:
            raise HTTPException(status_code=400, detail="employee_id is required for rso level")
        result = await service.get_rso_progress(employee_id)
    else:
        result = await service.get_house_progress()

    return {"success": True, "data": result}


@router.get("/reports/target-achievement/export")
async def export_target_achievement(
    house_id: Optional[int] = Query(None),
    target_date: Optional[str] = Query(None),
    role_type: Optional[str] = Query(None),
    employee_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("reports.target_achievement")),
):
    from io import BytesIO
    from openpyxl import Workbook

    is_admin = is_admin_user(current_user)
    user_houses_raw = current_user.houses

    target_house_id = house_id
    if not target_house_id:
        if is_admin:
            raise HTTPException(status_code=400, detail="house_id is required")
        if len(user_houses_raw) == 1:
            target_house_id = user_houses_raw[0].id
        else:
            raise HTTPException(status_code=400, detail="house_id is required")

    if target_date:
        td = datetime.strptime(target_date, "%Y-%m-%d").date()
    else:
        today = date.today()
        td = date(today.year, today.month, 1)
    if td.day != 1:
        td = date(td.year, td.month, 1)

    service = TargetAchievementService(db, target_house_id, td)

    if role_type == "supervisor" and employee_id:
        result = await service.get_supervisor_progress(employee_id)
    elif role_type == "rso" and employee_id:
        result = await service.get_rso_progress(employee_id)
    else:
        result = await service.get_house_progress()

    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])

    wb = Workbook()
    ws = wb.active
    ws.title = "Target Achievement"
    ws.append(["Category", "Target", "Achieved", "Percentage", "Remaining", "Projected", "Status"])

    for cat in result.get("categories", []):
        ws.append([
            cat["label_en"],
            cat["target"],
            cat["achieved"],
            cat["percentage"],
            cat["remaining"],
            round(cat["projected"], 1),
            cat["status"],
        ])

    ws.append([])
    summary = result.get("summary", {})
    ws.append(["Overall", summary.get("total_target"), summary.get("total_achieved"),
               summary.get("overall_percentage"), "", "", ""])

    output = BytesIO()
    wb.save(output)
    output.seek(0)

    return Response(
        content=output.read(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=target_achievement_{td.isoformat()}.xlsx"},
    )


@router.get("/reports/activations/dashboard")
async def get_activation_dashboard(
    month: int = Query(None, ge=1, le=12),
    year: int = Query(None, ge=2020),
    exclude_tags: Optional[str] = Query(None, description="Comma-separated tag names to exclude for Achievement (e.g. DRC,RSP,BSP)"),
    exclude_codes: Optional[str] = Query(None, description="Comma-separated product codes to exclude for Achievement (e.g. SIMSWAP,EV-SWAP)"),
    rso_exclude_tags: Optional[str] = Query(None, description="Comma-separated tag names to exclude for RSO Performance"),
    rso_exclude_codes: Optional[str] = Query(None, description="Comma-separated product codes to exclude for RSO Performance"),
    rso_achieved_exclude_tags: Optional[str] = Query(None, description="Comma-separated tag names to exclude for RSO Achieved column"),
    rso_market_exclude_tags: Optional[str] = Query(None, description="Comma-separated tag names to exclude for RSO Market column"),
    rso_active_days_threshold: int = Query(1, ge=1, description="Minimum activations per day to count as active day for RSO"),
    bp_exclude_tags: Optional[str] = Query(None, description="Comma-separated tag names to exclude for BP Performance"),
    bp_exclude_codes: Optional[str] = Query(None, description="Comma-separated product codes to exclude for BP Performance"),
    cc_exclude_tags: Optional[str] = Query(None, description="Comma-separated tag names to exclude for CC Performance"),
    cc_exclude_codes: Optional[str] = Query(None, description="Comma-separated product codes to exclude for CC Performance"),
    supervisor_exclude_tags: Optional[str] = Query(None, description="Comma-separated tag names to exclude for Supervisor Performance"),
    supervisor_exclude_codes: Optional[str] = Query(None, description="Comma-separated product codes to exclude for Supervisor Performance"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("reports.view")),
    house_id: Optional[int] = Depends(get_house_context),
    q_house_id: Optional[int] = Query(None, alias="house_id"),
):
    from app.services.activation_report_service import ActivationReportService

    target_house_id = q_house_id or house_id
    if q_house_id and not is_admin_user(current_user):
        user_house_ids = [h.id for h in current_user.houses]
        if q_house_id not in user_house_ids:
            raise HTTPException(status_code=403, detail="You do not have access to this house")

    if not target_house_id:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            target_house_id = user_house_ids[0]

    if not target_house_id:
        from app.models.house import House
        house_res = await db.execute(select(House.id).limit(1))
        first_house_id = house_res.scalar_one_or_none()
        if first_house_id:
            target_house_id = first_house_id

    if not target_house_id:
        raise HTTPException(status_code=400, detail="No house context available. Please select a house.")

    today = date.today()
    target_month = month or today.month
    target_year = year or today.year

    achievement_tag_list = [t.strip() for t in exclude_tags.split(",") if t.strip()] if exclude_tags else []

    if exclude_codes:
        achievement_code_set = {c.strip() for c in exclude_codes.split(",") if c.strip()}
    else:
        achievement_code_set = await get_excluded_codes(db)

    rso_tag_list = [t.strip() for t in rso_exclude_tags.split(",") if t.strip()] if rso_exclude_tags else []
    rso_code_set = {c.strip() for c in rso_exclude_codes.split(",") if c.strip()} if rso_exclude_codes else await get_excluded_codes(db)
    rso_achieved_tag_list = [t.strip() for t in rso_achieved_exclude_tags.split(",") if t.strip()] if rso_achieved_exclude_tags else []
    rso_market_tag_list = [t.strip() for t in rso_market_exclude_tags.split(",") if t.strip()] if rso_market_exclude_tags else []

    bp_tag_list = [t.strip() for t in bp_exclude_tags.split(",") if t.strip()] if bp_exclude_tags else []
    bp_code_set = {c.strip() for c in bp_exclude_codes.split(",") if c.strip()} if bp_exclude_codes else await get_excluded_codes(db)

    cc_tag_list = [t.strip() for t in cc_exclude_tags.split(",") if t.strip()] if cc_exclude_tags else []
    cc_code_set = {c.strip() for c in cc_exclude_codes.split(",") if c.strip()} if cc_exclude_codes else await get_excluded_codes(db)

    supervisor_tag_list = [t.strip() for t in supervisor_exclude_tags.split(",") if t.strip()] if supervisor_exclude_tags else []
    supervisor_code_set = {c.strip() for c in supervisor_exclude_codes.split(",") if c.strip()} if supervisor_exclude_codes else await get_excluded_codes(db)

    achievement_service = ActivationReportService(
        db, target_house_id, target_month, target_year,
        exclude_tag_names=achievement_tag_list,
        exclude_product_codes=achievement_code_set,
    )
    summary = await achievement_service.get_summary()
    daily_trend = await achievement_service.get_daily_trend()

    rso_service = ActivationReportService(
        db, target_house_id, target_month, target_year,
        exclude_tag_names=rso_tag_list,
        exclude_product_codes=rso_code_set,
        achieved_exclude_tag_names=rso_achieved_tag_list,
        market_exclude_tag_names=rso_market_tag_list,
        active_days_threshold=rso_active_days_threshold,
    )
    bp_service = ActivationReportService(
        db, target_house_id, target_month, target_year,
        exclude_tag_names=bp_tag_list,
        exclude_product_codes=bp_code_set,
    )
    cc_service = ActivationReportService(
        db, target_house_id, target_month, target_year,
        exclude_tag_names=cc_tag_list,
        exclude_product_codes=cc_code_set,
    )
    supervisor_service = ActivationReportService(
        db, target_house_id, target_month, target_year,
        exclude_tag_names=supervisor_tag_list,
        exclude_product_codes=supervisor_code_set,
    )
    rso = await rso_service.get_rso_performance()
    bp = await bp_service.get_bp_performance()
    cc = await cc_service.get_cc_performance()
    supervisor = await supervisor_service.get_supervisor_performance()
    top_performers = await rso_service.get_top_performers(rso, bp, cc, supervisor)

    return {
        "success": True,
        "summary": summary,
        "rso_performance": rso,
        "bp_performance": bp,
        "cc_performance": cc,
        "supervisor_performance": supervisor,
        "daily_trend": daily_trend,
        "top_performers": top_performers,
    }


@router.get("/reports/activations/dashboard/export")
async def export_activation_dashboard(
    month: int = Query(None, ge=1, le=12),
    year: int = Query(None, ge=2020),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("reports.download")),
    house_id: Optional[int] = Depends(get_house_context),
    q_house_id: Optional[int] = Query(None, alias="house_id"),
):
    from app.services.activation_report_service import ActivationReportService
    from io import BytesIO
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Border, Side

    target_house_id = q_house_id or house_id
    if q_house_id and not is_admin_user(current_user):
        user_house_ids = [h.id for h in current_user.houses]
        if q_house_id not in user_house_ids:
            raise HTTPException(status_code=403, detail="You do not have access to this house")

    if not target_house_id:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            target_house_id = user_house_ids[0]

    if not target_house_id:
        from app.models.house import House
        house_res = await db.execute(select(House.id).limit(1))
        first_house_id = house_res.scalar_one_or_none()
        if first_house_id:
            target_house_id = first_house_id

    if not target_house_id:
        raise HTTPException(status_code=400, detail="No house context available. Please select a house.")

    today = date.today()
    target_month = month or today.month
    target_year = year or today.year

    excluded_product_codes = await get_excluded_codes(db)
    service = ActivationReportService(db, target_house_id, target_month, target_year, exclude_product_codes=excluded_product_codes)
    data = await service.build_dashboard()

    wb = Workbook()
    ws = wb.active
    ws.title = "Activation Report"

    header_font = Font(bold=True, size=12, color="FFFFFF")
    header_fill = PatternFill(start_color="2563EB", end_color="2563EB", fill_type="solid")
    thin_border = Border(
        left=Side(style='thin'), right=Side(style='thin'),
        top=Side(style='thin'), bottom=Side(style='thin')
    )

    ws.cell(row=1, column=1, value=f"Activation Report - {target_year}-{target_month:02d}").font = Font(bold=True, size=14)
    ws.merge_cells('A1:H1')

    s = data["summary"]
    ws.cell(row=3, column=1, value="Summary").font = Font(bold=True, size=12)
    summary_headers = ["Metric", "Value"]
    for col, h in enumerate(summary_headers, 1):
        cell = ws.cell(row=4, column=col, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.border = thin_border

    summary_rows = [
        ("Monthly Target", s["monthly_target"]),
        ("Achievement", s["achievement"]),
        ("Achievement %", f'{s["achievement_percentage"]}%'),
        ("Remaining", s["remaining"]),
        ("Daily Required", s["daily_required"]),
        ("Daily Average", s["daily_average"]),
        ("Projection", s["projection"]),
        ("Expected %", f'{s["expected_percentage"]}%'),
        ("Days Elapsed", s["days_elapsed"]),
        ("Days Remaining", s["days_remaining"]),
    ]
    for i, (label, val) in enumerate(summary_rows):
        ws.cell(row=5+i, column=1, value=label).border = thin_border
        ws.cell(row=5+i, column=2, value=val).border = thin_border

    for section_name, section_key in [("RSO Performance", "rso_performance"), ("BP Performance", "bp_performance"), ("CC Performance", "cc_performance"), ("Supervisor Performance", "supervisor_performance")]:
        items = data.get(section_key, [])
        row_offset = 20
        ws.cell(row=row_offset, column=1, value=section_name).font = Font(bold=True, size=12)
        cols = ["Name", "Target", "Achievement", "%", "Remaining", "Daily Avg", "Projection", "Status"]
        for col, h in enumerate(cols, 1):
            cell = ws.cell(row=row_offset+1, column=col, value=h)
            cell.font = header_font
            cell.fill = header_fill
            cell.border = thin_border
        for i, item in enumerate(items):
            r = row_offset + 2 + i
            ws.cell(row=r, column=1, value=item["name"]).border = thin_border
            ws.cell(row=r, column=2, value=item["target"]).border = thin_border
            ws.cell(row=r, column=3, value=item["achievement"]).border = thin_border
            ws.cell(row=r, column=4, value=f'{item["percentage"]}%').border = thin_border
            ws.cell(row=r, column=5, value=item["remaining"]).border = thin_border
            ws.cell(row=r, column=6, value=item["daily_average"]).border = thin_border
            ws.cell(row=r, column=7, value=item["projection"]).border = thin_border
            ws.cell(row=r, column=8, value=item["status"].replace("_", " ").title()).border = thin_border

    output = BytesIO()
    wb.save(output)
    output.seek(0)

    return Response(
        content=output.read(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=activation_dashboard_{target_year}_{target_month:02d}.xlsx"},
    )


@router.get("/reports/recharge/dashboard")
async def get_recharge_dashboard(
    month: int = Query(None, ge=1, le=12),
    year: int = Query(None, ge=2020),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("reports.view")),
    house_id: Optional[int] = Depends(get_house_context),
    q_house_id: Optional[int] = Query(None, alias="house_id"),
):
    from app.services.recharge_report_service import RechargeReportService

    target_house_id = q_house_id or house_id
    if q_house_id and not is_admin_user(current_user):
        user_house_ids = [h.id for h in current_user.houses]
        if q_house_id not in user_house_ids:
            raise HTTPException(status_code=403, detail="You do not have access to this house")

    if not target_house_id:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            target_house_id = user_house_ids[0]

    if not target_house_id:
        from app.models.house import House
        house_res = await db.execute(select(House.id).limit(1))
        first_house_id = house_res.scalar_one_or_none()
        if first_house_id:
            target_house_id = first_house_id

    if not target_house_id:
        raise HTTPException(status_code=400, detail="No house context available. Please select a house.")

    today = date.today()
    target_month = month or today.month
    target_year = year or today.year

    service = RechargeReportService(db, target_house_id, target_month, target_year)
    summary = await service.get_summary()
    daily_trend = await service.get_daily_trend()
    rso = await service.get_rso_performance()
    supervisor = await service.get_supervisor_performance()
    top_performers = await service.get_top_performers(rso, supervisor)

    return {
        "success": True,
        "summary": summary,
        "rso_performance": rso,
        "supervisor_performance": supervisor,
        "daily_trend": daily_trend,
        "top_performers": top_performers,
    }


@router.get("/reports/recharge/dashboard/export")
async def export_recharge_dashboard(
    month: int = Query(None, ge=1, le=12),
    year: int = Query(None, ge=2020),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("reports.download")),
    house_id: Optional[int] = Depends(get_house_context),
    q_house_id: Optional[int] = Query(None, alias="house_id"),
):
    from app.services.recharge_report_service import RechargeReportService
    from io import BytesIO
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Border, Side

    target_house_id = q_house_id or house_id
    if q_house_id and not is_admin_user(current_user):
        user_house_ids = [h.id for h in current_user.houses]
        if q_house_id not in user_house_ids:
            raise HTTPException(status_code=403, detail="You do not have access to this house")

    if not target_house_id:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            target_house_id = user_house_ids[0]

    if not target_house_id:
        from app.models.house import House
        house_res = await db.execute(select(House.id).limit(1))
        first_house_id = house_res.scalar_one_or_none()
        if first_house_id:
            target_house_id = first_house_id

    if not target_house_id:
        raise HTTPException(status_code=400, detail="No house context available. Please select a house.")

    today = date.today()
    target_month = month or today.month
    target_year = year or today.year

    service = RechargeReportService(db, target_house_id, target_month, target_year)
    summary = await service.get_summary()
    rso = await service.get_rso_performance()
    supervisor = await service.get_supervisor_performance()

    wb = Workbook()
    ws = wb.active
    ws.title = "Recharge Report"

    header_font = Font(bold=True, size=12, color="FFFFFF")
    header_fill = PatternFill(start_color="2563EB", end_color="2563EB", fill_type="solid")
    thin_border = Border(
        left=Side(style='thin'), right=Side(style='thin'),
        top=Side(style='thin'), bottom=Side(style='thin')
    )

    ws.cell(row=1, column=1, value=f"Recharge Report (C2C) - {target_year}-{target_month:02d}").font = Font(bold=True, size=14)
    ws.merge_cells('A1:H1')

    s = summary
    ws.cell(row=3, column=1, value="Summary").font = Font(bold=True, size=12)
    summary_headers = ["Metric", "Value"]
    for col, h in enumerate(summary_headers, 1):
        cell = ws.cell(row=4, column=col, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.border = thin_border

    summary_rows = [
        ("Total Recharge Target", s["monthly_target"]),
        ("EV C2C Target", s["ev_c2c_target"]),
        ("SC Primary Target", s["sc_primary_target"]),
        ("Achievement", s["achievement"]),
        ("Achievement %", f'{s["achievement_percentage"]}%'),
        ("Remaining", s["remaining"]),
        ("Daily Required", s["daily_required"]),
        ("Daily Average", s["daily_average"]),
        ("Projection", s["projection"]),
        ("Expected %", f'{s["expected_percentage"]}%'),
        ("Days Elapsed", s["days_elapsed"]),
        ("Days Remaining", s["days_remaining"]),
    ]
    for i, (label, val) in enumerate(summary_rows):
        ws.cell(row=5+i, column=1, value=label).border = thin_border
        ws.cell(row=5+i, column=2, value=val).border = thin_border

    for section_name, section_key in [("RSO Performance", "rso_performance"), ("Supervisor Performance", "supervisor_performance")]:
        items = rso if section_key == "rso_performance" else supervisor
        row_offset = 20
        ws.cell(row=row_offset, column=1, value=section_name).font = Font(bold=True, size=12)
        cols = ["Name", "Target", "EV Target", "SC Target", "Achievement", "%", "Remaining", "Daily Avg", "Projection", "Status"]
        for col, h in enumerate(cols, 1):
            cell = ws.cell(row=row_offset+1, column=col, value=h)
            cell.font = header_font
            cell.fill = header_fill
            cell.border = thin_border
        for i, item in enumerate(items):
            r = row_offset + 2 + i
            ws.cell(row=r, column=1, value=item["name"]).border = thin_border
            ws.cell(row=r, column=2, value=item["target"]).border = thin_border
            ws.cell(row=r, column=3, value=item.get("ev_target", 0)).border = thin_border
            ws.cell(row=r, column=4, value=item.get("sc_target", 0)).border = thin_border
            ws.cell(row=r, column=5, value=item["achievement"]).border = thin_border
            ws.cell(row=r, column=6, value=f'{item["percentage"]}%').border = thin_border
            ws.cell(row=r, column=7, value=item["remaining"]).border = thin_border
            ws.cell(row=r, column=8, value=item["daily_average"]).border = thin_border
            ws.cell(row=r, column=9, value=item["projection"]).border = thin_border
            ws.cell(row=r, column=10, value=item["status"].replace("_", " ").title()).border = thin_border

    output = BytesIO()
    wb.save(output)
    output.seek(0)

    return Response(
        content=output.read(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=recharge_dashboard_{target_year}_{target_month:02d}.xlsx"},
    )


@router.get("/reports/my-target-progress")
async def get_my_target_progress(
    target_date: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("reports.target_achievement")),
):
    user_houses_raw = current_user.houses
    if not user_houses_raw:
        raise HTTPException(status_code=400, detail="User has no houses assigned")

    if target_date:
        td = datetime.strptime(target_date, "%Y-%m-%d").date()
    else:
        today = date.today()
        td = date(today.year, today.month, 1)

    if td.day != 1:
        td = date(td.year, td.month, 1)

    target_house_id = user_houses_raw[0].id
    service = TargetAchievementService(db, target_house_id, td)

    role_names = [r.name.lower() for r in current_user.roles]
    emp_profile = current_user.employee_profile

    if not emp_profile:
        return {"success": True, "data": await service.get_house_progress(), "user_role": "house"}

    if "rso" in role_names:
        result = await service.get_rso_progress(emp_profile.id)
        return {"success": True, "data": result, "user_role": "rso"}
    elif "supervisor" in role_names:
        result = await service.get_supervisor_progress(emp_profile.id)
        return {"success": True, "data": result, "user_role": "supervisor"}
    else:
        result = await service.get_house_progress()
        return {"success": True, "data": result, "user_role": "house"}
