"""Inactive Retailers list image builder (Active SSO report).

Renders one RSO's inactive-retailer list — the table the /reports/active-sso
"Inactive Retailers" modal shows — as a WhatsApp/Telegram-ready PNG, so the
modal's Share action delivers the list itself instead of the house-wide report
image.

Layout:

    * a header naming the RSO (name, DMS code, iTopUp number), the house, the
      period, the render time and two metric boxes — Total Retailers and Total
      Inactive;
    * one table — #, House, Ret Code, Ret Name, iTopUp No, Activations Done,
      Req. Activations, No SSO Last Month — whose header repeats on every
      continuation page. A long list flows onto extra A4 landscape pages.

Business rules come from the same service the modal/API uses
(:class:`ActiveSsoReportService.get_inactive_retailers`), with the same period,
so the image and the modal always show the same list: retailers on the event's
target sorted by the fewest activations first, and "No SSO Last Month" marking
the ones that were also inactive last month.
"""
import io
from datetime import date, timedelta

from PIL import Image, ImageDraw
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# Report images are deliberately large (multi-thousand pixel) renders - the size
# is intended, not a decompression bomb.
Image.MAX_IMAGE_PIXELS = None

from app.models.employee import Employee
from app.models.house import House
from app.services.active_sso_report_service import ActiveSsoReportService
from app.services.report_image_kit import (
    HDR_BOX_LABEL_F,
    HDR_BOX_VALUE_F,
    HDR_META_F,
    HDR_TITLE_F,
    INK,
    REPORT_BG,
    SECTION_TITLE_H,
    RenderScale,
    ScaledDraw,
    content_weights,
    draw_section_title,
    draw_table,
    ellipsize,
    fmt_num,
    header_scale,
    hugging_page_height,
    load_font,
    table_heights,
)
from app.utils.timezone import now_naive

# ── Layout ──
# Same A4 landscape sheet as the other WhatsApp report images: 1750 design units
# wide, height = width * 210/297, so a full page keeps the exact A4 ratio. A page
# whose content does not fill the sheet shrinks to its content height.
IMG_W = 1750
CARD_PAD = 10
INNER = IMG_W - 2 * CARD_PAD
GAP = 8
PAGE_W = IMG_W
PAGE_H = round(IMG_W * 210 / 297)  # ≈1237 → exact A4 landscape
FOOTER_H = 16
CONTENT_H = PAGE_H - 2 * CARD_PAD - FOOTER_H

# Header band: title + 4 meta lines (House, RSO, Period, Generated), sized from
# the kit's standard band plus one extra line.
HDR_TITLE_Y = 30
HDR_META_Y = 50
HDR_META_STEP = 20
HDR_META_LINES = 4
HDR_H = round((HDR_META_Y + HDR_META_STEP * (HDR_META_LINES - 1) + 11)
              * header_scale(IMG_W))

SECTION_TITLE_FONT_SIZE = 18
FONT_HEAD = 15
FONT_CELL = 15

TITLE = "Inactive Retailers"
CONTINUED = "Inactive Retailers (cont.)"
EMPTY_TEXT = "No inactive retailers in this period"
LABELS = ["#", "House", "Ret Code", "Ret Name", "iTopUp No",
          "Activations Done", "Req. Activations", "No SSO Last Month"]
# House / Ret Code / Ret Name / iTopUp No read left-aligned, the rest centred.
LEFT_COLS = [1, 2, 3, 4]
MUTED = "-"

# Metric boxes: total retailers (blue) then total inactive (amber highlight).
BOX_GAP = 14
RETAILERS_BG = "#EFF6FF"
RETAILERS_INK = "#1D4ED8"
INACTIVE_BG = "#FEF3C7"
INACTIVE_INK = "#B45309"
NOTE_INK = "#5B7290"

RENDER_SCALE = 4
_scale = RenderScale(RENDER_SCALE)


def _rows(items: list[dict]) -> list[list]:
    return [
        [
            idx,
            r.get("house_code") or MUTED,
            r.get("retailer_code") or MUTED,
            r.get("name") or MUTED,
            r.get("itop_number") or MUTED,
            fmt_num(r.get("activations_done") or 0),
            fmt_num(r.get("required_activations") or 0),
            "Y" if (r.get("inactive_last_month") or "") == "Y" else "",
        ]
        for idx, r in enumerate(items, start=1)
    ]


