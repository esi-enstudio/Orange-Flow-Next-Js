"""Activation Report image builder for WhatsApp/Telegram delivery.

Renders the current month's activation dashboard (house summary + RSO/BP/CC/
Supervisor performance) as a PNG image, mirroring the data served by the
``reports/activations/dashboard`` endpoint.
"""
import io

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.activation_report_service import ActivationReportService
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
SUBTOTAL_TEXT = "#0f172a"
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


def _status_label(s):
    return (s or "behind").replace("_", " ").title()


def _status_color(s):
    key = (s or "behind").lower().replace(" ", "_")
    return STATUS_COLORS.get(key, CELL_TEXT)


def _summary_status(ach_pct, proj_pct):
    if ach_pct >= 100:
        return "achieved"
    if proj_pct >= 100:
        return "on_track"
    if proj_pct >= 95:
        return "needs_attention"
    return "behind"


def _col_widths(header, rows, fonts):
    widths = []
    for ci, h in enumerate(header):
        w = fonts["header"].getlength(str(h))
        for row in rows:
            if ci < len(row):
                w = max(w, fonts["cell"].getlength(str(row[ci])))
        widths.append(w)
    return widths


def _draw_table(draw, x, y, header, rows, fonts, total_row=None, status_col=None):
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
        is_total = total_row is not None and ri == len(all_rows) - 1
        xx = x
        for ci in range(len(header)):
            val = str(row[ci]) if ci < len(row) else ""
            if is_total:
                fill = SUBTOTAL_TEXT
                font = fonts["header"]
            elif status_col is not None and ci == status_col:
                fill = _status_color(val)
                font = fonts["cell"]
            else:
                fill = CELL_TEXT
                font = fonts["cell"]
            draw.text((xx + ROW_PAD, ry + ROW_PAD), val, font=font, fill=fill)
            xx += widths[ci] + ROW_PAD * 2
        draw.line([x, ry + row_h, x + total_w, ry + row_h], fill=LINE_COLOR)

    # Vertical lines
    xx = x
    for ci in range(len(header) + 1):
        draw.line([xx, y, xx, y + row_h * (len(all_rows) + 1)], fill=LINE_COLOR)
        if ci < len(header):
            xx += widths[ci] + ROW_PAD * 2

    return total_w


