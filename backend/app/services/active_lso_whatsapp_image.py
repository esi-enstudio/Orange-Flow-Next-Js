"""Active LSO Report image builder for WhatsApp/Telegram delivery.

Renders a summary card with RSO-level performance as a PNG image.
"""
import io
import math
from datetime import date, timedelta

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.active_lso_report_service import ActiveLsoReportService
from app.utils.timezone import now_naive

FONT_REG_PATH = "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf"
FONT_BOLD_PATH = "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf"

TITLE_FONT_SIZE = 22
SECTION_FONT_SIZE = 14
HEADER_FONT_SIZE = 11
CELL_FONT_SIZE = 10
SMALL_FONT_SIZE = 9

MARGIN = 24
BLOCK_GAP = 14
ROW_PAD = 6

BG = "#FFFFFF"
TITLE_COLOR = "#1a1a2e"
SECTION_COLOR = "#2563eb"
HEADER_BG = "#f1f5f9"
HEADER_TEXT = "#334155"
CELL_TEXT = "#1e293b"
LINE_COLOR = "#cbd5e1"
STATUS_COLORS = {
    "achieved": "#16a34a",
    "on_track": "#2563eb",
    "needs_attention": "#d97706",
    "behind": "#dc2626",
}


def _load_fonts():
    try:
        title = ImageFont.truetype(FONT_BOLD_PATH, TITLE_FONT_SIZE)
        section = ImageFont.truetype(FONT_BOLD_PATH, SECTION_FONT_SIZE)
        header = ImageFont.truetype(FONT_BOLD_PATH, HEADER_FONT_SIZE)
        cell = ImageFont.truetype(FONT_REG_PATH, CELL_FONT_SIZE)
        small = ImageFont.truetype(FONT_REG_PATH, SMALL_FONT_SIZE)
    except OSError:
        title = ImageFont.load_default()
        section = title
        header = title
        cell = title
        small = title
    return {"title": title, "section": section, "header": header, "cell": cell, "small": small}


def _fmt(n):
    if n is None:
        return "0"
    if isinstance(n, float):
        return f"{n:,.1f}" if n != int(n) else f"{int(n):,}"
    return f"{n:,}"


def _pct(part, whole):
    if not whole:
        return "0%"
    return f"{part / whole * 100:.1f}%"


def _col_widths(header, rows, fonts):
    widths = []
    for ci, h in enumerate(header):
        w = fonts["header"].getlength(str(h))
        for row in rows:
            if ci < len(row):
                w = max(w, fonts["cell"].getlength(str(row[ci])))
        widths.append(w)
    return widths


def _draw_table(draw, x, y, header, rows, fonts, total_row=None):
    all_rows = rows + ([total_row] if total_row else [])
    widths = _col_widths(header, all_rows, fonts)
    total_w = sum(widths) + ROW_PAD * 2 * len(header)
    row_h = max(HEADER_FONT_SIZE, CELL_FONT_SIZE) + ROW_PAD * 2

    # Header background
    draw.rectangle([x, y, x + total_w, y + row_h], fill=HEADER_BG)
    xx = x
    for ci, h in enumerate(header):
        draw.text((xx + ROW_PAD, y + ROW_PAD), str(h), font=fonts["header"], fill=HEADER_TEXT)
        xx += widths[ci] + ROW_PAD * 2
    draw.line([x, y + row_h, x + total_w, y + row_h], fill=LINE_COLOR)

    # Data rows
    for ri, row in enumerate(all_rows):
        ry = y + row_h * (ri + 1)
        xx = x
        for ci in range(len(header)):
            val = str(row[ci]) if ci < len(row) else ""
            draw.text((xx + ROW_PAD, ry + ROW_PAD), val, font=fonts["cell"], fill=CELL_TEXT)
            xx += widths[ci] + ROW_PAD * 2
        draw.line([x, ry + row_h, x + total_w, ry + row_h], fill=LINE_COLOR)

    # Vertical lines
    xx = x
    for ci in range(len(header) + 1):
        draw.line([xx, y, xx, y + row_h * (len(all_rows) + 1)], fill=LINE_COLOR)
        if ci < len(header):
            xx += widths[ci] + ROW_PAD * 2

    return total_w


