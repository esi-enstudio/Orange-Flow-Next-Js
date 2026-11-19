"""Live C2C Report image builder for WhatsApp/Telegram delivery.

Renders ``/reports/live-c2c`` as A4 landscape PNG pages containing the same
table the page shows: one row per active RSO (serial, DMS code, RSO name, iTop
number, the C2C target / today's route / other route / total / Ach % / Remain
columns, then the same five transaction columns) plus the footer total row.

The two metric blocks sit under a grouped header band ("C2C (BDT)" and
"Transactions (count)") exactly like the page table's two-tier header, so the
repeated ``Today`` / ``Other`` / ``Total`` / ``Ach %`` / ``Remain`` labels are
never ambiguous.

Every page stays inside an exact A4 landscape sheet (1750x1237 design units,
the shared WhatsApp landscape geometry). Rows spill onto continuation pages
that repeat the table header, and the sheet shrinks to its content height when
the last page does not fill it.
"""
import io
import math
from contextlib import contextmanager
from datetime import date

from PIL import Image, ImageDraw
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# The delivered PNGs are intentionally large; this is not a decompression bomb.
Image.MAX_IMAGE_PIXELS = None

from app.models.house import House
from app.services.live_c2c_report_rows import load_live_c2c_report_rows
from app.services.report_image_kit import (
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
    load_font,
    table_heights,
)
from app.utils.timezone import now_naive

# ── Layout ──
IMG_W = 1750
CARD_PAD = 10
INNER = IMG_W - 2 * CARD_PAD
# A4 landscape: width * 210/297 keeps the exact sheet ratio.
PAGE_H = round(IMG_W * 210 / 297)
PAGE_W = IMG_W
FOOTER_H = 16

HDR_H = 118
HDR_TITLE_SIZE = 36
HDR_META_SIZE = 18
SECTION_TITLE_FONT_SIZE = 20
GROUP_H = 22
TOTAL_SPAN = 4
F_HEAD = 16
F_CELL = 16
RENDER_SCALE = 4

_scale = RenderScale(RENDER_SCALE)

# Column order mirrors the page's REPORT_COLUMNS (house code is dropped — the
# header already names the house — and the serial column leads).
LABELS = [
    "#",
    "DMS Code",
    "RSO",
    "iTop",
    "C2C Tgt",
    "Today",
    "Other",
    "Total",
    "Ach %",
    "Remain",
    "Trans Tgt",
    "Today",
    "Other",
    "Total",
    "Ach %",
    "Remain",
    "Start",
    "End",
    "Hrs",
]

# (first column index, column span, band text)
GROUPS = [
    (4, 6, "C2C (BDT)"),
    (10, 6, "Transactions (count)"),
]

# Name / code columns read left-aligned; every numeric column is centred.
LEFT_COLS = [1, 2]
RED_CELL = "#dc2626"
GREEN_CELL = "#16a34a"


@contextmanager
def _temp_scale(scale: int):
    with _scale.temp(scale):
        yield


def _pct(part, whole) -> str:
    try:
        if not whole:
            return "0.00%"
        return f"{float(part) / float(whole) * 100:.2f}%"
    except (TypeError, ValueError, ZeroDivisionError):
        return "0.00%"


def _clock(value) -> str:
    """HH:MM of a stored ISO time (the page shows the same clock value)."""
    if not value:
        return "-"
    text = str(value)
    return text[:5] if len(text) >= 5 else text


def _number(value) -> str:
    return "-" if value is None else fmt_num(value)


def _row_cells(position: int, row: dict) -> list[str]:
    return [
        str(position),
        row.get("dms_code") or "-",
        row.get("rso_name") or "-",
        row.get("rso_itop_number") or "-",
        fmt_num(row.get("productivity_c2c_tgt")),
        fmt_num(row.get("c2c_today_route")),
        fmt_num(row.get("c2c_other_route")),
        fmt_num(row.get("total_c2c")),
        _pct(row.get("total_c2c"), row.get("productivity_c2c_tgt")),
        fmt_num(row.get("c2c_remaining")),
        fmt_num(row.get("productivity_trans_tgt")),
        fmt_num(row.get("today_route_trans")),
        fmt_num(row.get("other_route_trans")),
        fmt_num(row.get("total_trans")),
        _pct(row.get("total_trans"), row.get("productivity_trans_tgt")),
        fmt_num(row.get("trans_remaining")),
        _clock(row.get("start_time")),
        _clock(row.get("end_time")),
        _number(row.get("serving_hours")),
    ]


