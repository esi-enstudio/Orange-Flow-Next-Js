import logging
import math
from datetime import date, datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import Response
from sqlalchemy import select, or_, func, desc, and_, update
from sqlalchemy.orm import joinedload
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.deps import get_db, get_current_user, has_permission, get_house_context
from app.models.user import User
from app.models.scratch_card_serial import ScratchCardSerial
from app.models.product import Product
from app.models.house import House
from app.utils.timezone import now_naive
from app.schemas.scratch_card_serial import (
    ScratchCardSerialSchema,
    ScratchCardSerialCreate,
    ScratchCardSerialUpdate,
    BatchSerialsCreate,
    SlotAllocateRequest,
    AllocationResultSchema,
    AllocationRangeSchema,
    ConfirmAllocationRequest,
    BulkStatusUpdate,
    BatchSerialUpdate,
    SerialFilterParams,
)
from app.schemas.pagination import PaginatedResponse, PaginationMeta, PaginationParams
from app.utils.activity_logger import log_activity
from app.utils.access_control import is_admin_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/scratch-card-serials", tags=["Scratch Card Serials"])


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


def _serial_to_schema(record):
    schema = ScratchCardSerialSchema.model_validate(record)
    if record.used_by_user:
        schema.used_by_name = record.used_by_user.name
        schema.used_by_role = record.used_by_user.roles[0].name if record.used_by_user.roles else None
    if record.house:
        schema.house_name = record.house.name
        schema.house_code = record.house.code
    return schema


