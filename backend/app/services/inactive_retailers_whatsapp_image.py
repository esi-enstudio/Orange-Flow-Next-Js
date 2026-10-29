"""Inactive Retailers list image builders (Active SSO / Active LSO reports).

Renders one RSO's inactive-retailer list — the table the /reports/active-sso and
/reports/active-lso "Inactive Retailers" modals show — as a
WhatsApp/Telegram-ready PNG, so the modal's Share action delivers the list
itself instead of the house-wide report image.

Layout (identical for both report types):

    * a header carrying the RSO — name, DMS code and iTopUp number — and
      nothing else (no title, house, period or metric boxes);
    * one table whose header repeats on every continuation page. A long list
      flows onto extra A4 landscape pages.

Only the table differs: Active SSO counts activations done, Active LSO counts
selling days and sales amount. Business rules come from the same services the
modals/APIs use (:class:`ActiveSsoReportService.get_inactive_retailers` /
:class:`ActiveLsoReportService.get_inactive_retailers`) with the same period, so
the image and the modal always show the same list.
"""
import io
from datetime import date, timedelta
from typing import Callable, Sequence

from PIL import Image, ImageDraw
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# Report images are deliberately large (multi-thousand pixel) renders - the size
# is intended, not a decompression bomb.
Image.MAX_IMAGE_PIXELS = None

