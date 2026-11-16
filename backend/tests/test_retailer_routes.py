"""Route parsing, retailer route links and the one-off route master backfill.

Retailers used to keep their routes only as a raw Excel string. These tests pin
the three behaviours the normalized tables rely on:

1. Parsing tolerates every Excel cell shape while keeping zero padding intact
   (ROUTE11 and ROUTE0011 are different routes) and rejecting other houses'
   prefixes.
2. Imports attach only **registered** routes — an unknown code is rejected, not
   silently invented, so a typo stays visible.
3. The startup backfill seeds the master from existing snapshots, is idempotent,
   and never reverts links that were curated afterwards.
"""
from datetime import datetime

import pytest
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.employee import Employee
from app.models.retailer import Retailer
from app.models.route import EmployeeRoute, Route, RetailerRoute
from app.services import db_service
from app.services.route_service import (
    parse_route_codes,
    register_routes,
    route_ids_for_codes,
    sync_retailer_routes,
)
from conftest import test_engine

HOUSE_CODE = "MYMVAI01"
A = f"{HOUSE_CODE}_ROUTE0066"
B = f"{HOUSE_CODE}_ROUTE0075"


def test_parse_handles_every_excel_shape():
    assert parse_route_codes(f"({A})", HOUSE_CODE) == [A]
    assert parse_route_codes(f"({A},{B})", HOUSE_CODE) == [A, B]
    assert parse_route_codes(f"{A}, {B}", HOUSE_CODE) == [A, B]
    assert parse_route_codes(f"{A};{B}\n{A}", HOUSE_CODE) == [A, B]
    assert parse_route_codes(f"  {B.lower()}  ", HOUSE_CODE) == [B]
    assert parse_route_codes("[%s]" % A, HOUSE_CODE) == [A]


def test_parse_keeps_zero_padding_and_rejects_junk():
    # Zero padding is part of the identity — never normalized away.
    assert parse_route_codes("MYMVAI01_ROUTE11,MYMVAI01_ROUTE0011", HOUSE_CODE) == [
        "MYMVAI01_ROUTE11",
        "MYMVAI01_ROUTE0011",
    ]
    assert parse_route_codes("3 Days Route", HOUSE_CODE) == []
    assert parse_route_codes(None, HOUSE_CODE) == []
    assert parse_route_codes("nan", HOUSE_CODE) == []


def test_parse_rejects_other_house_prefix():
    assert parse_route_codes(f"{A},MYMVAI02_ROUTE0011", HOUSE_CODE) == [A]


async def _retailer(db, house_id, code, raw_route):
    retailer = Retailer(
        house_id=house_id,
        retailer_code=code,
        name=f"Retailer {code}",
        route=raw_route,
    )
    db.add(retailer)
    await db.commit()
    await db.refresh(retailer)
    return retailer


async def _links(db, retailer_id):
    rows = (
        await db.execute(
            select(RetailerRoute, Route.code)
            .join(Route, Route.id == RetailerRoute.route_id)
            .where(
                RetailerRoute.retailer_id == retailer_id,
                RetailerRoute.status == "active",
            )
        )
    ).all()
    return {code: link for link, code in rows}


async def test_sync_rejects_unregistered_codes(db, house):
    retailer = await _retailer(db, house.id, "R1", f"({A})")
    await register_routes(db, house.id, [A])
    await db.commit()

    counts = await sync_retailer_routes(db, {"R1": (house.id, [A, B])})
    await db.commit()

    assert counts["rejected"] == 1
    assert counts["added"] == 1
    links = await _links(db, retailer.id)
    assert list(links) == [A]
    assert links[A].is_primary is True


