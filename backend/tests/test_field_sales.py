"""P2 field sales: serial reservation, approval-only stock impact, scoping."""

from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.models.employee import Employee
from app.models.field_sales import Sale
from app.models.house import House
from app.models.product import Product
from app.models.retailer import Retailer
from app.models.stock import InventoryLedger, SerialUnit
from app.schemas.field_sales import SaleCreate, SaleItem, SaleReject, SaleUpdate
from app.schemas.stock import IssueCreate, ReceiptCreate
from app.services import field_sales_service as fs
from app.services import inventory_service as inv


@pytest.fixture
async def setup(db):
    house = House(code="SALE-H1", name="Sales House", email="sale1@example.com")
    other_house = House(code="SALE-H2", name="Other Sales House", email="sale2@example.com")
    db.add_all([house, other_house])
    await db.flush()

    sim = Product(
        product_code="SIM-SALE-1",
        category="SIM",
        product_name="Sales SIM",
        status="Active",
    )
    db.add(sim)
    await db.flush()

    rso = Employee(
        house_id=house.id,
        dms_code="SALE-RSO-1",
        employee_name="Sales RSO",
        employee_type="rso",
        status="Active",
        employee_id="SALE-RSO-1",
    )
    colleague = Employee(
        house_id=house.id,
        dms_code="SALE-RSO-2",
        employee_name="Colleague RSO",
        employee_type="rso",
        status="Active",
        employee_id="SALE-RSO-2",
    )
    db.add_all([rso, colleague])
    await db.flush()

    retailer = Retailer(
        house_id=house.id,
        retailer_code="R-SALE-1",
        name="Sales Retailer",
        route="Route A",
    )
    db.add(retailer)
    await db.commit()

    return {
        "house": house,
        "other": other_house,
        "sim": sim,
        "rso": rso,
        "colleague": colleague,
        "retailer": retailer,
    }


async def _assign_serials(db, setup, serials, employee=None):
    employee = employee or setup["rso"]
    receipt = await inv.create_receipt(
        db,
        house_id=setup["house"].id,
        user_id=1,
        data=ReceiptCreate(
            product_id=setup["sim"].id,
            supplier="Banglalink",
            serials=serials,
        ),
    )
    await db.commit()
    await inv.post_receipt(
        db, house_id=setup["house"].id, doc_id=receipt.id, user_id=1
    )
    await db.commit()
    await inv.issue_stock(
        db,
        house_id=setup["house"].id,
        user_id=1,
        data=IssueCreate(
            employee_id=employee.id,
            product_id=setup["sim"].id,
            serials=serials,
        ),
    )
    await db.commit()


def _sale(setup, serials, **overrides):
    payload = dict(
        employee_id=setup["rso"].id,
        retailer_id=setup["retailer"].id,
        business_date=date(2026, 10, 29),
        payment_status="cash",
        items=[SaleItem(product_id=setup["sim"].id, serials=serials, unit_price=Decimal("50"))],
    )
    payload.update(overrides)
    return SaleCreate(**payload)


async def test_sale_draft_and_submit_do_not_change_stock(db, setup):
    await _assign_serials(db, setup, ["SALE001", "SALE002"])

    sale = await fs.create_sale(
        db, house_id=setup["house"].id, user_id=1, data=_sale(setup, ["SALE001"])
    )
    await db.commit()

    assert sale.status == "draft"
    assert sale.sale_no.startswith("SAL-")
    assert sale.total_quantity == 1
    assert sale.total_amount == Decimal("50.00")
    assert sale.route == "Route A"

    unit = (
        await db.execute(select(SerialUnit).where(SerialUnit.serial_number == "SALE001"))
    ).scalar_one()
    assert unit.status == "assigned"
    sale_ledger = (
        await db.execute(
            select(func.count(InventoryLedger.id)).where(
                InventoryLedger.movement_type == "sale"
            )
        )
    ).scalar()
    assert sale_ledger == 0

    submitted = await fs.submit_sale(
        db, house_id=setup["house"].id, sale_id=sale.id, scope_employee_id=None
    )
    await db.commit()
    assert submitted.status == "submitted"
    assert unit.status == "assigned"


