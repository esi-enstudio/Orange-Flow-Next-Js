import io
import os
import shutil
import time
import uuid
from typing import Optional

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.models.retailer import Retailer
from app.models.retailer_marking import RetailerMarking, RetailerMarkingAssignment
from app.models.user import User
from app.routers.deps import (
    get_db,
    get_house_context,
    has_permission,
)
from app.schemas.pagination import PaginatedResponse, PaginationMeta, PaginationParams
from app.schemas.retailer_marking import (
    AssignmentCreate,
    ImportConfirmRequest,
    ImportPreviewResponse,
    ImportPreviewRow,
    RetailerMarkingCreate,
    RetailerMarkingSchema,
    RetailerMarkingUpdate,
    UnassignRequest,
)
from app.services.retailer_marking_service import get_active_markings
from app.utils.access_control import is_admin_user
from app.utils.activity_logger import log_activity
from app.utils.timezone import now_naive
from app.utils.validation import safe_filename, validate_excel

router = APIRouter(prefix="/api/retailer-markings", tags=["retailer-markings"])

MODULE = "retailer_markings"

# In-memory staging store for the Import → Preview → Confirm flow.
_IMPORT_STAGING: dict[str, dict] = {}
_IMPORT_STAGING_TTL = 60 * 30  # 30 minutes


def _house_in_list(house_id: int, house_context: Optional[int], current_user: User) -> bool:
    if is_admin_user(current_user):
        return True
    if house_context:
        return house_id == house_context
    return any(h.id == house_id for h in current_user.houses)


async def _accessible_retailer(db: AsyncSession, retailer_id: int, current_user: User, house_context: Optional[int]) -> Retailer:
    retailer = await db.get(Retailer, retailer_id)
    if not retailer:
        raise HTTPException(status_code=404, detail=f"Retailer {retailer_id} not found")
    if not _house_in_list(retailer.house_id, house_context, current_user):
        raise HTTPException(status_code=403, detail="Access denied to this retailer's house")
    return retailer


async def _user_names(db: AsyncSession, ids: set[Optional[int]]) -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    res = await db.execute(select(User.id, User.name).where(User.id.in_(ids)))
    return {uid: name for uid, name in res.all()}


def _marking_to_dict(m: RetailerMarking, retailer_count: int = 0) -> dict:
    return {
        "id": m.id,
        "name": m.name,
        "code": m.code,
        "description": m.description,
        "status": m.status,
        "created_by": m.created_by,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "updated_at": m.updated_at.isoformat() if m.updated_at else None,
        "retailer_count": retailer_count,
    }


# ---------------------------------------------------------------------------
# Marking CRUD
# ---------------------------------------------------------------------------

@router.get("")
async def list_markings(
    pagination: PaginationParams = Depends(),
    status: Optional[str] = Query(None, pattern="^(active|inactive)$"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission(f"{MODULE}.view")),
):
    count_subq = (
        select(
            RetailerMarkingAssignment.marking_id,
            func.count().label("cnt"),
        )
        .where(RetailerMarkingAssignment.status == "active")
        .group_by(RetailerMarkingAssignment.marking_id)
        .subquery()
    )
    query = (
        select(RetailerMarking, func.coalesce(count_subq.c.cnt, 0))
        .outerjoin(count_subq, count_subq.c.marking_id == RetailerMarking.id)
    )
    if status:
        query = query.where(RetailerMarking.status == status)
    if pagination.search:
        p = f"%{pagination.search}%"
        query = query.where(
            (RetailerMarking.name.ilike(p))
            | (RetailerMarking.code.ilike(p))
            | (RetailerMarking.description.ilike(p))
        )

    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    sort_col = {
        "name": RetailerMarking.name,
        "code": RetailerMarking.code,
        "status": RetailerMarking.status,
        "created_at": RetailerMarking.created_at,
        "retailer_count": func.coalesce(count_subq.c.cnt, 0),
    }.get(pagination.sort_by, RetailerMarking.name)
    order = sort_col.asc() if pagination.sort_order == "asc" else sort_col.desc()
    offset = (pagination.page - 1) * pagination.per_page
    rows = (await db.execute(query.offset(offset).limit(pagination.per_page).order_by(order))).all()

    total_pages = max(1, -(-total // pagination.per_page))
    data = [_marking_to_dict(m, int(c)) for m, c in rows]
    return PaginatedResponse(
        success=True,
        data=data,
        pagination=PaginationMeta(
            page=pagination.page,
            per_page=pagination.per_page,
            total=total,
            total_pages=total_pages,
            has_next=pagination.page < total_pages,
            has_prev=pagination.page > 1,
        ),
    )


@router.get("/options", response_model=list[RetailerMarkingSchema])
async def marking_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission(f"{MODULE}.view")),
):
    """Lightweight list of active markings for dropdowns/exclusion configs."""
    return await get_active_markings(db)