async def test_sync_is_idempotent_and_follows_primary_order(db, house):
    retailer = await _retailer(db, house.id, "R1", f"({A},{B})")
    await register_routes(db, house.id, [A, B])
    await db.commit()

    first = await sync_retailer_routes(db, {"R1": (house.id, [A, B])})
    await db.commit()
    assert first["added"] == 2

    second = await sync_retailer_routes(db, {"R1": (house.id, [A, B])})
    await db.commit()
    assert second["added"] == 0 and second["removed"] == 0
    assert second["unchanged"] == 2

    # Order changes the primary route without creating a second link row.
    await sync_retailer_routes(db, {"R1": (house.id, [B, A])})
    await db.commit()
    links = await _links(db, retailer.id)
    assert links[B].is_primary is True
    assert links[A].is_primary is False
    assert (
        await db.execute(
            select(RetailerRoute).where(RetailerRoute.retailer_id == retailer.id)
        )
    ).all().__len__() == 2


async def test_sync_closes_removed_codes_without_deleting_history(db, house):
    retailer = await _retailer(db, house.id, "R1", f"({A},{B})")
    await register_routes(db, house.id, [A, B])
    await db.commit()
    await sync_retailer_routes(db, {"R1": (house.id, [A, B])})
    await db.commit()

    counts = await sync_retailer_routes(db, {"R1": (house.id, [A])})
    await db.commit()

    assert counts["removed"] == 1
    rows = (
        await db.execute(
            select(RetailerRoute).where(RetailerRoute.retailer_id == retailer.id)
        )
    ).scalars().all()
    assert len(rows) == 2  # history kept
    closed = [row for row in rows if row.status == "inactive"]
    assert len(closed) == 1 and closed[0].effective_to is not None

    # Re-importing the original list reopens the old row instead of duplicating.
    counts = await sync_retailer_routes(db, {"R1": (house.id, [A, B])})
    await db.commit()
    assert counts["added"] == 1
    rows = (
        await db.execute(
            select(RetailerRoute).where(RetailerRoute.retailer_id == retailer.id)
        )
    ).scalars().all()
    assert len(rows) == 3


async def test_route_ids_for_codes_ignores_other_houses(db, house):
    other_house = await _house(db, "OTHER02", "Other House")
    await register_routes(db, other_house.id, ["OTHER02_ROUTE1"])
    await db.commit()

    assert await route_ids_for_codes(db, other_house.id, ["OTHER02_ROUTE1", A]) == {
        "OTHER02_ROUTE1": (
            await db.execute(select(Route.id).where(Route.code == "OTHER02_ROUTE1"))
        ).scalar()
    }
    assert await route_ids_for_codes(db, house.id, ["OTHER02_ROUTE1"]) == {}


async def _house(db, code, name):
    from app.models.house import House

    house = House(code=code, name=name, email=f"{code.lower()}@example.com")
    db.add(house)
    await db.commit()
    await db.refresh(house)
    return house


async def test_backfill_seeds_master_and_is_idempotent(db, house):
    prefix = house.code.upper()
    a, b = f"{prefix}_ROUTE0066", f"{prefix}_ROUTE0075"
    retailer = await _retailer(db, house.id, "R1", f"({a},{b})")
    await _retailer(db, house.id, "R2", "3 Days Route")  # unparseable snapshot

    first = await db_service._migrate_retailer_routes(db_engine=test_engine)
    assert first["routes_created"] == 2
    assert first["retailers_linked"] == 2  # unchanged counts the second link too

    links = await _links(db, retailer.id)
    assert list(links) == [a, b]
    assert links[a].is_primary is True

    second = await db_service._migrate_retailer_routes(db_engine=test_engine)
    assert second["routes_created"] == 0
    assert (await db.execute(select(Route))).scalars().all().__len__() == 2
    assert (
        await db.execute(select(RetailerRoute))
    ).scalars().all().__len__() == 2


async def test_backfill_never_reverts_curated_links(db, house):
    prefix = house.code.upper()
    a, b = f"{prefix}_ROUTE0066", f"{prefix}_ROUTE0075"
    retailer = await _retailer(db, house.id, "R1", f"({a})")
    await register_routes(db, house.id, [a, b])
    await db.commit()
    # Operator moved the retailer to B before the next boot.
    await sync_retailer_routes(db, {"R1": (house.id, [b])})
    await db.commit()

    await db_service._migrate_retailer_routes(db_engine=test_engine)

    links = await _links(db, retailer.id)
    assert list(links) == [b]


