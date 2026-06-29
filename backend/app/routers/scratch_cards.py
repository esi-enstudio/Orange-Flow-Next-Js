import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from fastapi.responses import Response
from sqlalchemy import select, or_, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.deps import get_db, get_current_user, has_permission, get_house_context
from app.models.user import User
from app.models.scratch_card_issue import ScratchCardIssue
from app.models.house import House
from app.schemas.scratch_card import (
    ScratchCardIssueSchema,
    ScratchCardIssueCreate,
    ScratchCardIssueUpdate,
    BatchSerialsCreate,
    SlotAllocateRequest,
    SlotMarkUsedRequest,
    AllocationReportSchema,
    HouseSheetInfo,
    ImportFilterParams,
)
from app.schemas.pagination import PaginatedResponse, PaginationMeta, PaginationParams
from app.utils.activity_logger import log_activity
from app.utils.access_control import is_admin_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/scratch-cards", tags=["Scratch Cards"])


@router.get("")
async def list_scratch_cards(
    pagination: PaginationParams = Depends(),
    house_context: Optional[int] = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card.view")),
):
    query = select(ScratchCardIssue)

    user_house_ids = [h.id for h in current_user.houses]
    if house_context:
        query = query.where(ScratchCardIssue.house_id == house_context)
    elif not is_admin_user(current_user):
        query = query.where(ScratchCardIssue.house_id.in_(user_house_ids))

    if pagination.search:
        search_term = f"%{pagination.search}%"
        query = query.where(
            or_(
                ScratchCardIssue.distributor_code.ilike(search_term),
                ScratchCardIssue.retailer_code.ilike(search_term),
                ScratchCardIssue.product_code.ilike(search_term),
                ScratchCardIssue.start_sc_no.ilike(search_term),
                ScratchCardIssue.end_sc_no.ilike(search_term),
            )
        )

    sort_col = getattr(ScratchCardIssue, pagination.sort_by, ScratchCardIssue.id)
    if pagination.sort_order == "desc":
        query = query.order_by(desc(sort_col))
    else:
        query = query.order_by(sort_col)

    total_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(total_q)).scalar() or 0

    offset = (pagination.page - 1) * pagination.per_page
    query = query.offset(offset).limit(pagination.per_page)
    result = await db.execute(query)
    records = result.scalars().all()

    total_pages = max(1, (total + pagination.per_page - 1) // pagination.per_page)

    return PaginatedResponse(
        data=[ScratchCardIssueSchema.model_validate(r) for r in records],
        pagination=PaginationMeta(
            page=pagination.page,
            per_page=pagination.per_page,
            total=total,
            total_pages=total_pages,
            has_next=pagination.page < total_pages,
            has_prev=pagination.page > 1,
        ),
    )


@router.get("/{record_id}")
async def get_scratch_card(
    record_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card.view")),
):
    result = await db.execute(
        select(ScratchCardIssue).where(ScratchCardIssue.id == record_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Scratch card record not found")
    return {"success": True, "data": ScratchCardIssueSchema.model_validate(record)}


@router.post("", status_code=201)
async def create_scratch_card(
    payload: ScratchCardIssueCreate,
    house_context: Optional[int] = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card.create")),
):
    target_house_id = house_context or payload.house_id
    if not target_house_id:
        raise HTTPException(status_code=400, detail="house_id is required")
    user_house_ids = [h.id for h in current_user.houses]
    if not is_admin_user(current_user) and target_house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="Access denied to this house")

    record = ScratchCardIssue(
        house_id=target_house_id,
        issue_date=payload.issue_date,
        distributor_code=payload.distributor_code,
        distributor_name=payload.distributor_name,
        retailer_code=payload.retailer_code,
        retailer_name=payload.retailer_name,
        product_code=payload.product_code,
        product_name=payload.product_name,
        start_sc_no=payload.start_sc_no,
        end_sc_no=payload.end_sc_no,
        quantity=payload.quantity,
        value=payload.value,
        rso_code=payload.rso_code,
        route_code=payload.route_code,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="scratch_card",
        action="create",
        record_id=record.id,
        record_identifier=record.start_sc_no or str(record.id),
        new_values=payload.model_dump(),
    )

    return {"success": True, "data": ScratchCardIssueSchema.model_validate(record)}


@router.put("/{record_id}")
async def update_scratch_card(
    record_id: int,
    payload: ScratchCardIssueUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card.edit")),
):
    result = await db.execute(
        select(ScratchCardIssue).where(ScratchCardIssue.id == record_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Not found")
    user_house_ids = [h.id for h in current_user.houses]
    if not is_admin_user(current_user) and record.house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="Access denied")

    old_values = {c.name: getattr(record, c.name) for c in record.__table__.columns}
    update_data = payload.model_dump(exclude_unset=True)

    for key, val in update_data.items():
        if hasattr(record, key):
            setattr(record, key, val)

    await db.commit()
    await db.refresh(record)

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="scratch_card",
        action="edit",
        record_id=record.id,
        record_identifier=record.start_sc_no or str(record.id),
        old_values=old_values,
        new_values=update_data,
    )

    return {"success": True, "data": ScratchCardIssueSchema.model_validate(record)}


@router.delete("/{record_id}")
async def delete_scratch_card(
    record_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card.delete")),
):
    result = await db.execute(
        select(ScratchCardIssue).where(ScratchCardIssue.id == record_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Not found")
    user_house_ids = [h.id for h in current_user.houses]
    if not is_admin_user(current_user) and record.house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="Access denied")

    old_values = {c.name: getattr(record, c.name) for c in record.__table__.columns}
    await db.delete(record)
    await db.commit()

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="scratch_card",
        action="delete",
        record_id=record_id,
        record_identifier=str(record_id),
        old_values=old_values,
    )

    return {"success": True, "message": "Deleted successfully"}


@router.post("/import")
async def import_scratch_cards(
    file: UploadFile = File(...),
    house_context: Optional[int] = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card.import")),
):
    file_ext = file.filename.split(".")[-1].lower() if file.filename else ""
    if file_ext not in {"xlsx", "xls", "csv"}:
        raise HTTPException(status_code=400, detail="Only xlsx, xls, csv files allowed")

    import pandas as pd
    import io

    contents = await file.read()
    try:
        if file_ext == "csv":
            df = pd.read_csv(io.BytesIO(contents), dtype=str)
        else:
            df = pd.read_excel(io.BytesIO(contents), dtype=str)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"File read error: {str(e)}")

    df = df.where(pd.notnull(df), None)
    df.columns = [c.strip().replace(" ", "_") for c in df.columns]

    target_house_id = house_context
    if not target_house_id:
        result = await db.execute(select(House.id).limit(1))
        target_house_id = result.scalar()
    user_house_ids = [h.id for h in current_user.houses]
    if not is_admin_user(current_user) and target_house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="Access denied")

    inserted = 0
    for _, row in df.iterrows():
        record = ScratchCardIssue(
            house_id=target_house_id,
            issue_date=row.get("issue_date") or row.get("IssueDate"),
            distributor_code=row.get("distributor_code") or row.get("DistributorCode"),
            distributor_name=row.get("distributor_name") or row.get("Distributor"),
            retailer_code=row.get("retailer_code") or row.get("RetailerCode"),
            retailer_name=row.get("retailer_name") or row.get("Retailer"),
            product_code=row.get("product_code") or row.get("ProductCode"),
            product_name=row.get("product_name") or row.get("Product"),
            start_sc_no=row.get("start_sc_no") or row.get("StartSCNo") or row.get("start_sc"),
            end_sc_no=row.get("end_sc_no") or row.get("EndSCNo") or row.get("end_sc"),
            quantity=row.get("quantity") or row.get("Quantity"),
            value=row.get("value") or row.get("Value"),
            rso_code=row.get("rso_code") or row.get("RSOCode"),
            route_code=row.get("route_code") or row.get("RouteCode"),
        )
        db.add(record)
        inserted += 1

    await db.commit()

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="scratch_card",
        action="import",
        record_id=None,
        new_values={"imported_count": inserted},
    )

    return {"success": True, "message": f"{inserted} records imported successfully"}


@router.get("/export/list")
async def export_scratch_cards(
    house_context: Optional[int] = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card.export")),
):
    query = select(ScratchCardIssue)

    user_house_ids = [h.id for h in current_user.houses]
    if house_context:
        query = query.where(ScratchCardIssue.house_id == house_context)
    elif not is_admin_user(current_user):
        query = query.where(ScratchCardIssue.house_id.in_(user_house_ids))

    result = await db.execute(query)
    records = result.scalars().all()

    import io
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "Scratch Cards"

    headers = [
        "ID", "Issue Date", "Distributor Code", "Distributor Name",
        "Retailer Code", "Retailer Name", "Product Code", "Product Name",
        "Start SC No", "End SC No", "Quantity", "Value", "RSO Code", "Route Code",
    ]
    ws.append(headers)

    for r in records:
        ws.append([
            r.id, r.issue_date, r.distributor_code, r.distributor_name,
            r.retailer_code, r.retailer_name, r.product_code, r.product_name,
            r.start_sc_no, r.end_sc_no, r.quantity,
            float(r.value) if r.value else None,
            r.rso_code, r.route_code,
        ])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=scratch_cards.xlsx"},
    )