def _sum(rows: list[dict], key: str) -> float:
    return sum(float(row.get(key) or 0) for row in rows)


def _total_cells(rows: list[dict]) -> list[str]:
    c2c_target = _sum(rows, "productivity_c2c_tgt")
    c2c_total = _sum(rows, "total_c2c")
    trans_target = _sum(rows, "productivity_trans_tgt")
    trans_total = _sum(rows, "total_trans")
    return [
        f"Total ({len(rows)} RSO)",
        "",
        "",
        "",
        fmt_num(c2c_target),
        fmt_num(_sum(rows, "c2c_today_route")),
        fmt_num(_sum(rows, "c2c_other_route")),
        fmt_num(c2c_total),
        _pct(c2c_total, c2c_target),
        fmt_num(_sum(rows, "c2c_remaining")),
        fmt_num(trans_target),
        fmt_num(_sum(rows, "today_route_trans")),
        fmt_num(_sum(rows, "other_route_trans")),
        fmt_num(trans_total),
        _pct(trans_total, trans_target),
        fmt_num(_sum(rows, "trans_remaining")),
        "",
        "",
        "-",
    ]


def _is_at_least(value, threshold: float) -> bool:
    try:
        numeric = float(value)
    except (TypeError, ValueError, OverflowError):
        return False
    return math.isfinite(numeric) and numeric >= threshold


def _is_at_most(value, threshold: float) -> bool:
    try:
        numeric = float(value)
    except (TypeError, ValueError, OverflowError):
        return False
    return math.isfinite(numeric) and numeric <= threshold


def _row_cell_colors(row: dict) -> dict[int, str]:
    colors = {6: RED_CELL, 12: RED_CELL}
    for column, key in ((8, "c2c_achievement_pct"), (14, "trans_achievement_pct")):
        if _is_at_least(row.get(key), 100):
            colors[column] = GREEN_CELL
    for column, key in ((9, "c2c_remaining"), (15, "trans_remaining")):
        if _is_at_most(row.get(key), 0):
            colors[column] = GREEN_CELL
    return colors


def _total_cell_colors(rows: list[dict]) -> dict[int, str]:
    colors = {6: RED_CELL, 12: RED_CELL}
    c2c_target = _sum(rows, "productivity_c2c_tgt")
    trans_target = _sum(rows, "productivity_trans_tgt")
    c2c_total = _sum(rows, "total_c2c")
    trans_total = _sum(rows, "total_trans")
    if c2c_target > 0 and c2c_total / c2c_target * 100 >= 100:
        colors[8] = GREEN_CELL
    if trans_target > 0 and trans_total / trans_target * 100 >= 100:
        colors[14] = GREEN_CELL
    if _sum(rows, "c2c_remaining") <= 0:
        colors[9] = GREEN_CELL
    if _sum(rows, "trans_remaining") <= 0:
        colors[15] = GREEN_CELL
    return colors


def _draw_header(draw, x, y, house_name, house_code, today: date) -> int:
    generated = now_naive().strftime("%d %B %Y, %I:%M %p")
    draw.text((x + 16, y + 48), "Live C2C Report",
              font=load_font(HDR_TITLE_SIZE, True), fill=INK, anchor="ls")
    meta = load_font(HDR_META_SIZE, True)
    draw.text((x + 16, y + 76), ellipsize(
        draw, f"House: {house_name or '-'} ({house_code or '-'})", meta, INNER - 32),
        font=meta, fill=INK, anchor="lm")
    draw.text((x + 16, y + 100), ellipsize(
        draw, f"Generated: {generated}", meta, INNER - 32),
        font=meta, fill=INK, anchor="lm")
    return y + HDR_H


def _draw_group_band(draw, x, y, width, weights, groups, f_head) -> int:
    """Grouped header band spanning each metric block, like the page table."""
    widths = fit_widths(weights, width)
    band_font = load_font(f_head.size + 2, True)
    draw.rectangle([x, y, x + width, y + GROUP_H], fill=TH_BG)
    starts = []
    for start, span, text in groups:
        x0 = x + sum(widths[:start])
        x1 = x + sum(widths[:start + span])
        starts.append(x0)
        draw.text(((x0 + x1) / 2, y + GROUP_H / 2), text,
                  font=band_font, fill=TH_INK, anchor="mm")
    for lx in sorted({sx for sx in starts if sx > x}):
        draw.line([(lx, y), (lx, y + GROUP_H)], fill=TD_BORDER)
    draw.line([(x, y + GROUP_H), (x + width, y + GROUP_H)], fill=TD_BORDER)
    return y + GROUP_H


