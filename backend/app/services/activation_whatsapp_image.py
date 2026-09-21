"""Activation Report image builder for WhatsApp/Telegram delivery.

Renders the current month's Activation Dashboard as a clean business-style
PNG mirroring the `/reports/activations` dashboard rules:

    * Status        -> projectionStatus(achPct, projPct) identity with the
                       dashboard page: achieved / on_track / needs_attention /
                       behind (see ``projectionStatus`` in page.tsx)
    * Percentage    -> coloured by pct thresholds (>=100 emerald, >=70 blue,
                       >=40 amber, else red)
    * DRR           -> ceil(remaining / days_remaining) like the page table
    * Daily Require -> daily_required (excl. Fridays); subtitle shows the
                       with-Friday value
    * RSO           -> Market GA "Yest: x • MTD: y" + Own GA
                       "Yest: x • MTD: y • Day: z" one-line cells, type badge,
                       Itop Number column
    * BP            -> Yesterday + Day Count columns, type badge, Pool Number
                       column
    * Subtotal      -> aggregated per table using the dashboard formulas

Layout:
    * Navy header with a light "YESTERDAY ACTIVATION" metric card on the right
    * House metric-card rows (large numbers)
    * Per-supervisor navy banner with Target / Ach / Ach% / Remain / DRR /
      D.Avg / Projection / Proj% / Yest.Mkt / Yest.FF / Yest.Total + Status
    * Fully bordered RSO and BP tables (dynamic column widths, vertical grid)
    * Footer
"""
import io
import math
from contextlib import contextmanager
from datetime import date

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy.ext.asyncio import AsyncSession

# We deliberately generate large (multi-thousand pixel) report images at
# RENDER_SCALE below - the size is intended, not a decompression bomb.
Image.MAX_IMAGE_PIXELS = None

from app.services.activation_report_service import ActivationReportService
from app.utils.timezone import now_naive

FONT_REG_CANDIDATES = [
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]
FONT_BOLD_CANDIDATES = [
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]

# -- Design palette (business report) --
BG_COLOR = "#F4F7FC"
WHITE = "#FFFFFF"
NAVY = "#084182"
NAVY_SOFT = "#B3D4FF"
PURPLE = "#403294"
TABLE_HDR_BG = "#DEEBFF"
BP_ROW_BG = "#F1F5FB"
SUB_ROW_BG = "#EAF2FF"
CARD_BORDER = "#E0E6ED"
TEXT_DARK = "#172B4D"
MUTED = "#5E6C84"
SUB_INK = "#084182"
AMBER = "#F59E0B"
GREEN = "#10B981"
GRID_LINE = "#AFC2DB"
OUTER_LINE = "#5C76A4"

# Status pill colours (mirror page.tsx statusColors)
STATUS_COLORS = {
    "achieved": "#10B981",
    "on_track": "#3B82F6",
    "needs_attention": "#F59E0B",
    "behind": "#EF4444",
}
STATUS_LABELS = {
    "achieved": "Achieved",
    "on_track": "On Track",
    "needs_attention": "Needs Attention",
    "behind": "Behind",
}

BADGE_COLORS = {"rso": "#2563EB", "bp": "#D97706"}


# -- Dashboard business rules (mirror page.tsx / export-activations.ts) --
def _projection_status(ach_pct: float, proj_pct: float) -> str:
    if ach_pct >= 100:
        return "achieved"
    if proj_pct >= 100:
        return "on_track"
    if proj_pct >= 95:
        return "needs_attention"
    return "behind"


def _status_color(status: str) -> str:
    return STATUS_COLORS.get(status, MUTED)


def _pct_color(p: float) -> str:
    if p >= 100:
        return STATUS_COLORS["achieved"]
    if p >= 70:
        return STATUS_COLORS["on_track"]
    if p >= 40:
        return AMBER
    return STATUS_COLORS["behind"]


# -- Layout constants (design units, 1080 wide) --
WIDTH = 1080
MARGIN = 24
TBL_X0 = MARGIN
TBL_X1 = WIDTH - MARGIN

HDR_H = 120
CARD_H = 92
CARD_GAP = 12
BANNER_H = 62
HEADER_H = 28
ROW_H = 30
SUB_H = 26
FOOTER_H = 44
BLK_GAP = 10            # gap between banner and the first table
TBL_SPLIT_GAP = 12      # gap between the RSO and BP tables inside one block
CAPTION_H = 24          # small labelled band above each table
AFTER_SUMMARY_GAP = 14  # gap between the summary region and the first banner