async def test_retailer_api_payload_and_export_prefer_normalized_codes(db, house):
    from app.routers.retailers import _active_routes
    from app.services.Automation.retailer_excel import _export_route_value

    retailer = await _retailer(db, house.id, "R1", f"({A},{B})")
    await register_routes(db, house.id, [A, B])
    await db.commit()
    await sync_retailer_routes(db, {"R1": (house.id, [B, A])})
    await db.commit()

    loaded = (
        await db.execute(
            select(Retailer)
            .where(Retailer.id == retailer.id)
            .options(
                selectinload(Retailer.route_links).joinedload(RetailerRoute.route)
            )
        )
    ).scalars().one()

    payload = _active_routes(loaded)
    assert [entry["code"] for entry in payload] == [B, A]
    assert payload[0]["is_primary"] is True
    assert _export_route_value(loaded) == f"{B},{A}"


async def test_export_falls_back_to_raw_snapshot(db, house):
    from app.services.Automation.retailer_excel import _export_route_value

    retailer = await _retailer(db, house.id, "R1", "3 Days Route")
    loaded = (
        await db.execute(
            select(Retailer)
            .where(Retailer.id == retailer.id)
            .options(
                selectinload(Retailer.route_links).joinedload(RetailerRoute.route)
            )
        )
    ).scalars().one()
    assert _export_route_value(loaded) == "3 Days Route"


async def test_route_owner_self_heal_hands_over_and_unassigns_resigned_owner(db, house):
    route_a = Route(house_id=house.id, code=f"{house.code}_ROUTE0001")
    route_b = Route(house_id=house.id, code=f"{house.code}_ROUTE0002")
    outgoing = Employee(
        house_id=house.id,
        employee_name="RSO Out",
        employee_id="RsoOut",
        employee_type="rso",
        status="Resigned",
        itop_number="1915270101",
    )
    successor = Employee(
        house_id=house.id,
        employee_name="RSO New",
        employee_id="RsoNew",
        employee_type="rso",
        status="Active",
        itop_number="1915270101",
    )
    orphan = Employee(
        house_id=house.id,
        employee_name="RSO Gone",
        employee_id="RsoGone",
        employee_type="rso",
        status="Resigned",
        itop_number="1999",
    )
    db.add_all([route_a, route_b, outgoing, successor, orphan])
    await db.flush()
    start = datetime(2026, 10, 1)
    db.add_all(
        [
            EmployeeRoute(
                house_id=house.id,
                employee_id=outgoing.id,
                route_id=route_a.id,
                status="active",
                effective_from=start,
                assigned_at=start,
            ),
            EmployeeRoute(
                house_id=house.id,
                employee_id=orphan.id,
                route_id=route_b.id,
                status="active",
                effective_from=start,
                assigned_at=start,
            ),
        ]
    )
    await db.commit()

    assert await db_service._migrate_route_owner_link(db_engine=test_engine) == {
        "reassigned": 1,
        "unassigned": 1,
    }

    owners = {
        link.route_id: link.employee_id
        for link in (
            await db.execute(
                select(EmployeeRoute).where(EmployeeRoute.status == "active")
            )
        ).scalars()
    }
    assert owners == {route_a.id: successor.id}
    assert await db_service._migrate_route_owner_link(db_engine=test_engine) == {
        "reassigned": 0,
        "unassigned": 0,
    }


async def test_employee_route_owner_unique_per_route(db, house):
    from app.models.employee import Employee

    rso_one = Employee(
        house_id=house.id, employee_name="RSO One", employee_id="1", employee_type="rso"
    )
    rso_two = Employee(
        house_id=house.id, employee_name="RSO Two", employee_id="2", employee_type="rso"
    )
    db.add_all([rso_one, rso_two])
    await db.flush()
    route_id = (await register_routes(db, house.id, [A]))[A]
    db.add_all(
        [
            EmployeeRoute(house_id=house.id, employee_id=rso_one.id, route_id=route_id),
            EmployeeRoute(house_id=house.id, employee_id=rso_two.id, route_id=route_id),
        ]
    )
    with pytest.raises(Exception):
        await db.commit()