# ---------------------------------------------------------------------------
# LIST
# ---------------------------------------------------------------------------
@router.get("")
async def list_serials(
    pagination: PaginationParams = Depends(),
    product_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    house_context: Optional[int] = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card_serials.view")),
):
    query = select(ScratchCardSerial).options(
        joinedload(ScratchCardSerial.house),
        joinedload(ScratchCardSerial.product),
        joinedload(ScratchCardSerial.used_by_user),
    )
    query = _apply_house_filter(query, ScratchCardSerial, current_user, house_context)

    if pagination.search:
        q = f"%{pagination.search}%"
        query = query.where(
            or_(
                ScratchCardSerial.serial_number.ilike(q),
                ScratchCardSerial.batch_id.ilike(q),
                ScratchCardSerial.exit_order_no.ilike(q),
                ScratchCardSerial.rf_no.ilike(q),
            )
        )

    if product_id:
        query = query.where(ScratchCardSerial.product_id == product_id)
    if status:
        query = query.where(ScratchCardSerial.status == status)
    if date_from:
        query = query.where(ScratchCardSerial.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        query = query.where(ScratchCardSerial.created_at <= datetime.combine(date_to, datetime.max.time()))

    sort_col = getattr(ScratchCardSerial, pagination.sort_by, ScratchCardSerial.id)
    if pagination.sort_order == "desc":
        query = query.order_by(desc(sort_col))
    else:
        query = query.order_by(sort_col)

    total_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(total_q)).scalar() or 0

    offset = (pagination.page - 1) * pagination.per_page
    query = query.offset(offset).limit(pagination.per_page)
    result = await db.execute(query)
    records = result.unique().scalars().all()

    total_pages = max(1, (total + pagination.per_page - 1) // pagination.per_page)

    return PaginatedResponse(
        data=[_serial_to_schema(r) for r in records],
        pagination=PaginationMeta(
            page=pagination.page,
            per_page=pagination.per_page,
            total=total,
            total_pages=total_pages,
            has_next=pagination.page < total_pages,
            has_prev=pagination.page > 1,
        ),
    )


# ---------------------------------------------------------------------------
# SELECT ALL MATCHING (unlimited IDs)
# ---------------------------------------------------------------------------
@router.post("/select-all")
async def select_all_serials(
    product_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    search: Optional[str] = Query(None),
    house_context: Optional[int] = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card_serials.view")),
):
    query = select(ScratchCardSerial.id)
    query = _apply_house_filter(query, ScratchCardSerial, current_user, house_context)

    if search:
        q = f"%{search}%"
        query = query.where(
            or_(
                ScratchCardSerial.serial_number.ilike(q),
                ScratchCardSerial.batch_id.ilike(q),
                ScratchCardSerial.exit_order_no.ilike(q),
                ScratchCardSerial.rf_no.ilike(q),
            )
        )
    if product_id:
        query = query.where(ScratchCardSerial.product_id == product_id)
    if status:
        query = query.where(ScratchCardSerial.status == status)
    if date_from:
        query = query.where(ScratchCardSerial.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        query = query.where(ScratchCardSerial.created_at <= datetime.combine(date_to, datetime.max.time()))

    result = await db.execute(query)
    ids = [row[0] for row in result.all()]
    return {"success": True, "data": {"ids": ids, "total": len(ids)}}


# ---------------------------------------------------------------------------
# GET single
# ---------------------------------------------------------------------------
@router.get("/{serial_id}")
async def get_serial(
    serial_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card_serials.view")),
):
    result = await db.execute(
        select(ScratchCardSerial)
        .options(
            joinedload(ScratchCardSerial.product),
            joinedload(ScratchCardSerial.used_by_user),
        )
        .where(ScratchCardSerial.id == serial_id)
    )
    record = result.unique().scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Serial not found")
    return {"success": True, "data": _serial_to_schema(record)}


# ---------------------------------------------------------------------------
# CREATE single
# ---------------------------------------------------------------------------
@router.post("", status_code=201)
async def create_serial(
    payload: ScratchCardSerialCreate,
    house_context: Optional[int] = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card_serials.create")),
):
    target_house_id = house_context
    if not target_house_id:
        raise HTTPException(status_code=400, detail="X-House-ID header required")

    user_house_ids = [h.id for h in current_user.houses]
    if not is_admin_user(current_user) and target_house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="Access denied to this house")

    existing = await db.execute(
        select(ScratchCardSerial).where(
            ScratchCardSerial.serial_number == payload.serial_number
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Serial number already exists")

    record = ScratchCardSerial(
        house_id=target_house_id,
        product_id=payload.product_id,
        serial_number=payload.serial_number,
        status=payload.status,
        batch_id=payload.batch_id,
        notes=payload.notes,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="scratch_card_serials",
        action="create",
        record_id=record.id,
        record_identifier=record.serial_number,
        new_values=payload.model_dump(),
    )

    return {"success": True, "data": _serial_to_schema(record)}


# ---------------------------------------------------------------------------
# BATCH CREATE — bulk serial import
# ---------------------------------------------------------------------------
@router.post("/batch", status_code=201)
async def batch_create_serials(
    payload: BatchSerialsCreate,
    house_context: Optional[int] = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card_serials.create")),
):
    target_house_id = house_context
    if not target_house_id:
        raise HTTPException(status_code=400, detail="X-House-ID header required")

    user_house_ids = [h.id for h in current_user.houses]
    if not is_admin_user(current_user) and target_house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="Access denied")

    serials = list(dict.fromkeys(payload.serials))

    existing_set = set()
    CHUNK_SIZE = 500
    for i in range(0, len(serials), CHUNK_SIZE):
        chunk = serials[i:i + CHUNK_SIZE]
        existing_serials = await db.execute(
            select(ScratchCardSerial.serial_number).where(
                ScratchCardSerial.serial_number.in_(chunk)
            )
        )
        existing_set.update(row[0] for row in existing_serials.all())

    inserted = 0
    skipped = 0
    for sn in serials:
        if sn in existing_set:
            skipped += 1
            continue
        record = ScratchCardSerial(
            house_id=target_house_id,
            product_id=payload.product_id,
            serial_number=sn,
            status="available",
            batch_id=payload.batch_id,
            exit_order_no=payload.exit_order_no,
            rf_no=payload.rf_no,
        )
        db.add(record)
        inserted += 1

    await db.commit()

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="scratch_card_serials",
        action="import",
        new_values={"inserted": inserted, "skipped": skipped},
    )

    return {
        "success": True,
        "message": f"{inserted} serials inserted, {skipped} skipped (duplicates)",
    }


# ---------------------------------------------------------------------------
# UPDATE
# ---------------------------------------------------------------------------
@router.put("/{serial_id}")
async def update_serial(
    serial_id: int,
    payload: ScratchCardSerialUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card_serials.edit")),
):
    result = await db.execute(
        select(ScratchCardSerial).where(ScratchCardSerial.id == serial_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Serial not found")

    _check_house_access(record, current_user)

    old_serial = record.serial_number
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
        module="scratch_card_serials",
        action="edit",
        record_id=record.id,
        record_identifier=old_serial,
        new_values=update_data,
    )

    return {"success": True, "data": _serial_to_schema(record)}


# ---------------------------------------------------------------------------
# BULK STATUS UPDATE
# ---------------------------------------------------------------------------
@router.patch("/bulk-status")
async def bulk_update_status(
    payload: BulkStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card_serials.edit")),
):
    records = await db.execute(
        select(ScratchCardSerial).where(
            ScratchCardSerial.id.in_(payload.serial_ids)
        )
    )
    records_list = records.scalars().all()
    if not records_list:
        raise HTTPException(status_code=404, detail="No serials found")

    for rec in records_list:
        _check_house_access(rec, current_user)

    now = func.now()
    await db.execute(
        update(ScratchCardSerial).where(
            ScratchCardSerial.id.in_(payload.serial_ids)
        ).values(
            status=payload.status,
            used_at=now if payload.status == "used" else None,
        )
    )
    await db.commit()

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="scratch_card_serials",
        action="edit",
        new_values={"bulk_status": payload.status, "count": len(payload.serial_ids)},
    )

    return {
        "success": True,
        "message": f"{len(payload.serial_ids)} serials updated to '{payload.status}'",
    }


@router.put("/bulk/update")
async def batch_update_serials(
    payload: BatchSerialUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card_serials.edit")),
):
    records = await db.execute(
        select(ScratchCardSerial).where(
            ScratchCardSerial.id.in_(payload.serial_ids)
        )
    )
    records_list = records.scalars().all()
    if not records_list:
        raise HTTPException(status_code=404, detail="No serials found")

    for rec in records_list:
        _check_house_access(rec, current_user)

    update_values = {}
    if payload.exit_order_no is not None:
        update_values["exit_order_no"] = payload.exit_order_no
    if payload.rf_no is not None:
        update_values["rf_no"] = payload.rf_no
    if payload.notes is not None:
        update_values["notes"] = payload.notes

    if update_values:
        await db.execute(
            update(ScratchCardSerial).where(
                ScratchCardSerial.id.in_(payload.serial_ids)
            ).values(**update_values)
        )
        await db.commit()

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="scratch_card_serials",
        action="edit",
        new_values={"bulk_update": update_values, "count": len(payload.serial_ids)},
    )

    return {
        "success": True,
        "message": f"{len(payload.serial_ids)} serials updated",
    }