# Summary region: header top gap + two card rows + the days subtitle line.
SUMMARY_HEIGHT = (CARD_H + CARD_GAP) * 2 + 22
BLOCKS_TOP = HDR_H + 12 + SUMMARY_HEIGHT + AFTER_SUMMARY_GAP

# Minimum canvas height stays portrait (taller than wide) for small datasets.
PORTRAIT_MIN_RATIO = 1.0

PAD_X = 8          # horizontal padding inside each table cell

_FONTS: dict = {}


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    key = (size, bold)
    if key not in _FONTS:
        for path in (FONT_BOLD_CANDIDATES if bold else FONT_REG_CANDIDATES):
            try:
                _FONTS[key] = ImageFont.truetype(path, size)
                break
            except (OSError, IOError):
                continue
        else:
            _FONTS[key] = ImageFont.load_default()
    return _FONTS[key]


# -- Native high-resolution rendering --
# All layout math stays in the 1080-wide design space; ScaledDraw renders
# every coordinate and font natively at RENDER_SCALE so text stays crisp.
RENDER_SCALE = 6

_override_scale: int | None = None
_FONTS_SCALED: dict = {}


def _active_scale() -> int:
    return _override_scale if _override_scale is not None else RENDER_SCALE


@contextmanager
def _temp_scale(scale: int):
    global _override_scale
    prev = _override_scale
    _override_scale = scale
    try:
        yield
    finally:
        _override_scale = prev


def _scaled_font(font: ImageFont.FreeTypeFont) -> ImageFont.FreeTypeFont:
    key = (getattr(font, "path", None), int(font.size * _active_scale()))
    f = _FONTS_SCALED.get(key)
    if f is None:
        f = ImageFont.truetype(font.path, int(font.size * _active_scale()))
        _FONTS_SCALED[key] = f
    return f


class ScaledDraw:
    """Wrap ImageDraw so every coordinate/font renders at RENDER_SCALE.

    ``textlength`` is intentionally NOT scaled so layout math stays in design
    units (position + font scale together, keeping the ratio).
    """

    def __init__(self, draw: ImageDraw.ImageDraw, scale: int | None = None):
        self._draw = draw
        self.s = _active_scale() if scale is None else scale

    @staticmethod
    def _sc(p):
        if isinstance(p, (list, tuple)):
            return type(p)(ScaledDraw._sc(x) for x in p)
        return int(p * _active_scale())

    def text(self, xy, text: str, font=None, fill=None, anchor=None, **kw):
        self._draw.text(
            self._sc(xy), text, font=_scaled_font(font) if font is not None else None,
            fill=fill, anchor=anchor, **kw,
        )

    def textlength(self, text: str, font=None, **kw):
        return self._draw.textlength(text, font=font, **kw)

    def line(self, xy, fill=None, width=1, **kw):
        self._draw.line(self._sc(xy), fill=fill, width=int(width * self.s), **kw)

    def rectangle(self, xy, fill=None, outline=None, width=1, **kw):
        self._draw.rectangle(self._sc(xy), fill=fill, outline=outline,
                             width=int(width * self.s), **kw)

    def rounded_rectangle(self, xy, radius=0, fill=None, outline=None, width=1, **kw):
        self._draw.rounded_rectangle(self._sc(xy), radius=radius * self.s,
                                     fill=fill, outline=outline,
                                     width=int(width * self.s), **kw)

    def ellipse(self, xy, fill=None, outline=None, width=1, **kw):
        self._draw.ellipse(self._sc(xy), fill=fill, outline=outline,
                           width=int(width * self.s), **kw)


def _ellipsize(draw, text: str, font, max_w: float) -> str:
    s = str(text)
    if draw.textlength(s, font=font) <= max_w:
        return s
    while s and draw.textlength(s + "\u2026", font=font) > max_w:
        s = s[:-1]
    return s + "\u2026" if s else s


# -- Formatting helpers --
def _fmt(n) -> str:
    if n is None:
        return "0"
    try:
        v = float(n)
    except (TypeError, ValueError):
        return str(n)
    if abs(v - round(v)) < 0.05:
        return f"{int(round(v)):,}"
    return f"{v:,.1f}"


def _pct(v) -> str:
    try:
        v = float(v)
    except (TypeError, ValueError):
        return "0%"
    if v % 1 == 0:
        return f"{int(v)}%"
    s = f"{v:.1f}".rstrip("0").rstrip(".")
    return f"{s}%"


