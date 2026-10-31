"""P1 inventory foundation: serial integrity, ledger and tenant isolation."""

from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.dialects import postgresql

from app.models.employee import Employee
from app.models.house import House
from app.models.product import Product
from app.models.stock import (
    InventoryLedger,
    SerialUnit,
    StockDocument,
    StockLocation,
    StockSerialLine,
)
from app.schemas.stock import (
    IssueCreate,
    ReceiptCreate,
    ReturnCreate,
    ReturnDecision,
)
from app.services import inventory_service as svc
from app.utils.timezone import now_naive


def test_serial_unit_locks_exclude_joined_product_from_postgresql_lock():
    statement = svc.lock_serial_units(select(SerialUnit))
    sql = str(statement.compile(dialect=postgresql.dialect()))

    assert "LEFT OUTER JOIN products" in sql
    assert "FOR UPDATE OF serial_units" in sql


@pytest.fixture
async def setup(db):
    house = House(code="INV-H1", name="Inventory House", email="inv1@example.com")
    other_house = House(code="INV-H2", name="Other House", email="inv2@example.com")
    db.add_all([house, other_house])
    await db.flush()

    sim = Product(
        product_code="SIM-INV-1",
        category="SIM",
        product_name="Starter SIM",
        status="Active",
    )
    card = Product(
        product_code="SC-INV-1",
        category="Scratch Card",
        product_name="Scratch Card 50",
        status="Active",
    )
    device = Product(
        product_code="DEV-INV-1",
        category="Device",
        product_name="Router",
        status="Active",
    )
    db.add_all([sim, card, device])
    await db.flush()

    rso = Employee(
        house_id=house.id,
        dms_code="RSO-INV-1",
        employee_name="Inventory RSO",
        employee_type="rso",
        status="Active",
        employee_id="RSO-INV-1",
    )
    foreign_rso = Employee(
        house_id=other_house.id,
        dms_code="RSO-INV-2",
        employee_name="Other House RSO",
        employee_type="rso",
        status="Active",
        employee_id="RSO-INV-2",
    )
    db.add_all([rso, foreign_rso])
    await db.commit()

    return {
        "house": house,
        "other_house": other_house,
        "sim": sim,
        "card": card,
        "device": device,
        "rso": rso,
        "foreign_rso": foreign_rso,
    }


def _receipt(setup, serials, **overrides):
    payload = dict(
        product_id=setup["sim"].id,
        supplier="Banglalink",
        purchase_reference="PO-1",
        invoice_number="INV-1",
        business_date=date(2026, 10, 29),
        unit_cost=Decimal("10"),
        face_value=Decimal("50"),
        serials=serials,
    )
    payload.update(overrides)
    return ReceiptCreate(**payload)


async def _receive_and_post(db, setup, serials):
    doc = await svc.create_receipt(
        db, house_id=setup["house"].id, user_id=1, data=_receipt(setup, serials)
    )
    await db.commit()
    posted = await svc.post_receipt(
        db, house_id=setup["house"].id, doc_id=doc.id, user_id=1
    )
    await db.commit()
    return posted


async def _statuses(db, house_id):
    rows = await db.execute(
        select(SerialUnit.status, func.count(SerialUnit.id))
        .where(SerialUnit.house_id == house_id)
        .group_by(SerialUnit.status)
    )
    return {status: count for status, count in rows.all()}