async def test_approval_marks_serials_sold_and_writes_ledger(db, setup):
    await _assign_serials(db, setup, ["SALE101", "SALE102"])
    sale = await fs.create_sale(
        db,
        house_id=setup["house"].id,
        user_id=1,
        data=_sale(setup, ["SALE101", "SALE102"], submit=True),
    )
    await db.commit()

    approved = await fs.approve_sale(
        db, house_id=setup["house"].id, sale_id=sale.id, user_id=2
    )
    await db.commit()

    assert approved.status == "approved"
    units = (
        await db.execute(
            select(SerialUnit).where(
                SerialUnit.serial_number.in_(["SALE101", "SALE102"])
            )
        )
    ).scalars().all()
    assert all(unit.status == "sold" for unit in units)
    assert all(unit.current_employee_id is None for unit in units)

    ledger = (
        await db.execute(
            select(InventoryLedger).where(InventoryLedger.movement_type == "sale")
        )
    ).scalars().all()
    assert len(ledger) == 2
    assert all(entry.quantity == -1 for entry in ledger)
    assert all(entry.status_after == "sold" for entry in ledger)

    summary = await inv.stock_summary(db, house_id=setup["house"].id)
    assert summary["house"]["assigned"] == 0
    assert summary["house"]["sold"] == 2

    # Approving twice is refused.
    with pytest.raises(HTTPException) as exc:
        await fs.approve_sale(db, house_id=setup["house"].id, sale_id=sale.id, user_id=2)
    assert exc.value.detail["code"] == "INVALID_STATUS"


async def test_same_serial_cannot_be_in_two_pending_sales(db, setup):
    await _assign_serials(db, setup, ["SALE201"])
    first = await fs.create_sale(
        db,
        house_id=setup["house"].id,
        user_id=1,
        data=_sale(setup, ["SALE201"], submit=True),
    )
    await db.commit()

    # A serial pending in another submission is refused at entry, not at approval.
    with pytest.raises(HTTPException) as exc:
        await fs.create_sale(
            db, house_id=setup["house"].id, user_id=1, data=_sale(setup, ["SALE201"])
        )
    assert exc.value.detail["code"] == "SERIAL_IN_PENDING_SALE"
    assert (await db.execute(select(func.count(Sale.id)))).scalar() == 1
    assert first.status == "submitted"


async def test_serial_of_another_employee_is_rejected(db, setup):
    await _assign_serials(db, setup, ["SALE301"], employee=setup["colleague"])
    with pytest.raises(HTTPException) as exc:
        await fs.create_sale(
            db, house_id=setup["house"].id, user_id=1, data=_sale(setup, ["SALE301"])
        )
    assert exc.value.detail["code"] == "SERIAL_NOT_ASSIGNED_TO_EMPLOYEE"


async def test_rejected_sale_keeps_serials_with_employee_and_can_be_resubmitted(db, setup):
    await _assign_serials(db, setup, ["SALE401"])
    sale = await fs.create_sale(
        db,
        house_id=setup["house"].id,
        user_id=1,
        data=_sale(setup, ["SALE401"], submit=True),
    )
    await db.commit()

    rejected = await fs.reject_sale(
        db,
        house_id=setup["house"].id,
        sale_id=sale.id,
        user_id=2,
        reason="Wrong retailer",
    )
    await db.commit()
    assert rejected.status == "rejected"
    assert rejected.reject_reason == "Wrong retailer"

    unit = (
        await db.execute(select(SerialUnit).where(SerialUnit.serial_number == "SALE401"))
    ).scalar_one()
    assert unit.status == "assigned"

    resubmitted = await fs.submit_sale(
        db, house_id=setup["house"].id, sale_id=sale.id, scope_employee_id=None
    )
    await db.commit()
    assert resubmitted.status == "submitted"
    assert resubmitted.submitted_at is not None


