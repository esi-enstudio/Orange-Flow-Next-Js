import logging
import math
from datetime import date, datetime, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, or_, func, desc, and_, update
from sqlalchemy.orm import joinedload
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.deps import get_db, get_current_user, has_permission, get_house_context
from app.models.user import User
from app.models.house import House
from app.models.retailer import Retailer
from app.models.sim_inventory import SimInventory
from app.models.ev_kit_inventory import EvKitInventory
from app.models.sim_replacement_request import SimReplacementRequest
from app.models.sim_replacement_log import SimReplacementLog
from app.models.sim_stock_movement import SimStockMovement
from app.models.product import Product
from app.schemas.sim_inventory import SimInventoryCreate, SimInventoryUpdate, SimInventorySchema, SerialRangeItem
from app.schemas.ev_kit_inventory import EvKitCreate, EvKitUpdate, EvKitAllocate, EvKitSchema
from app.schemas.sim_replacement import (
    SimReplacementCreate, SimReplacementUpdate, SimReplacementApprove,
    SimReplacementIssue, SimReplacementActivate, SimReplacementSchema, SimReplacementLogSchema,
)
from app.schemas.pagination import PaginatedResponse, PaginationMeta, PaginationParams
from app.utils.activity_logger import log_activity
from app.utils.access_control import is_admin_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["SIM Replacement"])


# ---------------------------------------------------------------------------
# HELPERS
# ---------------------------------------------------------------------------

def _apply_house_filter(query, model, current_user, house_context):
    user_house_ids = [h.id for h in current_user.houses]
    if house_context:
        return query.where(model.house_id == house_context)
    elif not is_admin_user(current_user):
        return query.where(model.house_id.in_(user_house_ids))
    return query


def _check_house_access(record, current_user, house_context=None):
    if not record:
        return
    user_house_ids = [h.id for h in current_user.houses]
    if is_admin_user(current_user):
        return
    if record.house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="Access denied")
    if house_context and record.house_id != house_context:
        raise HTTPException(status_code=403, detail="Access denied")


async def _generate_request_number(db: AsyncSession, house_id: int) -> str:
    today = date.today()
    prefix = f"SRR-{today.strftime('%Y%m%d')}-"
    result = await db.execute(
        select(func.max(SimReplacementRequest.request_number)).where(
            SimReplacementRequest.request_number.ilike(f"{prefix}%")
        )
    )
    max_num = result.scalar()
    next_seq = 1
    if max_num:
        parts = max_num.rsplit("-", 1)
        if len(parts) == 2 and parts[1].isdigit():
            next_seq = int(parts[1]) + 1
    return f"{prefix}{next_seq:04d}"


async def _log_replacement_action(
    db: AsyncSession, request_id: int, action: str,
    old_status: str, new_status: str, current_user: User,
    notes: str = None, metadata: dict = None,
):
    import json
    log = SimReplacementLog(
        request_id=request_id,
        action=action,
        old_status=old_status,
        new_status=new_status,
        performed_by=current_user.id,
        performed_by_name=current_user.name,
        notes=notes,
        extra_data=json.dumps(metadata) if metadata else None,
    )
    db.add(log)
    await db.commit()


# ---------------------------------------------------------------------------
# RETAILERS BY HOUSE
# ---------------------------------------------------------------------------

@router.get("/sim-replacement/retailers")
async def get_retailers_for_sim_replacement(
    house_id: int = Query(..., ge=1),
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sim_replacement.create")),
):
    query = select(Retailer.id, Retailer.retailer_code, Retailer.name, Retailer.itop_number).where(
        Retailer.house_id == house_id
    )
    if search:
        q = f"%{search}%"
        query = query.where(
            or_(
                Retailer.retailer_code.ilike(q),
                Retailer.name.ilike(q),
                Retailer.itop_number.ilike(q),
            )
        )
    query = query.order_by(Retailer.name).limit(50)
    result = await db.execute(query)
    return [
        {"id": r[0], "retailer_code": r[1], "name": r[2], "itop_number": r[3]}
        for r in result.all()
    ]


# ---------------------------------------------------------------------------
# PRODUCTS (SIM category)
# ---------------------------------------------------------------------------

