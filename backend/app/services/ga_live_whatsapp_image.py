"""Server-side GA Live Report image builder for WhatsApp chat delivery.

Renders the same report the text builder produces (ga_live_whatsapp_text.py)
as a PNG image using Pillow, so the full report is delivered as a WhatsApp
image instead of pasted text.
"""
import io
import math
from datetime import date

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.ga_live_whatsapp_text import _load_report_data, _fmt, _pct
from app.utils.timezone import now_naive

FONT_REG_PATH = "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf"
FONT_BOLD_PATH = "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf"

TITLE_FONT_SIZE = 24
BIG_FONT_SIZE = 72
LABEL_FONT_SIZE = 13
SUB_FONT_SIZE = 13
SECTION_FONT_SIZE = 15
HEADER_FONT_SIZE = 12
CELL_FONT_SIZE = 12

PAD_X = 8
ROW_PAD = 6
MARGIN = 28
SECTION_GAP = 12
BLOCK_GAP = 6
TOTAL_LABEL_H = 18
TOTAL_BLOCK_GAP = 8
TOTAL_BOX_PAD_X = 18
TOTAL_BOX_PAD_Y = 12

BG = "#FFFFFF"
TITLE_COLOR = "#111827"
TEXT_COLOR = "#1F2937"
SECTION_COLOR = "#C2410C"
HEADER_FILL = "#FFEDD5"
HEADER_TEXT = "#7C2D12"
LINE_COLOR = "#D1D5DB"
ZEBRA_FILL = "#F9FAFB"
TOTAL_FILL = "#FEF3C7"
TOTAL_TEXT = "#92400E"
BIG_TOTAL_COLOR = "#C2410C"


def _load_fonts():
    return {
        "title": ImageFont.truetype(FONT_BOLD_PATH, TITLE_FONT_SIZE),
        "big": ImageFont.truetype(FONT_BOLD_PATH, BIG_FONT_SIZE),
        "small": ImageFont.truetype(FONT_REG_PATH, LABEL_FONT_SIZE),
        "sub": ImageFont.truetype(FONT_REG_PATH, SUB_FONT_SIZE),
        "section": ImageFont.truetype(FONT_BOLD_PATH, SECTION_FONT_SIZE),
        "head": ImageFont.truetype(FONT_BOLD_PATH, HEADER_FONT_SIZE),
        "cell": ImageFont.truetype(FONT_REG_PATH, CELL_FONT_SIZE),
    }


def _is_numeric(v) -> bool:
    s = str(v).replace(",", "").replace("%", "").replace(".", "").strip()
    return s.isdigit()


def _col_widths(header: list[str], rows: list[list], fonts) -> list[int]:
    widths: list[int] = []
    for ci, h in enumerate(header):
        w = fonts["head"].getlength(h)
        for row in rows:
            w = max(w, fonts["cell"].getlength(str(row[ci])))
        widths.append(math.ceil(w) + PAD_X * 2)
    return widths


def _draw_cell(draw, x, y, col_w, text, font, fill, right_align: bool):
    if right_align:
        tx = x + col_w - PAD_X - draw.textlength(str(text), font=font)
    else:
        tx = x + PAD_X
    draw.text((tx, y + ROW_PAD), str(text), font=font, fill=fill)