# ---------------------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------------------
@router.delete("/{serial_id}")
async def delete_serial(
    serial_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card_serials.delete")),
):
    result = await db.execute(
        select(ScratchCardSerial).where(ScratchCardSerial.id == serial_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Serial not found")

    _check_house_access(record, current_user)

    sn = record.serial_number
    await db.delete(record)
    await db.commit()

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="scratch_card_serials",
        action="delete",
        record_id=serial_id,
        record_identifier=sn,
    )

    return {"success": True, "message": "Serial deleted successfully"}


# ---------------------------------------------------------------------------
# PERMANENT DELETE — only for "used" serials, requires special permission
# ---------------------------------------------------------------------------
@router.delete("/{serial_id}/permanent")
async def permanent_delete_serial(
    serial_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card_serials.delete")),
):
    result = await db.execute(
        select(ScratchCardSerial).where(ScratchCardSerial.id == serial_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Serial not found")

    _check_house_access(record, current_user)

    if record.status != "used":
        raise HTTPException(
            status_code=400,
            detail="Only used serials can be permanently deleted",
        )

    sn = record.serial_number
    await db.delete(record)
    await db.commit()

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="scratch_card_serials",
        action="permanent_delete",
        record_id=serial_id,
        record_identifier=sn,
    )

    return {"success": True, "message": "Used serial permanently deleted"}


# ---------------------------------------------------------------------------
# BULK PERMANENT DELETE — only for "used" serials
# ---------------------------------------------------------------------------
@router.post("/bulk-permanent-delete")
async def bulk_permanent_delete(
    serial_ids: List[int],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card_serials.delete")),
):
    if not serial_ids:
        raise HTTPException(status_code=400, detail="Serial ID list is empty")

    records = await db.execute(
        select(ScratchCardSerial).where(
            ScratchCardSerial.id.in_(serial_ids),
            ScratchCardSerial.status == "used",
        )
    )
    records_list = records.scalars().all()

    for rec in records_list:
        _check_house_access(rec, current_user)

    ids = [r.id for r in records_list]
    count = len(ids)
    for rec in records_list:
        await db.delete(rec)
    await db.commit()

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="scratch_card_serials",
        action="permanent_delete",
        new_values={"count": count, "serial_ids": ids},
    )

    return {
        "success": True,
        "message": f"{count} used serials permanently deleted",
    }


@router.post("/bulk-delete")
async def bulk_delete_serials(
    serial_ids: List[int],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card_serials.delete")),
):
    if not serial_ids:
        raise HTTPException(status_code=400, detail="Serial ID list is empty")

    records = await db.execute(
        select(ScratchCardSerial).where(
            ScratchCardSerial.id.in_(serial_ids),
        )
    )
    records_list = records.scalars().all()

    for rec in records_list:
        _check_house_access(rec, current_user)

    ids = [r.id for r in records_list]
    count = len(ids)
    for rec in records_list:
        await db.delete(rec)
    await db.commit()

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="scratch_card_serials",
        action="delete",
        new_values={"count": count, "serial_ids": ids},
    )

    return {
        "success": True,
        "message": f"{count} serials deleted",
    }


