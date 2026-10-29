"""Inactive Retailers delivery report types (Active SSO / Active LSO).

Each page's "Inactive Retailers" modal Share action delivers one RSO's
inactive-retailer list as an image instead of the house-wide report. Those
report types render from the RSO id the schedule/send carries in
``report_params``, so the context must survive validation, the schedule row and
the builder — and the image must paginate on the A4 landscape sheet like every
other report. Both report types share one renderer, so the header (RSO name,
DMS code, iTopUp number) is identical and only the table columns differ.
"""
from datetime import date
from io import BytesIO
from types import SimpleNamespace

import pytest
from PIL import Image

from app.routers.whatsapp_schedules import (
    ALLOWED_REPORT_TYPES,
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
from app.services.inactive_retailers_whatsapp_image import (
    LSO_LABELS,
    LSO_LEFT_COLS,
    PAGE_H,
    PAGE_W,
    RENDER_SCALE,
    SSO_LABELS,
    SSO_LEFT_COLS,
    _lso_row,
    _render_pages,
    _resolve_period,
    _rows,
    _sso_row,
    build_active_lso_inactive_retailers_image,
    build_active_sso_inactive_retailers_image,
)

SSO = "active_sso_inactive_retailers"
LSO = "active_lso_inactive_retailers"
TODAY = date(2026, 10, 16)


def _sso_items(count: int) -> list[dict]:
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


def _lso_items(count: int) -> list[dict]:
    return [
        {
            "retailer_code": f"R{340000 + i}",
            "name": f"Retailer {i}",
            "itop_number": f"1915{700000 + i}",
            "house_code": "H001",
            "rso_number": "1915700001",
            "days_sold": i % 4,
            "sales_amount": 120.0 * i,
            "required_sales_amount": 500.0,
            "required_selling_days": 7,
            "inactive_last_month": "Y" if i % 2 else "",
        }
        for i in range(count)
    ]


def _render(count: int, *, lso: bool = False) -> list[bytes]:
    rows = _rows(_lso_items(count) if lso else _sso_items(count),
                 _lso_row if lso else _sso_row)
    return _render_pages(
        rso_name="RSO One",
        rso_dms="R642686",
        rso_itop="1915700001",
        labels=LSO_LABELS if lso else SSO_LABELS,
        left_cols=LSO_LEFT_COLS if lso else SSO_LEFT_COLS,
        rows=rows,
    )


def _decode(png: bytes) -> Image.Image:
    return Image.open(BytesIO(png))


# ── report type registration ──────────────────────────────────────

@pytest.mark.parametrize("report_type", [SSO, LSO])
def test_report_type_is_registered_and_sendable(report_type):
    assert report_type in ALLOWED_REPORT_TYPES
    assert get_report_builder(report_type) is FILTERED_BUILDERS[report_type]
    assert REPORT_BUILDERS[report_type] is FILTERED_BUILDERS[report_type]


def test_report_titles_name_their_page():
    assert get_report_title(SSO) == "Inactive Retailers (Active SSO)"
    assert get_report_title(LSO) == "Inactive Retailers (Active LSO)"


# ── report_params validation ──────────────────────────────────────

@pytest.mark.parametrize("report_type", [SSO, LSO])
def test_employee_id_is_required_for_the_retailer_list(report_type):
    with pytest.raises(ValueError):
        _validate_report_params(report_type, None)
    with pytest.raises(ValueError):
        _validate_report_params(report_type, {"employee_id": ""})
    with pytest.raises(ValueError):
        _validate_report_params(report_type, {"employee_id": 0})


def test_employee_id_is_normalized_to_an_integer():
    assert _validate_report_params(SSO, {"employee_id": "42"}) == {"employee_id": 42}
    assert _validate_report_params(SSO, {"employee_id": 42}) == {"employee_id": 42}
    assert _validate_report_params(LSO, {"employee_id": "42"}) == {"employee_id": 42}


def test_house_wide_report_types_never_keep_context():
    assert _validate_report_params("active_sso", {"employee_id": 42}) is None
    assert _validate_report_params("active_lso", {"employee_id": 42}) is None
    assert _validate_report_params("ga_live", None) is None


@pytest.mark.parametrize("report_type", [SSO, LSO])
def test_period_is_carried_with_the_context(report_type):
    params = _validate_report_params(report_type, {
        "employee_id": 7,
        "start_date": "2026-10-01",
        "end_date": "2026-10-31",
    })
    assert params == {"employee_id": 7, "start_date": "2026-10-01", "end_date": "2026-10-31"}
    # A period is all-or-nothing and must be ordered.
    with pytest.raises(ValueError):
        _validate_report_params(report_type, {"employee_id": 7, "start_date": "2026-10-01"})
    with pytest.raises(ValueError):
        _validate_report_params(report_type, {
            "employee_id": 7, "start_date": "2026-10-31", "end_date": "2026-10-01",
        })
    with pytest.raises(ValueError):
        _validate_report_params(report_type, {
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
    for report_type in (SSO, LSO):
        assert _matches_report_context(schedule, report_type, same_rso)
        assert not _matches_report_context(schedule, report_type, other_rso)
    # House-wide types keep every schedule of that type.
    assert _matches_report_context(schedule, "active_lso", None)


def test_report_params_decode_from_a_query_string():
    assert _decode_report_params('{"employee_id": 42}') == {"employee_id": 42}
    assert _decode_report_params(None) is None
    with pytest.raises(ValueError):
        _decode_report_params("employee_id=42")
    with pytest.raises(ValueError):
        _decode_report_params("[1, 2]")


@pytest.mark.parametrize("report_type", [SSO, LSO])
def test_payloads_accept_the_report_context(report_type):
    create = ScheduleCreate(
        schedule_type="daily",
        schedule_time="09:00",
        report_type=report_type,
        report_params={"employee_id": 7},
        target_ids=["120363@g.us"],
        target_names=["Group"],
    )
    assert create.report_params == {"employee_id": 7}

    direct = DirectSendPayload(
        report_type=report_type,
        report_params={"employee_id": 7},
        whatsapp_chat_ids=["120363@g.us"],
    )
    assert direct.report_params == {"employee_id": 7}


# ── builders ──────────────────────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("builder", [
    build_active_sso_inactive_retailers_image,
    build_active_lso_inactive_retailers_image,
])
async def test_missing_employee_id_fails_the_build(builder):
    with pytest.raises(ValueError):
        await builder(None, 1, report_params={})


@pytest.mark.parametrize("lso", [False, True])
def test_small_list_renders_one_content_hugging_page(lso):
    pages = _render(3, lso=lso)
    assert len(pages) == 1
    img = _decode(pages[0])
    assert img.width == PAGE_W * RENDER_SCALE
    # A page that does not fill the sheet shrinks to its content height.
    assert img.height < PAGE_H * RENDER_SCALE


@pytest.mark.parametrize("lso", [False, True])
def test_long_list_paginates_on_the_a4_landscape_sheet(lso):
    pages = _render(500, lso=lso)
    assert len(pages) > 1
    for png in pages:
        img = _decode(png)
        assert img.width == PAGE_W * RENDER_SCALE
        assert img.height <= PAGE_H * RENDER_SCALE
    # the last page holds the tail of the list, so it is not taller than a full one
    assert _decode(pages[-1]).height <= _decode(pages[0]).height


def test_sso_rows_render_every_modal_column():
    rows = _rows(_sso_items(1), _sso_row)
    assert rows[0][0] == 1
    assert rows[0][2] == "R340000"
    assert rows[0][4] == "1915700000"
    assert rows[0][6] == "3"
    assert rows[0][7] == ""
    assert _rows(_sso_items(2), _sso_row)[1][7] == "Y"


def test_lso_rows_render_every_modal_column():
    rows = _rows(_lso_items(2), _lso_row)
    assert rows[0][0] == 1
    assert rows[0][2] == "R340000"
    assert rows[0][4] == "1915700000"
    assert rows[0][5] == "1915700001"   # the RSO's own iTopUp SR number
    assert rows[0][6] == "0"            # days sold
    assert rows[0][7] == "0"            # sales amount
    assert rows[0][8] == "500/500"      # remaining/required sales
    assert rows[0][9] == "7/7"          # remaining/required days
    assert rows[0][10] == ""
    # second row: 1 day, 120 BDT sold -> 380 short of the 500 BDT / 7 day bar
    assert rows[1][6] == "1"
    assert rows[1][7] == "120"
    assert rows[1][8] == "380/500"
    assert rows[1][9] == "6/7"
    assert rows[1][10] == "Y"
