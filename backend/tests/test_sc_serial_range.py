from datetime import date
from types import SimpleNamespace

import pytest
from sqlalchemy import select, text

from app.models.product import Product
from app.models.scratch_card_serial import ScratchCardSerial
from app.routers import scratch_card_serials as serial_router
from app.routers.scratch_card_serials import (
    _apply_serial_range,
    list_serials,
    select_all_serials,
    bulk_update_status,
)
from app.schemas.pagination import PaginationParams
from app.schemas.scratch_card_serial import BulkStatusUpdate


@pytest.mark.asyncio
async def test_serial_range_compares_numeric_serials_by_value(db):
    await db.execute(
        text(
            "INSERT INTO scratch_card_serials "
            "(id, house_id, product_id, serial_number, status) "
            "VALUES (1, 1, 1, '8', 'available'), (2, 1, 1, '9', 'available'), "
            "(3, 1, 1, '10', 'available'), (4, 1, 1, '11', 'available'), "
            "(5, 1, 1, '50400050739', 'available'), "
            "(6, 1, 1, '504000507390', 'available'), "
            "(7, 1, 1, '5040005073901', 'available')"
        )
    )

    numeric_range = _apply_serial_range(select(ScratchCardSerial.serial_number), "9", "10")
    numeric_result = await db.execute(numeric_range)
    exact_range = _apply_serial_range(
        select(ScratchCardSerial.serial_number), "504000507390", "504000507390"
    )
    exact_result = await db.execute(exact_range)

    assert set(numeric_result.scalars().all()) == {"9", "10"}
    assert exact_result.scalars().all() == ["504000507390"]


@pytest.mark.asyncio
async def test_serial_range_filters_list_and_select_all(db):
    await db.execute(
        text(
            "INSERT INTO scratch_card_serials "
            "(id, house_id, product_id, serial_number, status) "
            "VALUES (1, 1, 1, '504000507389', 'available'), "
            "(2, 1, 1, '504000507390', 'available'), "
            "(3, 1, 1, '504000507391', 'available')"
        )
    )
    admin = SimpleNamespace(id=1, name="Admin", roles=[SimpleNamespace(name="admin")], houses=[])
    pagination = PaginationParams(
        page=1,
        per_page=20,
        search=None,
        sort_by="id",
        sort_order="desc",
    )

    response = await list_serials(
        pagination=pagination,
        product_id=None,
        mrp=None,
        status=None,
        date_from=None,
        date_to=None,
        serial_from="504000507390",
        serial_to="504000507390",
        house_context=None,
        db=db,
        current_user=admin,
    )
    selected = await select_all_serials(
        product_id=None,
        mrp=None,
        status=None,
        date_from=None,
        date_to=None,
        search=None,
        serial_from="504000507390",
        serial_to="504000507390",
        house_context=None,
        db=db,
        current_user=admin,
    )

    assert [row.serial_number for row in response.data] == ["504000507390"]
    assert selected["data"]["ids"] == [2]


@pytest.mark.asyncio
async def test_serial_range_searches_all_authorized_houses_not_only_selected_house(db):
    await db.execute(
        text(
            "INSERT INTO scratch_card_serials "
            "(id, house_id, product_id, serial_number, status) "
            "VALUES (1, 2, 1, '504000507390', 'available')"
        )
    )
    user = SimpleNamespace(
        id=1,
        name="User",
        roles=[SimpleNamespace(name="sales")],
        houses=[SimpleNamespace(id=1), SimpleNamespace(id=2)],
    )
    pagination = PaginationParams(
        page=1,
        per_page=20,
        search=None,
        sort_by="id",
        sort_order="desc",
    )

    response = await list_serials(
        pagination=pagination,
        product_id=None,
        mrp=None,
        status=None,
        date_from=None,
        date_to=None,
        serial_from="504000507390",
        serial_to="504000507390",
        house_context=1,
        db=db,
        current_user=user,
    )
    selected = await select_all_serials(
        product_id=None,
        mrp=None,
        status=None,
        date_from=None,
        date_to=None,
        search=None,
        serial_from="504000507390",
        serial_to="504000507390",
        house_context=1,
        db=db,
        current_user=user,
    )

    assert [row.serial_number for row in response.data] == ["504000507390"]
    assert selected["data"]["ids"] == [1]


