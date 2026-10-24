"""In-app notifications (header bell + sidebar badges).

Notifications are stored per recipient user, so a user only ever sees their own
rows. Super admins receive a row whenever a house submits a payment request that
is waiting for approval.

Delivery is best-effort: a notification failure must never roll back the
business action that produced it (e.g. a submitted payment request).
"""

import logging
from typing import Optional

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification
from app.models.role import Role
from app.models.user import User, user_roles
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

SUPER_ADMIN_ROLE_NAMES = ("super admin", "super_admin", "superadmin")

TYPE_PAYMENT_REQUEST = "payment_request"

# Where the UI should send the recipient when the notification is clicked.
LINK_PAYMENT_REVIEW = "/admin/payments"


async def _super_admin_user_ids(db: AsyncSession) -> list[int]:
    rows = await db.execute(
        select(User.id)
        .join(user_roles, user_roles.c.user_id == User.id)
        .join(Role, Role.id == user_roles.c.role_id)
        .where(func.lower(Role.name).in_(SUPER_ADMIN_ROLE_NAMES))
    )
    return sorted({row[0] for row in rows.all()})


async def notify_super_admins(
    db: AsyncSession,
    *,
    type: str,
    title: str,
    message: Optional[str] = None,
    link: Optional[str] = None,
    house_id: Optional[int] = None,
    record_id: Optional[int] = None,
    payload: Optional[dict] = None,
    commit: bool = True,
) -> int:
    """Create one notification row per super admin. Returns rows created.

    Never raises: the caller's transaction is not affected by a failure here.
    """
    try:
        user_ids = await _super_admin_user_ids(db)
        if not user_ids:
            logger.warning("notification '%s' skipped: no super admin user found", type)
            return 0
        for user_id in user_ids:
            db.add(
                Notification(
                    user_id=user_id,
                    type=type,
                    title=title,
                    message=message,
                    link=link,
                    house_id=house_id,
                    record_id=record_id,
                    payload=payload,
                    is_read=False,
                )
            )
        if commit:
            await db.commit()
        else:
            await db.flush()
        logger.info("notification '%s' created for %s super admin(s)", type, len(user_ids))
        return len(user_ids)
    except Exception as exc:  # noqa: BLE001 - best effort, must not break the caller
        logger.warning("notification '%s' failed: %s", type, exc)
        try:
            await db.rollback()
        except Exception:  # noqa: BLE001
            pass
        return 0


async def unread_count(db: AsyncSession, user_id: int) -> int:
    return (
        await db.execute(
            select(func.count(Notification.id)).where(
                Notification.user_id == user_id,
                Notification.is_read.is_(False),
            )
        )
    ).scalar_one()


async def list_notifications(
    db: AsyncSession,
    user_id: int,
    *,
    page: int = 1,
    per_page: int = 20,
    unread_only: bool = False,
) -> tuple[list[Notification], int]:
    """Returns (rows, total) for the user's own feed, newest first."""
    page = max(page, 1)
    per_page = min(max(per_page, 1), 100)
    conditions = [Notification.user_id == user_id]
    if unread_only:
        conditions.append(Notification.is_read.is_(False))

    total = (
        await db.execute(select(func.count(Notification.id)).where(*conditions))
    ).scalar_one()
    rows = (
        await db.execute(
            select(Notification)
            .where(*conditions)
            .order_by(Notification.created_at.desc(), Notification.id.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
        )
    ).scalars().all()
    return list(rows), total


async def mark_read(db: AsyncSession, user_id: int, notification_id: int) -> bool:
    """Marks one of the caller's notifications read. False when not found."""
    row = (
        await db.execute(
            select(Notification).where(
                Notification.id == notification_id,
                Notification.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return False
    if not row.is_read:
        row.is_read = True
        row.read_at = now_naive()
        await db.commit()
    return True


async def mark_all_read(db: AsyncSession, user_id: int) -> int:
    result = await db.execute(
        update(Notification)
        .where(Notification.user_id == user_id, Notification.is_read.is_(False))
        .values(is_read=True, read_at=now_naive())
    )
    await db.commit()
    return result.rowcount or 0