def _chunk_rows(rows: list, first_fit: int, rest_fit: int) -> list[list]:
    """Split the table body across pages, keeping at least one row per page."""
    if not rows:
        return [[]]
    chunks = [rows[:first_fit]]
    remaining = rows[first_fit:]
    while remaining:
        chunks.append(remaining[:rest_fit])
        remaining = remaining[rest_fit:]
    return chunks


def _render_image(house_name: str, house_code: str, rows: list[dict], today: date) -> list[bytes]:
    labels = list(LABELS)
    body = [_row_cells(index, row) for index, row in enumerate(rows, start=1)]
    total = _total_cells(rows)
    body_colors = [_row_cell_colors(row) for row in rows]
    total_colors = _total_cell_colors(rows)

    f_head = load_font(F_HEAD, True)
    f_cell = load_font(F_CELL, True)
    weights = content_weights(
        labels, body, f_head, f_cell, (),
        max_total=INNER, total_row=total, total_span=TOTAL_SPAN,
    )
    head_h, row_h = table_heights(f_head, f_cell)

    first_fit = max(1, (PAGE_H - CARD_PAD * 2 - HDR_H - SECTION_TITLE_H
                        - GROUP_H - head_h - row_h - FOOTER_H) // row_h)
    # Continuation pages repeat the section title and grouped header band so the
    # repeated Today / Other / Total / Ach % / Remain labels stay unambiguous.
    rest_fit = max(1, (PAGE_H - CARD_PAD * 2 - SECTION_TITLE_H
                       - GROUP_H - head_h - row_h - FOOTER_H) // row_h)
    chunks = _chunk_rows(body, first_fit, rest_fit)
    color_chunks = _chunk_rows(body_colors, first_fit, rest_fit)
    total_pages = len(chunks)

    pages: list[bytes] = []
    x = CARD_PAD
    for page_no, chunk in enumerate(chunks):
        is_first = page_no == 0
        is_last = page_no == total_pages - 1
        footer = FOOTER_H if total_pages > 1 else 0

        used = (CARD_PAD + SECTION_TITLE_H + GROUP_H + head_h
                + row_h * (len(chunk) + (1 if is_last else 0)))
        if is_first:
            used += HDR_H
        canvas_h = min(PAGE_H, used + CARD_PAD + footer)

        img = Image.new("RGB", (PAGE_W * _scale.active(), canvas_h * _scale.active()), REPORT_BG)
        draw = ScaledDraw(ImageDraw.Draw(img), _scale)
        y = CARD_PAD
        if is_first:
            y = _draw_header(draw, x, y, house_name, house_code, today)
        y = draw_section_title(
            draw, x, y, "RSO Productivity",
            font_size=SECTION_TITLE_FONT_SIZE,
        )
        y = _draw_group_band(draw, x, y, INNER, weights, GROUPS, f_head)

        draw_table(
            draw, x, y, INNER, labels, chunk,
            weights=weights,
            left_cols=LEFT_COLS,
            total_row=total if is_last else None,
            total_span=TOTAL_SPAN,
            f_head=f_head,
            f_cell=f_cell,
            cell_colors=color_chunks[page_no] + ([total_colors] if is_last else []),
        )

        if total_pages > 1:
            draw.text((x + INNER, canvas_h - CARD_PAD / 2 - 2),
                      f"Page {page_no + 1}/{total_pages}",
                      font=load_font(11, True), fill=INK, anchor="rs")

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        pages.append(buf.getvalue())
    return pages


async def build_live_c2c_report_image(
    db: AsyncSession,
    house_id: int,
    scale: int | None = None,
) -> list[bytes]:
    """Build the Live C2C Report as A4 landscape PNG pages.

    ``scale`` overrides the default render scale for a fast on-screen preview;
    ``None`` produces the full-resolution send-quality pages.
    """
    rows = await load_live_c2c_report_rows(db, house_id=house_id)
    house = await db.scalar(select(House).where(House.id == house_id))
    house_name = (house.name if house else "") or ""
    house_code = (house.code if house else "") or ""
    today = now_naive().date()

    if scale is None:
        return _render_image(house_name, house_code, rows, today)
    with _temp_scale(scale):
        return _render_image(house_name, house_code, rows, today)
