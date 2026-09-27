import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.house import House
from app.models.user import User
from app.models.whatsapp_contact import WhatsAppContact
from app.routers.deps import get_db, get_house_context, has_any_permission, has_permission, require_house_context
from app.schemas.pagination import PaginatedResponse, PaginationMeta, PaginationParams
from app.schemas.whatsapp_contact import (
    WhatsAppContactCreate,
    WhatsAppContactSchema,
    WhatsAppContactUpdate,
    phone_to_jid,
)
from app.utils.access_control import is_admin_user
from app.utils.activity_logger import log_activity
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["WhatsApp Contacts"])

# Reading the list is allowed for anyone who may already open the report delivery
# modal, so an existing schedule user never sees an unexplained empty tab. The three
# write operations stay behind their own dedicated permissions.
VIEW_PERMISSIONS = [
    "whatsapp.contact.view",
    "live_activations.schedule",
    "reports.whatsapp_share",
]

SORTABLE_FIELDS = {
    "id": WhatsAppContact.id,
    "name": WhatsAppContact.name,
    "phone_number": WhatsAppContact.phone_number,
    "created_at": WhatsAppContact.created_at,
}


def _serialize(contact: WhatsAppContact) -> dict:
    return {
        "id": contact.id,
        "house_id": contact.house_id,
        "name": contact.name,
        "phone_number": contact.phone_number,
        "jid": contact.jid,
        "note": contact.note,
        "is_active": contact.is_active,
        "created_at": contact.created_at.isoformat() if contact.created_at else None,
        "updated_at": contact.updated_at.isoformat() if contact.updated_at else None,
    }


async def _get_owned_contact(
    db: AsyncSession,
    current_user: User,
    contact_id: int,
) -> WhatsAppContact:
    result = await db.execute(
        select(WhatsAppContact).where(
            WhatsAppContact.id == contact_id,
            WhatsAppContact.is_deleted == False,  # noqa: E712
        )
    )
    contact = result.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    if not is_admin_user(current_user):
        user_house_ids = [h.id for h in current_user.houses]
        if contact.house_id not in user_house_ids:
            raise HTTPException(status_code=403, detail="You do not have access to this contact")
    return contact


@router.get("/whatsapp/contacts")
async def list_whatsapp_contacts(
    pagination: PaginationParams = Depends(),
    include_inactive: bool = Query(False, description="Also return contacts marked inactive"),
    house_context: Optional[int] = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_any_permission(VIEW_PERMISSIONS)),
):
    query = select(WhatsAppContact).where(WhatsAppContact.is_deleted == False)  # noqa: E712

    user_house_ids = [h.id for h in current_user.houses]
    if house_context:
        if not is_admin_user(current_user) and house_context not in user_house_ids:
            raise HTTPException(status_code=403, detail="You do not have access to this house")
        query = query.where(WhatsAppContact.house_id == house_context)
    elif not is_admin_user(current_user):
        # No house selected: fall back to every house the user belongs to.
        query = query.where(WhatsAppContact.house_id.in_(user_house_ids))

    if not include_inactive:
        query = query.where(WhatsAppContact.is_active == True)  # noqa: E712

    if pagination.search:
        term = f"%{pagination.search.strip()}%"
        query = query.where(
            or_(
                WhatsAppContact.name.ilike(term),
                WhatsAppContact.phone_number.ilike(term),
                WhatsAppContact.note.ilike(term),
            )
        )

    sort_col = SORTABLE_FIELDS.get(pagination.sort_by or "", WhatsAppContact.id)
    query = query.order_by(
        sort_col.desc() if pagination.sort_order == "desc" else sort_col.asc(),
        WhatsAppContact.id.desc(),
    )

    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar() or 0

    offset = (pagination.page - 1) * pagination.per_page
    result = await db.execute(query.offset(offset).limit(pagination.per_page))
    contacts = result.scalars().all()

    total_pages = max(1, (total + pagination.per_page - 1) // pagination.per_page)
    return PaginatedResponse(
        data=[_serialize(c) for c in contacts],
        pagination=PaginationMeta(
            page=pagination.page,
            per_page=pagination.per_page,
            total=total,
            total_pages=total_pages,
            has_next=pagination.page < total_pages,
            has_prev=pagination.page > 1,
        ),
    )


@router.post("/whatsapp/contacts", status_code=status.HTTP_201_CREATED)
async def create_whatsapp_contact(
    payload: WhatsAppContactCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("whatsapp.contact.create")),
    house_context: int = Depends(require_house_context),
):
    # house_id always comes from the request context, never the payload.
    if not is_admin_user(current_user):
        user_house_ids = [h.id for h in current_user.houses]
        if house_context not in user_house_ids:
            raise HTTPException(status_code=403, detail="You do not have access to this house")
    # Admins may send any house id, so confirm it exists before hitting the FK.
    house_exists = await db.execute(select(House.id).where(House.id == house_context))
    if house_exists.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="House not found")

    duplicate = await db.execute(
        select(WhatsAppContact).where(
            WhatsAppContact.house_id == house_context,
            WhatsAppContact.phone_number == payload.phone_number,
            WhatsAppContact.is_deleted == False,  # noqa: E712
        )
    )
    if duplicate.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail=f"{payload.phone_number} is already saved for this house",
        )

    contact = WhatsAppContact(
        house_id=house_context,
        name=payload.name,
        phone_number=payload.phone_number,
        jid=phone_to_jid(payload.phone_number),
        note=payload.note,
        is_active=payload.is_active,
        created_by=current_user.id,
        updated_by=current_user.id,
    )
    db.add(contact)
    await db.commit()
    await db.refresh(contact)

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="whatsapp",
        action="create",
        record_id=contact.id,
        record_identifier=contact.phone_number,
        new_values=_serialize(contact),
        request=request,
        status_code=status.HTTP_201_CREATED,
    )
    await db.commit()

    return {"success": True, "data": _serialize(contact)}


