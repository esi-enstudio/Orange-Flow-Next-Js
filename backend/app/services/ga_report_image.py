"""Generic server-side table image builder for WhatsApp delivery.

Renders an arbitrary table (title, subtitle, header, rows, optional totals
row) as a PNG using Pillow. Used by the GA Report Builder so reports can be
sent to WhatsApp as an image regardless of the selected columns.
"""
import io
import math

from PIL import Image, ImageDraw, ImageFont

FONT_REG_PATH = "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf"
FONT_BOLD_PATH = "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf"

TITLE_FONT_SIZE = 20
SUB_FONT_SIZE = 12
HEADER_FONT_SIZE = 12
CELL_FONT_SIZE = 12

PAD_X = 8
ROW_PAD = 6
MARGIN = 28
BLOCK_GAP = 8

BG = "#FFFFFF"
TITLE_COLOR = "#111827"
TEXT_COLOR = "#1F2937"
HEADER_FILL = "#FFEDD5"
HEADER_TEXT = "#7C2D12"
LINE_COLOR = "#D1D5DB"
ZEBRA_FILL = "#F9FAFB"
TOTAL_FILL = "#FEF3C7"
TOTAL_TEXT = "#92400E"


def _load_fonts():
    return {
        "title": ImageFont.truetype(FONT_BOLD_PATH, TITLE_FONT_SIZE),
        "sub": ImageFont.truetype(FONT_REG_PATH, SUB_FONT_SIZE),
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


def _draw_table(draw, x, y, header, rows, fonts, total_row) -> float:
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


def build_report_image(
    title: str,
    subtitle: str,
    header: list[str],
    rows: list[list],
    total_row: list | None = None,
) -> bytes:
    fonts = _load_fonts()

    row_h = max(HEADER_FONT_SIZE, CELL_FONT_SIZE) + ROW_PAD * 2
    all_rows = rows + ([total_row] if total_row else [])
    widths = _col_widths(header, all_rows, fonts)
    content_w = max(sum(widths), fonts["title"].getlength(title), fonts["sub"].getlength(subtitle))
    width = content_w + MARGIN * 2

    height = MARGIN + TITLE_FONT_SIZE + BLOCK_GAP + SUB_FONT_SIZE + BLOCK_GAP + row_h * (len(all_rows) + 1) + MARGIN

    img = Image.new("RGB", (int(width), int(height)), BG)
    draw = ImageDraw.Draw(img)
    x = MARGIN
    y = MARGIN

    draw.text((x, y), title, font=fonts["title"], fill=TITLE_COLOR)
    y += TITLE_FONT_SIZE + BLOCK_GAP
    draw.text((x, y), subtitle, font=fonts["sub"], fill=TEXT_COLOR)
    y += SUB_FONT_SIZE + BLOCK_GAP

    _draw_table(draw, x, y, header, rows, fonts, total_row)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()