async def test_receipt_draft_then_post_moves_serials_to_available(db, setup):
    doc = await svc.create_receipt(
        db,
        house_id=setup["house"].id,
        user_id=1,
        data=_receipt(setup, ["sim001", "SIM002"], expected_quantity=3),
    )
    await db.commit()

    assert doc.status == "draft"
    assert doc.document_no and doc.document_no.startswith("GRN-")
    assert doc.total_quantity == 2
    assert doc.discrepancy == 1  # expected 3, accepted 2 — never silently padded
    assert (await _statuses(db, setup["house"].id)) == {"received": 2}
    assert (
        await db.execute(select(func.count(InventoryLedger.id)))
    ).scalar() == 0

    posted = await svc.post_receipt(
        db, house_id=setup["house"].id, doc_id=doc.id, user_id=1
    )
    await db.commit()

    assert posted.status == "posted"
    assert (await _statuses(db, setup["house"].id)) == {"available": 2}
    ledger = (
        await db.execute(
            select(InventoryLedger).where(InventoryLedger.document_id == doc.id)
        )
    ).scalars().all()
    assert len(ledger) == 2
    assert all(entry.movement_type == "receipt" for entry in ledger)
    assert all(entry.quantity == 1 for entry in ledger)


async def test_duplicate_serials_are_rejected(db, setup):
    with pytest.raises(HTTPException) as exc:
        await svc.create_receipt(
            db,
            house_id=setup["house"].id,
            user_id=1,
            data=_receipt(setup, ["SIM100", "sim100"]),
        )
    assert exc.value.status_code == 400
    assert "Duplicate" in exc.value.detail["fields"]["serials"]

    await _receive_and_post(db, setup, ["SIM101"])
    with pytest.raises(HTTPException) as exc:
        await svc.create_receipt(
            db,
            house_id=setup["house"].id,
            user_id=1,
            data=_receipt(setup, ["SIM101"]),
        )
    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "DUPLICATE_SERIAL"


async def test_quantity_tracked_product_cannot_be_received(db, setup):
    with pytest.raises(HTTPException) as exc:
        await svc.create_receipt(
            db,
            house_id=setup["house"].id,
            user_id=1,
            data=_receipt(setup, ["SIMX-1"], product_id=setup["device"].id),
        )
    assert exc.value.detail["code"] == "PRODUCT_NOT_SERIAL_TRACKED"


async def test_issue_requires_available_serial_and_moves_both_ledgers(db, setup):
    doc = await svc.create_receipt(
        db, house_id=setup["house"].id, user_id=1, data=_receipt(setup, ["SIM201", "SIM202"])
    )
    await db.commit()

    # Draft serials are still `received`: never issuable.
    with pytest.raises(HTTPException) as exc:
        await svc.issue_stock(
            db,
            house_id=setup["house"].id,
            user_id=1,
            data=IssueCreate(
                employee_id=setup["rso"].id,
                product_id=setup["sim"].id,
                serials=["SIM201"],
            ),
        )
    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "SERIAL_NOT_AVAILABLE"

    await svc.post_receipt(db, house_id=setup["house"].id, doc_id=doc.id, user_id=1)
    await db.commit()

    issue = await svc.issue_stock(
        db,
        house_id=setup["house"].id,
        user_id=1,
        data=IssueCreate(
            employee_id=setup["rso"].id,
            product_id=setup["sim"].id,
            serials=["SIM201", "SIM202"],
        ),
    )
    await db.commit()

    assert issue.status == "posted"
    assert issue.document_no.startswith("ISS-")
    assert len(issue.serial_lines) == 2
    unit = (
        await db.execute(select(SerialUnit).where(SerialUnit.serial_number == "SIM201"))
    ).scalar_one()
    assert unit.status == "assigned"
    assert unit.current_employee_id == setup["rso"].id

    ledger = (
        await db.execute(
            select(InventoryLedger).where(InventoryLedger.document_id == issue.id)
        )
    ).scalars().all()
    assert sorted(entry.movement_type for entry in ledger) == [
        "issue_in", "issue_in", "issue_out", "issue_out",
    ]
    assert (await _statuses(db, setup["house"].id)) == {"assigned": 2}

    # The same serial cannot be issued twice.
    with pytest.raises(HTTPException) as exc:
        await svc.issue_stock(
            db,
            house_id=setup["house"].id,
            user_id=1,
            data=IssueCreate(
                employee_id=setup["rso"].id,
                product_id=setup["sim"].id,
                serials=["SIM201"],
            ),
        )
    assert exc.value.detail["code"] == "SERIAL_NOT_AVAILABLE"