def _ceil_div(n: float, d: int) -> int:
    return math.ceil(n / d) if d else 0


def _one_line_yest_mtd(yest, mtd) -> str:
    return f"Yest: {_fmt(yest)} \u2022 MTD: {_fmt(mtd)}"


def _one_line_own(yest, mtd, days) -> str:
    return f"Yest: {_fmt(yest)} \u2022 MTD: {_fmt(mtd)} \u2022 Day: {_fmt(days)}"


# -- Header --
def _draw_header(draw, house_name, house_code, summary, today: date, y0: int = 0) -> None:
    draw.rectangle([(0, y0), (WIDTH, y0 + HDR_H)], fill=NAVY)

    date_str = today.strftime("%d %b %Y")
    month_year = today.strftime("%B %Y")
    time_str = now_naive().strftime("%I:%M %p").lstrip("0")

    draw.text((30, y0 + 40), "Activation Report", font=_font(34, True), fill=WHITE, anchor="lm")
    draw.text((30, y0 + 78), f"{house_name} ({house_code})".strip(),
              font=_font(20, True), fill=NAVY_SOFT, anchor="lm")
    draw.text((30, y0 + 103), f"Date: {date_str}   |   Time: {time_str}   |   {month_year}",
              font=_font(13.5, True), fill=WHITE, anchor="lm")

    # Light metric card: yesterday's activation count
    bx, by, bw, bh = WIDTH - 300, y0 + 14, 272, HDR_H - 28
    draw.rounded_rectangle([bx, by, bx + bw, by + bh], radius=12, fill=WHITE)
    draw.text((bx + bw / 2, by + 20), "YESTERDAY ACTIVATION",
              font=_font(10.5, True), fill=MUTED, anchor="mm")
    count = _fmt(summary.get("yesterday_activation") or 0)
    draw.text((bx + bw / 2, by + 60), count, font=_font(42, True),
              fill=GREEN, anchor="mm")


# -- House summary cards --
def _draw_metric_card(draw, x, y, w, h, title, value, color):
    draw.rounded_rectangle([x, y, x + w, y + h], radius=8, fill=WHITE,
                           outline=CARD_BORDER, width=1)
    draw.text((x + 20, y + 18), title, font=_font(11.5, True), fill=MUTED, anchor="lm")
    draw.text((x + 20, y + 58), value, font=_font(27, True), fill=color, anchor="lm")


def _draw_summary_cards(draw, y, summary) -> int:
    """Draw the two metric-card rows + the days subtitle; returns the y below."""
    ach_pct = float(summary.get("achievement_percentage") or 0)
    exp_pct = float(summary.get("expected_percentage") or 0)

    row1 = [
        ("House Target", _fmt(summary.get("monthly_target") or 0), TEXT_DARK),
        ("House Achievement", _fmt(summary.get("achievement") or 0), TEXT_DARK),
        ("Achievement %", _pct(ach_pct), _pct_color(ach_pct)),
        ("Remaining", _fmt(summary.get("remaining") or 0), AMBER),
    ]
    row2 = [
        ("Daily Require", _fmt(math.ceil(summary.get("daily_required") or 0)), PURPLE),
        ("Daily Average", _fmt(round(summary.get("daily_average") or 0)), "#3B82F6"),
        ("Projection", _fmt(round(summary.get("projection") or 0)),
         _pct_color(exp_pct) if exp_pct >= 70 else AMBER),
        ("Expected %", _pct(exp_pct), _pct_color(exp_pct)),
    ]

    step1, card_w1 = 250, 244
    step2, card_w2 = 202, 196
    for ri, row in enumerate((row1, row2)):
        step, card_w = (step1, card_w1) if ri == 0 else (step2, card_w2)
        for ci, (label, value, color) in enumerate(row):
            _draw_metric_card(draw, 30 + ci * step, y, card_w, CARD_H, label, value, color)
        y += CARD_H + CARD_GAP

    days_elapsed = summary.get("days_elapsed") or 0
    days_remaining = summary.get("days_remaining") or 0
    total_days = summary.get("total_days") or 0
    with_friday = math.ceil(summary.get("daily_required_with_friday") or 0)
    fridays = summary.get("remaining_fridays") or 0
    draw.text((30, y + 2),
              f"Days Elapsed: {days_elapsed}/{total_days}  |  Days Remaining: {days_remaining}  "
              f"|  Daily Require (excl. Friday): {_fmt(summary.get('daily_required') or 0)}  "
              f"|  With Friday: {with_friday}  |  Fridays Left: {fridays}",
              font=_font(12, True), fill=MUTED, anchor="lm")
    return y + 22