@router.patch("/whatsapp/contacts/{contact_id}")
async def update_whatsapp_contact(
    contact_id: int,
    payload: WhatsAppContactUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("whatsapp.contact.edit")),
):
    contact = await _get_owned_contact(db, current_user, contact_id)
    old_values = _serialize(contact)

    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return {"success": True, "data": _serialize(contact)}

    if "phone_number" in changes and changes["phone_number"] != contact.phone_number:
        duplicate = await db.execute(
            select(WhatsAppContact).where(
                WhatsAppContact.house_id == contact.house_id,
                WhatsAppContact.phone_number == changes["phone_number"],
                WhatsAppContact.id != contact.id,
                WhatsAppContact.is_deleted == False,  # noqa: E712
            )
        )
        if duplicate.scalar_one_or_none():
            raise HTTPException(
                status_code=409,
                detail=f"{changes['phone_number']} is already saved for this house",
            )
        contact.phone_number = changes["phone_number"]
        contact.jid = phone_to_jid(contact.phone_number)

    for field in ("name", "note", "is_active"):
        if field in changes and changes[field] is not None:
            setattr(contact, field, changes[field])

    contact.updated_by = current_user.id
    contact.updated_at = now_naive()
    await db.commit()
    await db.refresh(contact)

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="whatsapp",
        action="edit",
        record_id=contact.id,
        record_identifier=contact.phone_number,
        old_values=old_values,
        new_values=_serialize(contact),
        request=request,
    )
    await db.commit()

    return {"success": True, "data": _serialize(contact)}


@router.delete("/whatsapp/contacts/{contact_id}")
async def delete_whatsapp_contact(
    contact_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("whatsapp.contact.delete")),
):
    contact = await _get_owned_contact(db, current_user, contact_id)
    old_values = _serialize(contact)

    contact.is_deleted = True
    contact.deleted_at = now_naive()
    contact.deleted_by = current_user.id
    contact.updated_by = current_user.id
    await db.commit()

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="whatsapp",
        action="delete",
        record_id=contact.id,
        record_identifier=contact.phone_number,
        old_values=old_values,
        request=request,
    )
    await db.commit()

    return {"success": True, "message": "Contact deleted"}


@router.post("/whatsapp/contacts/{contact_id}/restore")
async def restore_whatsapp_contact(
    contact_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("whatsapp.contact.edit")),
):
    result = await db.execute(select(WhatsAppContact).where(WhatsAppContact.id == contact_id))
    contact = result.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    if not is_admin_user(current_user):
        user_house_ids = [h.id for h in current_user.houses]
        if contact.house_id not in user_house_ids:
            raise HTTPException(status_code=403, detail="You do not have access to this contact")

    contact.is_deleted = False
    contact.deleted_at = None
    contact.deleted_by = None
    contact.updated_by = current_user.id
    contact.updated_at = now_naive()
    await db.commit()
    await db.refresh(contact)

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="whatsapp",
        action="restore",
        record_id=contact.id,
        record_identifier=contact.phone_number,
        new_values=_serialize(contact),
        request=request,
    )
    await db.commit()

    return {"success": True, "data": _serialize(contact)}