def _build_section_rows(employees, section_type: str):
    """Convert employee rows into [.., ..] table rows + a subtotal row."""
    rows = []
    for i, emp in enumerate(employees):
        percentage = float(emp.get("percentage") or 0)
        ach = emp.get("achievement") or 0
        tgt = emp.get("target") or 0
        proj = emp.get("projection") or 0
        proj_pct = round(proj / tgt * 100) if tgt else 0
        status = "achieved" if percentage >= 100 else ("on_track" if proj_pct >= 100 else ("needs_attention" if proj_pct >= 95 else "behind"))
        if section_type == "rso":
            rows.append([
                str(i + 1),
                str(emp.get("name") or "")[:22],
                str(emp.get("itop_number") or "")[:14],
                _fmt(tgt),
                _fmt(ach),
                f"{percentage:g}%",
                _fmt(emp.get("remaining") or 0),
                _fmt(emp.get("daily_average") or 0),
                _fmt(proj),
                f"Y {_fmt(emp.get('market_yesterday') or 0)}/M {_fmt(emp.get('market_activation') or 0)}",
                f"Y {_fmt(emp.get('yesterday_activation') or 0)}/M {_fmt(emp.get('month_total_activation') or 0)}",
                _status_label(status),
            ])
        elif section_type == "bp":
            rows.append([
                str(i + 1),
                str(emp.get("name") or "")[:22],
                str(emp.get("pool_number") or "")[:14],
                _fmt(tgt),
                _fmt(ach),
                f"{percentage:g}%",
                _fmt(emp.get("remaining") or 0),
                _fmt(emp.get("daily_average") or 0),
                _fmt(proj),
                _fmt(emp.get("yesterday_activation") or 0),
                str(emp.get("active_days") or 0),
                _status_label(status),
            ])
        elif section_type == "supervisor":
            rows.append([
                str(i + 1),
                str(emp.get("name") or "")[:22],
                str(emp.get("pool_number") or "")[:14],
                _fmt(tgt),
                _fmt(ach),
                f"{percentage:g}%",
                _fmt(emp.get("remaining") or 0),
                _fmt(emp.get("daily_average") or 0),
                _fmt(proj),
                _fmt(emp.get("yesterday_activation") or 0),
                _status_label(status),
            ])
        else:
            rows.append([
                str(i + 1),
                str(emp.get("name") or "")[:22],
                "—",
                _fmt(tgt),
                _fmt(ach),
                f"{percentage:g}%",
                _fmt(emp.get("remaining") or 0),
                _fmt(emp.get("daily_average") or 0),
                _fmt(proj),
                _status_label(status),
            ])

    total = {
        "target": sum(e.get("target") or 0 for e in employees),
        "achievement": sum(e.get("achievement") or 0 for e in employees),
        "remaining": sum(e.get("remaining") or 0 for e in employees),
        "projection": sum(e.get("projection") or 0 for e in employees),
        "daily_average": sum(e.get("daily_average") or 0 for e in employees),
        "market_yesterday": sum(e.get("market_yesterday") or 0 for e in employees),
        "market_activation": sum(e.get("market_activation") or 0 for e in employees),
        "yesterday_activation": sum(e.get("yesterday_activation") or 0 for e in employees),
        "month_total_activation": sum(e.get("month_total_activation") or 0 for e in employees),
        "active_days": sum(e.get("active_days") or 0 for e in employees),
    }
    tgt = total["target"]
    ach = total["achievement"]
    total_pct = round(ach / tgt * 100) if tgt else 0
    proj_pct = round(total["projection"] / tgt * 100) if tgt else 0
    status = "achieved" if total_pct >= 100 else ("on_track" if proj_pct >= 100 else ("needs_attention" if proj_pct >= 95 else "behind"))

    if section_type == "rso":
        subtotal = [
            "", "Subtotal", "",
            _fmt(tgt), _fmt(ach), f"{total_pct}%",
            _fmt(total["remaining"]), _fmt(round(total["daily_average"])),
            _fmt(round(total["projection"])),
            f"Y {_fmt(total['market_yesterday'])}/M {_fmt(total['market_activation'])}",
            f"Y {_fmt(total['yesterday_activation'])}/M {_fmt(total['month_total_activation'])}",
            _status_label(status),
        ]
    elif section_type == "bp":
        subtotal = [
            "", "Subtotal", "",
            _fmt(tgt), _fmt(ach), f"{total_pct}%",
            _fmt(total["remaining"]), _fmt(round(total["daily_average"])),
            _fmt(round(total["projection"])),
            _fmt(total["yesterday_activation"]),
            str(total["active_days"]),
            _status_label(status),
        ]
    elif section_type == "supervisor":
        subtotal = [
            "", "Subtotal", "",
            _fmt(tgt), _fmt(ach), f"{total_pct}%",
            _fmt(total["remaining"]), _fmt(round(total["daily_average"])),
            _fmt(round(total["projection"])),
            _fmt(total["yesterday_activation"]),
            _status_label(status),
        ]
    else:
        subtotal = [
            "", "Subtotal", "",
            _fmt(tgt), _fmt(ach), f"{total_pct}%",
            _fmt(total["remaining"]), _fmt(round(total["daily_average"])),
            _fmt(round(total["projection"])),
            _status_label(status),
        ]
    return rows, subtotal


