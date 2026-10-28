"""Active SSO Report image (WhatsApp delivery): RSO table columns + font sizing.

The image's RSO table mirrors the page's "RSO Target vs Achievement · Retailer
Count" section: the RSO's iTop number is shown right after its name, and the
Retailer Count group leads with the Retailers total before the SIM-activation
buckets. Every row and the grand-total row must stay perfectly aligned with the
label list, otherwise the bucket columns silently shift and each value lands
under the wrong header. `draw_table` never complains about the extra cells, so
the pagination tests cannot catch that — these assertions are the guard.

Because that table carries the most columns on the sheet, its headings are
abbreviated (Ach / Proj / 0 GA / 1 GA / Inactive L.M / Re.Act) so the columns
stay narrow. Every table then grows to the largest font its own content-sized
columns allow, instead of being pinned to one small size.

The supervisor column is deliberately absent (the SUPERVISOR SUMMARY table
above carries it), and the page's "retailers" key must never come back into the
bucket key list — it is rendered from the row's own ``retailer_count``.
"""
from app.services.active_sso_whatsapp_image import (
    FONT_MAX,
    HOUSE_LABELS,
    RSO_A_LABELS,
    SUPERVISOR_LABELS,
    TABLE_FIT_W,
    _bucket_label,
    _count_keys,
    _grand_total,
    _house_row,
    _pick_table_font,
    _rso_labels,
    _rso_rows,
    _supervisor_rows,
)
from app.services.report_image_kit import content_weights, load_font

COUNT_KEYS = [f"day_{i}" for i in range(2)] + [
    "inactive_last_month",
    "reactivated",
]
BUCKET_START = 3 + len(RSO_A_LABELS) + 1  # serial, RSO, iTop, metrics, Retailers


def _row(i: int, itop: str | None = None) -> dict:
    return {
        "name": f"RSO Person {i}",
        "itop_number": f"191527{i:04d}" if itop is None else itop,
        "supervisor_name": "Supervisor A",
        "target": 120 + i,
        "achieved": 80 + i,
        "remaining": 40 - i,
        "drr": 3,
        "daily_avg": 8.1,
        "projection": 250 + i,
        "status": "on_track",
        "retailer_count": 30 + i,
        "retailer_counts": {k: i + j + 1 for j, k in enumerate(COUNT_KEYS)},
    }


def _summary(rows: list[dict]) -> dict:
    return {
        "rso_count": len(rows),
        "retailer_count": sum(r["retailer_count"] for r in rows),
        "target": sum(r["target"] for r in rows),
        "achieved": sum(r["achieved"] for r in rows),
        "remaining": 0,
        "drr": 0,
        "daily_avg": 80.4,
        "projection": 3200,
        "status": "on_track",
        "retailer_counts": {
            k: sum(r["retailer_counts"][k] for r in rows) for k in COUNT_KEYS
        },
    }


def test_rso_table_shows_itop_after_name_with_abbreviated_headings():
    labels = _rso_labels(COUNT_KEYS)
    assert labels[:3] == ["#", "RSO", "iTop"]
    assert "Supervisor" not in labels
    assert labels[3:3 + len(RSO_A_LABELS)] == RSO_A_LABELS
    assert labels[3 + len(RSO_A_LABELS)] == "Retailers"
    assert labels[BUCKET_START:] == [_bucket_label(k) for k in COUNT_KEYS]
    # Abbreviated so this widest table keeps a large font; the page keeps the
    # full wording.
    assert "Ach" in labels and "Achieved" not in labels
    assert "Proj" in labels and "Projection" not in labels
    assert "0 GA" in labels and "1 GA" in labels
    assert "Inactive L.M" in labels and "Re.Act" in labels


def test_rso_rows_and_total_stay_aligned_with_the_labels():
    rows_in = [_row(0), _row(1), _row(2)]
    labels = _rso_labels(COUNT_KEYS)
    rows = _rso_rows(rows_in, COUNT_KEYS)
    total = _grand_total(_summary(rows_in), COUNT_KEYS)

    assert all(len(row) == len(labels) for row in rows)
    assert len(total) == len(labels)
    assert [row[2] for row in rows] == ["1915270000", "1915270001", "1915270002"]
    # The Retailers total sits in its own column, right before the buckets.
    assert [row[BUCKET_START - 1] for row in rows] == ["30", "31", "32"]
    # Bucket cells map to their own bucket key (no off-by-one shift).
    assert rows[0][BUCKET_START:] == [
        str(rows_in[0]["retailer_counts"][k]) for k in COUNT_KEYS
    ]
    assert total[BUCKET_START:] == [
        str(sum(r["retailer_counts"][k] for r in rows_in)) for k in COUNT_KEYS
    ]
    assert total[BUCKET_START - 1] == str(
        sum(r["retailer_count"] for r in rows_in)
    )
    # A missing iTop number still fills its cell, so nothing shifts.
    assert _rso_rows([{**_row(0), "itop_number": None}], COUNT_KEYS)[0][2] == "-"


def test_count_keys_never_reintroduce_the_retailers_column():
    dashboard = {"count_keys": ["retailers", *COUNT_KEYS]}
    assert _count_keys(dashboard) == COUNT_KEYS


# ── Font sizing ──
def _tables():
    """(labels, rows, total_row, total_span, name_cols) for each table drawn."""
    rows_in = [_row(0), _row(1), _row(2)]
    summary = _summary(rows_in)
    supervisors = [{**summary, "supervisor_name": "Supervisor A"}]
    return {
        "house": (HOUSE_LABELS, [], _house_row(summary), 0, []),
        "supervisor": (
            SUPERVISOR_LABELS, _supervisor_rows(supervisors), None, 0, [1],
        ),
        "rso": (
            _rso_labels(COUNT_KEYS),
            _rso_rows(rows_in, COUNT_KEYS),
            _grand_total(summary, COUNT_KEYS),
            3,
            [1],
        ),
    }


def test_every_table_grows_to_the_largest_font_that_fits():
    for name, (labels, rows, total_row, total_span, name_cols) in _tables().items():
        size, _, _, weights = _pick_table_font(
            labels, rows, total_row, total_span, name_cols
        )
        assert sum(weights) <= TABLE_FIT_W, name
        if size >= FONT_MAX:
            continue
        # One point larger no longer fits with every cell fully visible, so the
        # chosen size really is the biggest one the column widths allow.
        f = load_font(size + 1, True)
        assert sum(content_weights(labels, rows, f, f, (), margin=8,
                                   total_row=total_row,
                                   total_span=total_span)) > TABLE_FIT_W, name
