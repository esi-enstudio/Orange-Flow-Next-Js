"""Active LSO Report image (WhatsApp delivery): RSO table columns.

The image's RSO table mirrors the page's dense "RSO Target vs Achievement ·
Retailer Count" section with two deliberate differences: the Supervisor and
Retailers total columns are dropped and the RSO's iTop number is shown right
after its name. Every row and the grand-total row must stay perfectly aligned
with the label list, otherwise the day-bucket columns silently shift.

The D.Avg column is rendered rounded (the page shows the raw one-decimal
average), and the day buckets keep their own values — the page's removed
"Retailers" key must never come back into the key list.
"""
from app.services.active_lso_whatsapp_image import (
    A_LABELS,
    _bucket_label,
    _count_keys,
    _grand_total,
    _metric_cells,
    _rso_labels,
    _rso_rows,
)

COUNT_KEYS = [f"day_{i}" for i in range(7)] + [
    "days_no_sales",
    "inactive_last_month",
    "reactivated",
]
BUCKET_START = 3 + len(A_LABELS)


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
        "retailer_counts": {k: i + j for j, k in enumerate(COUNT_KEYS)},
    }


def _summary(rows: list[dict]) -> dict:
    return {
        "rso_count": len(rows),
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


def test_rso_table_drops_supervisor_and_retailers_and_adds_itop_after_name():
    labels = _rso_labels(COUNT_KEYS)
    assert labels[:3] == ["#", "RSO", "iTop"]
    assert "Supervisor" not in labels
    assert "Retailers" not in labels
    assert labels[3:3 + len(A_LABELS)] == A_LABELS
    assert labels[BUCKET_START:] == [_bucket_label(k) for k in COUNT_KEYS]


def test_rso_rows_and_total_stay_aligned_with_the_labels():
    rows_in = [_row(0), _row(1), _row(2)]
    labels = _rso_labels(COUNT_KEYS)
    rows = _rso_rows(rows_in, COUNT_KEYS)
    total = _grand_total(_summary(rows_in), COUNT_KEYS)

    assert all(len(row) == len(labels) for row in rows)
    assert len(total) == len(labels)
    assert [row[2] for row in rows] == ["1915270000", "1915270001", "1915270002"]
    # Bucket cells map to their own bucket key (no off-by-one shift).
    assert rows[0][BUCKET_START:] == [
        str(rows_in[0]["retailer_counts"][k]) for k in COUNT_KEYS
    ]
    assert total[BUCKET_START:] == [
        str(sum(r["retailer_counts"][k] for r in rows_in)) for k in COUNT_KEYS
    ]


def test_missing_itop_number_renders_as_a_dash():
    row = _rso_rows([{**_row(0), "itop_number": None}], COUNT_KEYS)[0]
    assert row[2] == "-"


def test_daily_avg_column_is_rounded():
    cells = _metric_cells({**_row(0), "daily_avg": 7.6})
    assert cells[A_LABELS.index("D.Avg")] == "8"
    cells = _metric_cells({**_row(0), "daily_avg": 8.4})
    assert cells[A_LABELS.index("D.Avg")] == "8"


def test_count_keys_never_reintroduce_the_removed_retailers_column():
    dashboard = {"count_keys": ["retailers", *COUNT_KEYS]}
    assert _count_keys(dashboard) == COUNT_KEYS
