"""Activation Report image (WhatsApp delivery): the HOUSE SUMMARY Status column
and the RSO table's Day column.

House Status — the house row carries the same projection status as the
dashboard's Target vs Achievement card and the supervisor/RSO/BP tables.
"Needs Attention" is far wider than the metric columns, so the house row is
sized from its own content and the shared font check reads those same widths:
adding the column must never ellipsize a cell.

RSO Day — how many days this month the RSO's assisted retailer code activated
(`active_days` from ActivationReportService), shown between the own-activation
pair (Yest Own / Tot) and the market pair (Yest Mkt / Tot), exactly like the
BP table's Day Count. The extra column must also keep every cell intact.
"""
import pytest

from app.services.activation_whatsapp_image import (
    CARD_PAD,
    FONT_MAX,
    FONT_MIN,
    HOUSE_LABELS,
    ORIENTATIONS,
    PAGE_PAD,
    RSO_LABELS,
    _house_values,
    _rso_rows,
    _uniform_font_size,
)
from app.services.report_image_kit import content_weights, fit_widths, load_font

TODAY_SUMMARY = {
    "days_remaining": 9,
    "days_elapsed": 21,
    "monthly_target": 12000,
    "achievement": 8400,
    "remaining": 3600,
    "daily_required": 120,
    "daily_average": 280,
    "projection": 11700,
}


def _rso(i: int, active_days: int | None = None) -> dict:
    rso = {
        "id": 1000 + i,
        "name": f"RSO Person {i}",
        "itop_number": f"19157{i:05d}",
        "target": 140 + i,
        "achievement": 100 + i,
        "remaining": 40,
        "projection": 135 + i,
        "daily_average": 4,
        "daily_required": 2,
        "yesterday_activation": i % 7,
        "month_total_activation": 100 + i,
        "market_yesterday": i % 5,
        "market_activation": 80 + i,
    }
    if active_days is not None:
        rso["active_days"] = active_days
    return rso


def _bp(i: int) -> dict:
    return {
        "id": 2000 + i,
        "name": f"BP Person {i}",
        "pool_number": f"0178{i:05d}",
        "target": 140 + i,
        "achievement": 90 + i,
        "remaining": 50,
        "projection": 132 + i,
        "daily_average": 3,
        "daily_required": 2,
        "yesterday_activation": i % 6,
        "active_days": 10 + i % 15,
    }


def _supervisor(i: int) -> dict:
    return {
        "name": f"Supervisor {i}",
        "pool_number": f"0179{i:05d}",
        "target": 900,
        "achievement": 600,
        "remaining": 300,
        "projection": 850,
        "daily_average": 22,
        "daily_required": 11,
        "own_yesterday": 2 + i,
        "own_month": 30 + i,
        "market_yesterday": 4 + i,
        "market_month": 60 + i,
        "team": [{"employee_id": 1, "employee_type": "rso"},
                 {"employee_id": 2, "employee_type": "bp"}],
    }


def _dashboard(summary: dict, rsos: list[dict] | None = None) -> dict:
    return {
        "summary": summary,
        "supervisor_performance": [_supervisor(1), _supervisor(2)],
        "rso_performance": [_rso(i, 10 + i % 15) for i in range(6)] if rsos is None else rsos,
        "bp_performance": [_bp(i) for i in range(5)],
    }


# ── HOUSE SUMMARY: Status column ──
def test_house_row_has_one_value_per_label():
    values = _house_values(TODAY_SUMMARY)
    assert len(values) == len(HOUSE_LABELS)
    assert HOUSE_LABELS[-1] == "Status"
    assert values[:8] == ["12,000", "8,400", "70.00%", "3,600", "120", "280",
                          "11,700", "97.50%"]


@pytest.mark.parametrize(
    "achievement, projection, expected",
    [
        (12500, 12500, "Achieved"),       # achievement at/over target
        (8400, 12100, "On Track"),        # projection at/over target
        (8400, 11700, "Needs Attention"),  # projection just short of target
        (5000, 7000, "Behind"),
        (0, 0, "Behind"),                 # no target yet — same as the page
    ],
)
def test_house_status_matches_the_dashboard_rule(achievement, projection, expected):
    summary = dict(TODAY_SUMMARY, achievement=achievement, projection=projection)
    assert _house_values(summary)[-1] == expected