async def test_issue_rejects_employee_from_another_house(db, setup):
    await _receive_and_post(db, setup, ["SIM301"])
    with pytest.raises(HTTPException) as exc:
        await svc.issue_stock(
            db,
            house_id=setup["house"].id,
            user_id=1,
            data=IssueCreate(
                employee_id=setup["foreign_rso"].id,
                product_id=setup["sim"].id,
                serials=["SIM301"],
            ),
        )
    assert exc.value.status_code == 404


async def test_return_does_not_restore_house_stock_until_verified(db, setup):
    await _receive_and_post(db, setup, ["SIM401", "SIM402", "SIM403"])
    issue = await svc.issue_stock(
        db,
        house_id=setup["house"].id,
        user_id=1,
        data=IssueCreate(
            employee_id=setup["rso"].id,
            product_id=setup["sim"].id,
            serials=["SIM401", "SIM402", "SIM403"],
        ),
    )
    await db.commit()

    ret = await svc.create_return(
        db,
        house_id=setup["house"].id,
        user_id=1,
        data=ReturnCreate(
            employee_id=setup["rso"].id,
            product_id=setup["sim"].id,
            serials=["SIM401", "SIM402"],
            reason="Unsold stock",
        ),
    )
    await db.commit()

    assert ret.status == "submitted"
    assert ret.document_no.startswith("RET-")
    # Pending return: no sellable house stock yet.
    assert (await _statuses(db, setup["house"].id)) == {
        "assigned": 1,
        "returned": 2,
    }

    verified = await svc.verify_return(
        db,
        house_id=setup["house"].id,
        doc_id=ret.id,
        user_id=2,
        decisions=[
            ReturnDecision(serial_number="SIM401", decision="accept"),
            ReturnDecision(serial_number="SIM402", decision="damaged", note="Scratched"),
        ],
    )
    await db.commit()

    assert verified.status == "verified"
    assert (await _statuses(db, setup["house"].id)) == {
        "available": 1,
        "damaged": 1,
        "assigned": 1,
    }
    accepted = (
        await db.execute(select(SerialUnit).where(SerialUnit.serial_number == "SIM401"))
    ).scalar_one()
    assert accepted.current_employee_id is None
    damaged = (
        await db.execute(select(SerialUnit).where(SerialUnit.serial_number == "SIM402"))
    ).scalar_one()
    quarantine = await db.get(StockLocation, damaged.current_location_id)
    assert quarantine.location_type == "quarantine"

    movements = sorted(
        entry.movement_type
        for entry in (
            await db.execute(
                select(InventoryLedger).where(InventoryLedger.document_id == ret.id)
            )
        ).scalars().all()
    )
    assert movements == ["return_accept", "return_damaged", "return_request", "return_request"]

    reissue = await svc.issue_stock(
        db,
        house_id=setup["house"].id,
        user_id=1,
        data=IssueCreate(
            employee_id=setup["rso"].id,
            product_id=setup["sim"].id,
            serials=["SIM401"],
        ),
    )
    await db.commit()
    assert reissue.status == "posted"
    assert issue.id != reissue.id


async def test_rejected_return_goes_back_to_the_employee(db, setup):
    await _receive_and_post(db, setup, ["SIM501"])
    await svc.issue_stock(
        db,
        house_id=setup["house"].id,
        user_id=1,
        data=IssueCreate(
            employee_id=setup["rso"].id,
            product_id=setup["sim"].id,
            serials=["SIM501"],
        ),
    )
    ret = await svc.create_return(
        db,
        house_id=setup["house"].id,
        user_id=1,
        data=ReturnCreate(
            employee_id=setup["rso"].id,
            product_id=setup["sim"].id,
            serials=["SIM501"],
        ),
    )
    await db.commit()

    verified = await svc.verify_return(
        db,
        house_id=setup["house"].id,
        doc_id=ret.id,
        user_id=2,
        decisions=[ReturnDecision(serial_number="SIM501", decision="reject")],
    )
    await db.commit()

    assert verified.status == "verified"
    unit = (
        await db.execute(select(SerialUnit).where(SerialUnit.serial_number == "SIM501"))
    ).scalar_one()
    assert unit.status == "assigned"
    assert unit.current_employee_id == setup["rso"].id
    assert (await _statuses(db, setup["house"].id)) == {"assigned": 1}