# ---------------------------------------------------------------------------
# ALLOCATE SLOTS — find available serials for a requested amount
# ---------------------------------------------------------------------------
@router.post("/allocate")
async def allocate_serials(
    payload: SlotAllocateRequest,
    house_context: Optional[int] = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card_serials.view")),
):
    target_house_id = house_context
    if not target_house_id:
        raise HTTPException(status_code=400, detail="X-House-ID header required")

    # ── Step 1: Aggregate stock per product (fast, no row data) ──────────
    count_query = select(
        ScratchCardSerial.product_id,
        func.count(ScratchCardSerial.id).label("cnt"),
    ).where(
        ScratchCardSerial.house_id == target_house_id,
        ScratchCardSerial.status == "available",
    )

    if payload.prefer_product_ids:
        count_query = count_query.where(
            ScratchCardSerial.product_id.in_(payload.prefer_product_ids)
        )

    count_query = count_query.group_by(ScratchCardSerial.product_id)
    count_result = await db.execute(count_query)
    product_counts = count_result.all()

    if not product_counts:
        raise HTTPException(status_code=400, detail="No available serials found")

    # ── Step 2: Load product MRPs ────────────────────────────────────────
    prod_ids = [pc.product_id for pc in product_counts]
    prod_result = await db.execute(
        select(Product).where(Product.id.in_(prod_ids))
    )
    products_map: dict[int, Product] = {p.id: p for p in prod_result.scalars().all()}

    # ── Step 3: Check total available value via aggregation ──────────────
    total_available = 0
    for pc in product_counts:
        p = products_map.get(pc.product_id)
        if p and p.mrp > 0:
            total_available += int(p.mrp) * pc.cnt

    if total_available < payload.request_amount:
        raise HTTPException(
            status_code=400,
            detail=f"Only {total_available} Taka available, cannot fulfill {payload.request_amount} Taka. "
                   f"No amount less than {payload.request_amount} can be provided."
        )

    # ── Step 4: Fetch only the serials we need (bounded per product) ─────
    selected: List[ScratchCardSerial] = []
    running_total = 0
    need_amount = payload.request_amount

    product_counts_sorted = sorted(product_counts, key=lambda x: x.product_id)

    for pc in product_counts_sorted:
        if need_amount <= 0:
            break

        p = products_map.get(pc.product_id)
        if not p or int(p.mrp) <= 0:
            continue

        amt = int(p.mrp)
        cards_needed = math.ceil(need_amount / amt)
        cards_to_take = min(cards_needed, pc.cnt)

        serial_query = (
            select(ScratchCardSerial)
            .where(
                ScratchCardSerial.house_id == target_house_id,
                ScratchCardSerial.status == "available",
                ScratchCardSerial.product_id == pc.product_id,
            )
            .order_by(ScratchCardSerial.id.asc())
            .limit(cards_to_take)
        )
        serial_result = await db.execute(serial_query)
        serials = serial_result.scalars().all()

        for s in serials:
            selected.append(s)
            running_total += amt
            need_amount -= amt

    # ── Step 5: Group into ranges (consecutive check) ────────────────────
    ranges: List[AllocationRangeSchema] = []
    i = 0
    while i < len(selected):
        s = selected[i]
        p = products_map.get(s.product_id)
        amt = int(p.mrp) if p else 0
        pname = p.product_name if p else None
        pcode = p.product_code if p else None

        start_serial = s.serial_number
        end_serial = s.serial_number
        count = 1
        total_val = amt
        i += 1

        while i < len(selected):
            nxt = selected[i]
            if nxt.product_id != s.product_id:
                break
            nxt_p = products_map.get(nxt.product_id)
            nxt_amt = int(nxt_p.mrp) if nxt_p else 0
            try:
                cur_num = int(end_serial)
                nxt_num = int(nxt.serial_number)
                if nxt_num == cur_num + 1:
                    end_serial = nxt.serial_number
                    count += 1
                    total_val += nxt_amt
                    i += 1
                    continue
            except ValueError:
                pass
            break

        ranges.append(AllocationRangeSchema(
            product_id=s.product_id,
            product_name=pname,
            product_code=pcode,
            amount=amt,
            start_serial=start_serial,
            end_serial=end_serial,
            count=count,
            total_value=total_val,
        ))

    return {
        "success": True,
        "data": AllocationResultSchema(
            ranges=ranges,
            requested_amount=payload.request_amount,
            fulfilled_amount=running_total,
        )
    }


