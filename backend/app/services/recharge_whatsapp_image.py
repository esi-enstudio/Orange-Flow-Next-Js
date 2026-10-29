"""Recharge Report image builder for WhatsApp/Telegram delivery.

Renders the current month's Recharge Dashboard (/reports/recharge) as a PNG image
in the same simple, print-friendly style as the GA Live and Activation report
images: a plain header with one highlighted metric box, a single-row house
summary table, and one plain bordered table each for supervisors and RSOs.

The report is laid out on one or more A4 landscape pages: the first page carries
the header, the single-row house summary and then the supervisor and RSO tables,
flowing top to bottom. A4 landscape is the *maximum* page size — a page whose
content does not fill it shrinks to the content height, so a small house yields
a short image instead of one with a large white void. A house with many members
spills onto extra pages, with each table repeating its header on the
continuation page.

Business rules mirror the dashboard page:
    * Status    -> projectionStatus(achievement %, projection %) identity with
                   the page (achieved / on track / needs attention / behind)
    * DRR       -> ceil(remaining / days_remaining), like the page table
    * D.Avg     -> service-computed daily average (achievement / elapsed days)
    * Proj      -> service-computed month-end projection (summed in the total
                   row, like the page's Subtotal row)
    * Proj %    -> projection / target, the value the page status is based on
    * Trans     -> unique retailers transacted yesterday (page's Trans Count)
    * Daily Req -> remaining / remaining working days (Fridays excluded)
    * Rows      -> already ranked by achievement % by RechargeReportService
"""
import io
import math
from datetime import date

from PIL import Image, ImageDraw
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# We deliberately generate large (multi-thousand pixel) report images at
# RENDER_SCALE below - the size is intended, not a decompression bomb.
Image.MAX_IMAGE_PIXELS = None

from app.models.house import House
from app.services.recharge_report_service import RechargeReportService
from app.services.report_image_kit import (
    HDR_BAND_H,
    HDR_BOX_LABEL_F,
    HDR_BOX_VALUE_F,
    HDR_META_F,
    HDR_TITLE_F,
    INK,
    REPORT_BG,
    SECTION_TITLE_H,
    TOTAL_BG,
    TOTAL_INK,
    RenderScale,
    ScaledDraw,
    content_weights,
    draw_section_title,
    draw_table,
    ellipsize,
    header_scale,
    hugging_page_height,
    load_font,
    pct_2dp,
    render_section,
    table_height,
    table_heights,
)
from app.utils.timezone import now_naive

# ── Layout ──
# A4 landscape pages: width 1750 design units — the shared WhatsApp landscape
# sheet width (the A4-landscape 1600 plus a 150-unit strip, matching the
# Activation landscape image) — and max height = width * 210/297 so a full page
# keeps the exact A4 landscape ratio. Header + house summary lead the first
# page, then the supervisor and RSO tables flow top to bottom, splitting onto
# extra pages when a house has many members; a page whose content does not fill
# A4 shrinks to the content height.
IMG_W = 1750
PAGE_PAD = 0             # no page margin — content is padded by CARD_PAD
CARD_PAD = 10            # inner padding of the page content
INNER = IMG_W - 2 * PAGE_PAD - 2 * CARD_PAD  # content width
GAP = 8                  # minimum gap between sections
# Header band height, scaled from the kit's standard 800-wide header block
# (header_scale(IMG_W) ~ 1.48 here) so the header keeps its standard size
# without dominating the wider sheet.
HDR_H = round(HDR_BAND_H * header_scale(IMG_W))

# ── A4 pagination ──
A4_SHORT_MM = 210
A4_LONG_MM = 297
PAGE_W = IMG_W
PAGE_H = round(IMG_W * A4_SHORT_MM / A4_LONG_MM)  # ≈ 1237 → exact A4 landscape
FOOTER_H = 16            # reserved band for the "Page n/N" footer
CONTENT_H = PAGE_H - 2 * CARD_PAD - FOOTER_H

# ── Fonts ──
# The A4 landscape canvas is wide enough that the shared kit's table text (11pt)
# reads small once the image is scaled onto a phone, so this report uses larger
# table text and headings. Overrides apply to this report only.
TABLE_FONT = 18          # table header + body cell text
SECTION_TITLE_FONT_SIZE = 20