async def test_sold_serial_cannot_be_returned(db, setup):
    await _receive_and_post(db, setup, ["SIM601"])
    await svc.issue_stock(
        db,
        house_id=setup["house"].id,
        user_id=1,
        data=IssueCreate(
            employee_id=setup["rso"].id,
            product_id=setup["sim"].id,
            serials=["SIM601"],
        ),
    )
    unit = (
        await db.execute(select(SerialUnit).where(SerialUnit.serial_number == "SIM601"))
    ).scalar_one()
    unit.status = "sold"
    await db.commit()

    with pytest.raises(HTTPException) as exc:
        await svc.create_return(
            db,
            house_id=setup["house"].id,
            user_id=1,
            data=ReturnCreate(
                employee_id=setup["rso"].id,
                product_id=setup["sim"].id,
                serials=["SIM601"],
            ),
        )
    assert exc.value.detail["code"] == "SERIAL_NOT_AVAILABLE"


async def test_idempotency_key_returns_the_same_document(db, setup):
    payload = _receipt(setup, ["SIM701"], idempotency_key="req-abc")
    first = await svc.create_receipt(
        db, house_id=setup["house"].id, user_id=1, data=payload
    )
    await db.commit()
    second = await svc.create_receipt(
        db, house_id=setup["house"].id, user_id=1, data=payload
    )
    await db.commit()

    assert first.id == second.id
    assert (
        await db.execute(select(func.count(StockDocument.id)))
    ).scalar() == 1


async def test_serial_history_contains_every_movement(db, setup):
    await _receive_and_post(db, setup, ["SIM801"])
    await svc.issue_stock(
        db,
        house_id=setup["house"].id,
        user_id=1,
        data=IssueCreate(
            employee_id=setup["rso"].id,
            product_id=setup["sim"].id,
            serials=["SIM801"],
        ),
    )
    await db.commit()

    unit = (
        await db.execute(select(SerialUnit).where(SerialUnit.serial_number == "SIM801"))
    ).scalar_one()
    history = await svc.serial_history(db, house_id=setup["house"].id, serial_id=unit.id)

    assert [line.action for line in history["movements"]] == ["receive", "issue"]
    assert len(history["ledger"]) == 3  # receipt + issue_out + issue_in
    assert history["serial"].current_employee_id == setup["rso"].id


async def test_other_house_serial_is_not_visible(db, setup):
    await _receive_and_post(db, setup, ["SIM901"])
    unit = (
        await db.execute(select(SerialUnit).where(SerialUnit.serial_number == "SIM901"))
    ).scalar_one()

    with pytest.raises(HTTPException) as exc:
        await svc.serial_history(
            db, house_id=setup["other_house"].id, serial_id=unit.id
        )
    assert exc.value.status_code == 404

    rows, total = await svc.list_serial_units(
        db, house_id=setup["other_house"].id, page=1, per_page=20
    )
    assert rows == [] and total == 0


async def test_future_business_date_is_rejected(db, setup):
    with pytest.raises(HTTPException) as exc:
        await svc.create_receipt(
            db,
            house_id=setup["house"].id,
            user_id=1,
            data=_receipt(
                setup, ["SIM1001"], business_date=now_naive().date().replace(year=2099)
            ),
        )
    assert exc.value.detail["fields"]["business_date"]
