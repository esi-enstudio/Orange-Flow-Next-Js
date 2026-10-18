"""Activation Report image (WhatsApp delivery): the SUPERVISOR table's team
own/market columns — Yest Emp / Tot / Yest Mkt / Tot.

Each supervisor row carries the team totals summed by ActivationReportService
from the same member metrics the RSO/BP tables show (RSO assisted + BP assisted
for own; RSO market for market), so the supervisor table reconciles with the
tables below it. The "Others (Unassigned)" row totals the same member fields
for members owned by no supervisor, and the grand-total row sums every row.

The four extra numeric columns must also keep the supervisor table
ellipsis-free on both orientations.
"""
import pytest

from app.services.activation_whatsapp_image import (
    CARD_PAD,
    FONT_MAX,
    FONT_MIN,
    ORIENTATIONS,
    PAGE_PAD,
    SUPERVISOR_LABELS,
    _supervisor_rows,
    _uniform_font_size,
)
from app.services.report_image_kit import content_weights, fit_widths, load_font

TODAY_SUMMARY = {
    "days_remaining": 14,
    "days_elapsed": 17,
    "monthly_target": 90000,
    "achievement": 1000,
    "remaining": 89000,
    "daily_required": 6358,
    "daily_average": 59,
    "projection": 1829,
}


def _supervisor(i: int, **overrides) -> dict:
    sup = {
        "name": f"Supervisor {i}",
        "pool_number": f"0179{i:05d}",
        "target": 900,
        "achievement": 600,
        "remaining": 300,
        "projection": 850,
        "daily_average": 22,
        "daily_required": 11,
        "team": [],
        "own_yesterday": 3 + i,
        "own_month": 40 + i,
        "market_yesterday": 5 + i,
        "market_month": 70 + i,
    }
    sup.update(overrides)
    return sup


# ── Columns ──
def test_supervisor_labels_carry_the_team_columns():
    assert len(SUPERVISOR_LABELS) == 17
    assert SUPERVISOR_LABELS[-1] == "Status"
    start = SUPERVISOR_LABELS.index("Proj %")
    assert SUPERVISOR_LABELS[start:start + 5] == \
        ["Proj %", "Yest Emp", "Tot", "Yest Mkt", "Tot"]


def test_supervisor_rows_map_team_values_and_total_sums_them():
    dashboard = {
        "supervisor_performance": [_supervisor(1), _supervisor(2)],
        "rso_performance": [],
        "bp_performance": [],
    }
    rows, total = _supervisor_rows(dashboard, 9, 21)
    own_yest = SUPERVISOR_LABELS.index("Yest Emp")
    assert all(len(row) == len(SUPERVISOR_LABELS) for row in rows)
    assert len(total) == len(SUPERVISOR_LABELS)
    assert [row[own_yest] for row in rows] == ["4", "5"]
    assert [row[own_yest + 1] for row in rows] == ["41", "42"]
    assert [row[own_yest + 2] for row in rows] == ["6", "7"]
    assert [row[own_yest + 3] for row in rows] == ["71", "72"]
    assert total[own_yest:own_yest + 4] == ["9", "83", "13", "143"]


def test_others_row_totals_unassigned_member_columns():
    dashboard = {
        "supervisor_performance": [_supervisor(1)],
        "rso_performance": [
            {"id": 11, "name": "R1", "target": 100, "achievement": 50,
             "remaining": 50, "projection": 90, "yesterday_activation": 2,
             "month_total_activation": 20, "market_yesterday": 3,
             "market_activation": 30},
        ],
        "bp_performance": [
            {"id": 12, "name": "B1", "target": 100, "achievement": 40,
             "remaining": 60, "projection": 80, "yesterday_activation": 1,
             "month_total_activation": 10},
        ],
    }
    rows, total = _supervisor_rows(dashboard, 9, 21)
    own_yest = SUPERVISOR_LABELS.index("Yest Emp")
    others = rows[-1]
    assert others[1] == "Others (Unassigned)"
    assert others[own_yest:own_yest + 4] == ["3", "30", "3", "30"]
    # the total row includes the Others row
    assert total[own_yest:own_yest + 4] == ["7", "71", "9", "101"]


# ── No cell may be ellipsized on either orientation ──
@pytest.mark.parametrize("orientation", sorted(ORIENTATIONS))
def test_no_supervisor_cell_is_ellipsized_with_the_team_columns(orientation):
    """All 17 supervisor columns must fit at the shared (auto-picked) font."""
    inner = ORIENTATIONS[orientation] - 2 * PAGE_PAD - 2 * CARD_PAD
    dashboard = {
        "summary": TODAY_SUMMARY,
        "supervisor_performance": [
            _supervisor(1, name="Titu Mia", pool_number="01712345678", target=2476,
                        achievement=912, remaining=1564, projection=630,
                        own_yesterday=3, own_month=33, market_yesterday=40,
                        market_month=400,
                        team=[{"employee_id": 100 + j, "employee_type": "rso"}
                              for j in range(9)]
                        + [{"employee_id": 200 + j, "employee_type": "bp"}
                           for j in range(3)]),
            _supervisor(2, name="Ruhul Amin", pool_number="01812345678", target=3693,
                        achievement=1318, remaining=2375, projection=1161,
                        own_yesterday=5, own_month=43, market_yesterday=72,
                        market_month=707,
                        team=[{"employee_id": 300 + j, "employee_type": "rso"}
                              for j in range(16)]
                        + [{"employee_id": 400, "employee_type": "bp"}]),
        ],
        "rso_performance": [
            {"id": 999, "name": "Unassigned RSO", "target": 300, "achievement": 150,
             "remaining": 150, "projection": 250, "yesterday_activation": 2,
             "month_total_activation": 20, "market_yesterday": 4,
             "market_activation": 60},
        ],
        "bp_performance": [
            {"id": 998, "name": "Unassigned BP", "target": 200, "achievement": 80,
             "remaining": 120, "projection": 150, "yesterday_activation": 1,
             "month_total_activation": 12},
        ],
    }
    rows, total = _supervisor_rows(dashboard, 14, 17)

    font_size = _uniform_font_size(dashboard, rows, total, [], None, [], None, inner)
    assert FONT_MIN <= font_size <= FONT_MAX
    font = load_font(font_size, True)

    weights = content_weights(SUPERVISOR_LABELS, rows, font, font, (),
                              total_row=total, total_span=2)
    widths = fit_widths(weights, inner)

    all_rows = rows + [total]
    for ci, label in enumerate(SUPERVISOR_LABELS):
        texts = [label] + [str(r[ci] if ci < len(r) else "") for r in all_rows]
        if ci == 0:                     # the total label is merged across #, Name
            needed = max(font.getlength(t) for t in texts)
            available = sum(widths[:2])
        elif ci < 2 and total:          # covered by the merged total cell
            continue
        else:
            needed = max(font.getlength(t) for t in texts)
            available = widths[ci]
        assert available >= needed, (
            f"{orientation} column {label!r} would ellipsize "
            f"({available:.0f}px available, {needed:.0f}px needed)")