@router.get("/sim-products")
async def list_sim_products(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sim_inventory.view")),
):
    query = select(Product.id, Product.product_code, Product.product_name, Product.subcategory).where(
        Product.category == "SIM", Product.status == "Active"
    ).order_by(Product.product_name)
    result = await db.execute(query)
    return [{"id": r[0], "product_code": r[1], "product_name": r[2], "subcategory": r[3]} for r in result.all()]


# ===========================================================================
# SIM INVENTORY
# ===========================================================================

@router.get("/sim-inventory")
async def list_sim_inventory(
    pagination: PaginationParams = Depends(),
    sim_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    house_context: Optional[int] = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sim_inventory.view")),
):
    query = select(SimInventory)
    query = _apply_house_filter(query, SimInventory, current_user, house_context)

    if pagination.search:
        q = f"%{pagination.search}%"
        query = query.where(
            or_(
                SimInventory.batch_number.ilike(q),
                SimInventory.starting_serial.ilike(q),
                SimInventory.ending_serial.ilike(q),
                SimInventory.supplier.ilike(q),
            )
        )
    if sim_type:
        query = query.where(SimInventory.sim_type == sim_type)
    if status:
        query = query.where(SimInventory.status == status)

    sort_col = getattr(SimInventory, pagination.sort_by, SimInventory.id)
    query = query.order_by(desc(sort_col)) if pagination.sort_order == "desc" else query.order_by(sort_col)

    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar() or 0
    offset = (pagination.page - 1) * pagination.per_page
    result = await db.execute(query.offset(offset).limit(pagination.per_page))
    records = result.scalars().all()

    total_pages = max(1, (total + pagination.per_page - 1) // pagination.per_page)
    return PaginatedResponse(
        data=[SimInventorySchema.model_validate(r) for r in records],
        pagination=PaginationMeta(page=pagination.page, per_page=pagination.per_page, total=total, total_pages=total_pages, has_next=pagination.page < total_pages, has_prev=pagination.page > 1),
    )


@router.get("/sim-inventory/{item_id}")
async def get_sim_inventory(
    item_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sim_inventory.view")),
):
    result = await db.execute(select(SimInventory).where(SimInventory.id == item_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="SIM inventory not found")
    _check_house_access(record, current_user)
    return {"success": True, "data": SimInventorySchema.model_validate(record)}


@router.post("/sim-inventory", status_code=201)
async def create_sim_inventory(
    payload: SimInventoryCreate,
    house_context: Optional[int] = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sim_inventory.create")),
):
    target_house_id = payload.house_id or house_context
    if not target_house_id:
        raise HTTPException(status_code=400, detail="Please select a house or provide X-House-ID header")

    user_house_ids = [h.id for h in current_user.houses]
    if not is_admin_user(current_user) and target_house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="Access denied to this house")

    ranges = payload.serial_ranges
    if not ranges and payload.starting_serial and payload.ending_serial:
        ranges = [SerialRangeItem(starting_serial=payload.starting_serial, ending_serial=payload.ending_serial)]

    if not ranges:
        raise HTTPException(status_code=400, detail="At least one serial range is required")

    total_qty = 0
    for r in ranges:
        try:
            start_str = r.starting_serial
            end_str = r.ending_serial
            if len(end_str) < len(start_str):
                prefix = start_str[:len(start_str) - len(end_str)]
                end_str = prefix + end_str
            start = int(start_str)
            end = int(end_str)
            total_qty += end - start + 1
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid serial number: {r.starting_serial} - {r.ending_serial}")

    import json
    serial_ranges_json = json.dumps([r.model_dump() for r in ranges])

    available = payload.available_quantity if payload.available_quantity is not None else total_qty

    batch_number = payload.batch_number
    if not batch_number:
        today_str = date.today().strftime("%Y%m%d")
        count_result = await db.execute(
            select(func.count()).select_from(SimInventory).where(
                SimInventory.batch_number.ilike(f"BATCH-{today_str}-%")
            )
        )
        count = count_result.scalar() or 0
        batch_number = f"BATCH-{today_str}-{target_house_id}-{count + 1:04d}"

    first_range = ranges[0]
    last_range = ranges[-1]

    record = SimInventory(
        house_id=target_house_id,
        product_id=payload.product_id,
        sim_type=payload.sim_type,
        starting_serial=first_range.starting_serial,
        ending_serial=last_range.ending_serial,
        serial_ranges=serial_ranges_json,
        quantity=total_qty,
        available_quantity=available,
        supplier=payload.supplier,
        batch_number=batch_number,
        purchase_date=payload.purchase_date,
        exit_order_no=payload.exit_order_no,
        notes=payload.notes,
        status="active",
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

    movement = SimStockMovement(
        house_id=target_house_id,
        sim_inventory_id=record.id,
        movement_type="stock_in",
        quantity=payload.quantity,
        reference_number=payload.batch_number,
        notes=f"Initial stock in: {payload.starting_serial} - {payload.ending_serial}",
        performed_by=current_user.id,
    )
    db.add(movement)
    await db.commit()

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="sim_inventory", action="create",
        record_id=record.id, record_identifier=record.batch_number or str(record.id),
        new_values=payload.model_dump(),
    )

    return {"success": True, "data": SimInventorySchema.model_validate(record)}


@router.put("/sim-inventory/{item_id}")
async def update_sim_inventory(
    item_id: int,
    payload: SimInventoryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sim_inventory.edit")),
):
    result = await db.execute(select(SimInventory).where(SimInventory.id == item_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="SIM inventory not found")
    _check_house_access(record, current_user)

    update_data = payload.model_dump(exclude_unset=True)
    for key, val in update_data.items():
        if hasattr(record, key):
            setattr(record, key, val)

    await db.commit()
    await db.refresh(record)

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="sim_inventory", action="edit",
        record_id=record.id, record_identifier=record.batch_number or str(record.id),
        new_values=update_data,
    )

    return {"success": True, "data": SimInventorySchema.model_validate(record)}


@router.delete("/sim-inventory/{item_id}")
async def delete_sim_inventory(
    item_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sim_inventory.delete")),
):
    result = await db.execute(select(SimInventory).where(SimInventory.id == item_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="SIM inventory not found")
    _check_house_access(record, current_user)

    record.is_deleted = True
    record.deleted_at = datetime.utcnow() + timedelta(hours=6)
    record.deleted_by = current_user.id
    await db.commit()

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="sim_inventory", action="delete",
        record_id=item_id, record_identifier=record.batch_number or str(record.id),
    )

    return {"success": True, "message": "SIM inventory deleted successfully"}


# ===========================================================================
# EV KIT INVENTORY
# ===========================================================================

@router.get("/ev-kit")
async def list_ev_kits(
    pagination: PaginationParams = Depends(),
    status: Optional[str] = Query(None),
    kit_type: Optional[str] = Query(None),
    house_context: Optional[int] = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ev_kit.view")),
):
    query = select(EvKitInventory).options(
        joinedload(EvKitInventory.request),
        joinedload(EvKitInventory.allocator),
    )
    query = _apply_house_filter(query, EvKitInventory, current_user, house_context)

    if pagination.search:
        q = f"%{pagination.search}%"
        query = query.where(EvKitInventory.kit_serial.ilike(q))
    if status:
        query = query.where(EvKitInventory.status == status)
    if kit_type:
        query = query.where(EvKitInventory.kit_type == kit_type)

    sort_col = getattr(EvKitInventory, pagination.sort_by, EvKitInventory.id)
    query = query.order_by(desc(sort_col)) if pagination.sort_order == "desc" else query.order_by(sort_col)

    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar() or 0
    offset = (pagination.page - 1) * pagination.per_page
    result = await db.execute(query.offset(offset).limit(pagination.per_page))
    records = result.unique().scalars().all()

    data = []
    for r in records:
        s = EvKitSchema.model_validate(r)
        if r.request:
            s.request_number = r.request.request_number
        if r.allocator:
            s.allocator_name = r.allocator.name
        data.append(s)

    total_pages = max(1, (total + pagination.per_page - 1) // pagination.per_page)
    return PaginatedResponse(
        data=data,
        pagination=PaginationMeta(page=pagination.page, per_page=pagination.per_page, total=total, total_pages=total_pages, has_next=pagination.page < total_pages, has_prev=pagination.page > 1),
    )


@router.post("/ev-kit", status_code=201)
async def create_ev_kit(
    payload: EvKitCreate,
    house_context: Optional[int] = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ev_kit.create")),
):
    target_house_id = house_context
    if not target_house_id:
        raise HTTPException(status_code=400, detail="X-House-ID header required")

    user_house_ids = [h.id for h in current_user.houses]
    if not is_admin_user(current_user) and target_house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="Access denied")

    existing = await db.execute(
        select(EvKitInventory).where(EvKitInventory.kit_serial == payload.kit_serial)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="EV kit serial already exists")

    record = EvKitInventory(
        house_id=target_house_id,
        kit_serial=payload.kit_serial,
        kit_type=payload.kit_type,
        status="available",
        notes=payload.notes,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="ev_kit", action="create",
        record_id=record.id, record_identifier=record.kit_serial,
        new_values=payload.model_dump(),
    )

    return {"success": True, "data": EvKitSchema.model_validate(record)}


@router.put("/ev-kit/{kit_id}")
async def update_ev_kit(
    kit_id: int,
    payload: EvKitUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ev_kit.edit")),
):
    result = await db.execute(select(EvKitInventory).where(EvKitInventory.id == kit_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="EV kit not found")
    _check_house_access(record, current_user)

    update_data = payload.model_dump(exclude_unset=True)
    for key, val in update_data.items():
        if hasattr(record, key):
            setattr(record, key, val)
    await db.commit()
    await db.refresh(record)

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="ev_kit", action="edit",
        record_id=record.id, record_identifier=record.kit_serial,
        new_values=update_data,
    )

    return {"success": True, "data": EvKitSchema.model_validate(record)}


@router.delete("/ev-kit/{kit_id}")
async def delete_ev_kit(
    kit_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ev_kit.delete")),
):
    result = await db.execute(select(EvKitInventory).where(EvKitInventory.id == kit_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="EV kit not found")
    _check_house_access(record, current_user)

    record.is_deleted = True
    record.deleted_at = datetime.utcnow() + timedelta(hours=6)
    record.deleted_by = current_user.id
    await db.commit()

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="ev_kit", action="delete",
        record_id=kit_id, record_identifier=record.kit_serial,
    )

    return {"success": True, "message": "EV kit deleted successfully"}


@router.post("/ev-kit/{kit_id}/allocate")
async def allocate_ev_kit(
    kit_id: int,
    payload: EvKitAllocate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ev_kit.allocate")),
):
    result = await db.execute(select(EvKitInventory).where(EvKitInventory.id == kit_id))
    kit = result.scalar_one_or_none()
    if not kit:
        raise HTTPException(status_code=404, detail="EV kit not found")
    _check_house_access(kit, current_user)

    if kit.status != "available":
        raise HTTPException(status_code=400, detail=f"EV kit is {kit.status}, cannot allocate")

    req_result = await db.execute(
        select(SimReplacementRequest).where(SimReplacementRequest.id == payload.request_id)
    )
    request = req_result.scalar_one_or_none()
    if not request:
        raise HTTPException(status_code=404, detail="Replacement request not found")

    kit.status = "allocated"
    kit.allocated_to = payload.request_id
    kit.allocated_at = datetime.utcnow() + timedelta(hours=6)
    kit.allocated_by = current_user.id

    request.ev_kit_id = kit_id
    await db.commit()

    await _log_replacement_action(
        db, request.id, "ev_kit_allocated",
        request.request_status, request.request_status, current_user,
        notes=f"EV kit {kit.kit_serial} allocated",
    )

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="ev_kit", action="allocate",
        record_id=kit_id, record_identifier=kit.kit_serial,
        new_values={"allocated_to_request": payload.request_id},
    )

    return {"success": True, "data": EvKitSchema.model_validate(kit)}


