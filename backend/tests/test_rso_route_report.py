"""Route-wise RSO attribution.

Two properties matter to the business:

1. ``primary`` mode reconciles with the house total (one row per activation),
   while ``all`` mode credits every route a multi-route retailer sits on.
2. Ownership is effective-dated: an activation is credited to the RSO who owned
   the route **on that day**, so a mid-month handover splits correctly and a
   resigned RSO keeps their earned numbers.
"""
from datetime import date, datetime

from sqlalchemy import select

from app.models.activation import Activation
from app.models.employee import Employee
from app.models.retailer import Retailer
from app.models.route import EmployeeRoute, RetailerRoute, Route
from app.services import db_service
from app.services.rso_route_report_service import build_rso_route_report
from conftest import test_engine

START = date(2026, 10, 1)
END = date(2026, 10, 31)


def _employee(house_id, name, **overrides):
    values = {
        "house_id": house_id,
        "employee_name": name,
        "employee_id": name.replace(" ", ""),
        "employee_type": "rso",
        "status": "Active",
    }
    values.update(overrides)
    return Employee(**values)


async def _route(db, house_id, code):
    route = Route(house_id=house_id, code=code)
    db.add(route)
    await db.flush()
    return route


async def _retailer(db, house_id, code, route_ids, primary_index=0):
    retailer = Retailer(house_id=house_id, retailer_code=code, name=f"Retailer {code}")
    db.add(retailer)
    await db.flush()
    for index, route_id in enumerate(route_ids):
        db.add(
            RetailerRoute(
                retailer_id=retailer.id,
                route_id=route_id,
                is_primary=index == primary_index,
                status="active",
                effective_from=datetime(2026, 9, 1),
            )
        )
    await db.flush()
    return retailer


async def _activation(db, house_id, retailer, sim_no, day, route_code, price="100"):
    db.add(
        Activation(
            house_id=house_id,
            retailer_id=retailer.id,
            retailer_code=retailer.retailer_code,
            retailer_name=retailer.name,
            sim_no=sim_no,
            activation_date=day,
            route_code=route_code,
            selling_price=price,
            product_code="P1",
        )
    )


async def _own(db, house_id, route_id, employee_id, start: date, end=None):
    db.add(
        EmployeeRoute(
            house_id=house_id,
            employee_id=employee_id,
            route_id=route_id,
            status="active" if end is None else "inactive",
            effective_from=datetime.combine(start, datetime.min.time()),
            effective_to=datetime.combine(end, datetime.min.time()) if end else None,
            assigned_at=datetime.combine(start, datetime.min.time()),
        )
    )


async def test_primary_mode_reconciles_with_house_total(db, house):
    code = f"{house.code}_ROUTE0001"
    route = await _route(db, house.id, code)
    rso = _employee(house.id, "Rso One")
    db.add(rso)
    await db.flush()
    await _own(db, house.id, route.id, rso.id, START)

    single = await _retailer(db, house.id, "R1", [route.id])
    both = await _retailer(db, house.id, "R2", [route.id])
    await _activation(db, house.id, single, "SIM1", date(2026, 10, 5), code)
    await _activation(db, house.id, both, "SIM2", date(2026, 10, 6), code)
    await db.commit()

    report = await build_rso_route_report(
        db, [house.id], START, END, mode="primary"
    )
    assert report["summary"]["activations"] == 2
    assert report["summary"]["amount"] == 200.0
    assert report["data"][0]["rso_name"] == "Rso One"
    assert report["data"][0]["route_code"] == code


async def test_all_mode_credits_every_route_of_a_multi_route_retailer(db, house):
    a = await _route(db, house.id, f"{house.code}_ROUTE0001")
    b = await _route(db, house.id, f"{house.code}_ROUTE0002")
    rso = _employee(house.id, "Rso One")
    db.add(rso)
    await db.flush()
    await _own(db, house.id, a.id, rso.id, START)
    await _own(db, house.id, b.id, rso.id, START)

    retailer = await _retailer(db, house.id, "R1", [a.id, b.id])
    await _activation(db, house.id, retailer, "SIM1", date(2026, 10, 5), a.code)
    await db.commit()

    primary = await build_rso_route_report(db, [house.id], START, END, mode="primary")
    every = await build_rso_route_report(db, [house.id], START, END, mode="all")

    assert primary["summary"]["activations"] == 1
    assert every["summary"]["activations"] == 2  # one per route, by design
    assert {row["route_code"] for row in every["data"]} == {a.code, b.code}


async def test_ownership_is_effective_dated_across_a_handover(db, house):
    code = f"{house.code}_ROUTE0001"
    route = await _route(db, house.id, code)
    outgoing = _employee(house.id, "Rso Out")
    incoming = _employee(house.id, "Rso In")
    db.add_all([outgoing, incoming])
    await db.flush()
    await _own(db, house.id, route.id, outgoing.id, START, end=date(2026, 10, 15))
    await _own(db, house.id, route.id, incoming.id, date(2026, 10, 15))

    retailer = await _retailer(db, house.id, "R1", [route.id])
    await _activation(db, house.id, retailer, "SIM1", date(2026, 10, 10), code)
    await _activation(db, house.id, retailer, "SIM2", date(2026, 10, 20), code)
    await db.commit()

    report = await build_rso_route_report(db, [house.id], START, END, mode="primary")
    by_rso = {row["rso_name"]: row["activations"] for row in report["data"]}
    assert by_rso == {"Rso Out": 1, "Rso In": 1}


async def test_activations_without_a_route_are_reported_separately(db, house):
    retailer = await _retailer(db, house.id, "R1", [])
    await _activation(db, house.id, retailer, "SIM1", date(2026, 10, 10), None)
    await db.commit()

    report = await build_rso_route_report(db, [house.id], START, END, mode="primary")
    assert report["data"] == []
    assert report["summary"]["no_route_activations"] == 1


async def test_route_owner_self_heal_hands_over_and_reports_unassigned(db, house):
    code_a = f"{house.code}_ROUTE0001"
    code_b = f"{house.code}_ROUTE0002"
    route_a = await _route(db, house.id, code_a)
    route_b = await _route(db, house.id, code_b)
    outgoing = _employee(house.id, "Rso Out", status="Resigned", itop_number="1915270101")
    successor = _employee(house.id, "Rso New", itop_number="1915270101")
    orphan = _employee(house.id, "Rso Gone", status="Resigned", itop_number="1999")
    db.add_all([outgoing, successor, orphan])
    await db.flush()
    await _own(db, house.id, route_a.id, outgoing.id, START)
    await _own(db, house.id, route_b.id, orphan.id, START)
    await db.commit()

    report = await db_service._migrate_route_owner_link(db_engine=test_engine)
    assert report == {"reassigned": 1, "unassigned": 1}

    owners = {
        link.route_id: link.employee_id
        for link in (
            await db.execute(
                select(EmployeeRoute).where(EmployeeRoute.status == "active")
            )
        ).scalars()
    }
    assert owners == {route_a.id: successor.id}

    # Idempotent on the next boot.
    assert await db_service._migrate_route_owner_link(db_engine=test_engine) == {
        "reassigned": 0,
        "unassigned": 0,
    }