# -- Supervisor banner --
def _draw_status_pill(draw, x, y, h, status: str, label=None, align="left",
                      font_size=11) -> None:
    label = label or STATUS_LABELS.get(status, status)
    f = _font(font_size, True)
    w = int(draw.textlength(label, font=f)) + 20
    if align == "right":
        x = x - w
    draw.rounded_rectangle([x, y, x + w, y + h], radius=h / 2, fill=_status_color(status))
    draw.text((x + w / 2, y + h / 2), label, font=f, fill=WHITE, anchor="mm")


def _draw_banner(draw, y, title, stats, status: str) -> None:
    x0, x1 = TBL_X0, TBL_X1
    draw.rectangle([x0, y, x1, y + BANNER_H], fill=NAVY)

    status_w = 0
    if status:
        label = STATUS_LABELS.get(status, status)
        h = 24
        w = int(draw.textlength(label, font=_font(10, True))) + 22
        _draw_status_pill(draw, x1 - 14 - w, y + (BANNER_H - h) / 2, h, status,
                          label, font_size=10)
        status_w = w + 8

    f_title = _font(16, True)
    draw.text((44, y + BANNER_H / 2),
              _ellipsize(draw, title, f_title, 200), font=f_title, fill=WHITE, anchor="lm")

    sx = 258
    ex = x1 - 14 - status_w - 8
    n = max(len(stats), 1)
    slot = (ex - sx) / n
    f_label = _font(8.5, True)
    f_val = _font(13, True)
    for label, val in stats:
        cx = sx + slot / 2
        draw.text((cx, y + 12), _ellipsize(draw, label, f_label, slot - 4),
                  font=f_label, fill=NAVY_SOFT, anchor="mm")
        draw.text((cx, y + BANNER_H - 13), _ellipsize(draw, val, f_val, slot - 6),
                  font=f_val, fill=WHITE, anchor="mm")
        sx += slot


# -- Tables (RSO / BP) --
def _table_specs(emp_type: str):
    common = [
        ("num", "#", 30),
        ("name", "Employee Name", 150),
        ("ident", "Itop Number" if emp_type == "rso" else "Pool Number", 84),
        ("target", "Target", 56),
        ("achievement", "Ach", 52),
        ("pct", "Ach%", 46),
        ("remaining", "Remain", 56),
        ("drr", "DRR", 44),
        ("davg", "D.Avg", 50),
        ("proj", "Projection", 70),
    ]
    if emp_type == "rso":
        common += [("market", "Market GA", 134), ("own", "Own GA", 148)]
    else:
        common += [("yest", "Yesterday", 66), ("days", "Day Count", 46)]
    common.append(("status", "Status", 92))
    return common


def _compute_widths(draw, specs, rows, subtotal) -> tuple[dict, int]:
    """Measure natural column widths; the Name column absorbs extra slack so it
    auto-adjusts to the longest name while numeric columns keep their size."""
    f_hdr = _font(11, True)
    f_name = _font(11, True)
    f_num = _font(10.5, True)
    f_wide = _font(10, True)
    f_pill = _font(11, True)

    all_rows = rows + ([subtotal] if subtotal else [])
    widths = {}
    for key, label, mw in specs:
        w = draw.textlength(label, font=f_hdr) + PAD_X * 2
        for r in all_rows:
            if key == "name":
                tw = draw.textlength(r.get("name", ""), font=f_name)
            elif key == "status":
                lbl = STATUS_LABELS.get(r.get("status", ""), r.get("status", ""))
                tw = draw.textlength(lbl, font=f_pill) + 20
            elif key in ("market", "own"):
                tw = draw.textlength(str(r.get(key, "")), font=f_wide)
            else:
                tw = draw.textlength(str(r.get(key, "")), font=f_num)
            w = max(w, tw + PAD_X * 2)
        widths[key] = max(w, mw)

    total = sum(widths.values())
    avail = TBL_X1 - TBL_X0
    if total < avail:
        widths["name"] += avail - total
        total = avail
    else:
        min_name = 100
        cut = min(total - avail, widths["name"] - min_name)
        widths["name"] -= cut
        total -= cut
        if total > avail:
            factor = avail / total
            for key in list(widths):
                if key in ("name", "status"):
                    continue
                widths[key] = max(34, int(widths[key] * factor))
            total = sum(widths.values())
            widths["name"] = max(min_name, widths["name"] + (avail - total))
            total = avail
    return widths, total