@router.post("", response_model=RetailerMarkingSchema)
async def create_marking(
    data: RetailerMarkingCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission(f"{MODULE}.create")),
):
    existing = (
        await db.execute(
            select(RetailerMarking).where(
                (RetailerMarking.name == data.name)
                | (RetailerMarking.code == data.code)
            )
        )
    ).scalar_one_or_none()
    if existing:
        dup = "name" if existing.name == data.name else "code"
        raise HTTPException(status_code=409, detail=f"Marking {dup} already exists")

    marking = RetailerMarking(
        name=data.name.strip(),
        code=data.code.strip().upper(),
        description=data.description,
        status="active",
        created_by=current_user.id,
    )
    db.add(marking)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Marking name or code already exists")
    await db.refresh(marking)
    await log_activity(
        db, current_user.id, current_user.name, MODULE, "create",
        record_id=marking.id, record_identifier=marking.name,
        new_values={"name": marking.name, "code": marking.code},
        request=None, status_code=201,
    )
    return _marking_to_dict(marking)


@router.patch("/{marking_id}", response_model=RetailerMarkingSchema)
async def update_marking(
    marking_id: int,
    data: RetailerMarkingUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission(f"{MODULE}.edit")),
):
    marking = await db.get(RetailerMarking, marking_id)
    if not marking:
        raise HTTPException(status_code=404, detail="Marking not found")

    old = _marking_to_dict(marking)
    updates = {}
    if data.name is not None and data.name.strip() != marking.name:
        dup = (
            await db.execute(
                select(RetailerMarking).where(
                    RetailerMarking.name == data.name.strip(),
                    RetailerMarking.id != marking_id,
                )
            )
        ).scalar_one_or_none()
        if dup:
            raise HTTPException(status_code=409, detail="Marking name already exists")
        marking.name = data.name.strip()
        updates["name"] = marking.name
    if data.code is not None and data.code.strip().upper() != marking.code:
        dup = (
            await db.execute(
                select(RetailerMarking).where(
                    RetailerMarking.code == data.code.strip().upper(),
                    RetailerMarking.id != marking_id,
                )
            )
        ).scalar_one_or_none()
        if dup:
            raise HTTPException(status_code=409, detail="Marking code already exists")
        marking.code = data.code.strip().upper()
        updates["code"] = marking.code
    if data.description is not None:
        marking.description = data.description.strip() or None
        updates["description"] = marking.description
    if data.status is not None and data.status != marking.status:
        if data.status == "inactive" and marking.status == "active":
            active_assignments = (
                await db.execute(
                    select(func.count())
                    .select_from(RetailerMarkingAssignment)
                    .where(
                        RetailerMarkingAssignment.marking_id == marking_id,
                        RetailerMarkingAssignment.status == "active",
                    )
                )
            ).scalar() or 0
            if active_assignments:
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot deactivate marking with {active_assignments} active assignment(s). Remove assignments first.",
                )
        marking.status = data.status
        updates["status"] = marking.status
    marking.updated_by = current_user.id
    await db.commit()
    await db.refresh(marking)
    await log_activity(
        db, current_user.id, current_user.name, MODULE, "edit",
        record_id=marking.id, record_identifier=marking.name,
        old_values=old, new_values=updates,
        request=None, status_code=200,
    )
    return _marking_to_dict(marking)