# ── Native high-resolution rendering ──
# All layout math stays in the IMG_W-wide design space; ScaledDraw renders every
# coordinate and font natively at RENDER_SCALE so text stays crisp when zoomed.
# Each A4-landscape page is wider than the portrait siblings (IMG_W = 1750),
# so a scale-4 page is 7000x4948px — light on disk (~1MB PNG) because the tables
# are mostly white, keeping WhatsApp sends and PDF conversion fast.
RENDER_SCALE = 4

_scale = RenderScale(RENDER_SCALE)


def _active_scale() -> int:
    return _scale.active()


# ── Report variants ──
# The dashboard's report-type toggle switches which target the report measures:
# the plain Recharge report uses the house's total recharge target, while the EV
# Secondary report uses the EV C2C target. RechargeReportService already applies
# that variant to the summary and to every RSO/supervisor row, so the image only
# needs to pass it through and label itself accordingly.
REPORT_TYPES = {
    "recharge": {
        "title": "Recharge Report",
        "service_report_type": "recharge",
    },
    "recharge_ev_secondary": {
        "title": "EV Secondary Report",
        "service_report_type": "ev_secondary",
    },
}

# ── Section column sets ──
# The supervisor and RSO tables share one column shape covering every metric the
# dashboard table shows beyond the targets (DRR, D.Avg, Proj, Proj %,
# Yest C2C/C2S, Trans Count), so the image lines up with the page.
HOUSE_LABELS = ["Target", "Ach", "%", "Remain", "Daily Req", "Daily Avg",
                "Projection", "Proj %", "Status"]
SUPERVISOR_LABELS = ["#", "Supervisor Name", "Pool No", "Target", "Ach", "%", "Remain",
                     "DRR", "D.Avg", "Proj", "Proj %", "Yest C2C", "Yest C2S",
                     "Trans Count", "Status"]
RSO_LABELS = ["#", "RSO Name", "ITop No", "Target", "Ach", "%", "Remain",
              "DRR", "D.Avg", "Proj", "Proj %", "Yest C2C", "Yest C2S",
              "Trans Count", "Status"]


# ── Status rules (mirror projectionStatus in page.tsx) ──
STATUS_LABELS = {
    "achieved": "Achieved",
    "on_track": "On Track",
    "needs_attention": "Needs Attention",
    "behind": "Behind",
}

# One colour per status so the Status column reads at a glance (green = achieved,
# blue = on track, amber = needs attention, red = behind).
STATUS_COLORS = {
    "Achieved": "#08773D",
    "On Track": "#1D6FD6",
    "Needs Attention": "#C77700",
    "Behind": "#C0392B",
}


def _projection_status(ach_pct: float, proj_pct: float) -> str:
    if ach_pct >= 100:
        return "achieved"
    if proj_pct >= 100:
        return "on_track"
    if proj_pct >= 95:
        return "needs_attention"
    return "behind"


def _status_label(ach_pct: float, proj_pct: float) -> str:
    return STATUS_LABELS[_projection_status(ach_pct, proj_pct)]


# ── Data prep ──
def _fmt(value) -> str:
    """Whole-number display: every amount/count is rounded to an integer.

    The recharge report shows counts and taka amounts, so a decimal (e.g.
    "1,234.5") is never desirable - ``fmt_num`` keeps one decimal for other
    reports, this report rounds amounts away. Percentage columns are the one
    exception and keep their two-decimal form via ``pct_2dp``.
    """
    try:
        return f"{int(round(float(value))):,}"
    except (TypeError, ValueError):
        return "0"


def _drr(remaining: float, days_remaining: int) -> str:
    """Daily required run rate: what each remaining working day must deliver."""
    if remaining <= 0:
        return "0"
    return _fmt(math.ceil(remaining / max(days_remaining, 1)))


def _metrics(item: dict) -> tuple[float, float, float, float, float]:
    """(target, achievement, achievement %, projection, projection %)."""
    target = float(item.get("target") or 0)
    ach = float(item.get("achievement") or 0)
    proj = float(item.get("projection") or 0)
    ach_pct = round(ach / target * 100, 1) if target else 0
    proj_pct = round(proj / target * 100) if target else 0
    return target, ach, ach_pct, proj, proj_pct


