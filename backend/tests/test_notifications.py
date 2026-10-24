"""In-app notifications for payment requests.

A house submitting a payment request must reach the platform owner (super
admins) in the header bell, and every user may only read their own feed.
"""

from sqlalchemy import select

from app.models.notification import Notification
from app.models.role import Role
from app.models.user import User
from app.services import notifications as notification_service
from app.services import payment_requests
from app.utils.timezone import now_naive


async def _user(db, name, role_name=None) -> User:
    user = User(name=name, email=f"{name.lower().replace(' ', '.')}@example.com")
    if role_name:
        role = (
            await db.execute(select(Role).where(Role.name == role_name))
        ).scalar_one_or_none()
        if role is None:
            role = Role(name=role_name)
            db.add(role)
        user.roles = [role]
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _super_admin(db, name="Root Admin") -> User:
    return await _user(db, name, "Super Admin")


async def _all_rows(db) -> list[Notification]:
    return list((await db.execute(select(Notification))).scalars().all())


async def test_payment_request_notifies_every_super_admin(db, house, invoice):
    admin = await _super_admin(db)
    second_admin = await _super_admin(db, "Second Admin")
    await _user(db, "Distributor User", "Distributor")

    payment = await payment_requests.submit_request(
        db, invoice, house_id=house.id, method="cash", note="cash at office",
        payment_date=now_naive().date(),
    )

    rows = await _all_rows(db)
    assert len(rows) == 2  # one row per super admin, never for the tenant
    assert {row.user_id for row in rows} == {admin.id, second_admin.id}

    row = rows[0]
    assert row.type == notification_service.TYPE_PAYMENT_REQUEST
    assert row.is_read is False
    assert row.link == notification_service.LINK_PAYMENT_REVIEW
    assert row.house_id == house.id
    assert row.record_id == payment.id
    assert row.payload["invoice_no"] == invoice.invoice_no
    assert row.payload["house_name"] == house.name
    assert row.payload["amount"] == str(invoice.total)
    assert row.payload["method"] == "cash"


async def test_feed_is_scoped_to_the_recipient(db):
    admin = await _super_admin(db)
    other = await _user(db, "Other User", "Distributor")

    await notification_service.notify_super_admins(
        db, type="payment_request", title="Payment request awaiting approval"
    )

    assert await notification_service.unread_count(db, admin.id) == 1
    assert await notification_service.unread_count(db, other.id) == 0

    rows, total = await notification_service.list_notifications(db, other.id)
    assert rows == [] and total == 0

    rows, total = await notification_service.list_notifications(db, admin.id)
    assert total == 1 and rows[0].title == "Payment request awaiting approval"


async def test_mark_read_and_mark_all_read(db):
    admin = await _super_admin(db)
    await _super_admin(db, "Second Admin")

    await notification_service.notify_super_admins(db, type="payment_request", title="First")
    await notification_service.notify_super_admins(db, type="payment_request", title="Second")

    mine, _ = await notification_service.list_notifications(db, admin.id)
    first_id = mine[0].id
    assert await notification_service.unread_count(db, admin.id) == 2

    assert await notification_service.mark_read(db, admin.id, first_id) is True
    assert await notification_service.unread_count(db, admin.id) == 1

    # Another user's row can never be acknowledged.
    other = await _user(db, "Someone Else", "Manager")
    assert await notification_service.mark_read(db, other.id, first_id) is False

    assert await notification_service.mark_all_read(db, admin.id) == 1
    assert await notification_service.unread_count(db, admin.id) == 0


async def test_no_super_admin_does_not_break_submission(db, house, invoice):
    await _user(db, "Distributor Only", "Distributor")

    created = await notification_service.notify_super_admins(
        db, type="payment_request", title="No recipient"
    )
    assert created == 0

    payment = await payment_requests.submit_request(
        db, invoice, house_id=house.id, method="cash",
        payment_date=now_naive().date(),
    )
    assert payment.id is not None
    assert await _all_rows(db) == []