@router.delete("/{marking_id}")
async def delete_marking(
    marking_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission(f"{MODULE}.delete")),
):
    marking = await db.get(RetailerMarking, marking_id)
    if not marking:
        raise HTTPException(status_code=404, detail="Marking not found")
    old = _marking_to_dict(marking)
    await db.delete(marking)
    await db.commit()
    await log_activity(
        db, current_user.id, current_user.name, MODULE, "delete",
        record_id=old["id"], record_identifier=old["name"],
        old_values=old, new_values=None,
        request=None, status_code=200,
    )
    return {"message": "Marking deleted successfully"}


@router.post("/{marking_id}/restore", response_model=RetailerMarkingSchema)
async def restore_marking(
    marking_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission(f"{MODULE}.restore")),
):
    raise HTTPException(status_code=404, detail="Markings use hard delete only — restore is not supported")


# ---------------------------------------------------------------------------
# Retailers + markings
# ---------------------------------------------------------------------------

@router.get("/retailers")
async def list_retailers_with_markings(
    pagination: PaginationParams = Depends(),
    marking: Optional[str] = Query(None, description="Filter by marking name"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission(f"{MODULE}.view")),
    house_context: Optional[int] = Depends(get_house_context),
):
    is_admin = is_admin_user(current_user)
    query = select(Retailer).options(joinedload(Retailer.house))
    if marking:
        query = (
            query.join(RetailerMarkingAssignment, RetailerMarkingAssignment.retailer_id == Retailer.id)
            .join(RetailerMarking, RetailerMarking.id == RetailerMarkingAssignment.marking_id)
            .where(
                RetailerMarkingAssignment.status == "active",
                RetailerMarking.name == marking,
            )
        )
    if house_context:
        query = query.where(Retailer.house_id == house_context)
    elif not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        query = query.where(
            Retailer.house_id.in_(user_house_ids) if user_house_ids else Retailer.house_id == -1
        )
    if pagination.search:
        p = f"%{pagination.search}%"
        query = query.where(
            (Retailer.name.ilike(p))
            | (Retailer.retailer_code.ilike(p))
            | (Retailer.itop_number.ilike(p))
        )
    query = query.distinct()

    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar() or 0

    sort_col = {
        "name": Retailer.name,
        "retailer_code": Retailer.retailer_code,
        "itop_number": Retailer.itop_number,
        "thana": Retailer.thana,
    }.get(pagination.sort_by, Retailer.id)
    order = sort_col.asc() if pagination.sort_order == "asc" else sort_col.desc()
    offset = (pagination.page - 1) * pagination.per_page
    retailers = (
        await db.execute(query.offset(offset).limit(pagination.per_page).order_by(order))
    ).scalars().unique().all()

    markings_map = await _marking_names_for_retailers(db, [r.id for r in retailers])

    data = []
    for r in retailers:
        data.append(
            {
                "id": r.id,
                "house_id": r.house_id,
                "retailer_code": r.retailer_code,
                "name": r.name,
                "itop_number": r.itop_number,
                "thana": r.thana,
                "type": r.type,
                "house": {"id": r.house.id, "name": r.house.name, "code": r.house.code}
                if r.house
                else None,
                "markings": markings_map.get(r.id, []),
            }
        )

    total_pages = max(1, -(-total // pagination.per_page))
    return PaginatedResponse(
        success=True,
        data=data,
        pagination=PaginationMeta(
            page=pagination.page,
            per_page=pagination.per_page,
            total=total,
            total_pages=total_pages,
            has_next=pagination.page < total_pages,
            has_prev=pagination.page > 1,
        ),
    )


async def _marking_names_for_retailers(db: AsyncSession, retailer_ids: list[int]) -> dict[int, list[str]]:
    if not retailer_ids:
        return {}
    res = await db.execute(
        select(RetailerMarkingAssignment.retailer_id, RetailerMarking.name)
        .join(RetailerMarking, RetailerMarking.id == RetailerMarkingAssignment.marking_id)
        .where(
            RetailerMarkingAssignment.retailer_id.in_(retailer_ids),
            RetailerMarkingAssignment.status == "active",
        )
        .order_by(RetailerMarking.name)
    )
    result: dict[int, list[str]] = {}
    for rid, name in res.all():
        result.setdefault(rid, []).append(name)
    return result


# ---------------------------------------------------------------------------
# Assign / unassign
# ---------------------------------------------------------------------------

@router.post("/{marking_id}/assign")
async def assign_marking(
    marking_id: int,
    data: AssignmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission(f"{MODULE}.assign")),
    house_context: Optional[int] = Depends(get_house_context),
):
    marking = await db.get(RetailerMarking, marking_id)
    if not marking or marking.status != "active":
        raise HTTPException(status_code=400, detail="Marking is not active")

    assigned = 0
    already = 0
    errors = []
    for retailer_id in data.retailer_ids:
        try:
            retailer = await _accessible_retailer(db, retailer_id, current_user, house_context)
        except HTTPException:
            errors.append(f"Retailer {retailer_id}: access denied or not found")
            continue
        existing = (
            await db.execute(
                select(RetailerMarkingAssignment).where(
                    RetailerMarkingAssignment.retailer_id == retailer.id,
                    RetailerMarkingAssignment.marking_id == marking_id,
                    RetailerMarkingAssignment.status == "active",
                )
            )
        ).scalar_one_or_none()
        if existing:
            already += 1
            continue
        now = now_naive()
        db.add(
            RetailerMarkingAssignment(
                retailer_id=retailer.id,
                marking_id=marking_id,
                status="active",
                effective_from=now,
                effective_to=None,
                assigned_by=current_user.id,
                assigned_at=now,
                remarks=data.remarks,
            )
        )
        assigned += 1
    await db.commit()

    await log_activity(
        db, current_user.id, current_user.name, MODULE, "assign",
        record_id=marking_id, record_identifier=marking.name,
        new_values={"assigned": assigned, "already": already, "errors": errors[:20]},
        request=None, status_code=200,
    )
    return {"assigned": assigned, "already_assigned": already, "errors": errors}


@router.post("/{marking_id}/unassign")
async def unassign_marking(
    marking_id: int,
    data: UnassignRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission(f"{MODULE}.assign")),
    house_context: Optional[int] = Depends(get_house_context),
):
    marking = await db.get(RetailerMarking, marking_id)
    if not marking:
        raise HTTPException(status_code=404, detail="Marking not found")

    removed = 0
    errors = []
    for retailer_id in data.retailer_ids:
        try:
            retailer = await _accessible_retailer(db, retailer_id, current_user, house_context)
        except HTTPException:
            errors.append(f"Retailer {retailer_id}: access denied or not found")
            continue
        active = (
            await db.execute(
                select(RetailerMarkingAssignment).where(
                    RetailerMarkingAssignment.retailer_id == retailer.id,
                    RetailerMarkingAssignment.marking_id == marking_id,
                    RetailerMarkingAssignment.status == "active",
                )
            )
        ).scalar_one_or_none()
        if not active:
            continue
        now = now_naive()
        active.status = "inactive"
        active.effective_to = now
        active.removed_by = current_user.id
        active.removed_at = now
        if data.remarks:
            active.remarks = data.remarks
        removed += 1
    await db.commit()

    await log_activity(
        db, current_user.id, current_user.name, MODULE, "unassign",
        record_id=marking_id, record_identifier=marking.name,
        new_values={"removed": removed, "errors": errors[:20]},
        request=None, status_code=200,
    )
    return {"removed": removed, "errors": errors}


# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------

@router.get("/history")
async def list_history(
    pagination: PaginationParams = Depends(),
    marking_id: Optional[int] = Query(None),
    retailer_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None, pattern="^(active|inactive)$"),
    house_context: Optional[int] = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission(f"{MODULE}.view")),
):
    query = (
        select(RetailerMarkingAssignment)
        .options(joinedload(RetailerMarkingAssignment.retailer), joinedload(RetailerMarkingAssignment.marking))
        .join(Retailer, Retailer.id == RetailerMarkingAssignment.retailer_id)
    )
    if marking_id:
        query = query.where(RetailerMarkingAssignment.marking_id == marking_id)
    if retailer_id:
        query = query.where(RetailerMarkingAssignment.retailer_id == retailer_id)
    if status:
        query = query.where(RetailerMarkingAssignment.status == status)
    is_admin = is_admin_user(current_user)
    if house_context:
        query = query.where(Retailer.house_id == house_context)
    elif not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        query = query.where(
            Retailer.house_id.in_(user_house_ids) if user_house_ids else Retailer.house_id == -1
        )
    if pagination.search:
        p = f"%{pagination.search}%"
        query = query.where(
            (Retailer.name.ilike(p))
            | (Retailer.retailer_code.ilike(p))
            | (RetailerMarkingAssignment.marking.has(RetailerMarking.name.ilike(p)))
        )

    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar() or 0
    offset = (pagination.page - 1) * pagination.per_page
    rows = (
        await db.execute(
            query.offset(offset).limit(pagination.per_page).order_by(RetailerMarkingAssignment.assigned_at.desc())
        )
    ).scalars().unique().all()

    user_ids = {a.assigned_by for a in rows} | {a.removed_by for a in rows}
    names = await _user_names(db, user_ids)

    data = []
    for a in rows:
        data.append(
            {
                "id": a.id,
                "retailer_id": a.retailer_id,
                "marking_id": a.marking_id,
                "marking_name": a.marking.name if a.marking else None,
                "marking_code": a.marking.code if a.marking else None,
                "status": a.status,
                "effective_from": a.effective_from.isoformat() if a.effective_from else None,
                "effective_to": a.effective_to.isoformat() if a.effective_to else None,
                "assigned_by": a.assigned_by,
                "assigned_by_name": names.get(a.assigned_by),
                "removed_by": a.removed_by,
                "removed_by_name": names.get(a.removed_by),
                "assigned_at": a.assigned_at.isoformat() if a.assigned_at else None,
                "removed_at": a.removed_at.isoformat() if a.removed_at else None,
                "remarks": a.remarks,
                "retailer": {
                    "id": a.retailer.id,
                    "retailer_code": a.retailer.retailer_code,
                    "name": a.retailer.name,
                    "itop_number": a.retailer.itop_number,
                    "house_id": a.retailer.house_id,
                }
                if a.retailer
                else None,
            }
        )

    total_pages = max(1, -(-total // pagination.per_page))
    return PaginatedResponse(
        success=True,
        data=data,
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
# Import / Export
# ---------------------------------------------------------------------------

_HEADER_MAP = {
    "retailer_number": "retailer_number",
    "retailernumber": "retailer_number",
    "retailer_code": "retailer_number",
    "retailercode": "retailer_number",
    "retailer_name": "retailer_name",
    "retailername": "retailer_name",
    "marking": "marking",
    "marking_name": "marking",
    "markingname": "marking",
    "tag": "marking",
    "tag_name": "marking",
}


def _normalize_header(h) -> str:
    return str(h or "").strip().lower().replace(" ", "_").replace("-", "_")


async def _parse_import_file(file_path: str, db: AsyncSession) -> tuple[list[ImportPreviewRow], list[str]]:
    df = pd.read_excel(file_path, dtype=str)
    df = df.fillna("")

    normalized = {_normalize_header(c): c for c in df.columns}
    col = {}
    for key, target in _HEADER_MAP.items():
        if key in normalized:
            col.setdefault(target, normalized[key])

    if "retailer_number" not in col:
        raise HTTPException(status_code=400, detail="Missing required column: Retailer Number")
    if "marking" not in col:
        raise HTTPException(status_code=400, detail="Missing required column: Marking")

    existing_markings = {
        m.name.lower(): m
        for m in (
            await db.execute(select(RetailerMarking))
        ).scalars().all()
    }

    rows: list[ImportPreviewRow] = []
    new_markings: set[str] = set()
    seen: set[tuple[str, str]] = set()

    for idx, (_, raw) in enumerate(df.iterrows(), start=2):
        retailer_number = str(raw.get(col["retailer_number"], "")).strip()
        retailer_name = str(raw.get(col["retailer_name"], "")).strip()
        marking_name = str(raw.get(col["marking"], "")).strip()

        error = None
        retailer_id = None
        if not retailer_number:
            error = "Retailer Number is required"
        elif not marking_name:
            error = "Marking is required"
        else:
            dup_key = (retailer_number, marking_name.lower())
            if dup_key in seen:
                error = "Duplicate row in file"
            else:
                seen.add(dup_key)
                retailer = (
                    await db.execute(
                        select(Retailer).where(Retailer.retailer_code == retailer_number)
                    )
                ).scalar_one_or_none()
                if not retailer:
                    error = f"Retailer '{retailer_number}' not found"
                else:
                    retailer_id = retailer.id
                m = existing_markings.get(marking_name.lower())
                if m is None:
                    new_markings.add(marking_name)

        rows.append(
            ImportPreviewRow(
                line=idx,
                retailer_number=retailer_number,
                retailer_name=retailer_name,
                marking_name=marking_name,
                retailer_id=retailer_id,
                valid=error is None,
                error=error,
            )
        )

    return rows, sorted(new_markings)


@router.post("/import/preview", response_model=ImportPreviewResponse)
async def import_preview(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission(f"{MODULE}.import")),
    house_context: Optional[int] = Depends(get_house_context),
):
    if not validate_excel(file.filename or "upload.xlsx"):
        raise HTTPException(status_code=400, detail="Invalid file type. Only .xlsx and .xls files are allowed.")
    if not os.path.exists("temp_downloads"):
        os.makedirs("temp_downloads")
    file_path = f"temp_downloads/{safe_filename(file.filename or 'upload.xlsx')}"
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        rows, new_markings = await _parse_import_file(file_path, db)
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)

    # House-access safety: drop rows whose retailer is outside the accessible scope.
    is_admin = is_admin_user(current_user)
    allowed: Optional[list[int]] = None
    if house_context:
        allowed = [house_context]
    elif not is_admin:
        allowed = [h.id for h in current_user.houses] or [-1]
    if allowed is not None:
        valid_ids = [r.retailer_id for r in rows if r.retailer_id]
        if valid_ids:
            res = await db.execute(select(Retailer.id).where(Retailer.id.in_(valid_ids), Retailer.house_id.in_(allowed)))
            allowed_ids = {row[0] for row in res.all()}
        else:
            allowed_ids = set()
        for r in rows:
            if r.retailer_id and r.retailer_id not in allowed_ids and r.valid:
                r.valid = False
                r.error = "Retailer outside accessible house scope"

    batch_reference = uuid.uuid4().hex
    _IMPORT_STAGING[batch_reference] = {
        "created_at": time.time(),
        "rows": rows,
        "new_markings": new_markings,
    }
    expired = [k for k, v in _IMPORT_STAGING.items() if time.time() - v["created_at"] >= _IMPORT_STAGING_TTL]
    for k in expired:
        del _IMPORT_STAGING[k]

    return ImportPreviewResponse(
        batch_reference=batch_reference,
        total=len(rows),
        valid_count=sum(1 for r in rows if r.valid),
        invalid_count=sum(1 for r in rows if not r.valid),
        errors=[r for r in rows if not r.valid],
        rows=rows,
        new_markings=new_markings,
    )


async def _create_marking_for_import(db: AsyncSession, name: str, current_user: User) -> RetailerMarking:
    if (
        await db.execute(
            select(RetailerMarking.id).where(RetailerMarking.name == name)
        )
    ).scalar_one_or_none():
        return (await db.execute(select(RetailerMarking).where(RetailerMarking.name == name))).scalar_one()

    base_code = "".join(c for c in name.upper() if c.isalnum())[:50] or "M"
    code = base_code
    suffix = 1
    while (
        await db.execute(
            select(RetailerMarking.id).where(RetailerMarking.code == code)
        )
    ).scalar_one_or_none():
        code = f"{base_code}{suffix}"
        suffix += 1
    marking = RetailerMarking(name=name, code=code, status="active", created_by=current_user.id)
    db.add(marking)
    await db.flush()
    return marking


@router.post("/import/confirm")
async def import_confirm(
    data: ImportConfirmRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission(f"{MODULE}.import")),
    house_context: Optional[int] = Depends(get_house_context),
):
    staged = _IMPORT_STAGING.pop(data.batch_reference, None)
    if not staged:
        raise HTTPException(status_code=400, detail="Import preview expired or not found. Please re-upload the file.")

    created_markings = 0
    assigned = 0
    errors = []
    new_markings = staged["new_markings"]

    for name in new_markings:
        existing = (
            await db.execute(
                select(RetailerMarking).where(RetailerMarking.name == name)
            )
        ).scalar_one_or_none()
        if not existing:
            await _create_marking_for_import(db, name, current_user)
            created_markings += 1

    for row in staged["rows"]:
        if not row.valid or not row.retailer_id:
            continue
        retailer = await db.get(Retailer, row.retailer_id)
        if not retailer:
            errors.append(f"Line {row.line}: retailer missing")
            continue
        if not _house_in_list(retailer.house_id, house_context, current_user):
            errors.append(f"Line {row.line}: retailer outside accessible house scope")
            continue
        marking = (
            await db.execute(
                select(RetailerMarking).where(RetailerMarking.name == row.marking_name)
            )
        ).scalar_one_or_none()
        if not marking or marking.status != "active":
            errors.append(f"Line {row.line}: marking not active")
            continue
        existing_active = (
            await db.execute(
                select(RetailerMarkingAssignment).where(
                    RetailerMarkingAssignment.retailer_id == retailer.id,
                    RetailerMarkingAssignment.marking_id == marking.id,
                    RetailerMarkingAssignment.status == "active",
                )
            )
        ).scalar_one_or_none()
        if existing_active:
            continue
        now = now_naive()
        db.add(
            RetailerMarkingAssignment(
                retailer_id=retailer.id,
                marking_id=marking.id,
                status="active",
                effective_from=now,
                assigned_by=current_user.id,
                assigned_at=now,
                remarks=data.remarks or f"Imported (line {row.line})",
            )
        )
        assigned += 1
    await db.commit()

    await log_activity(
        db, current_user.id, current_user.name, MODULE, "import",
        record_identifier=f"batch {data.batch_reference[:8]}",
        new_values={"assigned": assigned, "created_markings": created_markings, "errors": errors[:20]},
        request=None, status_code=200,
    )
    return {
        "assigned": assigned,
        "created_markings": created_markings,
        "skipped": sum(1 for r in staged["rows"] if not r.valid),
        "errors": errors,
    }


