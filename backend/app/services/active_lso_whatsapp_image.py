"""Active LSO Report image builder for WhatsApp/Telegram delivery.

Renders the current month's Active LSO Report (/reports/active-lso) as PNG
images mirroring the page: a header carrying the house, period and a
highlighted count of the retailers active yesterday, then three tables flowing
top to bottom —

    * HOUSE SUMMARY — one highlighted row with the house's RSO / retailer
      counts and Target vs Achievement metrics;
    * SUPERVISOR SUMMARY — one row per supervisor (serial number, name, RSO /
      retailer counts and metrics), mirroring the page's Section C;
    * RSO TARGET VS ACHIEVEMENT · RETAILER COUNT — one row per RSO (serial
      number, name, supervisor, the Target vs Achievement metric columns and
      the Retailer Count buckets: Retailers, one column per distinct-C2S-day
      bucket, Days No Sales, Inactive Last Month, Reactivated), ending in a
      grand total row. The two column groups sit under a grouped header band,
      exactly like the page table's two-tier header.

Every table picks the largest font that fits the page width: columns are sized
from their own content (labels, values and total row) and the whole table fits
with every cell fully visible. Only when the data is too wide for full display
(the 23-column RSO table of a house with long names) do the flexible name
columns give way — so a table with fewer columns renders its text bigger while
every number / status / bucket column stays fully legible without clipping.

Every page stays inside an exact A4 landscape sheet: the page width is the
shared WhatsApp landscape sheet width (1750 design units — the A4-landscape 1600
plus a 150-unit strip) and the height is capped at the matching A4 landscape
ratio (width * 210/297) — a page packed to full keeps the exact A4 ratio, while
a page whose content does not fill it shrinks to its content height instead of
leaving a white void. A house with many rows spills onto extra pages, repeating
the (grouped) table header on every continuation page.

Business rules mirror the dashboard page:
    * Target   -> rso_targets.lso_target_modified (fallback: rso_targets.lso)
    * Ach      -> retailers that qualify as Active LSO for the month
    * %        -> Ach / Target, the value the page status is based on
    * Remain   -> Target - Ach (signed: negative when over-achieved)
    * DRR      -> ceil(remaining / days_remaining), signed the same way
    * Active   -> configured threshold: N+ distinct C2S days AND M+ BDT
    * YesterdayActive -> retailers of this report's RSOs with any C2S activity
                         yesterday
    * Buckets  -> day_{n}: non-active retailers with n distinct C2S days;
                  Days No Sales: day threshold met, amount threshold missed;
                  Inactive Last Month / Reactivated: compared against last month
"""
import io
from contextlib import contextmanager
from datetime import date, datetime, timedelta

from PIL import Image, ImageDraw
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# We deliberately generate large (multi-thousand pixel) report images at
# RENDER_SCALE below - the size is intended, not a decompression bomb.
Image.MAX_IMAGE_PIXELS = None

from app.models.house import House
from app.services.active_lso_report_service import ActiveLsoReportService
from app.services.report_image_kit import (
    HDR_BAND_H,
    HDR_BOX_LABEL_F,
    HDR_BOX_VALUE_F,
    HDR_META_F,
    HDR_TITLE_F,
    INK,
    REPORT_BG,
    SECTION_TITLE_H,
    TD_BORDER,
    TH_BG,
    TH_INK,
    RenderScale,
    ScaledDraw,
    content_weights,
    draw_section_title,
    draw_table,
    ellipsize,
    fit_widths,
    fmt_num,
    header_scale,
    hugging_page_height,
    load_font,
    pct_2dp,
    table_heights,
)
from app.utils.timezone import now_naive