def _draw_table(draw, x, y, header, rows, fonts, total_row: list | None = None) -> float:
    all_rows = rows + ([total_row] if total_row else [])
    widths = _col_widths(header, all_rows, fonts)
    total_w = sum(widths)
    row_h = max(HEADER_FONT_SIZE, CELL_FONT_SIZE) + ROW_PAD * 2

    right_cols = [_is_numeric(h) for h in header]
    for ci in range(len(header)):
        if not right_cols[ci]:
            right_cols[ci] = all(_is_numeric(r[ci]) for r in rows)

    draw.rectangle([x, y, x + total_w, y + row_h], fill=HEADER_FILL)
    for ci, h in enumerate(header):
        _draw_cell(draw, x + sum(widths[:ci]), y, widths[ci], h, fonts["head"], HEADER_TEXT, right_cols[ci])
    yy = y + row_h

    for ri, row in enumerate(rows):
        if ri % 2 == 1:
            draw.rectangle([x, yy, x + total_w, yy + row_h], fill=ZEBRA_FILL)
        for ci, val in enumerate(row):
            _draw_cell(draw, x + sum(widths[:ci]), yy, widths[ci], val, fonts["cell"], TEXT_COLOR, right_cols[ci])
        yy += row_h

    if total_row:
        draw.line([x, yy, x + total_w, yy], fill=LINE_COLOR)
        draw.rectangle([x, yy, x + total_w, yy + row_h], fill=TOTAL_FILL)
        for ci, val in enumerate(total_row):
            _draw_cell(draw, x + sum(widths[:ci]), yy, widths[ci], val, fonts["head"], TOTAL_TEXT, right_cols[ci])
        yy += row_h

    draw.line([x, y, x + total_w, y], fill=LINE_COLOR)
    xx = x
    for w in widths:
        draw.line([xx, y, xx, yy], fill=LINE_COLOR)
        xx += w
    draw.line([xx, y, xx, yy], fill=LINE_COLOR)
    draw.line([x, yy, x + total_w, yy], fill=LINE_COLOR)
    for r in range(1, len(all_rows) + 1):
        ly = y + row_h * r
        draw.line([x, ly, x + total_w, ly], fill=LINE_COLOR)
    return total_w