def _draw_row_cells(draw, x, y, row_h, specs, widths, cells, *, emp_type, is_sub):
    cy = y + row_h / 2
    f_name = _font(12, True)
    f_num = _font(11, True) if not is_sub else _font(12, True)
    f_wide = _font(10.5, True)
    for key, label, mw in specs:
        w = widths[key]
        if key == "name":
            fill = SUB_INK if is_sub else TEXT_DARK
            draw.text((x + PAD_X, cy), _ellipsize(draw, cells.get("name", ""), f_name, w - PAD_X * 2),
                      font=f_name, fill=fill, anchor="lm")
        elif key == "status":
            lbl = STATUS_LABELS.get(cells.get("status", ""), cells.get("status", ""))
            pill_w = int(draw.textlength(lbl, font=f_num)) + 20
            _draw_status_pill(draw, x + (w - pill_w) / 2, y + (row_h - 22) / 2, 22,
                              cells.get("status", ""), lbl, font_size=11)
        elif key in ("market", "own"):
            draw.text((x + w / 2, cy),
                      _ellipsize(draw, cells.get(key, ""), f_wide, w - PAD_X * 2),
                      font=f_wide, fill=SUB_INK if is_sub else TEXT_DARK, anchor="mm")
        elif key == "ident":
            draw.text((x + w / 2, cy),
                      _ellipsize(draw, cells.get(key, ""), f_wide, w - PAD_X * 2),
                      font=f_wide, fill=SUB_INK if is_sub else MUTED, anchor="mm")
        else:
            fill = SUB_INK if is_sub else TEXT_DARK
            if key == "pct" and not is_sub:
                fill = cells.get("pct_color", TEXT_DARK)
            draw.text((x + w / 2, cy),
                      _ellipsize(draw, cells.get(key, ""), f_num, w - PAD_X * 2),
                      font=f_num, fill=fill, anchor="mm")
        x += w


def _draw_table(draw, y, emp_type: str, rows, subtotal) -> None:
    specs = _table_specs(emp_type)
    widths, total_w = _compute_widths(draw, specs, rows, subtotal)
    x1 = TBL_X0 + total_w

    # Header band
    draw.rectangle([TBL_X0, y, x1, y + HEADER_H], fill=TABLE_HDR_BG)
    f = _font(11, True)
    xx = TBL_X0
    for key, label, mw in specs:
        w = widths[key]
        draw.text((xx + w / 2, y + HEADER_H / 2), label, font=f, fill=TEXT_DARK, anchor="mm")
        xx += w
    yy = y + HEADER_H

    # Data rows
    for r in rows:
        bg = BP_ROW_BG if emp_type == "bp" else WHITE
        draw.rectangle([TBL_X0, yy, x1, yy + ROW_H], fill=bg)
        _draw_row_cells(draw, TBL_X0, yy, ROW_H, specs, widths, r,
                        emp_type=emp_type, is_sub=False)
        yy += ROW_H

    # Subtotal row
    if subtotal:
        draw.rectangle([TBL_X0, yy, x1, yy + SUB_H], fill=SUB_ROW_BG)
        _draw_row_cells(draw, TBL_X0, yy, SUB_H, specs, widths, subtotal,
                        emp_type=emp_type, is_sub=True)
        yy += SUB_H

    # Vertical grid lines (skip the very last column edge - the outer border covers it)
    xx = TBL_X0
    for key in [s[0] for s in specs[:-1]]:
        xx += widths[key]
        draw.line([(xx, y), (xx, yy)], fill=GRID_LINE, width=1)

    # Full outer border
    draw.rectangle([TBL_X0, y, x1, yy], outline=OUTER_LINE, width=1)


def _draw_table_caption(draw, y, title, count, emp_type) -> int:
    color = BADGE_COLORS[emp_type]
    draw.rounded_rectangle([TBL_X0, y + CAPTION_H / 2 - 6, TBL_X0 + 12, y + CAPTION_H / 2 + 6],
                           radius=3, fill=color)
    draw.text((TBL_X0 + 22, y + CAPTION_H / 2), title,
              font=_font(14, True), fill=TEXT_DARK, anchor="lm")
    if count:
        draw.text((TBL_X1, y + CAPTION_H / 2), f"Total Employees: {count}",
                  font=_font(11.5, True), fill=MUTED, anchor="rm")
    return y + CAPTION_H