def _render_image(house_name: str, house_code: str, dashboard: dict) -> bytes:
    fonts = _load_fonts()
    today = now_naive().date()
    summary = dashboard.get("summary", {})

    month_name = today.strftime("%B %Y")
    date_str = today.strftime("%d %B %Y")
    time_str = now_naive().strftime("%I:%M %p").lstrip("0").replace(" 0", " ")

    target = summary.get("monthly_target") or 0
    achievement = summary.get("achievement") or 0
    ach_pct = summary.get("achievement_percentage") or 0
    remaining = summary.get("remaining") or 0
    daily_avg = summary.get("daily_average") or 0
    projection = summary.get("projection") or 0
    expected_pct = summary.get("expected_percentage") or 0
    daily_required = summary.get("daily_required") or 0
    daily_required_wf = summary.get("daily_required_with_friday") or 0
    yesterday = summary.get("yesterday_activation") or 0
    days_elapsed = summary.get("days_elapsed") or 0
    days_remaining = summary.get("days_remaining") or 0
    total_days = summary.get("total_days") or 0
    status = _summary_status(ach_pct, projection / target * 100 if target else 0)

    # Build content
    content_lines = []
    content_lines.append(("title", f"Activation Report ({month_name})"))
    content_lines.append(("sub", f"House: {house_name} ({house_code})"))
    content_lines.append(("sub", f"Generated: {date_str}, {time_str}"))
    content_lines.append(("spacer",))

    content_lines.append(("section", "Summary"))
    content_lines.append(("sub", f"Target: {_fmt(target)} | Ach: {_fmt(achievement)} ({ach_pct:g}%) | Remaining: {_fmt(remaining)}"))
    content_lines.append(("sub", f"Daily Required: {_fmt(daily_required)} | D.Avg: {_fmt(daily_avg)} | Projection: {_fmt(projection)} ({expected_pct:g}%)"))
    content_lines.append(("sub", f"Yesterday: {_fmt(yesterday)} | Days: {days_elapsed}/{total_days} elapsed, {days_remaining} remaining"))
    content_lines.append(("status", status))
    content_lines.append(("spacer",))

    sections = [
        ("rso", "RSO PERFORMANCE", dashboard.get("rso_performance", []),
         ["#", "Name", "Itopup", "Target", "Ach", "%", "Remain", "D.Avg", "Proj", "Market", "Own Active", "Status"], 11),
        ("bp", "BP PERFORMANCE", dashboard.get("bp_performance", []),
         ["#", "Name", "Pool", "Target", "Ach", "%", "Remain", "D.Avg", "Proj", "Yesterday", "Day Cnt", "Status"], 11),
        ("cc", "CC PERFORMANCE", dashboard.get("cc_performance", []),
         ["#", "Name", "Ident", "Target", "Ach", "%", "Remaining", "D.Avg", "Projection", "Status"], 9),
        ("supervisor", "SUPERVISOR PERFORMANCE", dashboard.get("supervisor_performance", []),
         ["#", "Name", "Pool", "Target", "Ach", "%", "Remain", "D.Avg", "Proj", "Yesterday", "Status"], 10),
    ]

    # Measure dimensions first (two passes: measure, then render).
    total_h = MARGIN
    max_w = 0
    for kind, *rest in content_lines:
        if kind == "spacer":
            total_h += BLOCK_GAP
        elif kind == "title":
            max_w = max(max_w, fonts["title"].getlength(rest[0]))
            total_h += TITLE_FONT_SIZE + BLOCK_GAP
        elif kind == "section":
            max_w = max(max_w, fonts["section"].getlength(rest[0]))
            total_h += SECTION_FONT_SIZE + BLOCK_GAP
        elif kind == "sub":
            max_w = max(max_w, fonts["small"].getlength(rest[0]))
            total_h += SMALL_FONT_SIZE + 4
        elif kind == "status":
            total_h += SMALL_FONT_SIZE + BLOCK_GAP
    for sec_type, label, emps, header, status_col in sections:
        if not emps:
            continue
        max_w = max(max_w, fonts["section"].getlength(label))
        rows, subtotal = _build_section_rows(emps, sec_type)
        all_r = rows + [subtotal]
        tw = sum(_col_widths(header, all_r, fonts)) + ROW_PAD * 2 * len(header)
        max_w = max(max_w, tw)
        rh = max(HEADER_FONT_SIZE, CELL_FONT_SIZE) + ROW_PAD * 2
        total_h += SECTION_FONT_SIZE + BLOCK_GAP + rh * (len(all_r) + 1) + BLOCK_GAP
    total_h += MARGIN

    width = max(int(max_w), 500) + MARGIN * 2
    img = Image.new("RGB", (width, int(total_h)), BG)
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
        elif kind == "status":
            draw.text((x, y), f"Status: {_status_label(rest[0])}", font=fonts["small"], fill=_status_color(rest[0]))
            y += SMALL_FONT_SIZE + BLOCK_GAP

    for sec_type, label, emps, header, status_col in sections:
        if not emps:
            continue
        draw.text((x, y), label, font=fonts["section"], fill=SECTION_COLOR)
        y += SECTION_FONT_SIZE + BLOCK_GAP
        rows, subtotal = _build_section_rows(emps, sec_type)
        _draw_table(draw, x, y, header, rows, fonts, subtotal, status_col)
        rh = max(HEADER_FONT_SIZE, CELL_FONT_SIZE) + ROW_PAD * 2
        y += rh * (len(rows) + 2) + BLOCK_GAP

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


async def build_activation_report_image(db: AsyncSession, house_id: int) -> bytes:
    """Build the current month's Activation Report as a PNG image."""
    today = now_naive().date()
    svc = ActivationReportService(db, house_id, today.month, today.year)
    dashboard = await svc.build_dashboard()

    from sqlalchemy import select
    from app.models.house import House

    result = await db.execute(select(House).where(House.id == house_id))
    house = result.scalar_one_or_none()
    house_name = house.name if house else "Unknown"
    house_code = house.code if house else ""

    return _render_image(house_name, house_code, dashboard)