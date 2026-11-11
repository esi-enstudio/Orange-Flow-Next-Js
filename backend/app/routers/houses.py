import logging
from typing import Optional

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select, or_, and_, func as sa_func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.deps import get_db, has_permission, has_any_permission, get_current_user
from app.schemas.house import HouseSchema, HouseCreate
from app.schemas.pagination import PaginationParams, PaginatedResponse, PaginationMeta
from app.models.house import House
from app.models.user import User
from app.services import entitlement, house_letterhead
from app.services.house_purge import HousePurgeError, purge_house
from app.services.resignation_pdf import build_preview_html, render_pdf
from app.utils.access_control import is_admin_user, is_super_admin_user
from app.utils.activity_logger import log_activity
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/houses", tags=["houses"])


@router.get("/accessible")
async def get_accessible_houses(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    is_admin = is_admin_user(current_user)
    if is_admin:
        result = await db.execute(select(House).order_by(House.name))
        houses = result.scalars().all()
    else:
        houses = current_user.houses
    return [
        {
            "id": h.id,
            "name": h.name,
            "code": h.code,
            "display_name": f"{h.name} ({h.code})",
            "show_pull_button": bool(h.show_pull_button),
        }
        for h in houses
    ]

@router.get("/filter-options")
async def get_house_filter_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    is_admin = is_admin_user(current_user)
    base = select(House)
    if not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            base = base.where(House.id.in_(user_house_ids))
        else:
            base = base.where(House.id == -1)

    async def distinct_values(column):
        q = select(column).distinct().where(column != None).where(column != "").order_by(column)
        if base.whereclause is not None:
            q = q.where(base.whereclause)
        r = await db.execute(q)
        return [row[0] for row in r.all()]

    return {
        "clusters": await distinct_values(House.cluster),
        "regions": await distinct_values(House.region),
        "wh_regions": await distinct_values(House.wh_region),
        "districts": await distinct_values(House.district),
    }

@router.get("", response_model=PaginatedResponse)
async def list_houses(
    pagination: PaginationParams = Depends(),
    search: Optional[str] = Query(None, description="Search by name or code"),
    cluster: Optional[str] = Query(None, description="Filter by cluster"),
    region: Optional[str] = Query(None, description="Filter by region"),
    wh_region: Optional[str] = Query(None, description="Filter by WH region"),
    district: Optional[str] = Query(None, description="Filter by district"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_any_permission(["houses.view", "users.view", "users.edit"]))
):
    base_query = select(House).order_by(House.name)

    is_admin = is_admin_user(current_user)
    if not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            base_query = base_query.where(House.id.in_(user_house_ids))
        else:
            base_query = base_query.where(House.id == -1)

    conditions = []

    if search:
        p = f"%{search}%"
        conditions.append(or_(House.name.ilike(p), House.code.ilike(p)))
    if cluster:
        conditions.append(House.cluster == cluster)
    if region:
        conditions.append(House.region == region)
    if wh_region:
        conditions.append(House.wh_region == wh_region)
    if district:
        conditions.append(House.district == district)
    if is_active is not None:
        conditions.append(House.is_active == is_active)

    if conditions:
        base_query = base_query.where(and_(*conditions))

    sort_map = {
        "name": House.name, "code": House.code,
        "cluster": House.cluster, "region": House.region,
        "district": House.district, "id": House.id,
    }
    sort_col = sort_map.get(pagination.sort_by, House.id)
    order = sort_col.desc() if pagination.sort_order == "desc" else sort_col.asc()

    count_query = select(sa_func.count(House.id))
    if base_query.whereclause is not None:
        count_query = count_query.where(base_query.whereclause)
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    offset = (pagination.page - 1) * pagination.per_page
    query = base_query.order_by(order).offset(offset).limit(pagination.per_page)
    result = await db.execute(query)
    items = result.scalars().all()
    # Attach the latest plan + days-remaining for every house in one query.
    latest_subs = await entitlement.get_latest_subscriptions_for_houses(
        db, [h.id for h in items]
    )
    data = []
    for h in items:
        row = HouseSchema.model_validate(h).model_dump()
        row.update(entitlement.subscription_summary(latest_subs.get(h.id)))
        data.append(row)

    total_pages = max(1, (total + pagination.per_page - 1) // pagination.per_page)

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
        )
    )