# ===========================================================================
# SIM REPLACEMENT REQUESTS — Main Lifecycle
# ===========================================================================

@router.get("/sim-replacement")
async def list_replacement_requests(
    pagination: PaginationParams = Depends(),
    status: Optional[str] = Query(None),
    reason: Optional[str] = Query(None, alias="replacement_reason"),
    priority: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    house_context: Optional[int] = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sim_replacement.view")),
):
    query = select(SimReplacementRequest).options(
        joinedload(SimReplacementRequest.requester),
        joinedload(SimReplacementRequest.approver),
        joinedload(SimReplacementRequest.issuer),
        joinedload(SimReplacementRequest.activator),
        joinedload(SimReplacementRequest.retailer),
    )
    query = _apply_house_filter(query, SimReplacementRequest, current_user, house_context)

    if pagination.search:
        q = f"%{pagination.search}%"
        query = query.where(
            or_(
                SimReplacementRequest.request_number.ilike(q),
                SimReplacementRequest.retailer_name.ilike(q),
                SimReplacementRequest.retailer_code.ilike(q),
                SimReplacementRequest.new_sim_number.ilike(q),
            )
        )
    if status:
        query = query.where(SimReplacementRequest.request_status == status)
    if reason:
        query = query.where(SimReplacementRequest.replacement_reason == reason)
    if priority:
        query = query.where(SimReplacementRequest.priority == priority)
    if date_from:
        query = query.where(SimReplacementRequest.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        query = query.where(SimReplacementRequest.created_at <= datetime.combine(date_to, datetime.max.time()))

    sort_col = getattr(SimReplacementRequest, pagination.sort_by, SimReplacementRequest.id)
    query = query.order_by(desc(sort_col)) if pagination.sort_order == "desc" else query.order_by(sort_col)

    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar() or 0
    offset = (pagination.page - 1) * pagination.per_page
    result = await db.execute(query.offset(offset).limit(pagination.per_page))
    records = result.unique().scalars().all()

    data = []
    for r in records:
        s = SimReplacementSchema.model_validate(r)
        if r.requester: s.requester_name = r.requester.name
        if r.approver: s.approver_name = r.approver.name
        if r.issuer: s.issuer_name = r.issuer.name
        if r.activator: s.activator_name = r.activator.name
        if r.closer: s.closer_name = r.closer.name
        data.append(s)

    total_pages = max(1, (total + pagination.per_page - 1) // pagination.per_page)
    return PaginatedResponse(
        data=data,
        pagination=PaginationMeta(page=pagination.page, per_page=pagination.per_page, total=total, total_pages=total_pages, has_next=pagination.page < total_pages, has_prev=pagination.page > 1),
    )


@router.get("/sim-replacement/{request_id}")
async def get_replacement_request(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sim_replacement.view")),
):
    result = await db.execute(
        select(SimReplacementRequest).options(
            joinedload(SimReplacementRequest.requester),
            joinedload(SimReplacementRequest.approver),
            joinedload(SimReplacementRequest.issuer),
            joinedload(SimReplacementRequest.activator),
            joinedload(SimReplacementRequest.closer),
            joinedload(SimReplacementRequest.retailer),
            joinedload(SimReplacementRequest.sim_inventory),
            joinedload(SimReplacementRequest.ev_kit),
        ).where(SimReplacementRequest.id == request_id)
    )
    record = result.unique().scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Replacement request not found")
    _check_house_access(record, current_user)

    s = SimReplacementSchema.model_validate(record)
    if record.requester: s.requester_name = record.requester.name
    if record.approver: s.approver_name = record.approver.name
    if record.issuer: s.issuer_name = record.issuer.name
    if record.activator: s.activator_name = record.activator.name
    if record.closer: s.closer_name = record.closer.name

    return {"success": True, "data": s}


@router.post("/sim-replacement", status_code=201)
async def create_replacement_request(
    payload: SimReplacementCreate,
    house_context: Optional[int] = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sim_replacement.create")),
):
    target_house_id = payload.house_id or house_context
    if not target_house_id:
        raise HTTPException(status_code=400, detail="house_id is required")

    user_house_ids = [h.id for h in current_user.houses]
    if not is_admin_user(current_user) and target_house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="Access denied to this house")

    request_number = await _generate_request_number(db, target_house_id)

    record = SimReplacementRequest(
        house_id=target_house_id,
        request_number=request_number,
        retailer_id=payload.retailer_id,
        retailer_code=payload.retailer_code,
        retailer_name=payload.retailer_name,
        customer_nid=payload.customer_nid,
        sim_type=payload.sim_type,
        replacement_reason=payload.replacement_reason,
        reason_details=payload.reason_details,
        ev_swap_serial=payload.ev_swap_serial,
        priority=payload.priority,
        notes=payload.notes,
        remarks=payload.remarks,
        request_status="pending",
        requested_by=current_user.id,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

    await _log_replacement_action(
        db, record.id, "created",
        None, "pending", current_user,
        notes=f"Request created: {payload.replacement_reason}",
        metadata={"payload": payload.model_dump()},
    )

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="sim_replacement", action="create",
        record_id=record.id, record_identifier=record.request_number,
        new_values=payload.model_dump(),
    )

    s = SimReplacementSchema.model_validate(record)
    s.requester_name = current_user.name

    return {"success": True, "data": s}


@router.put("/sim-replacement/{request_id}")
async def update_replacement_request(
    request_id: int,
    payload: SimReplacementUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sim_replacement.edit")),
):
    result = await db.execute(select(SimReplacementRequest).where(SimReplacementRequest.id == request_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Replacement request not found")
    _check_house_access(record, current_user)

    if record.request_status not in ("pending",):
        raise HTTPException(status_code=400, detail=f"Cannot edit request in '{record.request_status}' status")

    update_data = payload.model_dump(exclude_unset=True)
    for key, val in update_data.items():
        if hasattr(record, key):
            setattr(record, key, val)
    await db.commit()
    await db.refresh(record)

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="sim_replacement", action="edit",
        record_id=record.id, record_identifier=record.request_number,
        new_values=update_data,
    )

    s = SimReplacementSchema.model_validate(record)
    s.requester_name = current_user.name
    return {"success": True, "data": s}


@router.post("/sim-replacement/{request_id}/approve")
async def approve_replacement_request(
    request_id: int,
    payload: SimReplacementApprove,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sim_replacement.approve")),
):
    result = await db.execute(select(SimReplacementRequest).where(SimReplacementRequest.id == request_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Replacement request not found")
    _check_house_access(record, current_user)

    if record.request_status != "pending":
        raise HTTPException(status_code=400, detail=f"Cannot approve request in '{record.request_status}' status")

    old = record.request_status
    record.request_status = "approved"
    record.approved_by = current_user.id
    record.approved_at = datetime.utcnow() + timedelta(hours=6)
    record.approval_notes = payload.approval_notes
    await db.commit()

    await _log_replacement_action(
        db, request_id, "approved",
        old, "approved", current_user,
        notes=payload.approval_notes,
    )

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="sim_replacement", action="approve",
        record_id=record.id, record_identifier=record.request_number,
    )

    return {"success": True, "message": "Request approved"}


@router.post("/sim-replacement/{request_id}/reject")
async def reject_replacement_request(
    request_id: int,
    payload: SimReplacementApprove,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sim_replacement.approve")),
):
    result = await db.execute(select(SimReplacementRequest).where(SimReplacementRequest.id == request_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Replacement request not found")
    _check_house_access(record, current_user)

    if record.request_status != "pending":
        raise HTTPException(status_code=400, detail=f"Cannot reject request in '{record.request_status}' status")

    old = record.request_status
    record.request_status = "rejected"
    record.approved_by = current_user.id
    record.approved_at = datetime.utcnow() + timedelta(hours=6)
    record.approval_notes = payload.approval_notes
    await db.commit()

    await _log_replacement_action(
        db, request_id, "rejected",
        old, "rejected", current_user,
        notes=payload.approval_notes,
    )

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="sim_replacement", action="reject",
        record_id=record.id, record_identifier=record.request_number,
    )

    return {"success": True, "message": "Request rejected"}


@router.post("/sim-replacement/{request_id}/issue")
async def issue_sim_for_replacement(
    request_id: int,
    payload: SimReplacementIssue,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sim_replacement.issue")),
):
    result = await db.execute(
        select(SimReplacementRequest).options(
            joinedload(SimReplacementRequest.sim_inventory),
        ).where(SimReplacementRequest.id == request_id)
    )
    record = result.unique().scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Replacement request not found")
    _check_house_access(record, current_user)

    if record.request_status != "approved":
        raise HTTPException(status_code=400, detail=f"Cannot issue SIM for request in '{record.request_status}' status")

    if payload.sim_inventory_id:
        inv_result = await db.execute(
            select(SimInventory).where(SimInventory.id == payload.sim_inventory_id)
        )
        inventory = inv_result.scalar_one_or_none()
        if not inventory:
            raise HTTPException(status_code=404, detail="SIM inventory not found")
        if inventory.available_quantity < 1:
            raise HTTPException(status_code=400, detail="No available SIMs in this inventory batch")
        inventory.available_quantity -= 1

        movement = SimStockMovement(
            house_id=record.house_id,
            sim_inventory_id=inventory.id,
            request_id=request_id,
            movement_type="stock_out",
            quantity=1,
            reference_number=record.request_number,
            notes=f"SIM issued for replacement: {payload.new_sim_number}",
            performed_by=current_user.id,
        )
        db.add(movement)

    old = record.request_status
    record.request_status = "sim_issued"
    record.new_sim_number = payload.new_sim_number
    record.new_msisdn = payload.new_msisdn
    record.sim_inventory_id = payload.sim_inventory_id
    record.issued_by = current_user.id
    record.issued_at = datetime.utcnow() + timedelta(hours=6)

    if payload.ev_kit_id:
        ev_result = await db.execute(
            select(EvKitInventory).where(EvKitInventory.id == payload.ev_kit_id)
        )
        ev_kit = ev_result.scalar_one_or_none()
        if ev_kit and ev_kit.status == "available":
            ev_kit.status = "allocated"
            ev_kit.allocated_to = request_id
            ev_kit.allocated_at = datetime.utcnow() + timedelta(hours=6)
            ev_kit.allocated_by = current_user.id
            record.ev_kit_id = payload.ev_kit_id

    await db.commit()

    await _log_replacement_action(
        db, request_id, "sim_issued",
        old, "sim_issued", current_user,
        notes=f"New SIM: {payload.new_sim_number}",
        metadata={"new_sim": payload.new_sim_number, "inventory_id": payload.sim_inventory_id},
    )

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="sim_replacement", action="issue",
        record_id=record.id, record_identifier=record.request_number,
        new_values={"new_sim_number": payload.new_sim_number},
    )

    return {"success": True, "message": f"SIM {payload.new_sim_number} issued for replacement"}


@router.post("/sim-replacement/{request_id}/activate")
async def activate_replacement_sim(
    request_id: int,
    payload: SimReplacementActivate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sim_replacement.activate")),
):
    result = await db.execute(select(SimReplacementRequest).where(SimReplacementRequest.id == request_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Replacement request not found")
    _check_house_access(record, current_user)

    if record.request_status != "sim_issued":
        raise HTTPException(status_code=400, detail=f"Cannot activate SIM in '{record.request_status}' status")

    old = record.request_status
    record.request_status = "activated"
    record.new_msisdn = payload.new_msisdn or record.new_msisdn
    record.activated_by = current_user.id
    record.activated_at = datetime.utcnow() + timedelta(hours=6)
    await db.commit()

    await _log_replacement_action(
        db, request_id, "activated",
        old, "activated", current_user,
        notes=f"SIM activated. MSISDN: {record.new_msisdn}",
    )

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="sim_replacement", action="activate",
        record_id=record.id, record_identifier=record.request_number,
    )

    return {"success": True, "message": "SIM activated successfully"}


@router.post("/sim-replacement/{request_id}/close")
async def close_replacement_request(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sim_replacement.edit")),
):
    result = await db.execute(select(SimReplacementRequest).where(SimReplacementRequest.id == request_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Replacement request not found")
    _check_house_access(record, current_user)

    if record.request_status != "activated":
        raise HTTPException(status_code=400, detail=f"Cannot close request in '{record.request_status}' status")

    old = record.request_status
    record.request_status = "closed"
    record.old_sim_deactivated = True
    record.old_sim_deactivated_at = datetime.utcnow() + timedelta(hours=6)
    record.closed_by = current_user.id
    record.closed_at = datetime.utcnow() + timedelta(hours=6)
    await db.commit()

    await _log_replacement_action(
        db, request_id, "closed",
        old, "closed", current_user,
        notes="Request closed. Old SIM deactivated.",
    )

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="sim_replacement", action="close",
        record_id=record.id, record_identifier=record.request_number,
    )

    return {"success": True, "message": "Replacement request closed"}


@router.post("/sim-replacement/{request_id}/cancel")
async def cancel_replacement_request(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sim_replacement.edit")),
):
    result = await db.execute(select(SimReplacementRequest).where(SimReplacementRequest.id == request_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Replacement request not found")
    _check_house_access(record, current_user)

    if record.request_status in ("closed", "rejected"):
        raise HTTPException(status_code=400, detail=f"Cannot cancel request in '{record.request_status}' status")

    old = record.request_status

    if record.sim_inventory_id:
        inv_result = await db.execute(
            select(SimInventory).where(SimInventory.id == record.sim_inventory_id)
        )
        inventory = inv_result.scalar_one_or_none()
        if inventory:
            inventory.available_quantity += 1

    if record.ev_kit_id:
        ev_result = await db.execute(
            select(EvKitInventory).where(EvKitInventory.id == record.ev_kit_id)
        )
        ev_kit = ev_result.scalar_one_or_none()
        if ev_kit:
            ev_kit.status = "available"
            ev_kit.allocated_to = None
            ev_kit.allocated_at = None
            ev_kit.allocated_by = None

    record.request_status = "cancelled"
    record.closed_by = current_user.id
    record.closed_at = datetime.utcnow() + timedelta(hours=6)
    await db.commit()

    await _log_replacement_action(
        db, request_id, "cancelled",
        old, "cancelled", current_user,
    )

    return {"success": True, "message": "Request cancelled"}


@router.get("/sim-replacement/{request_id}/logs")
async def get_replacement_logs(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sim_replacement.view")),
):
    result = await db.execute(
        select(SimReplacementRequest).where(SimReplacementRequest.id == request_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Replacement request not found")
    _check_house_access(record, current_user)

    logs_result = await db.execute(
        select(SimReplacementLog)
        .where(SimReplacementLog.request_id == request_id)
        .order_by(SimReplacementLog.created_at.asc())
    )
    logs = logs_result.scalars().all()

    return {
        "success": True,
        "data": [SimReplacementLogSchema.model_validate(l) for l in logs],
    }


# ===========================================================================
# EXPORT endpoints
# ===========================================================================

@router.get("/sim-replacement/export/list")
async def export_replacement_requests(
    status: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    house_context: Optional[int] = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sim_replacement.export")),
):
    from openpyxl import Workbook
    import io

    query = select(SimReplacementRequest)
    query = _apply_house_filter(query, SimReplacementRequest, current_user, house_context)

    if status:
        query = query.where(SimReplacementRequest.request_status == status)
    if date_from:
        query = query.where(SimReplacementRequest.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        query = query.where(SimReplacementRequest.created_at <= datetime.combine(date_to, datetime.max.time()))

    query = query.order_by(desc(SimReplacementRequest.id))
    result = await db.execute(query)
    records = result.scalars().all()

    wb = Workbook()
    ws = wb.active
    ws.title = "SIM Replacement"
    ws.append(["Request #", "Status", "Retailer", "Retailer Code", "EV Swap Serial",
               "New SIM", "Reason", "Priority", "Requested By", "Requested At", "Approved At", "Issued At", "Activated At"])

    for r in records:
        ws.append([
            r.request_number, r.request_status, r.retailer_name, r.retailer_code,
            r.ev_swap_serial, r.new_sim_number,
            r.replacement_reason, r.priority, r.requested_by,
            r.requested_at, r.approved_at, r.issued_at, r.activated_at,
        ])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    from fastapi.responses import Response
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=sim_replacement_requests.xlsx"},
    )


@router.get("/sim-inventory/export/list")
async def export_sim_inventory(
    house_context: Optional[int] = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sim_inventory.export")),
):
    from openpyxl import Workbook
    import io

    query = select(SimInventory)
    query = _apply_house_filter(query, SimInventory, current_user, house_context)
    query = query.where(SimInventory.is_deleted == False)
    query = query.order_by(desc(SimInventory.id))

    result = await db.execute(query)
    records = result.scalars().all()

    wb = Workbook()
    ws = wb.active
    ws.title = "SIM Inventory"
    ws.append(["Batch #", "SIM Type", "Starting Serial", "Ending Serial", "Total Qty",
               "Available Qty", "Supplier", "Exit Order No", "Status", "Purchase Date"])

    for r in records:
        ws.append([
            r.batch_number, r.sim_type, r.starting_serial, r.ending_serial,
            r.quantity, r.available_quantity, r.supplier,
            r.exit_order_no, r.status, r.purchase_date,
        ])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    from fastapi.responses import Response
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=sim_inventory.xlsx"},
    )