def _render_image(house_name: str, house_code: str, dashboard: dict) -> bytes:
    fonts = _load_fonts()
    today = now_naive().date()
    period = dashboard.get("period", {})
    summary = dashboard.get("summary", {})
    rows = dashboard.get("rows", [])

    month_year = today.strftime("%B %Y")
    date_str = today.strftime("%d %B %Y")
    time_str = now_naive().strftime("%I:%M %p").lstrip("0").replace(" 0", " ")

    # Build content
    content_lines = []
    content_lines.append(("title", f"Active LSO Report ({month_year})"))
    content_lines.append(("sub", f"House: {house_name} ({house_code})"))
    content_lines.append(("sub", f"Generated: {date_str}, {time_str}"))
    content_lines.append(("spacer",))

    # Summary section
    total_rso = summary.get("rso_count", 0)
    total_retailers = summary.get("retailer_count", 0)
    target = summary.get("target", 0)
    achieved = summary.get("achieved", 0)
    ach_pct = summary.get("ach_pct", 0)
    remaining = summary.get("remaining", 0)
    status = summary.get("status", "behind")

    content_lines.append(("section", "Summary"))
    content_lines.append(("sub", f"RSOs: {total_rso} | Retailers: {total_retailers}"))
    content_lines.append(("sub", f"Target: {_fmt(target)} | Achieved: {_fmt(achieved)} ({_pct(achieved, target)}) | Remaining: {_fmt(remaining)}"))
    content_lines.append(("sub", f"Status: {status.replace('_', ' ').title()}"))
    content_lines.append(("spacer",))

    # RSO table
    if rows:
        header = ["#", "RSO Name", "Supervisor", "Target", "Achieved", "%", "Status"]
        table_rows = []
        for i, r in enumerate(rows):
            table_rows.append([
                str(i + 1),
                str(r.get("name", ""))[:20],
                str(r.get("supervisor_name", "") or "")[:15],
                _fmt(r.get("target", 0)),
                _fmt(r.get("achieved", 0)),
                _pct(r.get("achieved", 0), r.get("target", 0)),
                r.get("status", "").replace("_", " ").title(),
            ])
        total_row = [
            "", "Total", "",
            _fmt(target),
            _fmt(achieved),
            _pct(achieved, target),
            status.replace("_", " ").title(),
        ]
        content_lines.append(("section", "RSO Performance"))
        content_lines.append(("table", header, table_rows, total_row))

    # Measure dimensions
    total_h = MARGIN
    max_w = 0
    for kind, *rest in content_lines:
        if kind == "spacer":
            total_h += BLOCK_GAP
        elif kind == "title":
            w = fonts["title"].getlength(rest[0])
            max_w = max(max_w, w)
            total_h += TITLE_FONT_SIZE + BLOCK_GAP
        elif kind == "section":
            w = fonts["section"].getlength(rest[0])
            max_w = max(max_w, w)
            total_h += SECTION_FONT_SIZE + BLOCK_GAP
        elif kind == "sub":
            w = fonts["small"].getlength(rest[0])
            max_w = max(max_w, w)
            total_h += SMALL_FONT_SIZE + 4
        elif kind == "table":
            header_row, data_rows, tot_row = rest
            all_r = data_rows + ([tot_row] if tot_row else [])
            widths = _col_widths(header_row, all_r, fonts)
            tw = sum(widths) + ROW_PAD * 2 * len(header_row)
            max_w = max(max_w, tw)
            rh = max(HEADER_FONT_SIZE, CELL_FONT_SIZE) + ROW_PAD * 2
            total_h += rh * (len(all_r) + 1) + BLOCK_GAP
    total_h += MARGIN

    width = max(max_w, 500) + MARGIN * 2
    img = Image.new("RGB", (int(width), int(total_h)), BG)
    draw = ImageDraw.Draw(img)
    x = MARGIN
    y = MARGIN

    for kind, *rest in content_lines:
        if kind == "spacer":
            y += BLOCK_GAP
        elif kind == "title":
            draw.text((x, y), rest[0], font=fonts["title"], fill=TITLE_COLOR)
            y += TITLE_FONT_SIZE + BLOCK_GAP
        elif kind == "section":
            draw.text((x, y), rest[0], font=fonts["section"], fill=SECTION_COLOR)
            y += SECTION_FONT_SIZE + BLOCK_GAP
        elif kind == "sub":
            draw.text((x, y), rest[0], font=fonts["small"], fill=CELL_TEXT)
            y += SMALL_FONT_SIZE + 4
        elif kind == "table":
            header_row, data_rows, tot_row = rest
            _draw_table(draw, x, y, header_row, data_rows, fonts, tot_row)
            all_r = data_rows + ([tot_row] if tot_row else [])
            rh = max(HEADER_FONT_SIZE, CELL_FONT_SIZE) + ROW_PAD * 2
            y += rh * (len(all_r) + 1) + BLOCK_GAP

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


async def build_active_lso_report_image(db: AsyncSession, house_id: int) -> bytes:
    """Build the Active LSO report as a PNG image."""
    today = now_naive().date()
    start_date = today.replace(day=1)
    if today.month == 12:
        end_date = date(today.year + 1, 1, 1) - timedelta(days=1)
    else:
        end_date = date(today.year, today.month + 1, 1) - timedelta(days=1)

    svc = ActiveLsoReportService(db, house_id, start_date, end_date)
    dashboard = await svc.build_dashboard()

    # Get house name
    from sqlalchemy import select
    from app.models.house import House
    result = await db.execute(select(House).where(House.id == house_id))
    house = result.scalar_one_or_none()
    house_name = house.name if house else "Unknown"
    house_code = house.code if house else ""

    return _render_image(house_name, house_code, dashboard)
