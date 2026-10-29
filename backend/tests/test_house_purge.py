"""House deletion must purge every tenant-scoped row, not just the houses row."""

from datetime import timedelta

import pytest
from sqlalchemy import func, select

# Register the full model set so the SQLite schema contains every table the
# purge planner can encounter in production.
import app.models  # noqa: F401
from app.models.activity_log import ActivityLog
from app.models.employee import Employee
from app.models.house import House
from app.models.invoice import Invoice
from app.models.notification import Notification
from app.models.payment import Payment
from app.models.retailer import Retailer
from app.models.retailer_marking import RetailerMarking, RetailerMarkingAssignment
from app.models.role import Role
from app.models.subscription import HouseSubscription, SubscriptionRenewal
from app.models.user import User, user_houses, user_roles
from app.models.whatsapp_schedule import WhatsAppSchedule
from app.services.house_purge import HousePurgeError, purge_house
from app.utils.timezone import now_naive

from conftest import make_house, make_invoice, make_plan, make_sub


async def _count(db, model, *conditions) -> int:
    query = select(func.count()).select_from(model)
    for condition in conditions:
        query = query.where(condition)
    return (await db.execute(query)).scalar_one()


async def _make_user(
    db, username: str, house_ids=(), role_ids=()
) -> User:
    user = User(username=username, email=f"{username}@example.com", name=username)
    db.add(user)
    await db.flush()
    for house_id in house_ids:
        await db.execute(
            user_houses.insert().values(user_id=user.id, house_id=house_id)
        )
    for role_id in role_ids:
        await db.execute(
            user_roles.insert().values(user_id=user.id, role_id=role_id)
        )
    await db.commit()
    await db.refresh(user)
    return user


async def _make_employee(db, house_id: int, code: str) -> Employee:
    employee = Employee(
        house_id=house_id,
        dms_code=code,
        employee_id=code,
        employee_name=f"Employee {code}",
        employee_type="rso",
    )
    db.add(employee)
    await db.commit()
    await db.refresh(employee)
    return employee


async def _make_schedule(db, house_id: int, label: str) -> WhatsAppSchedule:
    schedule = WhatsAppSchedule(
        house_id=house_id,
        schedule_type="daily",
        schedule_time="09:00",
        whatsapp_chat_id=f"chat-{label}",
        whatsapp_chat_name=f"Chat {label}",
    )
    db.add(schedule)
    await db.commit()
    await db.refresh(schedule)
    return schedule