@pytest.mark.asyncio
async def test_mrp_filter_matches_all_products_with_selected_mrp(db):
    db.add_all(
        [
            Product(id=1, product_code="SC-29-A", category="Scratch Card", product_name="29 A", mrp=29),
            Product(id=2, product_code="SC-29-B", category="Scratch Card", product_name="29 B", mrp=29),
            Product(id=3, product_code="SC-39-A", category="Scratch Card", product_name="39 A", mrp=39),
        ]
    )
    await db.flush()
    await db.execute(
        text(
            "INSERT INTO scratch_card_serials "
            "(id, house_id, product_id, serial_number, status) "
            "VALUES (1, 1, 1, 'serial-29-a', 'available'), "
            "(2, 1, 2, 'serial-29-b', 'available'), "
            "(3, 1, 3, 'serial-39-a', 'available')"
        )
    )
    admin = SimpleNamespace(id=1, name="Admin", roles=[SimpleNamespace(name="admin")], houses=[])
    pagination = PaginationParams(
        page=1,
        per_page=20,
        search=None,
        sort_by="id",
        sort_order="desc",
    )

    response = await list_serials(
        pagination=pagination,
        product_id=None,
        mrp=29,
        status=None,
        date_from=None,
        date_to=None,
        serial_from=None,
        serial_to=None,
        house_context=None,
        db=db,
        current_user=admin,
    )
    selected = await select_all_serials(
        product_id=None,
        mrp=29,
        status=None,
        date_from=None,
        date_to=None,
        search=None,
        serial_from=None,
        serial_to=None,
        house_context=None,
        db=db,
        current_user=admin,
    )

    assert {row.serial_number for row in response.data} == {"serial-29-a", "serial-29-b"}
    assert set(selected["data"]["ids"]) == {1, 2}


@pytest.mark.asyncio
@pytest.mark.parametrize("serial", ["504000507390", "SC-ABC123"])
async def test_serial_search_ignores_list_filters_but_keeps_house_access(db, serial):
    await db.execute(
        text(
            "INSERT INTO scratch_card_serials "
            "(id, house_id, product_id, serial_number, status, created_at) "
            "VALUES (1, 2, 1, :serial, 'available', '2026-01-01 00:00:00')"
        ),
        {"serial": serial},
    )
    user = SimpleNamespace(
        id=1,
        name="User",
        roles=[SimpleNamespace(name="sales")],
        houses=[SimpleNamespace(id=1), SimpleNamespace(id=2)],
    )
    today = date(2026, 11, 14)

    response = await list_serials(
        pagination=PaginationParams(
            page=1,
            per_page=20,
            search=serial,
            sort_by="id",
            sort_order="desc",
        ),
        product_id=999,
        mrp=None,
        status="used",
        date_from=today,
        date_to=today,
        serial_from="999",
        serial_to="999",
        house_context=1,
        db=db,
        current_user=user,
    )
    selected = await select_all_serials(
        product_id=999,
        mrp=None,
        status="used",
        search=serial,
        date_from=today,
        date_to=today,
        serial_from="999",
        serial_to="999",
        house_context=1,
        db=db,
        current_user=user,
    )

    assert [row.serial_number for row in response.data] == [serial]
    assert selected["data"]["ids"] == [1]

    partial_response = await list_serials(
        pagination=PaginationParams(
            page=1,
            per_page=20,
            search=serial[-6:],
            sort_by="id",
            sort_order="desc",
        ),
        product_id=999,
        mrp=None,
        status="used",
        date_from=today,
        date_to=today,
        serial_from="999",
        serial_to="999",
        house_context=1,
        db=db,
        current_user=user,
    )
    assert [row.serial_number for row in partial_response.data] == [serial]