def _build_sections(house, data: dict, summary: dict, today: date) -> list:
    month_year = today.strftime("%B %Y")
    date_str = today.strftime("%d %B %Y")
    time_str = now_naive().strftime("%I:%M %p").lstrip("0").replace(" 0", " ")

    total_activations = data["summary"].get("total_activations", 0)
    monthly_target = summary.get("monthly_target", 0)
    achievement = summary.get("achievement", 0)
    remaining = summary.get("remaining", 0)
    daily_required = summary.get("daily_required_with_friday", 0)
    days_remaining = summary.get("days_remaining", 0)

    sections: list = [
        ("title", f"GA Live Report ({month_year})"),
        ("total", total_activations),
        ("sub", f"House: {house.name or ''} ({house.code or ''})"),
        ("sub", f"Generated: {date_str}, {time_str}"),
        ("spacer",),
        ("section", "DD Summary"),
        (
            "sub",
            f"Target: {_fmt(monthly_target)} | Ach: {_fmt(achievement)} | "
            f"{_pct(achievement, monthly_target)} | Remain: {_fmt(remaining)} | "
            f"DRR: {_fmt(daily_required)}",
        ),
        ("spacer",),
    ]

    rsos = sorted(data.get("rsos", []), key=lambda x: str(x.get("itop_number") or ""))
    bps = sorted(data.get("bps", []), key=lambda x: str(x.get("pool_number") or ""))
    ccs = sorted(data.get("ccs", []), key=lambda x: str(x.get("name") or ""))
    supervisors = data.get("supervisors", [])

    if rsos:
        rso_header = ["#", "Name", "ITop", "AC", "Trgt", "Own", "Mkt", "Total", "%", "Rem", "YOwn", "YMkt", "YTot"]
        rso_rows = []
        sums = [0, 0, 0, 0, 0, 0, 0, 0]
        for i, item in enumerate(rsos):
            target = (
                math.ceil(item["remaining"] / max(days_remaining, 1))
                if item.get("remaining", 0) > 0
                else 0
            )
            total = item.get("total_activation", 0)
            remain = max(0, target - total)
            own = item.get("own_activation", 0)
            mkt = item.get("market_activation", 0)
            y_own = item.get("yesterday_own", 0)
            y_mkt = item.get("yesterday_market", 0)
            y_tot = item.get("yesterday_total", 0)
            sums[0] += target
            sums[1] += total
            sums[2] += own
            sums[3] += mkt
            sums[4] += remain
            sums[5] += y_own
            sums[6] += y_mkt
            sums[7] += y_tot
            rso_rows.append([
                str(i + 1),
                str(item.get("name", "")),
                str(item.get("itop_number", "") or ""),
                str(item.get("assisted_code", "") or ""),
                _fmt(target),
                _fmt(own),
                _fmt(mkt),
                _fmt(total),
                _pct(total, target),
                _fmt(remain),
                _fmt(y_own),
                _fmt(y_mkt),
                _fmt(y_tot),
            ])
        rso_total = [
            "", "Total", "", "",
            _fmt(sums[0]), _fmt(sums[2]), _fmt(sums[3]), _fmt(sums[1]),
            _pct(sums[1], sums[0]), _fmt(sums[4]),
            _fmt(sums[5]), _fmt(sums[6]), _fmt(sums[7]),
        ]
        sections.append(("section", "RSO PERFORMANCE"))
        sections.append(("table", rso_header, rso_rows, rso_total))

    if bps:
        bp_header = ["#", "Name", "Pool", "AC", "Trgt", "Ach", "%", "Rem", "YGA"]
        bp_rows = []
        sums = [0, 0, 0, 0]
        for i, item in enumerate(bps):
            target = (
                math.ceil(item["remaining"] / max(days_remaining, 1))
                if item.get("remaining", 0) > 0
                else 0
            )
            ach = item.get("own_activation", 0)
            remain = max(0, target - ach)
            yga = item.get("yesterday_activation", 0)
            sums[0] += target
            sums[1] += ach
            sums[2] += remain
            sums[3] += yga
            bp_rows.append([
                str(i + 1),
                str(item.get("name", "")),
                str(item.get("pool_number", "") or ""),
                str(item.get("assisted_code", "") or ""),
                _fmt(target),
                _fmt(ach),
                _pct(ach, target),
                _fmt(remain),
                _fmt(yga),
            ])
        bp_total = [
            "", "Total", "", "",
            _fmt(sums[0]), _fmt(sums[1]), _pct(sums[1], sums[0]), _fmt(sums[2]), _fmt(sums[3]),
        ]
        sections.append(("section", "BP PERFORMANCE"))
        sections.append(("table", bp_header, bp_rows, bp_total))

    if ccs:
        cc_header = ["#", "Name", "AC", "Pool", "TGA", "TotGA", "YGA", "Days"]
        cc_rows = [
            [
                str(i + 1),
                str(item.get("name", "")),
                str(item.get("assisted_code", "") or ""),
                str(item.get("pool_number", "") or ""),
                _fmt(item.get("own_activation", 0)),
                _fmt(item.get("total_ga", 0) or 0),
                _fmt(item.get("yesterday_activation", 0) or 0),
                str(item.get("day_count", 0) or 0),
            ]
            for i, item in enumerate(ccs)
        ]
        sections.append(("section", "CC PERFORMANCE"))
        sections.append(("table", cc_header, cc_rows, None))

    if supervisors:
        sup_header = ["#", "Name", "Pool", "TGA", "YGA"]
        sup_rows = []
        sums = [0, 0]
        for i, item in enumerate(supervisors):
            tga = item.get("total_activation", 0)
            yga = item.get("yesterday_total", 0) or 0
            sums[0] += tga
            sums[1] += yga
            sup_rows.append([
                str(i + 1),
                str(item.get("name", "")),
                str(item.get("pool_number", "") or ""),
                _fmt(tga),
                _fmt(yga),
            ])
        sup_total = ["", "Total", "", _fmt(sums[0]), _fmt(sums[1])]
        sections.append(("section", "SUPERVISOR PERFORMANCE"))
        sections.append(("table", sup_header, sup_rows, sup_total))

    return sections