async def test_purge_house_removes_all_tenant_data(db):
    house_a = await make_house(db, code="HOUSE-A", name="House A")
    house_b = await make_house(db, code="HOUSE-B", name="House B")
    plan = await make_plan(db)
    sub_a = await make_sub(db, house_a.id, plan)
    sub_b = await make_sub(db, house_b.id, plan)
    invoice_a = await make_invoice(db, sub_a, plan)
    invoice_b = await make_invoice(db, sub_b, plan)

    payment_a = Payment(
        house_id=house_a.id,
        invoice_id=invoice_a.id,
        subscription_id=sub_a.id,
        amount=100,
        currency="BDT",
        gateway="cash",
        gateway_tran_id="TX-A",
    )
    renewal_a = SubscriptionRenewal(
        subscription_id=sub_a.id,
        new_start_date=now_naive(),
        new_end_date=now_naive() + timedelta(days=30),
        days_added=30,
        renewed_by=1,
    )
    db.add_all([payment_a, renewal_a])

    employee_a = await _make_employee(db, house_a.id, "RSO-A")
    employee_b = await _make_employee(db, house_b.id, "RSO-B")

    retailer_a = Retailer(
        house_id=house_a.id, employee_id=employee_a.id, retailer_code="R-A", name="Retailer A"
    )
    retailer_b = Retailer(
        house_id=house_b.id, employee_id=employee_b.id, retailer_code="R-B", name="Retailer B"
    )
    # Global marking shared by every house; only the assignment is tenant data.
    marking = RetailerMarking(name="BL Retailer", code="BLR")
    db.add_all([retailer_a, retailer_b, marking])
    await db.flush()
    assignment_a = RetailerMarkingAssignment(
        retailer_id=retailer_a.id, marking_id=marking.id
    )
    assignment_b = RetailerMarkingAssignment(
        retailer_id=retailer_b.id, marking_id=marking.id
    )
    db.add_all([assignment_a, assignment_b])

    super_role = Role(name="super admin")
    db.add(super_role)
    await db.flush()

    user_a = await _make_user(db, "house-a-user", house_ids=[house_a.id])
    user_b = await _make_user(db, "house-b-user", house_ids=[house_b.id])
    shared = await _make_user(
        db, "shared-user", house_ids=[house_a.id, house_b.id]
    )
    super_admin = await _make_user(
        db, "platform-owner", house_ids=[house_a.id], role_ids=[super_role.id]
    )

    notification_a = Notification(
        user_id=user_a.id, type="test", title="A", house_id=house_a.id
    )
    notification_b = Notification(
        user_id=user_b.id, type="test", title="B", house_id=house_b.id
    )
    schedule_a = await _make_schedule(db, house_a.id, "A")
    schedule_b = await _make_schedule(db, house_b.id, "B")
    audit = ActivityLog(
        user_id=99, user_name="auditor", module="house", action="delete"
    )
    db.add_all([notification_a, notification_b, schedule_a, schedule_b, audit])
    await db.commit()

    deleted = await purge_house(db, house_a.id, current_user_id=9999)
    await db.commit()

    # House A and every row that belonged to it are gone.
    assert deleted["houses"] == 1
    assert await _count(db, House, House.id == house_a.id) == 0
    assert await _count(db, Employee, Employee.house_id == house_a.id) == 0
    assert await _count(db, Retailer, Retailer.house_id == house_a.id) == 0
    assert await _count(db, HouseSubscription, HouseSubscription.house_id == house_a.id) == 0
    assert await _count(db, Invoice, Invoice.house_id == house_a.id) == 0
    assert await _count(db, Payment, Payment.house_id == house_a.id) == 0
    assert await _count(db, WhatsAppSchedule, WhatsAppSchedule.house_id == house_a.id) == 0
    assert await _count(db, Notification, Notification.house_id == house_a.id) == 0
    assert await _count(
        db, RetailerMarkingAssignment, RetailerMarkingAssignment.retailer_id == retailer_a.id
    ) == 0
    assert await _count(db, SubscriptionRenewal, SubscriptionRenewal.id == renewal_a.id) == 0

    # House B is untouched, including its dependent rows.
    assert await _count(db, House, House.id == house_b.id) == 1
    assert await _count(db, Employee, Employee.house_id == house_b.id) == 1
    assert await _count(db, Retailer, Retailer.house_id == house_b.id) == 1
    assert await _count(db, HouseSubscription, HouseSubscription.house_id == house_b.id) == 1
    assert await _count(db, Invoice, Invoice.house_id == house_b.id) == 1
    assert await _count(db, WhatsAppSchedule, WhatsAppSchedule.house_id == house_b.id) == 1
    assert await _count(
        db, RetailerMarkingAssignment, RetailerMarkingAssignment.retailer_id == retailer_b.id
    ) == 1
    assert await _count(db, RetailerMarking, RetailerMarking.id == marking.id) == 1

    # Accounts that existed only for house A are removed; shared accounts and
    # super admins stay. The append-only audit row is never purged.
    assert await _count(db, User, User.id == user_a.id) == 0
    assert await _count(db, User, User.id == user_b.id) == 1
    assert await _count(db, User, User.id == shared.id) == 1
    assert await _count(db, User, User.id == super_admin.id) == 1
    assert await _count(db, ActivityLog, ActivityLog.id == audit.id) == 1


async def test_purge_house_rejects_missing_house(db):
    with pytest.raises(HousePurgeError):
        await purge_house(db, 999_999)