def _box_width(draw, label, value, fl, fv, s: float) -> int:
    return int(max(round(220 * s),
                   draw.textlength(label, font=fl) + round(40 * s),
                   draw.textlength(value, font=fv) + round(40 * s)))


def _metric_box(draw, bx, by, box_w, box_h, label, value, bg, ink, fl, fv,
                s: float) -> None:
    draw.rounded_rectangle([bx, by, bx + box_w, by + box_h], radius=round(9 * s),
                           fill=bg, outline=ink, width=round(2 * s))
    draw.text((bx + box_w / 2, by + round(17 * s)), label, font=fl, fill=ink, anchor="mm")
    draw.text((bx + box_w / 2, by + round(52 * s)), value, font=fv, fill=ink, anchor="mm")


def _render_header(draw, x, y, *, house_name, house_code, rso_name, rso_dms,
                   rso_itop, period_text, today, total_retailers: int,
                   total_inactive: int) -> int:
    s = header_scale(IMG_W)
    pad_x = round(16 * s)
    fl = load_font(round(HDR_BOX_LABEL_F * s), True)
    fv = load_font(round(HDR_BOX_VALUE_F * s), True)

    boxes = [
        ("Total Retailers", fmt_num(total_retailers), RETAILERS_BG, RETAILERS_INK),
        ("Total Inactive", fmt_num(total_inactive), INACTIVE_BG, INACTIVE_INK),
    ]
    widths = [_box_width(draw, label, value, fl, fv, s) for label, value, _, _ in boxes]
    box_h = round(80 * s)
    by = y + (HDR_H - box_h) // 2
    bx = x + INNER - pad_x - widths[-1]
    for (label, value, bg, ink), box_w in reversed(list(zip(boxes, widths))):
        _metric_box(draw, bx, by, box_w, box_h, label, value, bg, ink, fl, fv, s)
        bx -= box_w + round(BOX_GAP * s)

    # Brand text left, kept clear of the metric boxes.
    tx = x + pad_x
    brand_max = bx + round(BOX_GAP * s) + widths[0] - tx - round(10 * s)
    f_title = load_font(round(HDR_TITLE_F * s), True)
    f_meta = load_font(round(HDR_META_F * s), True)

    draw.text((tx, y + round(HDR_TITLE_Y * s)), TITLE, font=f_title, fill=INK, anchor="ls")
    meta_lines = [
        f"House: {house_name or ''} ({house_code or ''})",
        f"RSO: {rso_name or MUTED} · DMS {rso_dms or MUTED} · iTopUp {rso_itop or MUTED}",
        f"Period: {period_text}",
        f"Generated: {today.strftime('%d %B %Y')}, "
        f"{now_naive().strftime('%I:%M %p').lstrip('0').replace(' 0', ' ')}",
    ]
    for i, line in enumerate(meta_lines):
        draw.text((tx, y + round((HDR_META_Y + HDR_META_STEP * i) * s)),
                  ellipsize(draw, line, f_meta, brand_max),
                  font=f_meta, fill=INK if i < 3 else NOTE_INK, anchor="lm")

    return y + HDR_H