@router.post("", response_model=HouseSchema)
async def create_house(house_data: HouseCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("houses.create"))):
    existing = (await db.execute(select(House).where(House.code == house_data.code))).scalar_one_or_none()
    if existing: raise HTTPException(status_code=400, detail="House with this code already exists")
    new_house = House(**house_data.model_dump())
    db.add(new_house)
    await db.commit()
    await db.refresh(new_house)

    # Deny-by-default access policy: a brand-new house must not sit in the
    # "no plan assigned" state where every employee is locked out on day one.
    from app.services.subscription_service import provision_house_default_plan

    await provision_house_default_plan(db, new_house.id, changed_by=current_user.id)
    return new_house

@router.put("/{house_id}", response_model=HouseSchema)
async def update_house(house_id: int, house_data: HouseCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("houses.edit"))):
    result = await db.execute(select(House).where(House.id == house_id))
    house = result.scalar_one_or_none()
    if not house: raise HTTPException(status_code=404, detail="House not found")
    is_admin = is_admin_user(current_user)
    user_house_ids = [h.id for h in current_user.houses]
    if not is_admin and house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="You do not have access to edit this house")
    for key, value in house_data.model_dump().items():
        setattr(house, key, value)
    await db.commit()
    await db.refresh(house)
    return house

@router.delete("/{house_id}")
async def delete_house(
    house_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("houses.delete")),
):
    result = await db.execute(select(House).where(House.id == house_id))
    house = result.scalar_one_or_none()
    if not house:
        raise HTTPException(status_code=404, detail="House not found")

    # Only the platform super admin may delete a house they do not belong to.
    # A tenant admin/manager is still scoped to their own houses.
    user_house_ids = [h.id for h in current_user.houses]
    if not is_super_admin_user(current_user) and house_id not in user_house_ids:
        raise HTTPException(
            status_code=403,
            detail="You do not have access to delete this house",
        )

    # Snapshot only non-sensitive identity fields for the audit trail.
    old_values = {
        "id": house.id,
        "name": house.name,
        "code": house.code,
        "cluster": house.cluster,
        "region": house.region,
        "district": house.district,
    }

    try:
        # Hard purge: the house and every tenant-scoped row (employees,
        # retailers, targets, reports, billing, schedules, ...) is
        # deleted in one transaction. See app/services/house_purge.py.
        deleted = await purge_house(
            db, house_id=house_id, current_user_id=current_user.id
        )
        await db.commit()
    except HousePurgeError as exc:
        await db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except IntegrityError as exc:
        await db.rollback()
        logger.exception("House %s purge failed on a foreign-key constraint", house_id)
        raise HTTPException(
            status_code=409,
            detail={
                "code": "HOUSE_DELETE_CONFLICT",
                "message": (
                    "House could not be deleted because related records are "
                    "still referenced. No data was changed."
                ),
                "fields": {},
            },
        ) from exc
    except Exception as exc:
        await db.rollback()
        logger.exception("House %s purge failed", house_id)
        raise HTTPException(
            status_code=500,
            detail={
                "code": "HOUSE_DELETE_FAILED",
                "message": "House could not be deleted. No data was changed.",
                "fields": {},
            },
        ) from exc

    try:
        await log_activity(
            db=db,
            user_id=current_user.id,
            user_name=current_user.name or current_user.username,
            module="house",
            action="delete",
            record_id=house_id,
            record_identifier=old_values.get("code") or old_values.get("name"),
            old_values=old_values,
            new_values={"deleted_rows": deleted},
            request=request,
            status_code=200,
        )
    except Exception:
        logger.warning(
            "Activity log failed for house delete (%s)", house_id, exc_info=True
        )

    return {"message": "House deleted successfully", "deleted": deleted}


# --------------------------------------------------------------------------- #
# Letterhead (resignation application page)
#
# Each house uploads one full-page letterhead image and edits the application
# text printed on it. The layout is stored as percentages on `houses` so the
# renderer is independent of the image resolution.
# --------------------------------------------------------------------------- #

class LetterheadLayoutIn(BaseModel):
    layout: dict


class LetterheadPreviewIn(BaseModel):
    layout: Optional[dict] = None


async def _load_letterhead_house(db: AsyncSession, house_id: int, current_user: User) -> House:
    house = await db.get(House, house_id)
    if not house:
        raise HTTPException(status_code=404, detail="House not found")
    if not is_admin_user(current_user):
        own_ids = [h.id for h in current_user.houses]
        if house_id not in own_ids:
            raise HTTPException(status_code=403, detail="You do not have access to this house")
    return house