# ---------------------------------------------------------------------------
# CONFIRM ALLOCATION — mark allocated serials as used
# ---------------------------------------------------------------------------
@router.post("/confirm-allocation")
async def confirm_allocation(
    payload: ConfirmAllocationRequest,
    house_context: Optional[int] = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card_serials.edit")),
):
    # Expand ranges into individual serial numbers
    all_serials: List[str] = list(payload.serials)
    for rng in payload.ranges:
        try:
            s = int(rng.start_serial)
            e = int(rng.end_serial)
            if e < s:
                raise HTTPException(status_code=400, detail=f"Invalid range: {rng.start_serial} > {rng.end_serial}")
            if e - s > 100000:
                raise HTTPException(status_code=400, detail="Range too large (max 100,000)")
            length = len(rng.start_serial)
            for i in range(s, e + 1):
                all_serials.append(str(i).zfill(length))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid serial number in range")

    if not all_serials:
        raise HTTPException(status_code=400, detail="Serial list is empty")

    result = await db.execute(
        select(ScratchCardSerial).where(
            ScratchCardSerial.serial_number.in_(all_serials),
            ScratchCardSerial.status == "available",
        )
    )
    records = result.scalars().all()

    target_house_id = house_context
    user_house_ids = [h.id for h in current_user.houses]

    updated = 0
    for rec in records:
        if not is_admin_user(current_user) and rec.house_id not in user_house_ids:
            continue
        if target_house_id and rec.house_id != target_house_id:
            continue
        rec.status = "used"
        rec.used_by = current_user.id
        rec.used_at = now_naive()
        if payload.notes:
            rec.notes = payload.notes
        updated += 1

    await db.commit()

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="scratch_card_serials",
        action="edit",
        new_values={"confirmed_allocation": True, "count": updated},
    )

    return {"success": True, "message": f"{updated} serials marked as used"}