@router.get("/export")
async def export_assignments(
    marking_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None, pattern="^(active|inactive)$"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission(f"{MODULE}.export")),
    house_context: Optional[int] = Depends(get_house_context),
):
    is_admin = is_admin_user(current_user)

    def house_ids() -> list[int]:
        if house_context:
            return [house_context]
        if is_admin:
            return []
        return [h.id for h in current_user.houses] or [-1]

    hids = house_ids()
    query = (
        select(RetailerMarkingAssignment)
        .join(Retailer, Retailer.id == RetailerMarkingAssignment.retailer_id)
        .join(RetailerMarking, RetailerMarking.id == RetailerMarkingAssignment.marking_id)
        .options(joinedload(RetailerMarkingAssignment.retailer), joinedload(RetailerMarkingAssignment.marking))
    )
    if hids:
        query = query.where(Retailer.house_id.in_(hids))
    if marking_id:
        query = query.where(RetailerMarkingAssignment.marking_id == marking_id)
    if status:
        query = query.where(RetailerMarkingAssignment.status == status)

    rows = (
        await db.execute(query.order_by(RetailerMarkingAssignment.assigned_at.desc()))
    ).scalars().unique().all()

    data = []
    for a in rows:
        data.append(
            {
                "Retailer Code": a.retailer.retailer_code if a.retailer else "",
                "Retailer Name": a.retailer.name if a.retailer else "",
                "Marking": a.marking.name if a.marking else "",
                "Status": a.status,
                "Effective From": a.effective_from.isoformat() if a.effective_from else "",
                "Effective To": a.effective_to.isoformat() if a.effective_to else "",
                "Assigned At": a.assigned_at.isoformat() if a.assigned_at else "",
                "Removed At": a.removed_at.isoformat() if a.removed_at else "",
                "Remarks": a.remarks or "",
            }
        )

    buffer = io.BytesIO()
    pd.DataFrame(data).to_excel(buffer, index=False)
    buffer.seek(0)

    await log_activity(
        db, current_user.id, current_user.name, MODULE, "export",
        record_identifier="assignments",
        new_values={"count": len(data)},
        request=None, status_code=200,
    )
    return Response(
        content=buffer.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=retailer_marking_assignments.xlsx"},
    )