from app.models.employee import Employee
from app.services.active_lso_report_service import ActiveLsoReportService
from app.services.active_sso_report_service import ActiveSsoReportService
from app.services.report_image_kit import (
    HDR_META_F,
    INK,
    REPORT_BG,
    RenderScale,
    ScaledDraw,
    content_weights,
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

# Header band: one line with the RSO's name, DMS code and iTopUp number. The
# image carries no title, house, period, render time or metric boxes.
HDR_LINE_Y = 26
HDR_H = round((HDR_LINE_Y * 2) * header_scale(IMG_W))

FONT_HEAD = 15
FONT_CELL = 15

EMPTY_TEXT = "No inactive retailers in this period"

# Active SSO: activation counts.
SSO_LABELS = ["#", "House", "Ret Code", "Ret Name", "iTopUp No",
              "Activations Done", "Req. Activations", "No SSO Last Month"]
# Active LSO: selling days and sales amount (the modal's Req. columns show
# remaining/required, the same way the modal renders them).
LSO_LABELS = ["#", "House", "Ret Code", "Ret Name", "iTopUp No", "RSO Number",
              "Days Sold", "Sales Amount", "Req. Sales", "Req. Days",
              "No LSO Last Month"]

# House / Ret Code / Ret Name / iTopUp No (and the LSO RSO Number) read
# left-aligned, the rest centred.
SSO_LEFT_COLS = [1, 2, 3, 4]
LSO_LEFT_COLS = [1, 2, 3, 4, 5]
MUTED = "-"
NOTE_INK = "#5B7290"

RENDER_SCALE = 4
_scale = RenderScale(RENDER_SCALE)


def _rows(items: Sequence[dict], build_row: Callable[[int, dict], list]) -> list[list]:
    return [build_row(idx, r) for idx, r in enumerate(items, start=1)]


def _head(idx: int, r: dict) -> list:
    """The columns every inactive-retailer list starts with."""
    return [
        idx,
        r.get("house_code") or MUTED,
        r.get("retailer_code") or MUTED,
        r.get("name") or MUTED,
        r.get("itop_number") or MUTED,
    ]


def _flag(r: dict) -> str:
    return "Y" if (r.get("inactive_last_month") or "") == "Y" else ""


def _sso_row(idx: int, r: dict) -> list:
    return _head(idx, r) + [
        fmt_num(r.get("activations_done") or 0),
        fmt_num(r.get("required_activations") or 0),
        _flag(r),
    ]


def _remaining_required(remaining, required) -> str:
    return f"{fmt_num(max(0, remaining))}/{fmt_num(required)}"


def _lso_row(idx: int, r: dict) -> list:
    sales = round(float(r.get("sales_amount") or 0))
    required_sales = round(float(r.get("required_sales_amount") or 0))
    days = int(r.get("days_sold") or 0)
    required_days = int(r.get("required_selling_days") or 0)
    return _head(idx, r) + [
        r.get("rso_number") or MUTED,
        fmt_num(days),
        fmt_num(sales),
        _remaining_required(required_sales - sales, required_sales),
        _remaining_required(required_days - days, required_days),
        _flag(r),
    ]


def _render_header(draw, x, y, *, rso_name, rso_dms, rso_itop) -> int:
    """Header band: the RSO's name, DMS code and iTopUp number — nothing else.
    No title, house, period, render time or metric boxes."""
    s = header_scale(IMG_W)
    pad_x = round(16 * s)
    tx = x + pad_x
    max_w = INNER - 2 * pad_x
    f_meta = load_font(round(HDR_META_F * s), True)

    line = f"RSO: {rso_name or MUTED} · DMS {rso_dms or MUTED} · iTopUp {rso_itop or MUTED}"
    draw.text((tx, y + HDR_H / 2), ellipsize(draw, line, f_meta, max_w),
              font=f_meta, fill=INK, anchor="lm")

    return y + HDR_H


def _rows_per_page(row_h: int, *, first_page: bool) -> int:
    avail = CONTENT_H
    if first_page:
        avail -= HDR_H
    return max(1, int(avail // row_h))


def _render_pages(*, rso_name, rso_dms, rso_itop, labels, left_cols,
                  rows: list[list]) -> list[bytes]:
    f_head = load_font(FONT_HEAD, True)
    f_cell = load_font(FONT_CELL, True)
    head_h, row_h = table_heights(f_head, f_cell)
    weights = content_weights(labels, rows, f_head, f_cell, [], max_total=INNER)

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
        used = head_h + row_h * body_rows + GAP
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
            y = _render_header(draw, x, y, rso_name=rso_name,
                               rso_dms=rso_dms, rso_itop=rso_itop)
        draw_table(draw, x, y, INNER, labels, chunk, weights=weights,
                   left_cols=left_cols, f_head=f_head, f_cell=f_cell)
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


async def _employee_header(db: AsyncSession, employee_id: int, *, name_map: bool) -> dict:
    """The RSO identity shown in the header (name, DMS code, iTopUp number)."""
    employee = (await db.execute(
        select(Employee).where(Employee.id == employee_id)
    )).scalars().first()
    if not employee:
        return {"rso_name": "", "rso_dms": "", "rso_itop": ""}

    name = getattr(employee, "employee_name", None) or ""
    if name_map:
        from app.services.active_lso_report_service import employee_name_map
        name = (await employee_name_map(db, [employee.id])).get(employee.id, "") or name

    return {
        "rso_name": name,
        "rso_dms": getattr(employee, "dms_code", None) or "",
        "rso_itop": getattr(employee, "itop_number", None) or "",
    }


async def _build(
    db: AsyncSession,
    house_id: int,
    report_params: dict | None,
    scale: int | None,
    *,
    service_cls,
    build_row: Callable[[int, dict], list],
    labels: list[str],
    left_cols: list[int],
    name_map: bool = False,
) -> list[bytes]:
    """Shared build path: resolve the RSO + period, fetch the list, render it."""
    params = report_params or {}
    try:
        employee_id = int(params.get("employee_id"))
    except (TypeError, ValueError):
        raise ValueError("report_params.employee_id is required for the inactive-retailers report")

    start_date, end_date = _resolve_period(params)
    items = await service_cls(db, house_id, start_date, end_date).get_inactive_retailers(employee_id)

    kwargs = {
        "labels": labels,
        "left_cols": left_cols,
        "rows": _rows(items, build_row),
        **(await _employee_header(db, employee_id, name_map=name_map)),
    }
    if scale is None:
        return _render_pages(**kwargs)
    with _scale.temp(scale):
        return _render_pages(**kwargs)


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
    return await _build(db, house_id, report_params, scale,
                        service_cls=ActiveSsoReportService,
                        build_row=_sso_row, labels=SSO_LABELS,
                        left_cols=SSO_LEFT_COLS)


async def build_active_lso_inactive_retailers_image(
    db: AsyncSession,
    house_id: int,
    *,
    report_params: dict | None = None,
    scale: int | None = None,
) -> list[bytes]:
    """Build one RSO's Active LSO inactive-retailer list as PNG page images.

    Same contract as :func:`build_active_sso_inactive_retailers_image`, rendered
    from :class:`ActiveLsoReportService` with the Active LSO columns (days sold,
    sales amount, remaining/required).
    """
    return await _build(db, house_id, report_params, scale,
                        service_cls=ActiveLsoReportService,
                        build_row=_lso_row, labels=LSO_LABELS,
                        left_cols=LSO_LEFT_COLS, name_map=True)
