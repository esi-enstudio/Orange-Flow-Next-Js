import logging
import math
from datetime import date
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
    return ScratchCardSerialSchema.model_validate(record)


# ---------------------------------------------------------------------------
# LIST
# ---------------------------------------------------------------------------
@router.get("")
async def list_serials(
    pagination: PaginationParams = Depends(),
    product_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    batch_id: Optional[str] = Query(None),
    house_context: Optional[int] = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card_serials.view")),
):
    query = select(ScratchCardSerial).options(joinedload(ScratchCardSerial.product))
    query = _apply_house_filter(query, ScratchCardSerial, current_user, house_context)

    if pagination.search:
        q = f"%{pagination.search}%"
        query = query.where(ScratchCardSerial.serial_number.ilike(q))

    if product_id:
        query = query.where(ScratchCardSerial.product_id == product_id)
    if status:
        query = query.where(ScratchCardSerial.status == status)
    if batch_id:
        query = query.where(ScratchCardSerial.batch_id == batch_id)

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
        .options(joinedload(ScratchCardSerial.product))
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

    existing_serials = await db.execute(
        select(ScratchCardSerial.serial_number).where(
            ScratchCardSerial.serial_number.in_(payload.serials)
        )
    )
    existing_set = set(row[0] for row in existing_serials.all())

    inserted = 0
    skipped = 0
    for sn in payload.serials:
        if sn in existing_set:
            skipped += 1
            continue
        record = ScratchCardSerial(
            house_id=target_house_id,
            product_id=payload.product_id,
            serial_number=sn,
            status="available",
            batch_id=payload.batch_id,
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

    query = select(ScratchCardSerial).where(
        ScratchCardSerial.house_id == target_house_id,
        ScratchCardSerial.status == "available",
    )

    if payload.prefer_product_ids:
        query = query.where(ScratchCardSerial.product_id.in_(payload.prefer_product_ids))

    query = query.options(joinedload(ScratchCardSerial.product))
    query = query.order_by(ScratchCardSerial.product_id.asc(), ScratchCardSerial.id.asc())
    result = await db.execute(query)
    available = result.unique().scalars().all()

    # Check if enough total value is available
    total_available = sum(int(s.product.mrp) for s in available if s.product)
    if total_available < payload.request_amount:
        raise HTTPException(
            status_code=400,
            detail=f"Only {total_available} Taka available, cannot fulfill {payload.request_amount} Taka. "
                   f"No amount less than {payload.request_amount} can be provided."
        )

    # Greedily pick serials until >= requested_amount
    selected: List[ScratchCardSerial] = []
    running_total = 0
    for serial in available:
        amt = int(serial.product.mrp) if serial.product else 0
        if amt <= 0:
            continue
        selected.append(serial)
        running_total += amt
        if running_total >= payload.request_amount:
            break

    # Group selected serials into ranges by product (consecutive check)
    ranges: List[AllocationRangeSchema] = []
    i = 0
    while i < len(selected):
        s = selected[i]
        amt = int(s.product.mrp) if s.product else 0
        pname = s.product_name
        pcode = s.product_code

        start_serial = s.serial_number
        end_serial = s.serial_number
        count = 1
        total_val = amt
        i += 1

        while i < len(selected):
            nxt = selected[i]
            if nxt.product_id != s.product_id:
                break
            nxt_amt = int(nxt.product.mrp) if nxt.product else 0
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
    status: Optional[str] = Query(None),
    batch_id: Optional[str] = Query(None),
    house_context: Optional[int] = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card_serials.export")),
):
    query = select(ScratchCardSerial).options(joinedload(ScratchCardSerial.product))
    query = _apply_house_filter(query, ScratchCardSerial, current_user, house_context)

    if product_id:
        query = query.where(ScratchCardSerial.product_id == product_id)
    if status:
        query = query.where(ScratchCardSerial.status == status)
    if batch_id:
        query = query.where(ScratchCardSerial.batch_id == batch_id)

    result = await db.execute(query)
    records = result.unique().scalars().all()

    import io
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "SC Serials"

    headers = ["ID", "House ID", "Product ID", "Product Name", "Product Code",
               "Serial Number", "Status", "Batch ID", "Notes", "Used At", "Used By"]
    ws.append(headers)

    for r in records:
        ws.append([
            r.id, r.house_id, r.product_id, r.product_name, r.product_code,
            r.serial_number, r.status, r.batch_id, r.notes, r.used_at, r.used_by,
        ])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=scratch_card_serials.xlsx"},
    )


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
    house_context: Optional[int] = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("scratch_card_serials.view")),
):
    query = select(
        ScratchCardSerial.product_id,
        ScratchCardSerial.status,
        func.count(ScratchCardSerial.id).label("count"),
    )
    query = _apply_house_filter(query, ScratchCardSerial, current_user, house_context)
    query = query.group_by(ScratchCardSerial.product_id, ScratchCardSerial.status)
    result = await db.execute(query)
    rows = result.all()

    product_ids = set(r.product_id for r in rows)
    products_map = {}
    if product_ids:
        prod_result = await db.execute(
            select(Product).where(Product.id.in_(product_ids))
        )
        for p in prod_result.scalars().all():
            products_map[p.id] = p

    summary = []
    group = {}
    for row in rows:
        pid = row.product_id
        if pid not in group:
            p = products_map.get(pid)
            group[pid] = {
                "product_id": pid,
                "product_name": p.product_name if p else f"Product #{pid}",
                "product_code": p.product_code if p else "",
                "available": 0,
                "used": 0,
                "allocated": 0,
                "total": 0,
            }
        group[pid][row.status] = row.count
        group[pid]["total"] += row.count

    return {"success": True, "data": list(group.values())}