async def test_rejected_sale_can_be_corrected_before_resubmission(db, setup):
    await _assign_serials(db, setup, ["SALE501", "SALE502"])
    sale = await fs.create_sale(
        db,
        house_id=setup["house"].id,
        user_id=1,
        data=_sale(setup, ["SALE501"], submit=True),
    )
    await db.commit()
    await fs.reject_sale(
        db, house_id=setup["house"].id, sale_id=sale.id, user_id=2, reason="Missing item"
    )
    await db.commit()

    updated = await fs.update_sale(
        db,
        house_id=setup["house"].id,
        sale_id=sale.id,
        data=SaleUpdate(
            items=[
                SaleItem(
                    product_id=setup["sim"].id,
                    serials=["SALE501", "SALE502"],
                    unit_price=Decimal("60"),
                )
            ],
            submit=True,
        ),
        scope_employee_id=None,
    )
    await db.commit()

    assert updated.status == "submitted"
    assert updated.total_quantity == 2
    assert updated.total_amount == Decimal("120.00")
    assert len(updated.serial_lines) == 2
    assert len(updated.lines) == 1


async def test_scope_blocks_creating_for_another_employee(db, setup):
    await _assign_serials(db, setup, ["SALE601"])
    with pytest.raises(HTTPException) as exc:
        await fs.create_sale(
            db,
            house_id=setup["house"].id,
            user_id=1,
            data=_sale(setup, ["SALE601"], employee_id=setup["colleague"].id),
            scope_employee_id=setup["rso"].id,
        )
    assert exc.value.status_code == 403


async def test_sale_is_house_scoped(db, setup):
    await _assign_serials(db, setup, ["SALE701"])
    sale = await fs.create_sale(
        db, house_id=setup["house"].id, user_id=1, data=_sale(setup, ["SALE701"])
    )
    await db.commit()

    with pytest.raises(HTTPException) as exc:
        await fs.get_sale(db, setup["other"].id, sale.id)
    assert exc.value.status_code == 404

    rows, total = await fs.list_sales(
        db, house_id=setup["other"].id, page=1, per_page=20
    )
    assert rows == [] and total == 0


async def test_idempotency_key_returns_same_sale(db, setup):
    await _assign_serials(db, setup, ["SALE801"])
    payload = _sale(setup, ["SALE801"], idempotency_key="sale-req-1")
    first = await fs.create_sale(
        db, house_id=setup["house"].id, user_id=1, data=payload
    )
    await db.commit()
    second = await fs.create_sale(
        db, house_id=setup["house"].id, user_id=1, data=payload
    )
    await db.commit()

    assert first.id == second.id
    assert (await db.execute(select(func.count(Sale.id)))).scalar() == 1


async def test_employee_dashboard_reports_own_stock_and_sales(db, setup):
    await _assign_serials(db, setup, ["SALE901", "SALE902"])
    sale = await fs.create_sale(
        db,
        house_id=setup["house"].id,
        user_id=1,
        data=SaleCreate(
            employee_id=setup["rso"].id,
            submit=True,
            items=[
                SaleItem(
                    product_id=setup["sim"].id,
                    serials=["SALE901"],
                    unit_price=Decimal("50"),
                )
            ],
        ),
    )
    await db.commit()
    await fs.approve_sale(db, house_id=setup["house"].id, sale_id=sale.id, user_id=2)
    await db.commit()

    dashboard = await fs.sales_dashboard(
        db, house_id=setup["house"].id, employee_id=setup["rso"].id
    )
    assert dashboard["scope"] == "employee"
    assert dashboard["employee"]["id"] == setup["rso"].id
    assert dashboard["stock"]["assigned"] == 1
    assert dashboard["stock"]["sold"] == 1
    assert dashboard["today"]["sold_units"] == 1
    assert dashboard["today"]["sales_amount"] == 50.0
    assert len(dashboard["recent_sales"]) == 1

    house_dashboard = await fs.sales_dashboard(
        db, house_id=setup["house"].id, employee_id=None
    )
    assert house_dashboard["scope"] == "house"
    assert house_dashboard["today"]["pending_submissions"] == 0