# ── Layout ──
# A4 landscape pages: width 1750 design units — the shared WhatsApp landscape
# sheet width (the A4-landscape 1600 plus a 150-unit strip, same geometry as the
# Recharge report image) — height = width * 210/297 so a full page keeps the
# exact A4 landscape ratio. Header + threshold note lead the first page, then
# the house / supervisor / RSO tables flow top to bottom, splitting onto extra
# pages when a table has many rows; a page whose content does not fill its A4
# sheet shrinks to the content height, never beyond the sheet.
IMG_W = 1750
PAGE_PAD = 0             # no page margin — content is padded by CARD_PAD
CARD_PAD = 10            # inner padding of the page content
INNER = IMG_W - 2 * PAGE_PAD - 2 * CARD_PAD  # content width
# Table fonts are sized against the former 1600-wide sheet's content width, so
# the wider 1750 sheet never inflates the text — the same fitted font numbers
# render slightly smaller here, while the drawn tables still stretch to the
# full INNER width.
PROBE_INNER = 1600 - 2 * PAGE_PAD - 2 * CARD_PAD  # 1580
GAP = 8                  # minimum gap between sections
# Header band height, scaled from the kit's standard 800-wide header block
# (header_scale(IMG_W) ~ 1.48 here) so the header keeps its standard size
# without dominating the wider sheet.
HDR_H = round(HDR_BAND_H * header_scale(IMG_W))
NOTE_H = 18              # caption line under the header (Active threshold)

# ── A4 pagination ──
A4_SHORT_MM = 210
A4_LONG_MM = 297
PAGE_W = IMG_W
PAGE_H = round(IMG_W * A4_SHORT_MM / A4_LONG_MM)  # ≈1237 → exact A4 landscape
FOOTER_H = 16            # reserved band for the "Page n/N" footer
CONTENT_H = PAGE_H - 2 * CARD_PAD - FOOTER_H

# ── Fonts ──
# Every table picks the largest font from FONT_MIN..FONT_MAX at which its
# content-sized columns fit the page width with every cell visible; only when
# the data is too wide for that (the 23-column RSO table with very long names)
# do the customarily-flexible name columns give way, each keeping at least
# NAME_MIN_W so names stay readable. The native RENDER_SCALE keeps everything
# crisp.
FONT_MAX = 15            # largest table font tried
FONT_MIN = 11            # smallest table font (used when a table is very wide)
NAME_MIN_W = 120         # flexible name columns never shrink below this

SECTION_TITLE_FONT_SIZE = 18

GROUP_H = 22             # band carrying the section titles above the RSO table

# ── Native high-resolution rendering ──
# All layout math stays in the IMG_W-wide design space; ScaledDraw renders every
# coordinate and font natively at RENDER_SCALE so text stays crisp when zoomed.
RENDER_SCALE = 4

_scale = RenderScale(RENDER_SCALE)

NOTE_INK = "#5B7290"
MUTED = "-"

YDAY_BG = "#EFF6FF"      # "Active Yesterday" metric box (blue)
YDAY_INK = "#1D4ED8"

# ── Section titles and column sets (mirror the page's sections) ──
TITLE_HOUSE = "HOUSE SUMMARY"
TITLE_SUPERVISOR = "SUPERVISOR SUMMARY"
TITLE_RSO = "RSO TARGET VS ACHIEVEMENT · RETAILER COUNT"
GROUP_A_TITLE = "RSO TARGET VS ACHIEVEMENT"
GROUP_B_TITLE = "RETAILER COUNT"
A_LABELS = ["Target", "Achieved", "Ach %", "Remain", "DRR", "D.Avg",
            "Projection", "Proj %", "Status"]
HOUSE_LABELS = ["RSOs", "Retailers", *A_LABELS]
SUPERVISOR_LABELS = ["#", "Supervisor", "RSOs", "Retailers", *A_LABELS]
TAIL_LABELS = {
    "days_no_sales": "Days No Sales",
    "inactive_last_month": "Inactive Last Month",
    "reactivated": "Reactivated",
}

STATUS_LABELS = {
    "achieved": "Achieved",
    "on_track": "On Track",
    "needs_attention": "Needs Attention",
    "behind": "Behind",
}

# One colour per status so the Status column reads at a glance (same palette as
# the Recharge report image).
STATUS_COLORS = {
    "Achieved": "#08773D",
    "On Track": "#1D6FD6",
    "Needs Attention": "#C77700",
    "Behind": "#C0392B",
}


def _active_scale() -> int:
    return _scale.active()


@contextmanager
def _temp_scale(scale: int):
    with _scale.temp(scale):
        yield


