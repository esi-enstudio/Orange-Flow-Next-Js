"""Auto-managed retailer markings (BP / RSO assisted codes).

The auto sync rebuilds a marking from `employees.assisted_retailer_code`:
only Active owners keep a marking, a resignation drops it and a type change
moves it to the marking of the other type.
"""

import pytest
from sqlalchemy import select

from app.models.employee import Employee
from app.models.retailer import Retailer
from app.models.retailer_marking import RetailerMarking, RetailerMarkingAssignment
from app.services.retailer_marking_auto_service import (
    auto_source_employee_type,
    is_auto_managed,
    sync_auto_markings,
)

from conftest import make_house


async def make_marking(db, name, code, auto_source=None) -> RetailerMarking:
    marking = RetailerMarking(name=name, code=code, status="active", auto_source=auto_source)
    db.add(marking)
    await db.commit()
    await db.refresh(marking)
    return marking


async def make_retailer(db, house_id, code, name=None) -> Retailer:
    retailer = Retailer(house_id=house_id, retailer_code=code, name=name or f"Shop {code}")
    db.add(retailer)
    await db.commit()
    await db.refresh(retailer)
    return retailer


async def make_employee(db, house_id, dms_code, employee_type, assisted_code, status="Active") -> Employee:
    employee = Employee(
        house_id=house_id,
        dms_code=dms_code,
        employee_id=f"EMP-{dms_code}",
        employee_name=f"Employee {dms_code}",
        employee_type=employee_type,
        assisted_retailer_code=assisted_code,
        status=status,
    )
    db.add(employee)
    await db.commit()
    await db.refresh(employee)
    return employee


async def active_pairs(db) -> set[tuple[int, int]]:
    rows = (
        await db.execute(
            select(RetailerMarkingAssignment.retailer_id, RetailerMarkingAssignment.marking_id).where(
                RetailerMarkingAssignment.status == "active"
            )
        )
    ).all()
    return {(r[0], r[1]) for r in rows}


async def test_sync_marks_active_assisted_codes(db):
    house = await make_house(db)
    bp_marking = await make_marking(db, "BP", "BP", "bp_assisted")
    rso_marking = await make_marking(db, "RSO", "RSO", "rso_assisted")

    bp_retailer = await make_retailer(db, house.id, "R100001")
    rso_retailer = await make_retailer(db, house.id, "R100002")
    plain_retailer = await make_retailer(db, house.id, "R100003")

    await make_employee(db, house.id, "BP1", "bp", "R100001")
    await make_employee(db, house.id, "RSO1", "rso", "R100002")
    # Same retailer code but owned by an employee type without an auto marking.
    await make_employee(db, house.id, "CC1", "cc", "R100003")

    summary = await sync_auto_markings(db)

    assert summary["added"] == 2
    assert summary["removed"] == 0
    assert await active_pairs(db) == {
        (bp_retailer.id, bp_marking.id),
        (rso_retailer.id, rso_marking.id),
    }
    assert plain_retailer.id not in {p[0] for p in await active_pairs(db)}

    # Running again is a no-op (idempotent).
    second = await sync_auto_markings(db)
    assert (second["added"], second["removed"]) == (0, 0)


async def test_resigned_employee_loses_marking(db):
    house = await make_house(db)
    rso_marking = await make_marking(db, "RSO", "RSO", "rso_assisted")
    retailer = await make_retailer(db, house.id, "R200001")
    employee = await make_employee(db, house.id, "RSO2", "rso", "R200001")
    await sync_auto_markings(db)
    assert (retailer.id, rso_marking.id) in await active_pairs(db)

    employee.status = "Resigned"
    await db.commit()

    summary = await sync_auto_markings(db)
    assert summary["removed"] == 1
    assert await active_pairs(db) == set()

    removed = (
        await db.execute(
            select(RetailerMarkingAssignment).where(
                RetailerMarkingAssignment.retailer_id == retailer.id,
                RetailerMarkingAssignment.marking_id == rso_marking.id,
            )
        )
    ).scalars().all()
    assert len(removed) == 1
    assert removed[0].status == "inactive"
    assert removed[0].removed_at is not None
    assert removed[0].removed_by is None  # system, not a user
    assert removed[0].effective_to is not None