# -- Data / row builders --
def _display_rows(perf_rows: list[dict], emp_type: str, days_remaining: int) -> list[dict]:
    """Build display row dicts from employee performance entries, applying
    the dashboard page's status + colour rules."""
    rows = []
    for i, p in enumerate(perf_rows, 1):
        remaining = p.get("remaining") or 0
        pct = float(p.get("percentage") or 0)
        proj = float(p.get("projection") or 0)
        target = float(p.get("target") or 0)
        projpct = round(proj / target * 100) if target else 0
        status = _projection_status(pct, projpct)

        row = {
            "num": str(i),
            "name": str(p.get("name") or ""),
            "target": _fmt(p.get("target") or 0),
            "achievement": _fmt(p.get("achievement") or 0),
            "pct": _pct(pct),
            "pct_color": _pct_color(pct),
            "remaining": _fmt(remaining),
            "drr": _fmt(_ceil_div(remaining, days_remaining)),
            "davg": _fmt(p.get("daily_average") or 0),
            "proj": _fmt(proj),
            "status": status,
        }
        if emp_type == "rso":
            row["ident"] = str(p.get("itop_number") or p.get("dms_code") or "")
            row["market"] = _one_line_yest_mtd(p.get("market_yesterday") or 0,
                                               p.get("market_activation") or 0)
            row["own"] = _one_line_own(p.get("yesterday_activation") or 0,
                                       p.get("month_total_activation") or 0,
                                       p.get("active_days") or 0)
        else:
            row["ident"] = str(p.get("pool_number") or "")
            row["yest"] = _fmt(p.get("yesterday_activation") or 0)
            row["days"] = _fmt(p.get("active_days") or 0)
        rows.append(row)
    return rows


def _group_subtotal(rows: list[dict], emp_type: str,
                    days_remaining: int, days_elapsed: int) -> dict:
    """Aggregate raw perf dicts into a Subtotal row using the dashboard
    formulas (pct from totals, D.Avg = totalAch / days_elapsed, etc.)."""
    target = sum(r.get("target") or 0 for r in rows)
    ach = sum(r.get("achievement") or 0 for r in rows)
    pct = round(ach / target * 100) if target else 0
    remaining = sum(r.get("remaining") or 0 for r in rows)
    davg = round(ach / max(days_elapsed, 1))
    proj = sum(r.get("projection") or 0 for r in rows)
    projpct = round(proj / target * 100) if target else 0
    status = _projection_status(pct, projpct)

    row = {
        "num": "",
        "name": f"Total ({emp_type.upper()}) {len(rows)}",
        "ident": "",
        "target": _fmt(target),
        "achievement": _fmt(ach),
        "pct": _pct(pct),
        "pct_color": _pct_color(pct),
        "remaining": _fmt(remaining),
        "drr": _fmt(_ceil_div(remaining, days_remaining)),
        "davg": _fmt(davg),
        "proj": _fmt(proj),
        "projpct": projpct,
        "status": status,
    }
    if emp_type == "rso":
        row["market"] = _one_line_yest_mtd(sum(r.get("market_yesterday") or 0 for r in rows),
                                           sum(r.get("market_activation") or 0 for r in rows))
        row["own"] = _one_line_own(sum(r.get("yesterday_activation") or 0 for r in rows),
                                   sum(r.get("month_total_activation") or 0 for r in rows),
                                   sum(r.get("active_days") or 0 for r in rows))
    else:
        row["yest"] = _fmt(sum(r.get("yesterday_activation") or 0 for r in rows))
        row["days"] = _fmt(sum(r.get("active_days") or 0 for r in rows))
    return row