def _remaining(item: dict) -> float:
    return max(0.0, float(item.get("remaining") or 0))


# ── Header ──
def _render_header(draw, x, y, house_name, house_code, summary, today: date,
                   report_title: str) -> int:
    # Standard header block scaled from the 800-wide reference (~1.48x on this
    # 1750-wide sheet) so the header keeps its standard size everywhere.
    s = header_scale(IMG_W)
    x1 = x + INNER
    pad_x = round(16 * s)
    date_str = today.strftime("%d %B %Y")
    time_str = now_naive().strftime("%I:%M %p").lstrip("0").replace(" 0", " ")

    # metric box (right) — measured first so the brand text can be kept clear of it
    lbl = "Yesterday C2C"
    val = _fmt(summary.get("yesterday_achievement") or 0)
    fl = load_font(round(HDR_BOX_LABEL_F * s), True)
    fv = load_font(round(HDR_BOX_VALUE_F * s), True)
    box_w = max(draw.textlength(lbl, font=fl), draw.textlength(val, font=fv)) + round(40 * s)
    box_w = max(box_w, round(200 * s))
    box_h = round(80 * s)
    bx = x1 - pad_x - box_w
    by = y + (HDR_H - box_h) // 2

    # brand (left) — text column, vertically centred
    tx = x + pad_x
    brand_max = bx - tx - round(10 * s)  # keep clear of the metric box

    draw.text((tx, y + round(50 * s)), report_title,
              font=load_font(round(HDR_TITLE_F * s), True),
              fill=INK, anchor="ls")
    f_meta = load_font(round(HDR_META_F * s), True)
    draw.text((tx, y + round(74 * s)), ellipsize(
        draw, f"House: {house_name or ''} ({house_code or ''})", f_meta, brand_max),
        font=f_meta, fill=INK, anchor="lm")
    draw.text((tx, y + round(94 * s)), f"Generated: {date_str}, {time_str}",
              font=f_meta, fill=INK, anchor="lm")

    draw.rounded_rectangle([bx, by, bx + box_w, by + box_h], radius=round(9 * s),
                           fill=TOTAL_BG, outline=TOTAL_INK, width=round(2 * s))
    draw.text((bx + box_w / 2, by + round(17 * s)), lbl, font=fl, fill=TOTAL_INK, anchor="mm")
    draw.text((bx + box_w / 2, by + round(52 * s)), val, font=fv, fill=TOTAL_INK, anchor="mm")
    return y + HDR_H


# ── Sections ──
def _render_house_summary(draw, x, y, w, summary) -> int:
    """House summary: plain title + a single-row metric table."""
    f_head = load_font(TABLE_FONT, True)
    f_cell = load_font(TABLE_FONT, True)
    target = float(summary.get("monthly_target") or 0)
    achievement = float(summary.get("achievement") or 0)
    projection = float(summary.get("projection") or 0)
    # House-level status uses the same projection rule as the dashboard card and
    # the supervisor/RSO tables.
    ach_pct = round(achievement / target * 100, 1) if target else 0
    proj_pct = round(projection / target * 100) if target else 0
    values = [
        _fmt(target),
        _fmt(achievement),
        pct_2dp(achievement, target),
        _fmt(summary.get("remaining") or 0),
        _fmt(summary.get("daily_required") or 0),
        _fmt(summary.get("daily_average") or 0),
        _fmt(projection),
        pct_2dp(projection, target),
        _status_label(ach_pct, proj_pct),
    ]
    # Evenly split metric cells (no left-aligned name column), mirroring the
    # summary grid in the HTML dashboard.
    return render_section(draw, x, y, w, "HOUSE SUMMARY", HOUSE_LABELS, [values],
                          weights=[1] * len(HOUSE_LABELS), left_cols=(),
                          f_head=f_head, f_cell=f_cell,
                          cell_color_map={len(HOUSE_LABELS) - 1: STATUS_COLORS},
                          title_font_size=SECTION_TITLE_FONT_SIZE)