async def test_type_change_moves_marking(db):
    house = await make_house(db)
    bp_marking = await make_marking(db, "BP", "BP", "bp_assisted")
    rso_marking = await make_marking(db, "RSO", "RSO", "rso_assisted")
    retailer = await make_retailer(db, house.id, "R300001")
    employee = await make_employee(db, house.id, "SW1", "bp", "R300001")
    await sync_auto_markings(db)
    assert await active_pairs(db) == {(retailer.id, bp_marking.id)}

    employee.employee_type = "rso"
    await db.commit()

    summary = await sync_auto_markings(db)
    assert (summary["added"], summary["removed"]) == (1, 1)
    assert await active_pairs(db) == {(retailer.id, rso_marking.id)}

    # Repeated assign/remove keeps a full audit trail (partial unique index on
    # the active row only) — the old (retailer, marking, status) constraint would
    # have blocked the second tombstone row.
    employee.status = "Inactive"
    await db.commit()
    await sync_auto_markings(db)
    employee.status = "Active"
    await db.commit()
    await sync_auto_markings(db)
    employee.status = "Inactive"
    await db.commit()
    await sync_auto_markings(db)
    employee.status = "Active"
    await db.commit()
    await sync_auto_markings(db)

    history = (
        await db.execute(
            select(RetailerMarkingAssignment).where(
                RetailerMarkingAssignment.retailer_id == retailer.id,
                RetailerMarkingAssignment.marking_id == rso_marking.id,
            )
        )
    ).scalars().all()
    assert len(history) == 3
    # Two tombstones co-exist for the same (retailer, marking) pair, which only the
    # partial unique index allows.
    assert sorted(row.status for row in history) == ["active", "inactive", "inactive"]
    assert await active_pairs(db) == {(retailer.id, rso_marking.id)}


async def test_manual_marking_is_untouched(db):
    house = await make_house(db)
    await make_marking(db, "BP", "BP", "bp_assisted")
    manual = await make_marking(db, "DRC", "DRC")
    retailer = await make_retailer(db, house.id, "R400001")
    await make_employee(db, house.id, "RSO3", "rso", "R400001")
    db.add(
        RetailerMarkingAssignment(
            retailer_id=retailer.id,
            marking_id=manual.id,
            status="active",
        )
    )
    await db.commit()

    await sync_auto_markings(db)

    assert await active_pairs(db) == {(retailer.id, manual.id)}
    assert is_auto_managed(manual) is False
    assert auto_source_employee_type("bp_assisted") == "bp"
    assert auto_source_employee_type("rso_assisted") == "rso"
    assert auto_source_employee_type(None) is None
    assert auto_source_employee_type("something_else") is None


async def test_sync_can_be_scoped_to_one_house(db):
    house_one = await make_house(db, code="H001", name="House One")
    house_two = await make_house(db, code="H002", name="House Two")
    rso_marking = await make_marking(db, "RSO", "RSO", "rso_assisted")
    first = await make_retailer(db, house_one.id, "R500001")
    second = await make_retailer(db, house_two.id, "R500002")
    await make_employee(db, house_one.id, "RSO4", "rso", "R500001")
    await make_employee(db, house_two.id, "RSO5", "rso", "R500002")

    await sync_auto_markings(db, house_ids=[house_one.id])

    assert await active_pairs(db) == {(first.id, rso_marking.id)}
    assert (second.id, rso_marking.id) not in await active_pairs(db)

    await sync_auto_markings(db, house_ids=[house_two.id])
    assert await active_pairs(db) == {
        (first.id, rso_marking.id),
        (second.id, rso_marking.id),
    }


async def test_inactive_owner_does_not_hold_the_marking(db):
    """A non-active owner never wins: the assisted code only marks while Active."""
    house = await make_house(db)
    bp_marking = await make_marking(db, "BP", "BP", "bp_assisted")
    retailer = await make_retailer(db, house.id, "R600001")
    await make_employee(db, house.id, "BP2", "bp", "R600001", status="Resigned")

    summary = await sync_auto_markings(db)

    assert summary["added"] == 0
    assert (retailer.id, bp_marking.id) not in await active_pairs(db)


@pytest.mark.parametrize("source", ["bp_assisted", "rso_assisted"])
async def test_marking_with_unknown_source_is_skipped(db, source):
    house = await make_house(db)
    marking = await make_marking(db, "Ghost", "GHOST", "unknown_source")
    await make_retailer(db, house.id, "R700001")
    await make_employee(db, house.id, "X1", source.split("_")[0], "R700001")

    summary = await sync_auto_markings(db)

    assert summary["markings"] == []
    assert (await db.execute(select(RetailerMarkingAssignment))).scalars().all() == []
    assert marking.auto_source == "unknown_source"
