"""Live C2C Report image (WhatsApp delivery): layout and column alignment.

The image mirrors the page's table, so every row, the total row and the grouped
header bands must stay aligned with ``LABELS`` — an off-by-one would silently
shift the transaction columns. The sheet is A4 landscape, and the two metric
blocks are grouped so the repeated Today/Other/Total/Ach %/Remain labels stay
unambiguous.
"""
from app.services.live_c2c_whatsapp_image import (
    GROUPS,
    IMG_W,
    LABELS,
    PAGE_H,
    PAGE_W,
    _chunk_rows,
    _pct,
    _row_cells,
    _total_cells,
)


def _row(**overrides) -> dict:
    row = {
        "employee_id": 1,
        "house_code": "DMS-01",
        "dms_code": "DMS-03",
        "rso_name": "RSO One",
        "rso_itop_number": "1915270001",
        "productivity_c2c_tgt": 1000.0,
        "c2c_today_route": 400.0,
        "c2c_other_route": 100.0,
        "total_c2c": 500.0,
        "c2c_achievement_pct": 50.0,
        "c2c_remaining": 500.0,
        "productivity_trans_tgt": 4.0,
        "today_route_trans": 1,
        "other_route_trans": 1,
        "total_trans": 2,
        "trans_achievement_pct": 50.0,
        "trans_remaining": 2.0,
        "start_time": "10:05:00",
        "end_time": "12:30:00",
        "serving_hours": 2.42,
    }
    row.update(overrides)
    return row


def test_registered_as_a_scale_aware_whatsapp_report():
    from app.services import report_builders as rb
    from app.services.live_c2c_whatsapp_image import build_live_c2c_report_image

    assert rb.REPORT_BUILDERS["live_c2c"] is build_live_c2c_report_image
    assert rb.SCALE_AWARE_BUILDERS["live_c2c"] is build_live_c2c_report_image
    assert rb.get_report_title("live_c2c") == "Live C2C Report"


def test_sheet_is_a4_landscape():
    assert PAGE_W == IMG_W
    assert PAGE_H == round(IMG_W * 210 / 297)
    assert IMG_W > PAGE_H


def test_every_row_and_the_total_line_up_with_the_labels():
    rows = [_row(), _row(dms_code="DMS-04", total_trans=0, other_route_trans=0)]
    cells = _row_cells(1, rows[0])
    assert len(cells) == len(LABELS)
    assert all(len(_row_cells(i, r)) == len(LABELS) for i, r in enumerate(rows, 1))
    total = _total_cells(rows)
    assert len(total) == len(LABELS)
    assert total[0] == "Total (2 RSO)"


def test_total_trans_column_follows_today_and_other_route_counts():
    index = 13
    assert LABELS[index] == "Total"
    assert _row_cells(1, _row())[index] == "2"
    assert _row_cells(1, _row(total_trans=0, today_route_trans=0, other_route_trans=0))[index] == "0"


def test_achievement_columns_are_computed_from_the_totals():
    rows = [_row(), _row(total_c2c=0.0, c2c_today_route=0.0, c2c_other_route=0.0, total_trans=0)]
    total = _total_cells(rows)
    assert total[8] == _pct(500.0, 2000.0)
    assert total[14] == _pct(2, 8)
    # A zero target never divides by zero.
    assert _pct(5, 0) == "0.00%"
    assert _total_cells([])[8] == "0.00%"


def test_group_bands_cover_both_metric_blocks():
    labels = len(LABELS)
    covered = set()
    for start, span, _ in GROUPS:
        covered.update(range(start, start + span))
    assert covered == set(range(4, 16))
    assert all(start + span <= labels for start, span, _ in GROUPS)


def test_rows_paginate_without_dropping_any():
    rows = list(range(95))
    chunks = _chunk_rows(rows, 40, 45)
    assert [len(chunk) for chunk in chunks] == [40, 45, 10]
    assert [row for chunk in chunks for row in chunk] == rows
    assert _chunk_rows([], 40, 45) == [[]]


def test_header_uses_compact_fonts_and_omits_active_rso_count():
    from datetime import date

    from app.services.live_c2c_whatsapp_image import (
        HDR_META_SIZE,
        HDR_TITLE_SIZE,
        _draw_header,
    )

    class TextCapture:
        calls = []

        def text(self, xy, text, font, fill, anchor):
            self.calls.append((text, font.size))

        def textlength(self, text, font):
            return len(text) * font.size

    draw = TextCapture()
    _draw_header(draw, 0, 0, "House", "H001", date(2026, 11, 19))

    assert HDR_TITLE_SIZE < 40
    assert HDR_META_SIZE < 22
    assert draw.calls[0] == ("Live C2C Report", HDR_TITLE_SIZE)
    assert "Generated:" in draw.calls[2][0]
    assert "Active RSO" not in draw.calls[2][0]


def test_table_uses_larger_fonts(monkeypatch):
    from datetime import date

    from app.services import live_c2c_whatsapp_image as image_builder

    font_sizes = []
    draw_table = image_builder.draw_table

    def capture_table_fonts(*args, **kwargs):
        font_sizes.extend((kwargs["f_head"].size, kwargs["f_cell"].size))
        return draw_table(*args, **kwargs)

    monkeypatch.setattr(image_builder, "draw_table", capture_table_fonts)
    image_builder._render_image("House", "H001", [_row()], date(2026, 11, 19))

    assert font_sizes
    assert min(font_sizes) > 13