def _touch_letterhead(house: House, current_user: User) -> None:
    house.letterhead_updated_by = current_user.id
    house.letterhead_updated_at = now_naive()


async def _log_letterhead(db, house, request, current_user, action, old_values=None, new_values=None):
    await log_activity(
        db, current_user.id, current_user.name, "houses", action,
        record_id=house.id,
        record_identifier=house.code or house.name,
        old_values=old_values,
        new_values=new_values,
        request=request,
        status_code=200,
    )


@router.get("/{house_id}/letterhead")
async def get_house_letterhead(
    house_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("houses.letterhead_view")),
):
    house = await _load_letterhead_house(db, house_id, current_user)
    return house_letterhead.serialize(house)


@router.get("/{house_id}/letterhead/image")
async def stream_house_letterhead_image(
    house_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("houses.letterhead_view")),
):
    house = await _load_letterhead_house(db, house_id, current_user)
    path = house_letterhead.image_fs_path(house)
    if not path:
        raise HTTPException(status_code=404, detail="This house has no letterhead image")
    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, no-store"},
    )


@router.post("/{house_id}/letterhead/image")
async def upload_house_letterhead_image(
    house_id: int,
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("houses.letterhead_edit")),
):
    house = await _load_letterhead_house(db, house_id, current_user)
    previous = house.letterhead_image_path
    try:
        await house_letterhead.store_image(house, file)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    _touch_letterhead(house, current_user)
    await db.commit()
    await db.refresh(house)
    await _log_letterhead(
        db, house, request, current_user, "edit",
        old_values={"letterhead_image": previous},
        new_values={"letterhead_image": house.letterhead_image_path},
    )
    return house_letterhead.serialize(house)


@router.delete("/{house_id}/letterhead/image")
async def delete_house_letterhead_image(
    house_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("houses.letterhead_edit")),
):
    house = await _load_letterhead_house(db, house_id, current_user)
    previous = house.letterhead_image_path
    if not previous:
        raise HTTPException(status_code=404, detail="This house has no letterhead image")
    house_letterhead.delete_image(house)
    _touch_letterhead(house, current_user)
    await db.commit()
    await db.refresh(house)
    await _log_letterhead(
        db, house, request, current_user, "delete",
        old_values={"letterhead_image": previous},
    )
    return house_letterhead.serialize(house)


@router.put("/{house_id}/letterhead")
async def update_house_letterhead(
    house_id: int,
    payload: LetterheadLayoutIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("houses.letterhead_edit")),
):
    house = await _load_letterhead_house(db, house_id, current_user)
    try:
        layout = house_letterhead.validate_layout(payload.layout)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    previous = house.letterhead_layout
    house.letterhead_layout = layout
    _touch_letterhead(house, current_user)
    await db.commit()
    await db.refresh(house)
    await _log_letterhead(
        db, house, request, current_user, "edit",
        old_values={"letterhead_layout": previous},
        new_values={"letterhead_layout": layout},
    )
    return house_letterhead.serialize(house)


@router.post("/{house_id}/letterhead/preview")
async def preview_house_letterhead(
    house_id: int,
    request: Request,
    payload: Optional[LetterheadPreviewIn] = Body(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("houses.letterhead_view")),
):
    house = await _load_letterhead_house(db, house_id, current_user)
    if not house_letterhead.image_fs_path(house):
        raise HTTPException(
            status_code=422,
            detail={"code": "LETTERHEAD_IMAGE_MISSING", "message": "Upload the letterhead image first"},
        )
    layout = None
    if payload and payload.layout:
        try:
            layout = house_letterhead.validate_layout(payload.layout)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    else:
        layout = house.letterhead_layout or house_letterhead.default_layout()

    try:
        pdf = await render_pdf(build_preview_html(house, layout))
    except Exception as exc:  # noqa: BLE001 - operator gets a clear message
        logger.exception("Letterhead preview failed for house %s", house.id)
        raise HTTPException(
            status_code=500,
            detail={"code": "PDF_GENERATION_FAILED", "message": "The preview could not be generated"},
        ) from exc
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'inline; filename="letterhead-preview.pdf"',
            "Cache-Control": "private, no-store",
        },
    )