# ---------------------------------------------------------------------------
# EXPORT
# ---------------------------------------------------------------------------
@router.get("/export/list")
async def export_serials(
    product_id: Optional[int] = Query(None),
    batch_id: Optional[str] = Query(None),
    house_context: Optional[int] = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card_serials.export")),
):
    from collections import defaultdict
    import asyncio

    from app.models.product import Product

    query = select(
        ScratchCardSerial.product_id,
        ScratchCardSerial.serial_number,
        Product.product_code,
    ).join(Product, ScratchCardSerial.product_id == Product.id).where(
        ScratchCardSerial.status == "available"
    )
    query = _apply_house_filter(query, ScratchCardSerial, current_user, house_context)

    if product_id:
        query = query.where(ScratchCardSerial.product_id == product_id)
    if batch_id:
        query = query.where(ScratchCardSerial.batch_id == batch_id)

    query = query.order_by(ScratchCardSerial.product_id, ScratchCardSerial.serial_number)

    result = await db.execute(query)
    rows = result.all()
    if not rows:
        return Response(content=b"", media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": "attachment; filename=scratch_card_serials.xlsx"})

    # Group by product_id
    groups: dict[int, list[tuple]] = defaultdict(list)
    for r in rows:
        groups[r[0]].append(r)

    # Build product info (code + ranges) – CPU-light, fine on event loop
    product_info: list[tuple[str, list[tuple[str, str]]]] = []
    for pid, serials in groups.items():
        sorted_serials = sorted(serials, key=lambda s: int(s[1]))
        code = sorted_serials[0][2] or f"Product #{pid}"
        ranges: list[tuple[str, str]] = []
        start = end = sorted_serials[0][1]
        prev = int(end)
        for s in sorted_serials[1:]:
            cur = int(s[1])
            if cur == prev + 1:
                end = s[1]
                prev = cur
            else:
                ranges.append((start, end))
                start = s[1]
                end = s[1]
                prev = cur
        ranges.append((start, end))
        product_info.append((code, ranges))

    # ── Heavy Excel work → run in thread (frees the event loop) ──────
    loop = asyncio.get_event_loop()
    buf = await loop.run_in_executor(None, _build_excel, product_info)

    return Response(
        content=buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=scratch_card_serials.xlsx"},
    )


def _build_excel(product_info: list[tuple[str, list[tuple[str, str]]]]) -> bytes:
    """CPU-bound Excel generation — runs in a thread pool."""
    import io
    from openpyxl import Workbook

    MAX_ROW = 1048576

    # Build column data arrays
    columns: list[list[str | None]] = []
    for code, ranges in product_info:
        col_values: list[str | None] = [code]
        first_in_col = True
        for start_sn, end_sn in ranges:
            size = int(end_sn) - int(start_sn) + 1
            gap = 0 if first_in_col else 1
            if len(col_values) + gap + size > MAX_ROW:
                columns.append(col_values)
                col_values = [code]
                first_in_col = True
                gap = 0
            if gap:
                col_values.append(None)
            pad = len(start_sn)
            s = int(start_sn)
            col_values.extend(str(x).zfill(pad) for x in range(s, s + size))
            first_in_col = False
        columns.append(col_values)

    # Write in write-only mode
    wb = Workbook(write_only=True)
    ws = wb.create_sheet(title="SC Serials")

    ncols = len(columns)
    max_rows = max(len(c) for c in columns) if columns else 0

    for ri in range(max_rows):
        row: list[str | None] = []
        for ci in range(ncols):
            row.append(columns[ci][ri] if ri < len(columns[ci]) else None)
        ws.append(row)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# GENERATE UNIQUE BATCH ID
# ---------------------------------------------------------------------------
@router.get("/batch-id/generate")
async def generate_batch_id(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card_serials.create")),
):
    today = date.today()
    prefix = f"BATCH-{today.strftime('%Y%m%d')}-"
    like_pattern = f"{prefix}%"
    result = await db.execute(
        select(func.max(ScratchCardSerial.batch_id)).where(
            ScratchCardSerial.batch_id.ilike(like_pattern)
        )
    )
    max_id = result.scalar()
    next_num = 1
    if max_id:
        parts = max_id.rsplit("-", 1)
        if len(parts) == 2 and parts[1].isdigit():
            next_num = int(parts[1]) + 1
    batch_id = f"{prefix}{next_num:04d}"
    return {"success": True, "data": {"batch_id": batch_id}}


# ---------------------------------------------------------------------------
# STOCK SUMMARY — grouped by product
# ---------------------------------------------------------------------------
@router.get("/stock/summary")
async def stock_summary(
    house_agg: Optional[int] = Query(None, alias="house_id"),
    house_context: Optional[int] = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card_serials.view")),
):
    from app.models.house import House

    # ── Detail mode: per-product breakdown for one house ──────────────
    if house_agg:
        h_result = await db.execute(select(House).where(House.id == house_agg))
        house = h_result.scalar_one_or_none()
        if not house:
            raise HTTPException(status_code=404, detail="House not found")
        user_house_ids = [h.id for h in current_user.houses]
        if not is_admin_user(current_user) and house_agg not in user_house_ids:
            raise HTTPException(status_code=403, detail="Access denied")

        q = select(
            ScratchCardSerial.product_id,
            ScratchCardSerial.status,
            Product.product_code,
            Product.product_name,
            Product.mrp,
            func.count(ScratchCardSerial.id).label("count"),
        ).join(Product, ScratchCardSerial.product_id == Product.id).where(
            ScratchCardSerial.house_id == house_agg
        ).group_by(
            ScratchCardSerial.product_id, ScratchCardSerial.status,
            Product.product_code, Product.product_name, Product.mrp,
        )
        result = await db.execute(q)
        rows = result.all()

        products_map: dict[int, dict] = {}
        for row in rows:
            pid = row.product_id
            if pid not in products_map:
                products_map[pid] = {
                    "product_id": pid,
                    "product_code": row.product_code,
                    "product_name": row.product_name,
                    "mrp": row.mrp or 0,
                    "available_qty": 0,
                    "available_amount": 0,
                    "used_qty": 0,
                    "used_amount": 0,
                }
            qty = row.count
            amt = int(qty * (row.mrp or 0))
            if row.status == "available":
                products_map[pid]["available_qty"] = qty
                products_map[pid]["available_amount"] = amt
            elif row.status == "used":
                products_map[pid]["used_qty"] = qty
                products_map[pid]["used_amount"] = amt

        return {
            "success": True,
            "data": {
                "house_id": house_agg,
                "house_name": house.name,
                "house_code": house.code,
                "products": list(products_map.values()),
            },
        }

    # ── Aggregate mode: per-house totals ──────────────────────────────
    query = select(
        ScratchCardSerial.house_id,
        ScratchCardSerial.status,
        Product.mrp,
        func.count(ScratchCardSerial.id).label("count"),
    ).join(Product, ScratchCardSerial.product_id == Product.id)
    query = _apply_house_filter(query, ScratchCardSerial, current_user, house_context)
    query = query.group_by(ScratchCardSerial.house_id, ScratchCardSerial.status, Product.mrp)
    result = await db.execute(query)
    rows = result.all()

    house_ids = set(r.house_id for r in rows)
    houses_map = {}
    if house_ids:
        house_result = await db.execute(
            select(House).where(House.id.in_(house_ids))
        )
        for h in house_result.scalars().all():
            houses_map[h.id] = h

    agg = {}
    for row in rows:
        hid = row.house_id
        if hid not in agg:
            h = houses_map.get(hid)
            agg[hid] = {
                "house_id": hid,
                "house_name": h.name if h else f"House #{hid}",
                "house_code": h.code or "",
                "total_serials": 0,
                "total_value": 0,
            }
        if row.status == "available":
            agg[hid]["total_serials"] += row.count
            agg[hid]["total_value"] += int(row.count * (row.mrp or 0))

    return {"success": True, "data": list(agg.values())}
