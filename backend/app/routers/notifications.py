"""In-app notifications for the signed-in user.

Every row belongs to one recipient, so these endpoints are inherently scoped:
a user can only list and acknowledge their own notifications. Super admins
receive a row when a house submits a payment request awaiting approval
(created in ``app/services/payment_requests.py``).
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification
from app.models.user import User
from app.routers.deps import get_current_user, get_db
from app.services import notifications as notifications_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/notifications", tags=["Notifications"])


def _serialize(row: Notification) -> dict:
    return {
        "id": row.id,
        "type": row.type,
        "title": row.title,
        "message": row.message,
        "link": row.link,
        "house_id": row.house_id,
        "record_id": row.record_id,
        "payload": row.payload or {},
        "is_read": bool(row.is_read),
        "read_at": row.read_at.isoformat() if row.read_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@router.get("")
async def list_notifications(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    unread_only: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows, total = await notifications_service.list_notifications(
        db, current_user.id, page=page, per_page=per_page, unread_only=unread_only
    )
    unread = await notifications_service.unread_count(db, current_user.id)
    total_pages = (total + per_page - 1) // per_page if total else 0
    return {
        "success": True,
        "data": [_serialize(row) for row in rows],
        "unread_count": unread,
        "pagination": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "total_pages": total_pages,
            "has_next": page < total_pages,
            "has_prev": page > 1,
        },
    }


@router.get("/unread-count")
async def get_unread_count(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return {
        "success": True,
        "data": {"count": await notifications_service.unread_count(db, current_user.id)},
    }


@router.post("/{notification_id}/read")
async def mark_notification_read(
    notification_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ok = await notifications_service.mark_read(db, current_user.id, notification_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"success": True, "data": {"id": notification_id, "is_read": True}}


@router.post("/read-all")
async def mark_all_read(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    updated = await notifications_service.mark_all_read(db, current_user.id)
    return {"success": True, "data": {"updated": updated}}