def _build_blocks(dashboard: dict, days_remaining: int, days_elapsed: int) -> list[dict]:
    """Structure the dashboard into per-supervisor display blocks."""
    rso_by_id = {r["id"]: r for r in dashboard.get("rso_performance", [])}
    bp_by_id = {r["id"]: r for r in dashboard.get("bp_performance", [])}
    supervisors = dashboard.get("supervisor_performance", [])
    blocks = []

    assigned_ids: set[int] = set()
    for sup in supervisors:
        team = sup.get("team") or []
        ids = [m.get("employee_id") for m in team if m.get("employee_id")]
        assigned_ids.update(ids)

        rso_data = [rso_by_id[m["employee_id"]] for m in team
                    if m.get("employee_type") == "rso" and rso_by_id.get(m["employee_id"])]
        bp_data = [bp_by_id[m["employee_id"]] for m in team
                   if m.get("employee_type") == "bp" and bp_by_id.get(m["employee_id"])]

        rso_rows = _display_rows(rso_data, "rso", days_remaining)
        bp_rows = _display_rows(bp_data, "bp", days_remaining)
        rso_sub = _group_subtotal(rso_data, "rso", days_remaining, days_elapsed) if rso_rows else None
        bp_sub = _group_subtotal(bp_data, "bp", days_remaining, days_elapsed) if bp_rows else None

        sup_rem = sup.get("remaining") or 0
        sup_pct = float(sup.get("percentage") or 0)
        sup_proj = float(sup.get("projection") or 0)
        sup_target = float(sup.get("target") or 0)
        sup_projpct = round(sup_proj / sup_target * 100) if sup_target else 0
        mkt = sum(r.get("market_yesterday") or 0 for r in rso_data)
        ff = (sum(r.get("yesterday_activation") or 0 for r in rso_data)
              + sum(r.get("yesterday_activation") or 0 for r in bp_data))
        ytot = sup.get("yesterday_activation") or 0

        blocks.append({
            "title": f"Supervisor: {sup.get('name') or ''}",
            "stats": [
                ("Target", _fmt(sup.get("target") or 0)),
                ("Ach", _fmt(sup.get("achievement") or 0)),
                ("Ach%", _pct(sup_pct)),
                ("Remain", _fmt(sup_rem)),
                ("DRR", _fmt(_ceil_div(sup_rem, days_remaining))),
                ("D.Avg", _fmt(sup.get("daily_average") or 0)),
                ("Projection", _fmt(sup_proj)),
                ("Proj%", _pct(sup_projpct)),
                ("Yest.Mkt", _fmt(mkt)),
                ("Yest.FF", _fmt(ff)),
                ("Yest.Total", _fmt(ytot)),
            ],
            "status": _projection_status(sup_pct, sup_projpct),
            "rso_rows": rso_rows,
            "bp_rows": bp_rows,
            "rso_sub": rso_sub,
            "bp_sub": bp_sub,
        })

    # Members with no supervisor assignment
    unassigned_rso = [r for r in dashboard.get("rso_performance", []) if r["id"] not in assigned_ids]
    unassigned_bp = [r for r in dashboard.get("bp_performance", []) if r["id"] not in assigned_ids]
    if unassigned_rso or unassigned_bp:
        data = unassigned_rso + unassigned_bp
        target = sum(r.get("target") or 0 for r in data)
        ach = sum(r.get("achievement") or 0 for r in data)
        remaining = sum(r.get("remaining") or 0 for r in data)
        proj = sum(r.get("projection") or 0 for r in data)
        davg = round(ach / max(days_elapsed, 1))
        u_pct = round(ach / target * 100) if target else 0
        u_projpct = round(proj / target * 100) if target else 0
        mkt = sum(r.get("market_yesterday") or 0 for r in unassigned_rso)
        ff = sum(r.get("yesterday_activation") or 0 for r in data)

        u_rso_rows = _display_rows(unassigned_rso, "rso", days_remaining)
        u_bp_rows = _display_rows(unassigned_bp, "bp", days_remaining)
        u_rso_sub = _group_subtotal(unassigned_rso, "rso", days_remaining, days_elapsed) if u_rso_rows else None
        u_bp_sub = _group_subtotal(unassigned_bp, "bp", days_remaining, days_elapsed) if u_bp_rows else None

        blocks.append({
            "title": "Others (Unassigned)",
            "stats": [
                ("Target", _fmt(target)),
                ("Ach", _fmt(ach)),
                ("Ach%", _pct(u_pct)),
                ("Remain", _fmt(remaining)),
                ("DRR", _fmt(_ceil_div(remaining, days_remaining))),
                ("D.Avg", _fmt(davg)),
                ("Projection", _fmt(proj)),
                ("Proj%", _pct(u_projpct)),
                ("Yest.Mkt", _fmt(mkt)),
                ("Yest.FF", _fmt(ff)),
                ("Yest.Total", _fmt(ff)),
            ],
            "status": _projection_status(u_pct, u_projpct),
            "rso_rows": u_rso_rows,
            "bp_rows": u_bp_rows,
            "rso_sub": u_rso_sub,
            "bp_sub": u_bp_sub,
        })

    return blocks


# -- Block rendering + sizing --
def _table_height(n_rows: int) -> int:
    return HEADER_H + ROW_H * n_rows + SUB_H