def _supervisor_rows(supervisors: list[dict], days_remaining: int):
    """Rows + total for the SUPERVISOR PERFORMANCE table."""
    rows = []
    tot = {"target": 0.0, "ach": 0.0, "remain": 0.0, "davg": 0.0, "proj": 0.0,
           "c2c": 0.0, "c2s": 0.0, "txn": 0}
    for i, sup in enumerate(supervisors):
        target, ach, ach_pct, proj, proj_pct = _metrics(sup)
        remain = _remaining(sup)
        daily_avg = float(sup.get("daily_average") or 0)
        yest_c2c = float(sup.get("yesterday_c2c") or 0)
        yest_c2s = float(sup.get("yesterday_c2s") or 0)
        # Unique retailers the supervisor's team transacted C2C with yesterday.
        yest_txn = int(sup.get("yesterday_transaction_count") or 0)
        rows.append([
            str(i + 1), str(sup.get("name") or ""),
            str(sup.get("pool_number") or sup.get("dms_code") or "-"),
            _fmt(target), _fmt(ach), pct_2dp(ach, target),
            _fmt(remain), _drr(remain, days_remaining),
            _fmt(daily_avg), _fmt(proj), pct_2dp(proj, target),
            _fmt(yest_c2c), _fmt(yest_c2s), _fmt(yest_txn),
            _status_label(ach_pct, proj_pct),
        ])
        tot["target"] += target
        tot["ach"] += ach
        tot["remain"] += remain
        tot["davg"] += daily_avg
        tot["proj"] += proj
        tot["c2c"] += yest_c2c
        tot["c2s"] += yest_c2s
        tot["txn"] += yest_txn

    if not rows:
        return [], None

    total_row = [
        f"Total ({len(rows)} Supervisor)", "", "",
        _fmt(tot["target"]), _fmt(tot["ach"]), pct_2dp(tot["ach"], tot["target"]),
        _fmt(tot["remain"]), _drr(tot["remain"], days_remaining),
        _fmt(tot["davg"]), _fmt(tot["proj"]),
        pct_2dp(tot["proj"], tot["target"]),
        _fmt(tot["c2c"]), _fmt(tot["c2s"]), _fmt(tot["txn"]), "",
    ]
    return rows, total_row


def _rso_rows(rsos: list[dict], days_remaining: int):
    """Rows + total for the RSO PERFORMANCE table."""
    rows = []
    tot = {"target": 0.0, "ach": 0.0, "remain": 0.0, "davg": 0.0, "proj": 0.0,
           "c2c": 0.0, "c2s": 0.0, "txn": 0}
    for i, r in enumerate(rsos):
        target, ach, ach_pct, proj, proj_pct = _metrics(r)
        remain = _remaining(r)
        daily_avg = float(r.get("daily_average") or 0)
        yest_c2c = float(r.get("yesterday_c2c") or 0)
        yest_c2s = float(r.get("yesterday_c2s") or 0)
        # Unique retailers the RSO transacted C2C with yesterday.
        yest_txn = int(r.get("yesterday_transaction_count") or 0)
        rows.append([
            str(i + 1), str(r.get("name") or ""),
            str(r.get("itop_number") or r.get("dms_code") or "-"),
            _fmt(target), _fmt(ach), pct_2dp(ach, target),
            _fmt(remain), _drr(remain, days_remaining),
            _fmt(daily_avg), _fmt(proj), pct_2dp(proj, target),
            _fmt(yest_c2c), _fmt(yest_c2s), _fmt(yest_txn),
            _status_label(ach_pct, proj_pct),
        ])
        tot["target"] += target
        tot["ach"] += ach
        tot["remain"] += remain
        tot["davg"] += daily_avg
        tot["proj"] += proj
        tot["c2c"] += yest_c2c
        tot["c2s"] += yest_c2s
        tot["txn"] += yest_txn

    if not rows:
        return [], None

    total_row = [
        f"Total ({len(rows)} RSO)", "", "",
        _fmt(tot["target"]), _fmt(tot["ach"]), pct_2dp(tot["ach"], tot["target"]),
        _fmt(tot["remain"]), _drr(tot["remain"], days_remaining),
        _fmt(tot["davg"]), _fmt(tot["proj"]),
        pct_2dp(tot["proj"], tot["target"]),
        _fmt(tot["c2c"]), _fmt(tot["c2s"]), _fmt(tot["txn"]), "",
    ]
    return rows, total_row