# ── RSO PERFORMANCE: Day column ──
def test_rso_day_column_sits_after_the_own_activation_pair():
    assert RSO_LABELS[RSO_LABELS.index("Yest Own"):RSO_LABELS.index("Yest Own") + 3] == \
        ["Yest Own", "Tot", "Day"]


def test_rso_day_column_shows_the_assisted_code_active_days():
    rsos = [_rso(0, active_days=17), _rso(1, active_days=3)]
    rows, total = _rso_rows(rsos, 9, 21)
    day = RSO_LABELS.index("Day")
    assert all(len(row) == len(RSO_LABELS) for row in rows)
    assert len(total) == len(RSO_LABELS)
    by_name = {row[1]: row[day] for row in rows}
    assert by_name == {"RSO Person 0": "17", "RSO Person 1": "3"}
    assert total[day] == "20"


def test_rso_day_column_is_zero_without_an_assisted_code():
    """RSOs with no assisted code (no active_days in the payload) show 0."""
    rows, total = _rso_rows([_rso(0), _rso(1)], 9, 21)
    day = RSO_LABELS.index("Day")
    assert [row[day] for row in rows] == ["0", "0"]
    assert total[day] == "0"


# ── No cell may be ellipsized on either column ──
@pytest.mark.parametrize("orientation", sorted(ORIENTATIONS))
@pytest.mark.parametrize(
    "summary",
    [
        TODAY_SUMMARY,
        dict(TODAY_SUMMARY, monthly_target=1234567, achievement=1234567,
             projection=1234567, remaining=0),   # widest numbers, status "Achieved"
        dict(TODAY_SUMMARY, monthly_target=999999, achievement=1,
             projection=1),                      # status "Behind"
        {},                                      # no target data at all
    ],
)
def test_no_house_cell_is_ellipsized(orientation, summary):
    """The Status text (and every metric) must render in full at the shared font."""
    inner = ORIENTATIONS[orientation] - 2 * PAGE_PAD - 2 * CARD_PAD

    font_size = _uniform_font_size(
        _dashboard(summary),
        [], None, [], None, [], None,   # house row only: isolates its own fit
        inner,
    )
    assert FONT_MIN <= font_size <= FONT_MAX
    font = load_font(font_size, True)

    values = _house_values(summary)
    widths = fit_widths(content_weights(HOUSE_LABELS, [values], font, font, ()), inner)
    for ci, (label, value) in enumerate(zip(HOUSE_LABELS, values)):
        needed = max(font.getlength(label), font.getlength(value))
        assert widths[ci] >= needed, (
            f"{orientation} column {label!r} would ellipsize {value!r} "
            f"({widths[ci]:.0f}px available, {needed:.0f}px needed)")


@pytest.mark.parametrize("orientation", sorted(ORIENTATIONS))
def test_no_rso_cell_is_ellipsized_with_the_day_column(orientation):
    """The Day column must fit alongside the 15 existing RSO columns."""
    inner = ORIENTATIONS[orientation] - 2 * PAGE_PAD - 2 * CARD_PAD
    dashboard = _dashboard(TODAY_SUMMARY, rsos=[_rso(i, 10 + i) for i in range(40)])
    rows, total = _rso_rows(dashboard["rso_performance"], 9, 21)

    font_size = _uniform_font_size(dashboard, [], None, rows, total, [], None, inner)
    assert FONT_MIN <= font_size <= FONT_MAX
    font = load_font(font_size, True)

    weights = content_weights(RSO_LABELS, rows, font, font, (),
                              total_row=total, total_span=3)
    # Only the free-text name column may give way (down to its documented floor).
    overflow = sum(weights) - inner
    if overflow > 0:
        weights[1] = max(130, weights[1] - overflow)
    widths = fit_widths(weights, inner)

    all_rows = rows + [total]
    for ci, label in enumerate(RSO_LABELS):
        texts = [label] + [str(r[ci] if ci < len(r) else "") for r in all_rows]
        if ci == 0:                     # the total label is merged across #, Name, ITop
            needed = max(font.getlength(t) for t in texts)
            available = sum(widths[:3])
        elif ci < 3 and total:          # covered by the merged total cell
            continue
        else:
            needed = max(font.getlength(t) for t in texts)
            available = widths[ci]
        assert available >= needed, (
            f"{orientation} column {label!r} would ellipsize "
            f"({available:.0f}px available, {needed:.0f}px needed)")
