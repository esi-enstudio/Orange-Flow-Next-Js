"""Active SSO "Inactive Retailers" delivery report type.

The Inactive Retailers modal's Share action delivers one RSO's inactive-retailer
list as an image instead of the house-wide Active SSO report. That report type
renders from the RSO id the schedule/send carries in ``report_params``, so the
context must survive validation, the schedule row and the builder — and the
image must paginate on the A4 landscape sheet like every other report.
"""
from datetime import date
from io import BytesIO
from types import SimpleNamespace

import pytest
from PIL import Image

from app.routers.whatsapp_schedules import (
    DirectSendPayload,
    ScheduleCreate,
    _decode_report_params,
    _matches_report_context,
    _validate_report_params,
)
from app.services.report_builders import (
    FILTERED_BUILDERS,
    REPORT_BUILDERS,
    get_report_builder,
    get_report_title,
)
from app.services.active_sso_retailers_whatsapp_image import (
    PAGE_H,
    PAGE_W,
    RENDER_SCALE,
    _render_pages,
    _resolve_period,
    _rows,
    build_active_sso_inactive_retailers_image,
)

REPORT_TYPE = "active_sso_inactive_retailers"
TODAY = date(2026, 10, 16)


def _items(count: int) -> list[dict]:
    return [
        {
            "retailer_code": f"R{340000 + i}",
            "name": f"Retailer {i}",
            "itop_number": f"1915{700000 + i}",
            "house_code": "H001",
            "activations_done": i % 3,
            "required_activations": 3,
            "inactive_last_month": "Y" if i % 2 else "",
        }
        for i in range(count)
    ]


def _render(count: int) -> list[bytes]:
    return _render_pages(
        house_name="Test House",
        house_code="H001",
        rso_name="RSO One",
        rso_dms="R642686",
        rso_itop="1915700001",
        period_text="01 Oct 2026 to 31 Oct 2026",
        today=TODAY,
        rows=_rows(_items(count)),
        total_retailers=count + 5,
    )


def _decode(png: bytes) -> Image.Image:
    return Image.open(BytesIO(png))


# ── report type registration ──────────────────────────────────────


def test_report_type_is_registered_and_sendable():
    from app.routers.whatsapp_schedules import ALLOWED_REPORT_TYPES

    assert REPORT_TYPE in ALLOWED_REPORT_TYPES
    assert get_report_builder(REPORT_TYPE) is FILTERED_BUILDERS[REPORT_TYPE]
    assert REPORT_BUILDERS[REPORT_TYPE] is FILTERED_BUILDERS[REPORT_TYPE]
    assert get_report_title(REPORT_TYPE) == "Inactive Retailers (Active SSO)"


# ── report_params validation ──────────────────────────────────────


def test_employee_id_is_required_for_the_retailer_list():
    with pytest.raises(ValueError):
        _validate_report_params(REPORT_TYPE, None)
    with pytest.raises(ValueError):
        _validate_report_params(REPORT_TYPE, {"employee_id": ""})
    with pytest.raises(ValueError):
        _validate_report_params(REPORT_TYPE, {"employee_id": 0})


def test_employee_id_is_normalized_to_an_integer():
    assert _validate_report_params(REPORT_TYPE, {"employee_id": "42"}) == {"employee_id": 42}
    assert _validate_report_params(REPORT_TYPE, {"employee_id": 42}) == {"employee_id": 42}


def test_house_wide_report_types_never_keep_context():
    assert _validate_report_params("active_sso", {"employee_id": 42}) is None
    assert _validate_report_params("ga_live", None) is None


def test_period_is_carried_with_the_context():
    params = _validate_report_params(REPORT_TYPE, {
        "employee_id": 7,
        "start_date": "2026-10-01",
        "end_date": "2026-10-31",
    })
    assert params == {"employee_id": 7, "start_date": "2026-10-01", "end_date": "2026-10-31"}
    # A period is all-or-nothing and must be ordered.
    with pytest.raises(ValueError):
        _validate_report_params(REPORT_TYPE, {"employee_id": 7, "start_date": "2026-10-01"})
    with pytest.raises(ValueError):
        _validate_report_params(REPORT_TYPE, {
            "employee_id": 7, "start_date": "2026-10-31", "end_date": "2026-10-01",
        })
    with pytest.raises(ValueError):
        _validate_report_params(REPORT_TYPE, {
            "employee_id": 7, "start_date": "last month", "end_date": "2026-10-31",
        })


def test_period_falls_back_to_the_report_page_default():
    context = {"employee_id": 7, "start_date": "2026-09-01", "end_date": "2026-09-30"}
    assert _resolve_period(context) == (date(2026, 9, 1), date(2026, 9, 30))

    start, end = _resolve_period({"employee_id": 7})
    assert start.day == 1 and start.month == end.month
    assert (end - start).days >= 27  # a whole calendar month


def test_schedule_grouping_ignores_the_period():
    schedule = SimpleNamespace(report_params='{"employee_id": 7, "start_date": "2026-09-01", "end_date": "2026-09-30"}')
    same_rso = {"employee_id": 7, "start_date": "2026-10-01", "end_date": "2026-10-31"}
    other_rso = {"employee_id": 8}
    assert _matches_report_context(schedule, REPORT_TYPE, same_rso)
    assert not _matches_report_context(schedule, REPORT_TYPE, other_rso)
    # House-wide types keep every schedule of that type.
    assert _matches_report_context(schedule, "active_sso", None)


def test_report_params_decode_from_a_query_string():
    assert _decode_report_params('{"employee_id": 42}') == {"employee_id": 42}
    assert _decode_report_params(None) is None
    with pytest.raises(ValueError):
        _decode_report_params("employee_id=42")
    with pytest.raises(ValueError):
        _decode_report_params("[1, 2]")


def test_payloads_accept_the_report_context():
    create = ScheduleCreate(
        schedule_type="daily",
        schedule_time="09:00",
        report_type=REPORT_TYPE,
        report_params={"employee_id": 7},
        target_ids=["120363@g.us"],
        target_names=["Group"],
    )
    assert create.report_params == {"employee_id": 7}

    direct = DirectSendPayload(
        report_type=REPORT_TYPE,
        report_params={"employee_id": 7},
        whatsapp_chat_ids=["120363@g.us"],
    )
    assert direct.report_params == {"employee_id": 7}


# ── builder ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_missing_employee_id_fails_the_build():
    with pytest.raises(ValueError):
        await build_active_sso_inactive_retailers_image(None, 1, report_params={})


def test_small_list_renders_one_content_hugging_page():
    pages = _render(3)
    assert len(pages) == 1
    img = _decode(pages[0])
    assert img.width == PAGE_W * RENDER_SCALE
    # A page that does not fill the sheet shrinks to its content height.
    assert img.height < PAGE_H * RENDER_SCALE


def test_long_list_paginates_on_the_a4_landscape_sheet():
    pages = _render(500)
    assert len(pages) > 1
    for png in pages:
        img = _decode(png)
        assert img.width == PAGE_W * RENDER_SCALE
        assert img.height <= PAGE_H * RENDER_SCALE
    # the last page holds the tail of the list, so it is not taller than a full one
    assert _decode(pages[-1]).height <= _decode(pages[0]).height


def test_rows_render_every_modal_column():
    rows = _rows(_items(1))
    assert rows[0][0] == 1
    assert rows[0][2] == "R340000"
    assert rows[0][4] == "1915700000"
    assert rows[0][6] == "3"
    assert rows[0][7] == ""
    assert _rows(_items(2))[1][7] == "Y"