def _measure_sections(sections, fonts) -> tuple[int, int]:
    """Return (total_height, max_text_width) using font metrics only."""
    total_h = MARGIN
    max_w = 0
    top_box_min = 0
    for idx, sec in enumerate(sections):
        kind = sec[0]
        if kind == "spacer":
            total_h += BLOCK_GAP
            continue
        if kind == "title":
            w = fonts["title"].getlength(sec[1])
            nxt = sections[idx + 1] if idx + 1 < len(sections) else None
            if nxt and nxt[0] == "total":
                bw = max(
                    fonts["small"].getlength("Total Activations"),
                    fonts["big"].getlength(_fmt(nxt[1])),
                )
                w = w + BLOCK_GAP + bw + TOTAL_BOX_PAD_X * 2
                box_h = TOTAL_LABEL_H + 2 + BIG_FONT_SIZE + TOTAL_BOX_PAD_Y * 2
                top_box_min = box_h + MARGIN * 2
            total_h += TITLE_FONT_SIZE + BLOCK_GAP
            max_w = max(max_w, w)
        elif kind == "section":
            w = fonts["section"].getlength(sec[1])
            max_w = max(max_w, w)
            total_h += SECTION_FONT_SIZE + BLOCK_GAP
        elif kind == "sub":
            w = fonts["sub"].getlength(sec[1])
            max_w = max(max_w, w)
            total_h += SUB_FONT_SIZE + 2
        elif kind == "table":
            _, header, rows, total_row = sec
            all_rows = rows + ([total_row] if total_row else [])
            widths = _col_widths(header, all_rows, fonts)
            max_w = max(max_w, sum(widths))
            row_h = max(HEADER_FONT_SIZE, CELL_FONT_SIZE) + ROW_PAD * 2
            total_h += row_h * (len(all_rows) + 1) + BLOCK_GAP
    total_h += MARGIN
    if top_box_min:
        total_h = max(total_h, top_box_min)
    return total_h, max_w


def _render_image(house, data: dict, summary: dict, today: date) -> bytes:
    fonts = _load_fonts()
    sections = _build_sections(house, data, summary, today)

    height, content_w = _measure_sections(sections, fonts)
    width = max(content_w, 500) + MARGIN * 2

    img = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(img)
    x = MARGIN
    x_right = width - MARGIN
    y = MARGIN

    for idx, sec in enumerate(sections):
        kind = sec[0]
        if kind == "spacer":
            y += BLOCK_GAP
            continue
        if kind == "title":
            draw.text((x, y), sec[1], font=fonts["title"], fill=TITLE_COLOR)
            nxt = sections[idx + 1] if idx + 1 < len(sections) else None
            if not (nxt and nxt[0] == "total"):
                y += TITLE_FONT_SIZE + BLOCK_GAP
        elif kind == "total":
            value = _fmt(sec[1])
            label = "Total Activations"
            label_w = fonts["small"].getlength(label)
            val_w = fonts["big"].getlength(value)
            block_w = max(label_w, val_w)
            box_w = block_w + TOTAL_BOX_PAD_X * 2
            box_h = TOTAL_LABEL_H + 2 + BIG_FONT_SIZE + TOTAL_BOX_PAD_Y * 2
            bx = x_right - box_w
            draw.rounded_rectangle(
                [bx, y, bx + box_w, y + box_h],
                radius=14,
                fill=TOTAL_FILL,
                outline=TOTAL_TEXT,
            )
            lx = bx + TOTAL_BOX_PAD_X + block_w - label_w
            draw.text((lx, y + TOTAL_BOX_PAD_Y), label, font=fonts["small"], fill=TOTAL_TEXT)
            tx = bx + TOTAL_BOX_PAD_X + block_w - draw.textlength(value, font=fonts["big"])
            draw.text((tx, y + TOTAL_BOX_PAD_Y + TOTAL_LABEL_H + 2), value, font=fonts["big"], fill=BIG_TOTAL_COLOR)
            y += TITLE_FONT_SIZE + BLOCK_GAP
        elif kind == "section":
            draw.text((x, y), sec[1], font=fonts["section"], fill=SECTION_COLOR)
            y += SECTION_FONT_SIZE + BLOCK_GAP
        elif kind == "sub":
            draw.text((x, y), sec[1], font=fonts["sub"], fill=TEXT_COLOR)
            y += SUB_FONT_SIZE + 2
        elif kind == "table":
            _, header, rows, total_row = sec
            _draw_table(draw, x, y, header, rows, fonts, total_row)
            row_h = max(HEADER_FONT_SIZE, CELL_FONT_SIZE) + ROW_PAD * 2
            all_rows = rows + ([total_row] if total_row else [])
            y += row_h * (len(all_rows) + 1) + BLOCK_GAP

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


async def build_ga_live_report_image(db: AsyncSession, house_id: int) -> bytes:
    """Build the full GA live report as a PNG image."""
    today = now_naive().date()
    house, data, summary = await _load_report_data(db, house_id, today)
    return _render_image(house, data, summary, today)