def _rows_per_page(row_h: int, *, first_page: bool) -> int:
    avail = CONTENT_H - SECTION_TITLE_H
    if first_page:
        avail -= HDR_H
    return max(1, int(avail // row_h))


def _render_pages(*, house_name, house_code, rso_name, rso_dms, rso_itop,
                  period_text, today, rows: list[list],
                  total_retailers: int) -> list[bytes]:
    f_head = load_font(FONT_HEAD, True)
    f_cell = load_font(FONT_CELL, True)
    head_h, row_h = table_heights(f_head, f_cell)
    weights = content_weights(LABELS, rows, f_head, f_cell, [], max_total=INNER)

    # Split the list into pages that each fit the A4 landscape sheet.
    chunks: list[list[list]] = []
    remaining = list(rows)
    first = True
    while remaining or first:
        cap = _rows_per_page(row_h, first_page=first)
        chunks.append(remaining[:cap])
        remaining = remaining[cap:]
        first = False

    total_pages = len(chunks)
    out: list[bytes] = []
    for page_no, chunk in enumerate(chunks):
        # The first page carries the header; every page repeats the table header.
        body_rows = len(chunk) or 1  # an empty list still draws its empty-state line
        title_h = 0 if page_no == 0 else SECTION_TITLE_H
        used = title_h + head_h + row_h * body_rows + GAP
        if page_no == 0:
            used += HDR_H
        footer = FOOTER_H if total_pages > 1 else 0
        canvas_h = hugging_page_height(used, page_h=PAGE_H, content_h=CONTENT_H,
                                       row_h=row_h, pad=CARD_PAD, footer_h=footer)

        s = _scale.active()
        img = Image.new("RGB", (PAGE_W * s, canvas_h * s), REPORT_BG)
        draw = ScaledDraw(ImageDraw.Draw(img), _scale)
        x = CARD_PAD
        y = CARD_PAD
        if page_no == 0:
            y = _render_header(draw, x, y, house_name=house_name,
                               house_code=house_code, rso_name=rso_name,
                               rso_dms=rso_dms, rso_itop=rso_itop,
                               period_text=period_text, today=today,
                               total_retailers=total_retailers,
                               total_inactive=len(rows))
        else:
            y = draw_section_title(draw, x, y, CONTINUED,
                                   font_size=SECTION_TITLE_FONT_SIZE)
        draw_table(draw, x, y, INNER, LABELS, chunk, weights=weights,
                   left_cols=LEFT_COLS, f_head=f_head, f_cell=f_cell)
        if not chunk:
            draw.text((x + INNER / 2, y + head_h + row_h / 2), EMPTY_TEXT,
                      font=f_cell, fill=NOTE_INK, anchor="mm")
        if total_pages > 1:
            draw.text((x + INNER, canvas_h - CARD_PAD),
                      f"Page {page_no + 1}/{total_pages}",
                      font=load_font(11, True), fill=INK, anchor="rs")

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        out.append(buf.getvalue())
    return out


def _resolve_period(report_params: dict) -> tuple[date, date]:
    """The list's period: the shared context when given, else the report page's
    own default (this month, 1st to last day)."""
    raw_start = report_params.get("start_date")
    raw_end = report_params.get("end_date")
    if raw_start and raw_end:
        return date.fromisoformat(str(raw_start)), date.fromisoformat(str(raw_end))
    today = now_naive().date()
    month_start = today.replace(day=1)
    if month_start.month == 12:
        month_end = date(month_start.year + 1, 1, 1) - timedelta(days=1)
    else:
        month_end = date(month_start.year, month_start.month + 1, 1) - timedelta(days=1)
    return month_start, month_end


async def build_active_sso_inactive_retailers_image(
    db: AsyncSession,
    house_id: int,
    *,
    report_params: dict | None = None,
    scale: int | None = None,
) -> list[bytes]:
    """Build one RSO's Active SSO inactive-retailer list as PNG page images.

    ``report_params`` must carry ``employee_id`` (the RSO whose list is rendered)
    and may carry ``start_date`` / ``end_date`` — the period the modal was
    showing, so the image matches it exactly. Both are persisted on the schedule
    and sent with a direct send. ``scale`` overrides the native render scale,
    used for the lightweight on-screen preview.
    """
    params = report_params or {}
    try:
        employee_id = int(params.get("employee_id"))
    except (TypeError, ValueError):
        raise ValueError("report_params.employee_id is required for the inactive-retailers report")

    start_date, end_date = _resolve_period(params)

    svc = ActiveSsoReportService(db, house_id, start_date, end_date)
    items = await svc.get_inactive_retailers(employee_id)

    # The RSO's whole retailer universe (what the report row shows as the
    # retailer count) — the same map the list is taken from.
    retailer_map = await svc._get_retailer_emp_map([employee_id])
    total_retailers = sum(1 for eid in retailer_map.values() if eid == employee_id)

    employee = (await db.execute(
        select(Employee).where(Employee.id == employee_id)
    )).scalars().first()

    house = (await db.execute(
        select(House).where(House.id == house_id)
    )).scalar_one_or_none()

    kwargs = {
        "house_name": (house.name or "") if house else "Unknown",
        "house_code": (house.code or "") if house else "",
        "rso_name": (getattr(employee, "employee_name", None) or "") if employee else "",
        "rso_dms": (getattr(employee, "dms_code", None) or "") if employee else "",
        "rso_itop": (getattr(employee, "itop_number", None) or "") if employee else "",
        "period_text": f"{start_date.strftime('%d %b %Y')} to {end_date.strftime('%d %b %Y')}",
        "today": now_naive().date(),
        "rows": _rows(items),
        "total_retailers": total_retailers,
    }
    if scale is None:
        return _render_pages(**kwargs)
    with _scale.temp(scale):
        return _render_pages(**kwargs)