# ── Data prep ──
def _num(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _period_text(period: dict) -> str:
    start = period.get("start_date") or ""
    end = period.get("end_date") or ""
    try:
        start = datetime.fromisoformat(str(start)).strftime("%d %b %Y")
    except ValueError:
        pass
    try:
        end = datetime.fromisoformat(str(end)).strftime("%d %b %Y")
    except ValueError:
        pass
    if start and end:
        return f"Period: {start} - {end}"
    return ""


def _threshold_text(period: dict) -> str:
    days = period.get("active_threshold_days")
    amount = period.get("active_threshold_amount")
    if days is None or amount is None:
        return ""
    return (f"Active = {fmt_num(days)}+ distinct C2S days and "
            f"{fmt_num(amount)}+ BDT in the period")


def _count_keys(dashboard: dict) -> list[str]:
    """Retailer-count bucket keys, mirroring buildBColKeys on the page."""
    keys = dashboard.get("count_keys") or []
    if not keys:
        days = int(_num((dashboard.get("period") or {}).get("active_threshold_days")) or 7)
        keys = [f"day_{i}" for i in range(min(31, max(1, days)))] + list(TAIL_LABELS)
    return ["retailers", *keys]


def _bucket_label(key: str) -> str:
    """Bucket column label — "n Day" for day buckets, like the page's colLabel."""
    if key.startswith("day_"):
        return f"{int(key[4:])} Day"
    if key == "retailers":
        return "Retailers"
    return TAIL_LABELS.get(key, key)


def _rso_labels(count_keys: list[str]) -> list[str]:
    return ["#", "RSO", "Supervisor", *A_LABELS, *[_bucket_label(k) for k in count_keys]]


def _rso_band(count_keys: list[str]):
    """(start, span, title) markers for the RSO table's grouped header band."""
    a_start = 3  # after the serial, RSO and supervisor columns
    return [
        (a_start, len(A_LABELS), GROUP_A_TITLE),
        (a_start + len(A_LABELS), len(count_keys), GROUP_B_TITLE),
    ]


def _status_label(status) -> str:
    return STATUS_LABELS.get(str(status), "Behind")


def _metric_cells(src: dict) -> list:
    """The shared Target vs Achievement metric cells used by every table row."""
    target = _num(src.get("target"))
    achieved = _num(src.get("achieved"))
    projection = _num(src.get("projection"))
    proj_pct = projection / target * 100 if target else 0.0
    return [
        fmt_num(target),
        fmt_num(achieved),
        pct_2dp(achieved, target),
        fmt_num(src.get("remaining")),
        fmt_num(src.get("drr")),
        fmt_num(src.get("daily_avg")),
        fmt_num(round(projection)),
        f"{proj_pct:.2f}%",
        _status_label(src.get("status")),
    ]


def _house_row(summary: dict) -> list:
    """The house summary row: RSO / retailer counts + the house metrics."""
    return [
        fmt_num(summary.get("rso_count")),
        fmt_num(summary.get("retailer_count")),
        *_metric_cells(summary),
    ]


def _supervisor_rows(supervisors: list[dict]) -> list[list]:
    """One row per supervisor, mirroring the page's Section C row."""
    rows = []
    for i, s in enumerate(supervisors):
        rows.append([
            str(i + 1),
            str(s.get("supervisor_name") or MUTED),
            fmt_num(s.get("rso_count")),
            fmt_num(s.get("retailer_count")),
            *_metric_cells(s),
        ])
    return rows


def _rso_rows(rows_in: list[dict], count_keys: list[str]) -> list[list]:
    """One row per RSO, mirroring the page's Section A · Section B row cells."""
    rows = []
    for i, r in enumerate(rows_in):
        counts = r.get("retailer_counts") or {}
        rows.append([
            str(i + 1),
            str(r.get("name") or MUTED),
            str(r.get("supervisor_name") or MUTED),
            *_metric_cells(r),
            fmt_num(r.get("retailer_count")),
            *[fmt_num(counts.get(k)) for k in count_keys],
        ])
    return rows


def _grand_total(summary: dict, count_keys: list[str]) -> list:
    """Grand-total row; the three leading cells merge into one label when drawn."""
    counts = summary.get("retailer_counts") or {}
    return [
        f"Grand Total ({int(_num(summary.get('rso_count')))} RSO)",
        "",
        "",
        *_metric_cells(summary),
        fmt_num(summary.get("retailer_count")),
        *[fmt_num(counts.get(k)) for k in count_keys],
    ]


# ── Font / column sizing ──
def _pick_table_font(labels, rows, total_row, total_span, name_cols):
    """Largest table font whose content-sized columns fit the page width.

    Every column is sized from its own content (label, values, total row), so
    the widths follow the data. The widest font is chosen at which the whole
    table fits with every cell fully visible; when the data is too wide for
    that (the 23-column RSO table of a house with long names), the font stays
    as large as possible while only the flexible name columns give way — every
    number / status / bucket column keeps its exact content width.

    Sized against PROBE_INNER — the content width of the former 1600-wide
    sheet — so widening the sheet never inflates the text.
    Returns ``(size, f_head, f_cell, weights)``.
    """
    full = None
    flex = None
    last = None
    for candidate in range(FONT_MAX, FONT_MIN - 1, -1):
        f = load_font(candidate, True)
        req = content_weights(labels, rows, f, f, (), margin=8,
                              total_row=total_row, total_span=total_span)
        fixed = sum(req) - sum(req[i] for i in name_cols)
        last = (candidate, req)
        if sum(req) <= PROBE_INNER:
            full = last
            break
        if flex is None and fixed + NAME_MIN_W * len(name_cols) <= PROBE_INNER:
            flex = last

    size, req = full or flex or last
    f = load_font(size, True)
    if full is None:
        # Too wide to show everything: the name columns share the leftover
        # width proportionally, so the rest of the table keeps its exact fit
        # (very long names ellipsize instead).
        name_req = sum(req[i] for i in name_cols)
        name_avail = PROBE_INNER - (sum(req) - name_req)
        if name_req > name_avail and name_req > 0:
            scale = name_avail / name_req
            for i in name_cols:
                req[i] = max(1, int(req[i] * scale))
        if sum(req) > PROBE_INNER:  # rounding / merged-total-label safety
            req = [max(1, int(r * PROBE_INNER / sum(req))) for r in req]
    return size, f, f, req


# ── Header ──
def _metric_box(draw, bx, by, box_w, box_h, label, value, bg, ink, fl, fv,
                s: float = 1.0) -> None:
    draw.rounded_rectangle([bx, by, bx + box_w, by + box_h], radius=round(9 * s),
                           fill=bg, outline=ink, width=round(2 * s))
    draw.text((bx + box_w / 2, by + round(17 * s)), label, font=fl, fill=ink, anchor="mm")
    draw.text((bx + box_w / 2, by + round(52 * s)), value, font=fv, fill=ink, anchor="mm")


def _render_header(draw, x, y, house_name, house_code, period, today,
                   yesterday_active=0) -> int:
    # Standard header block scaled from the 800-wide reference (~1.48x on this
    # 1750-wide sheet) so the header keeps its standard size everywhere.
    s = header_scale(IMG_W)
    x1 = x + INNER
    pad_x = round(16 * s)
    date_str = today.strftime("%d %B %Y")
    time_str = now_naive().strftime("%I:%M %p").lstrip("0").replace(" 0", " ")

    # metric box (right): retailers active yesterday — measured first so the
    # brand text can be kept clear of it
    label, value = "Active Yesterday", fmt_num(yesterday_active)
    fl = load_font(round(HDR_BOX_LABEL_F * s), True)
    fv = load_font(round(HDR_BOX_VALUE_F * s), True)
    box_w = int(max(round(220 * s), draw.textlength(label, font=fl) + round(40 * s),
                    draw.textlength(value, font=fv) + round(40 * s)))
    box_h = round(80 * s)
    by = y + (HDR_H - box_h) // 2
    bx = x1 - pad_x - box_w

    # brand (left) — text column, vertically centred
    tx = x + pad_x
    brand_max = bx - tx - round(10 * s)  # keep clear of the metric box

    draw.text((tx, y + round(46 * s)), "Active LSO Report",
              font=load_font(round(HDR_TITLE_F * s), True),
              fill=INK, anchor="ls")
    f_meta = load_font(round(HDR_META_F * s), True)
    draw.text((tx, y + round(68 * s)), ellipsize(
        draw, f"House: {house_name or ''} ({house_code or ''})", f_meta, brand_max),
        font=f_meta, fill=INK, anchor="lm")
    draw.text((tx, y + round(88 * s)), ellipsize(
        draw, _period_text(period), f_meta, brand_max),
        font=f_meta, fill=INK, anchor="lm")
    draw.text((tx, y + round(106 * s)), f"Generated: {date_str}, {time_str}",
              font=f_meta, fill=INK, anchor="lm")

    _metric_box(draw, bx, by, box_w, box_h, label, value, YDAY_BG, YDAY_INK, fl, fv, s)
    return y + HDR_H


def _render_threshold_note(draw, x, y, period) -> int:
    """Small caption explaining what counts as an Active LSO this month."""
    text = _threshold_text(period)
    if not text:
        return y
    draw.text((x, y + 10), text, font=load_font(12, True), fill=NOTE_INK, anchor="lm")
    return y + NOTE_H


def _draw_group_band(draw, x, y, width, weights, groups, f_head) -> int:
    """Two-tier header band: section titles spanning their column groups.

    Mirrors the page table's grouped header — "RSO Target vs Achievement" spans
    its metric columns and "Retailer Count" spans the retailer bucket columns,
    while the leading serial / RSO / supervisor columns keep a blank band (those
    headers span both header rows on the page).
    """
    widths = fit_widths(weights, width)
    f = load_font(f_head.size + 2, True)
    draw.rectangle([x, y, x + width, y + GROUP_H], fill=TH_BG)
    starts = []
    for start, span, text in groups:
        x0 = x + sum(widths[:start])
        x1 = x + sum(widths[:start + span])
        starts.append(x0)
        draw.text(((x0 + x1) / 2, y + GROUP_H / 2), text,
                  font=f, fill=TH_INK, anchor="mm")
    # separators at the group boundaries, matching the table's own borders
    for lx in sorted({sx for sx in starts if sx > x}):
        draw.line([(lx, y), (lx, y + GROUP_H)], fill=TD_BORDER)
    draw.line([(x, y + GROUP_H), (x + width, y + GROUP_H)], fill=TD_BORDER)
    return y + GROUP_H


# ── A4 pagination ──
# A draw-op is a (kind, payload) tuple placed top to bottom on a page. Tables are
# split into row chunks so a long list continues on the next A4 sheet with its
# (grouped) header repeated.
def _paginate(tables: list[dict], note_h: int):
    """Plan the report onto exact-A4 landscape pages.

    Each table is ``{"title", "labels", "rows", "total_row", "total_span",
    "band", "name_cols"}``. Returns ``(pages, heights, min_rh)`` where ``pages``
    is a list of pages, each a top-to-bottom-ordered list of draw-ops, and
    ``heights`` is the used content height of every page (A4 height is the
    maximum — a page whose content does not fill it shrinks to this height
    instead of leaving a void, and no page can ever exceed the sheet).
    """
    pages: list[list] = []
    heights: list[int] = []
    page: list = []
    used = 0
    min_rh = None

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

    # Header (+ threshold note) always leads the first page and never splits.
    put(HDR_H, ("header",))
    if note_h:
        put(note_h, ("note",))

    for t in tables:
        title, labels = t["title"], t["labels"]
        rows, total_row = t["rows"], t["total_row"]
        total_span, band = t["total_span"], t["band"]
        if not rows and total_row is None:
            continue
        size, f_head, f_cell, weights = _pick_table_font(
            labels, rows, total_row, total_span, t["name_cols"])
        hh, rh = table_heights(f_head, f_cell)
        min_rh = rh if min_rh is None else min(min_rh, rh)
        # The grouped header band + column headers repeat on every page, so a
        # continuation page reads standalone.
        base = SECTION_TITLE_H + (GROUP_H if band else 0) + hh
        if not rows:
            # a single highlighted row table (the house summary)
            put(base + rh, ("table", title, labels, band, [], total_row,
                            weights, total_span, f_head, f_cell))
            continue
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
            tro = total_row if is_last else None
            label = title if chunk_no == 0 else f"{title} (contd.)"
            put(base + rh * len(chunk) + (rh if tro else 0),
                ("table", label, labels, band, chunk, tro, weights, total_span,
                 f_head, f_cell))
            idx += take
            chunk_no += 1
            if idx < len(rows):
                new_page()

    pages.append(page)
    heights.append(used)
    if min_rh is None:
        min_rh = table_heights(load_font(FONT_MIN, True), load_font(FONT_MIN, True))[1]
    return pages, heights, min_rh


# ── Render ──
def _render_image(house_name: str, house_code: str, dashboard: dict,
                  today: date) -> list[bytes]:
    """Render the report as one PNG per page.

    Every page is capped at the exact A4 landscape sheet (PAGE_W x PAGE_H);
    a page whose content does not fill the sheet shrinks to its content height.
    """
    summary = dashboard.get("summary") or {}
    period = dashboard.get("period") or {}
    yesterday_active = dashboard.get("yesterday_active") or 0
    count_keys = _count_keys(dashboard)
    rso_rows = _rso_rows(dashboard.get("rows") or [], count_keys)
    supervisor_rows = _supervisor_rows(dashboard.get("supervisor_summary") or [])

    tables: list[dict] = [
        # the house summary is a one-row table drawn in the highlighted
        # "total" style, its single row carrying the house-level metrics
        {"title": TITLE_HOUSE, "labels": HOUSE_LABELS, "rows": [],
         "total_row": _house_row(summary), "total_span": 0, "band": None,
         "name_cols": []},
    ]
    if supervisor_rows:
        tables.append({
            "title": TITLE_SUPERVISOR, "labels": SUPERVISOR_LABELS,
            "rows": supervisor_rows, "total_row": None, "total_span": 0,
            "band": None, "name_cols": [1],
        })
    if rso_rows:
        tables.append({
            "title": TITLE_RSO, "labels": _rso_labels(count_keys),
            "rows": rso_rows, "total_row": _grand_total(summary, count_keys),
            "total_span": 3, "band": _rso_band(count_keys), "name_cols": [1, 2],
        })

    note_h = NOTE_H if _threshold_text(period) else 0
    pages, heights, min_rh = _paginate(tables, note_h)

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
            heights[page_no], page_h=PAGE_H, content_h=CONTENT_H, row_h=min_rh,
            pad=CARD_PAD, footer_h=footer)
        img = Image.new("RGB", (PAGE_W * s, canvas_h * s), REPORT_BG)
        draw = ScaledDraw(ImageDraw.Draw(img), _scale)
        y = PAGE_PAD + CARD_PAD
        for op in ops:
            kind = op[0]
            if kind == "header":
                y = _render_header(draw, cx, y, house_name, house_code,
                                   period, today, yesterday_active)
            elif kind == "note":
                y = _render_threshold_note(draw, cx, y, period)
            else:  # table op
                (_, title, labels, band, chunk, tro, weights, total_span,
                 f_head, f_cell) = op
                hh, rh = table_heights(f_head, f_cell)
                y = draw_section_title(draw, cx, y, title,
                                       font_size=SECTION_TITLE_FONT_SIZE)
                if band:
                    y = _draw_group_band(draw, cx, y, INNER, weights, band, f_head)
                # name columns read left-aligned, every other column centred
                left_cols = [i for i, lb in enumerate(labels)
                             if lb in ("RSO", "Supervisor")]
                draw_table(draw, cx, y, INNER, labels, chunk, weights=weights,
                           left_cols=left_cols, total_row=tro,
                           total_span=total_span, f_head=f_head, f_cell=f_cell,
                           cell_color_map={labels.index("Status"): STATUS_COLORS})
                y += hh + rh * (len(chunk) + (1 if tro is not None else 0))
            y += GAP
        if total_pages > 1:
            draw.text((cx + INNER, canvas_h - CARD_PAD),
                      f"Page {page_no + 1}/{total_pages}",
                      font=load_font(11, True), fill=INK, anchor="rs")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        out.append(buf.getvalue())
    return out


async def build_active_lso_report_image(
    db: AsyncSession, house_id: int, scale: int | None = None
) -> list[bytes]:
    """Build the current month's Active LSO Report as PNG images.

    Returns one PNG per page, each inside the exact A4 landscape sheet (a page
    whose content does not fill it hugs its content). ``scale`` overrides the
    default RENDER_SCALE - used for fast, reduced-size preview renders. ``None``
    produces the full-resolution send-quality images.
    """
    today = now_naive().date()
    start_date = today.replace(day=1)
    if today.month == 12:
        end_date = date(today.year + 1, 1, 1) - timedelta(days=1)
    else:
        end_date = date(today.year, today.month + 1, 1) - timedelta(days=1)

    svc = ActiveLsoReportService(db, house_id, start_date, end_date)
    dashboard = await svc.build_dashboard()

    result = await db.execute(select(House).where(House.id == house_id))
    house = result.scalar_one_or_none()
    house_name = (house.name or "") if house else "Unknown"
    house_code = (house.code or "") if house else ""

    if scale is None:
        return _render_image(house_name, house_code, dashboard, today)
    with _temp_scale(scale):
        return _render_image(house_name, house_code, dashboard, today)