# ── A4 pagination ──
# A draw-op is a (kind, payload) tuple placed top to bottom on a page. Tables are
# split into row chunks so a long RSO list continues on the next A4 sheet with
# its header repeated.
def _paginate(sup_rows, sup_total, rso_rows, rso_total):
    """Plan the report onto A4 landscape pages.

    Returns ``(pages, heights, f_head, f_cell, hh, rh)`` where ``pages`` is a
    list of pages, each a top-to-bottom-ordered list of draw-ops, and
    ``heights`` is the used content height of every page (A4 height is the
    maximum — a page whose content does not fill it shrinks to this height
    instead of leaving a void).
    """
    f_head = load_font(TABLE_FONT, True)
    f_cell = load_font(TABLE_FONT, True)
    hh, rh = table_heights(f_head, f_cell)

    pages: list[list] = []
    heights: list[int] = []
    page: list = []
    used = 0

    def new_page():
        nonlocal page, used
        pages.append(page)
        heights.append(used)
        page = []
        used = 0

    def space() -> int:
        return CONTENT_H - used - (GAP if used else 0)

    def put(h, op):
        nonlocal used
        if page:
            used += GAP
        page.append(op)
        used += h

    # Header + house summary always lead the first page and never split.
    put(HDR_H, ("header",))
    put(SECTION_TITLE_H + table_height(1, f_head, f_cell), ("summary",))

    tables = (
        ("SUPERVISOR PERFORMANCE", SUPERVISOR_LABELS, sup_rows, sup_total),
        ("RSO PERFORMANCE", RSO_LABELS, rso_rows, rso_total),
    )
    for title, labels, rows, total_row in tables:
        if not rows:
            continue
        # Column widths sized from the table's own content (labels, every value
        # and the total row), computed once for the whole table so every
        # continuation page keeps identical column widths. The "%" column is
        # floored to "100.00%" so the two-decimal percentages never clip.
        weights = content_weights(labels, rows, f_head, f_cell, (), max_total=INNER,
                                  total_row=total_row, total_span=3)
        base = SECTION_TITLE_H + hh
        idx = 0
        chunk_no = 0
        while idx < len(rows):
            avail = space()
            if avail < base + rh:
                new_page()
                avail = space()
            remaining = len(rows) - idx
            take = max(1, min(int((avail - base) // rh), remaining))
            # Keep the total row on the final chunk; drop a body row to make room.
            if take == remaining and total_row is not None:
                if base + rh * remaining + rh > avail:
                    take = remaining - 1
                    if take < 1:
                        new_page()
                        avail = space()
                        take = max(1, min(int((avail - base) // rh), remaining))
            is_last = (idx + take) >= len(rows)
            chunk = rows[idx:idx + take]
            tro = total_row if (is_last and total_row is not None) else None
            label = title if chunk_no == 0 else f"{title} (contd.)"
            put(base + rh * len(chunk) + (rh if tro else 0),
                ("table", label, labels, chunk, tro, weights))
            idx += take
            chunk_no += 1
            if idx < len(rows):
                new_page()

    pages.append(page)
    heights.append(used)
    return pages, heights, f_head, f_cell, hh, rh


# ── Render ──
def _render_image(house_name: str, house_code: str, dashboard: dict, today: date,
                  report_title: str) -> list[bytes]:
    """Render the report as one PNG per page (A4 landscape height cap; a page
    that does not fill its A4 sheet shrinks to its content height)."""
    summary = dashboard.get("summary") or {}
    days_remaining = int(summary.get("days_remaining") or 0)

    sup_rows, sup_total = _supervisor_rows(dashboard.get("supervisor_performance") or [],
                                           days_remaining)
    rso_rows, rso_total = _rso_rows(dashboard.get("rso_performance") or [], days_remaining)

    pages, heights, f_head, f_cell, hh, rh = _paginate(
        sup_rows, sup_total, rso_rows, rso_total)

    s = _active_scale()
    cx = PAGE_PAD + CARD_PAD
    total_pages = len(pages)
    out: list[bytes] = []
    for page_no, ops in enumerate(pages):
        # A4 landscape height is the cap; a page whose content does not fill it
        # (usually the only/last page of a small house) shrinks to the content
        # height instead of leaving a large white void below.
        footer = FOOTER_H if total_pages > 1 else 0
        canvas_h = hugging_page_height(
            heights[page_no], page_h=PAGE_H, content_h=CONTENT_H, row_h=rh,
            pad=CARD_PAD, footer_h=footer)
        img = Image.new("RGB", (PAGE_W * s, canvas_h * s), REPORT_BG)
        draw = ScaledDraw(ImageDraw.Draw(img), _scale)
        y = PAGE_PAD + CARD_PAD
        for op in ops:
            kind = op[0]
            if kind == "header":
                y = _render_header(draw, cx, y, house_name, house_code, summary, today,
                                   report_title)
            elif kind == "summary":
                y = _render_house_summary(draw, cx, y, INNER, summary)
            else:  # table chunk
                _, title, labels, chunk, tro, weights = op
                y = draw_section_title(draw, cx, y, title,
                                       font_size=SECTION_TITLE_FONT_SIZE)
                draw_table(draw, cx, y, INNER, labels, chunk, weights=weights,
                           left_cols=[1], total_row=tro, total_span=3,
                           f_head=f_head, f_cell=f_cell,
                           cell_color_map={len(labels) - 1: STATUS_COLORS})
                y += hh + rh * (len(chunk) + (1 if tro else 0))
            y += GAP
        if total_pages > 1:
            draw.text((cx + INNER, canvas_h - CARD_PAD), f"Page {page_no + 1}/{total_pages}",
                      font=load_font(11, True), fill=INK, anchor="rs")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        out.append(buf.getvalue())
    return out


async def _build(db: AsyncSession, house_id: int, report_type: str,
                 scale: int | None, *, month: int | None = None,
                 year: int | None = None) -> list[bytes]:
    """Build the report image for one report-type variant.

    ``month`` / ``year`` render an explicit month (e.g. what the report page is
    printing); without them the current month is rendered.
    """
    variant = REPORT_TYPES[report_type]
    today = now_naive().date()
    svc = RechargeReportService(db, house_id, int(month or today.month),
                                int(year or today.year),
                                variant["service_report_type"])
    dashboard = {
        "summary": await svc.get_summary(),
        "rso_performance": await svc.get_rso_performance(),
        "supervisor_performance": await svc.get_supervisor_performance(),
    }

    result = await db.execute(select(House).where(House.id == house_id))
    house = result.scalar_one_or_none()
    house_name = (house.name or "") if house else "Unknown"
    house_code = (house.code or "") if house else ""

    if scale is None:
        return _render_image(house_name, house_code, dashboard, today, variant["title"])
    with _scale.temp(scale):
        return _render_image(house_name, house_code, dashboard, today, variant["title"])


async def build_recharge_report_image(
    db: AsyncSession, house_id: int, scale: int | None = None,
    *, month: int | None = None, year: int | None = None,
) -> list[bytes]:
    """Total-recharge variant of the Recharge Report (report_type `recharge`).

    Returns one PNG per page (A4 landscape is the size cap; a page whose content
    does not fill it hugs its content). ``scale`` overrides the default
    RENDER_SCALE - used for fast, reduced-size preview renders. ``None`` produces
    the full-resolution send-quality images. ``month`` / ``year`` render an
    explicit month; without them the current month is rendered.
    """
    return await _build(db, house_id, "recharge", scale, month=month, year=year)


async def build_recharge_ev_report_image(
    db: AsyncSession, house_id: int, scale: int | None = None,
    *, month: int | None = None, year: int | None = None,
) -> list[bytes]:
    """EV C2C variant of the Recharge Report (report_type `recharge_ev_secondary`)."""
    return await _build(db, house_id, "recharge_ev_secondary", scale,
                        month=month, year=year)