@pytest.mark.asyncio
async def test_serial_search_does_not_cross_unassigned_house_scope(db):
    await db.execute(
        text(
            "INSERT INTO scratch_card_serials "
            "(id, house_id, product_id, serial_number, status) "
            "VALUES (1, 2, 1, '504000507390', 'available')"
        )
    )
    user = SimpleNamespace(
        id=1,
        name="User",
        roles=[SimpleNamespace(name="sales")],
        houses=[SimpleNamespace(id=1)],
    )

    response = await list_serials(
        pagination=PaginationParams(
            page=1,
            per_page=20,
            search="504000507390",
            sort_by="id",
            sort_order="desc",
        ),
        product_id=None,
        mrp=None,
        status=None,
        date_from=None,
        date_to=None,
        serial_from=None,
        serial_to=None,
        house_context=1,
        db=db,
        current_user=user,
    )

    assert response.data == []

    range_response = await list_serials(
        pagination=PaginationParams(
            page=1,
            per_page=20,
            search=None,
            sort_by="id",
            sort_order="desc",
        ),
        product_id=None,
        mrp=None,
        status=None,
        date_from=None,
        date_to=None,
        serial_from="504000507390",
        serial_to="504000507390",
        house_context=1,
        db=db,
        current_user=user,
    )
    selected = await select_all_serials(
        product_id=None,
        mrp=None,
        status=None,
        date_from=None,
        date_to=None,
        search=None,
        serial_from="504000507390",
        serial_to="504000507390",
        house_context=1,
        db=db,
        current_user=user,
    )

    assert range_response.data == []
    assert selected["data"]["ids"] == []


@pytest.mark.asyncio
async def test_serial_list_cache_is_reused_and_cleared_after_update(db, monkeypatch):
    await db.execute(
        text(
            "INSERT INTO scratch_card_serials "
            "(id, house_id, product_id, serial_number, status) "
            "VALUES (1, 1, 1, 'cached-serial', 'available')"
        )
    )
    admin = SimpleNamespace(id=1, name="Admin", roles=[SimpleNamespace(name="admin")], houses=[])
    cache = {}

    async def get_cached(key):
        return cache.get(key)

    async def set_cached(key, value, ttl):
        cache[key] = value

    async def invalidate_cached(pattern):
        cache.clear()

    async def no_activity_log(**kwargs):
        return None

    monkeypatch.setattr(serial_router.cache_service, "get", get_cached)
    monkeypatch.setattr(serial_router.cache_service, "set", set_cached)
    monkeypatch.setattr(serial_router.cache_service, "invalidate_pattern", invalidate_cached)
    monkeypatch.setattr(serial_router, "log_activity", no_activity_log)

    pagination = PaginationParams(
        page=1,
        per_page=20,
        search="cached-serial",
        sort_by="id",
        sort_order="desc",
    )
    first = await list_serials(
        pagination=pagination,
        product_id=None,
        mrp=None,
        status=None,
        date_from=None,
        date_to=None,
        serial_from=None,
        serial_to=None,
        house_context=None,
        db=db,
        current_user=admin,
    )
    second = await list_serials(
        pagination=pagination,
        product_id=None,
        mrp=None,
        status=None,
        date_from=None,
        date_to=None,
        serial_from=None,
        serial_to=None,
        house_context=None,
        db=db,
        current_user=admin,
    )

    assert first.data[0].serial_number == "cached-serial"
    assert second["data"][0]["serial_number"] == "cached-serial"
    assert len(cache) == 1

    await bulk_update_status(
        payload=BulkStatusUpdate(serial_ids=[1], status="used"),
        db=db,
        current_user=admin,
    )

    assert cache == {}