def _block_estimate(block: dict) -> int:
    h = BANNER_H + BLK_GAP
    if block["rso_rows"]:
        h += CAPTION_H + _table_height(len(block["rso_rows"])) + TBL_SPLIT_GAP
    if block["bp_rows"]:
        h += CAPTION_H + _table_height(len(block["bp_rows"]))
    return h


def _draw_block(draw, block: dict) -> None:
    y = block["y"]
    _draw_banner(draw, y, block["title"], block["stats"], block["status"])
    yy = y + BANNER_H + BLK_GAP
    if block["rso_rows"]:
        yy = _draw_table_caption(draw, yy, "RSO - Team Performance",
                                 len(block["rso_rows"]), "rso")
        _draw_table(draw, yy, "rso", block["rso_rows"], block["rso_sub"])
        yy += _table_height(len(block["rso_rows"])) + TBL_SPLIT_GAP
    if block["bp_rows"]:
        yy = _draw_table_caption(draw, yy, "BP - Team Performance",
                                 len(block["bp_rows"]), "bp")
        _draw_table(draw, yy, "bp", block["bp_rows"], block["bp_sub"])
        yy += _table_height(len(block["bp_rows"]))
    block["bottom"] = yy


def _draw_footer(draw, y) -> None:
    draw.rectangle([TBL_X0, y, TBL_X1, y + FOOTER_H], fill=NAVY)
    draw.text((TBL_X0 + 14, y + FOOTER_H / 2), "Together We Grow  |  Success Tomorrow",
              font=_font(12, True), fill=WHITE, anchor="lm")
    date_str = now_naive().strftime("%d %B %Y, %I:%M %p")
    draw.text((TBL_X1 - 14, y + FOOTER_H / 2),
              f"Generated by OrangeFlow  |  {date_str}",
              font=_font(12, True), fill=WHITE, anchor="rm")


def _render_image(house_name: str, house_code: str, dashboard: dict,
                  today: date) -> bytes:
    summary = dashboard.get("summary", {})
    days_remaining = int(summary.get("days_remaining") or 0)
    days_elapsed = int(summary.get("days_elapsed") or 1)

    blocks = _build_blocks(dashboard, days_remaining, days_elapsed)
    est = sum(_block_estimate(b) for b in blocks)

    canvas_h = max(BLOCKS_TOP + est + 16 + FOOTER_H,
                   int(WIDTH * PORTRAIT_MIN_RATIO) + FOOTER_H)

    # Layout pass: place blocks, inserting a repeated header band (new page)
    # when a block would overflow past the footer.
    page_headers = []
    cursor = BLOCKS_TOP
    for i, b in enumerate(blocks):
        eh = _block_estimate(b)
        if i and cursor + eh > canvas_h - FOOTER_H - 16:
            top = canvas_h - FOOTER_H + 8
            canvas_h += HDR_H + 48
            page_headers.append(top)
            cursor = top + HDR_H + 12
        b["y"] = cursor
        cursor += eh

    s = _active_scale()
    img = Image.new("RGB", (WIDTH * s, max(int(canvas_h), 60) * s), BG_COLOR)
    draw = ScaledDraw(ImageDraw.Draw(img))

    _draw_header(draw, house_name, house_code, summary, today, 0)
    for top in page_headers:
        _draw_header(draw, house_name, house_code, summary, today, top)
    _draw_summary_cards(draw, HDR_H + 12, summary)
    for b in blocks:
        _draw_block(draw, b)
    _draw_footer(draw, canvas_h - FOOTER_H)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


async def build_activation_report_image(
    db: AsyncSession, house_id: int, scale: int | None = None
) -> bytes:
    """Build the current month's Activation Report as a PNG image.

    ``scale`` overrides the default RENDER_SCALE - used for fast, reduced-size
    preview renders. ``None`` produces the full-resolution send-quality image.
    """
    today = now_naive().date()
    svc = ActivationReportService(db, house_id, today.month, today.year, target_role="HOUSE")
    dashboard = await svc.build_dashboard()

    from sqlalchemy import select
    from app.models.house import House

    result = await db.execute(select(House).where(House.id == house_id))
    house = result.scalar_one_or_none()
    house_name = (house.name or "") if house else "Unknown"
    house_code = (house.code or "") if house else ""

    if scale is None:
        return _render_image(house_name, house_code, dashboard, today)
    with _temp_scale(scale):
        return _render_image(house_name, house_code, dashboard, today)
