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

# -- Design palette (modern business report) --
BG_COLOR = "#F8FAFC"          # Soft gray background
WHITE = "#FFFFFF"
PRIMARY = "#0F172A"           # Deep slate for headers
PRIMARY_LIGHT = "#1E293B"     # Lighter slate
ACCENT = "#3B82F6"            # Modern blue accent
ACCENT_SOFT = "#DBEAFE"       # Light blue
PURPLE = "#8B5CF6"            # Modern purple
TABLE_HDR_BG = "#F1F5F9"      # Light gray header
BP_ROW_BG = "#FAFBFC"         # Very light gray
SUB_ROW_BG = "#E0E7FF"        # Light indigo
CARD_BORDER = "#E2E8F0"       # Subtle border
TEXT_DARK = "#0F172A"         # Deep slate text
MUTED = "#64748B"             # Muted gray
SUB_INK = "#1E40AF"           # Deep blue
AMBER = "#F59E0B"
GREEN = "#10B981"
EMERALD = "#059669"           # Rich emerald
GRID_LINE = "#CBD5E1"         # Light gray grid
OUTER_LINE = "#475569"        # Darker slate border
SHADOW = "#94A3B820"          # Subtle shadow

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
BANNER_H = 64
HEADER_H = 28
ROW_H = 30
SUB_H = 26
FOOTER_H = 44
BLK_GAP = 8             # gap between banner and the first table (reduced)
TBL_SPLIT_GAP = 10      # gap between the RSO and BP tables inside one block (reduced)
CAPTION_H = 24          # small labelled band above each table
AFTER_SUMMARY_GAP = 5   # gap between the summary region and the first banner (balanced)

# Summary region: table (2 rows x 56px) + gap (8px) + days card (36px) + bottom gap (5px)
SUMMARY_HEIGHT = (2 * 56) + 8 + 36 + 5
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


def _fit_font(draw, text: str, max_w: float, max_size: float,
              min_size: float = 9.0, bold: bool = True) -> tuple[ImageFont.FreeTypeFont, str]:
    """Find the largest font in [min_size, max_size] that fits text within max_w.
    If even min_size overflows, ellipsize at min_size."""
    s = str(text) if text is not None else ""
    if not s:
        return _font(int(round(max_size)), bold), ""
    size = float(max_size)
    while size >= min_size:
        f = _font(int(round(size)), bold)
        if draw.textlength(s, font=f) <= max_w:
            return f, s
        size -= 0.5
    f_min = _font(int(round(min_size)), bold)
    curr = s
    while curr and draw.textlength(curr + "\u2026", font=f_min) > max_w:
        curr = curr[:-1]
    return f_min, (curr + "\u2026" if curr else curr)


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
    # Always return integer percentage (no decimal)
    return f"{int(round(v))}%"


def _ceil_div(n: float, d: int) -> int:
    return math.ceil(n / d) if d else 0


def _one_line_yest_mtd(yest, mtd) -> str:
    return f"Yest: {_fmt(yest)} \u2022 MTD: {_fmt(mtd)}"


def _one_line_own(yest, mtd, days) -> str:
    return f"Yest: {_fmt(yest)} \u2022 MTD: {_fmt(mtd)} \u2022 Day: {_fmt(days)}"


# -- Header --
def _draw_header(draw, house_name, house_code, summary, today: date, y0: int = 0) -> None:
    # Modern light header design
    draw.rectangle([(0, y0), (WIDTH, y0 + HDR_H)], fill=WHITE)

    date_str = today.strftime("%d %b %Y")
    month_year = today.strftime("%B %Y")
    time_str = now_naive().strftime("%I:%M %p").lstrip("0")

    # Main title with icon placeholder
    draw.ellipse([24, y0 + 32, 44, y0 + 52], fill=ACCENT)
    draw.text((54, y0 + 42), "Activation Performance Report",
              font=_font(32, True), fill=PRIMARY, anchor="lm")

    # Subtitle - house info
    draw.text((54, y0 + 76), f"{house_name} ({house_code})".strip(),
              font=_font(18, True), fill=MUTED, anchor="lm")

    # Date/time info without emoji icons
    draw.text((54, y0 + 100), f"Date: {date_str}  •  Time: {time_str}  •  {month_year}",
              font=_font(13, True), fill=MUTED, anchor="lm")

    # Modern metric card: yesterday's activation count with subtle shadow effect
    bx, by, bw, bh = WIDTH - 280, y0 + 20, 256, HDR_H - 40

    # Shadow effect
    draw.rounded_rectangle([bx + 2, by + 2, bx + bw + 2, by + bh + 2],
                          radius=16, fill=SHADOW)

    # Main card with light green background
    draw.rounded_rectangle([bx, by, bx + bw, by + bh], radius=16, fill="#F0FDF4",
                          outline=EMERALD, width=2)

    # Label (removed accent bar)
    draw.text((bx + bw / 2, by + 24), "YESTERDAY ACTIVATION",
              font=_font(10, True), fill=MUTED, anchor="mm")

    # Value - large and bold
    count = _fmt(summary.get("yesterday_activation") or 0)
    draw.text((bx + bw / 2, by + 56), count, font=_font(44, True),
              fill=EMERALD, anchor="mm")


# -- House summary table --
def _draw_summary_table(draw, y, summary) -> int:
    """Draw house summary as a modern clean table with shadow effects; returns the y below."""
    ach_pct = float(summary.get("achievement_percentage") or 0)
    exp_pct = float(summary.get("expected_percentage") or 0)

    # Table data: label, value, color
    metrics = [
        ("House Target", _fmt(summary.get("monthly_target") or 0), TEXT_DARK),
        ("House Achievement", _fmt(summary.get("achievement") or 0), ACCENT),
        ("Achievement %", _pct(ach_pct), _pct_color(ach_pct)),
        ("Remaining", _fmt(summary.get("remaining") or 0), AMBER),
        ("Daily Require", _fmt(math.ceil(summary.get("daily_required") or 0)), PURPLE),
        ("Daily Average", _fmt(round(summary.get("daily_average") or 0)), ACCENT),
        ("Projection", _fmt(round(summary.get("projection") or 0)),
         _pct_color(exp_pct) if exp_pct >= 70 else AMBER),
        ("Expected %", _pct(exp_pct), _pct_color(exp_pct)),
    ]

    # Calculate column widths
    num_cols = 4  # 4 columns
    avail_width = TBL_X1 - TBL_X0
    col_width = avail_width / num_cols
    row_height = 56

    # Draw table with shadow
    x0, y0 = TBL_X0, y
    num_rows = math.ceil(len(metrics) / num_cols)
    table_height = num_rows * row_height

    # Shadow effect
    draw.rounded_rectangle([x0 + 3, y0 + 3, TBL_X1 + 3, y0 + table_height + 3],
                          radius=12, fill=SHADOW)

    # Main table background
    draw.rounded_rectangle([x0, y0, TBL_X1, y0 + table_height],
                          radius=12, fill=WHITE)

    # Draw cells
    for idx, (label, value, color) in enumerate(metrics):
        row = idx // num_cols
        col = idx % num_cols

        cell_x = x0 + col * col_width
        cell_y = y0 + row * row_height

        # Cell separator lines (except first column and first row)
        if col > 0:
            draw.line([(cell_x, cell_y + 8), (cell_x, cell_y + row_height - 8)],
                     fill=GRID_LINE, width=1)
        if row > 0 and col == 0:
            draw.line([(x0 + 8, cell_y), (TBL_X1 - 8, cell_y)],
                     fill=GRID_LINE, width=1)

        # Label (top) with icon placeholder
        draw.text((cell_x + col_width / 2, cell_y + 16), label,
                 font=_font(10.5, True), fill=MUTED, anchor="mm")

        # Value (bottom, larger and bold)
        draw.text((cell_x + col_width / 2, cell_y + 40), value,
                 font=_font(22, True), fill=color, anchor="mm")

    # Outer border with rounded corners
    draw.rounded_rectangle([x0, y0, TBL_X1, y0 + table_height],
                          radius=12, outline=OUTER_LINE, width=2)

    y = y0 + table_height + 8  # Reduced gap

    # Days info subtitle with modern styling
    days_elapsed = summary.get("days_elapsed") or 0
    days_remaining = summary.get("days_remaining") or 0
    total_days = summary.get("total_days") or 0
    with_friday = math.ceil(summary.get("daily_required_with_friday") or 0)
    fridays = summary.get("remaining_fridays") or 0

    # Info card for days
    info_x0, info_y0 = x0, y
    info_width = TBL_X1 - TBL_X0
    info_height = 36

    draw.rounded_rectangle([info_x0, info_y0, info_x0 + info_width, info_y0 + info_height],
                          radius=8, fill=ACCENT_SOFT, outline=ACCENT, width=1)

    draw.text((info_x0 + info_width / 2, info_y0 + info_height / 2),
              f"Days: {days_elapsed}/{total_days} Elapsed  •  {days_remaining} Remaining  •  "
              f"Daily Target: {_fmt(summary.get('daily_required') or 0)} (excl. Fri)  •  "
              f"{with_friday} (with Fri)  •  {fridays} Fridays Left",
              font=_font(11.5, True), fill=PRIMARY, anchor="mm")

    return y + info_height + 5  # Balanced gap - increased from 2 to 5


# -- Supervisor banner --
def _draw_status_pill(draw, x, y, h, status: str, label=None, align="left",
                      font_size=11) -> None:
    label = label or STATUS_LABELS.get(status, status)
    f = _font(font_size, True)
    w = int(draw.textlength(label, font=f)) + 24
    if align == "right":
        x = x - w
    # Modern pill with subtle shadow
    draw.rounded_rectangle([x + 1, y + 1, x + w + 1, y + h + 1], radius=h / 2, fill=SHADOW)
    draw.rounded_rectangle([x, y, x + w, y + h], radius=h / 2, fill=_status_color(status))
    draw.text((x + w / 2, y + h / 2), label, font=f, fill=WHITE, anchor="mm")


def _draw_banner(draw, y, title, stats, status: str) -> None:
    x0, x1 = TBL_X0, TBL_X1

    # Modern light banner without top border
    draw.rounded_rectangle([x0, y, x1, y + BANNER_H], radius=12, fill=ACCENT_SOFT)

    status_w = 0
    if status:
        label = STATUS_LABELS.get(status, status)
        h = 28  # Pill height
        f_pill = _font(11, True)
        w = int(draw.textlength(label, font=f_pill)) + 26
        _draw_status_pill(draw, x1 - 16 - w, y + (BANNER_H - h) / 2, h, status,
                          label, font_size=11)
        status_w = w + 14

    # Icon placeholder (circle)
    draw.ellipse([x0 + 16, y + BANNER_H / 2 - 12, x0 + 40, y + BANNER_H / 2 + 12],
                 fill=ACCENT)

    # Supervisor title - dynamic fit up to 230px with prominent size
    f_title, title_txt = _fit_font(draw, title, 230, max_size=16.5, min_size=12.0, bold=True)
    draw.text((x0 + 48, y + BANNER_H / 2), title_txt, font=f_title, fill=PRIMARY, anchor="lm")
    title_w = draw.textlength(title_txt, font=f_title)

    # Stats section - dynamically space between title and status pill
    sx = max(x0 + 52 + int(title_w) + 14, 230)
    ex = x1 - 16 - status_w
    n = max(len(stats), 1)
    slot = (ex - sx) / n

    for i, (label, val) in enumerate(stats):
        cx = sx + slot * i + slot / 2
        # Dynamic label (top) - up to 11.5pt
        f_lbl, lbl_txt = _fit_font(draw, label, slot - 3, max_size=11.5, min_size=9.0, bold=True)
        draw.text((cx, y + 19), lbl_txt, font=f_lbl, fill=MUTED, anchor="mm")
        # Dynamic value (bottom, prominent) - up to 14.5pt
        f_val, val_txt = _fit_font(draw, str(val), slot - 4, max_size=14.5, min_size=10.5, bold=True)
        val_fill = PRIMARY
        if label == "Ach%":
            try:
                p_num = float(str(val).replace("%", ""))
                val_fill = _pct_color(p_num)
            except (ValueError, TypeError):
                pass
        elif label == "Proj%":
            try:
                p_num = float(str(val).replace("%", ""))
                val_fill = _pct_color(p_num)
            except (ValueError, TypeError):
                pass
        draw.text((cx, y + 43), val_txt, font=f_val, fill=val_fill, anchor="mm")


# -- Tables (RSO / BP) --
def _table_specs(emp_type: str):
    if emp_type == "rso":
        return [
            ("num", "#"),
            ("name", "Employee Name"),
            ("ident", "Itop Number"),
            ("target", "Target"),
            ("achievement", "Ach"),
            ("pct", "Ach%"),
            ("remaining", "Remain"),
            ("drr", "DRR"),
            ("davg", "D.Avg"),
            ("proj", "Projection"),
            ("projpct", "Proj%"),
            ("market", "Market GA"),
            ("own", "Own GA"),
            ("status", "Status"),
        ]
    else:
        return [
            ("num", "#"),
            ("name", "Employee Name"),
            ("ident", "Pool Number"),
            ("target", "Target"),
            ("achievement", "Ach"),
            ("pct", "Ach%"),
            ("remaining", "Remain"),
            ("drr", "DRR"),
            ("davg", "D.Avg"),
            ("proj", "Projection"),
            ("projpct", "Proj%"),
            ("yest", "Yesterday"),
            ("days", "Day Count"),
            ("status", "Status"),
        ]


# Content-based column sizing: every column is sized from its widest actual
# content (header + cells + subtotal). The Employee Name column is capped at
# the longest name in its own table/section — no leftover space is absorbed,
# so no column keeps an extra gap after its content.
SMALL_MIN_COL = 22       # absolute sanity floor for any thin column (e.g. "#")
NAME_FONT_MAX = 15.0     # name font grows when names are short -> fills the cell
NAME_FONT_MIN = 10.0     # steps down for long names
NAME_CAP_RATIO = 0.50    # name column may take at most 50% of the table width
MAX_TABLE_SCALE = 1.18   # when free space exists, columns+fonts zoom up to this scale

# Floor ratio per column type used when a long name forces the other columns
# to accept a smaller font (cells still render every character via _fit_font).
# ratio = min cell draw font / natural measurement font.
_MEAS_FONTS = {"num": 13, "ident": 12, "wide": 11, "status": 10.5}
_MIN_FONT_RATIO = {
    "num": 10 / _MEAS_FONTS["num"], "target": 10 / _MEAS_FONTS["num"],
    "achievement": 10 / _MEAS_FONTS["num"], "pct": 10 / _MEAS_FONTS["num"],
    "remaining": 10 / _MEAS_FONTS["num"], "drr": 10 / _MEAS_FONTS["num"],
    "davg": 10 / _MEAS_FONTS["num"], "proj": 10 / _MEAS_FONTS["num"],
    "projpct": 10 / _MEAS_FONTS["num"], "yest": 10 / _MEAS_FONTS["num"],
    "days": 10 / _MEAS_FONTS["num"],
    "ident": 9.5 / _MEAS_FONTS["ident"],
    "market": 9 / _MEAS_FONTS["wide"], "own": 9 / _MEAS_FONTS["wide"],
    "status": 9 / _MEAS_FONTS["status"],
}


def _compute_widths(draw, specs, rows, subtotal, emp_type: str = "rso") -> tuple[dict, int, dict, float]:
    """Compute content-based column widths + per-column max fonts.

    Every column is sized from its actual content (header + cells + subtotal)
    so no column keeps an extra gap. The Employee Name column's width equals
    the longest name in this table, and its max font size adapts to that name.
    If free width remains, all columns and fonts zoom up uniformly (scale > 1)
    so the table fills the available region without reintroducing gaps.

    Returns ``(widths, total_w, fonts, scale)`` — ``fonts`` holds the per-column
    max font sizes used at draw time, ``scale`` the uniform zoom factor.
    """
    f_hdr = _font(11.5, True)
    f_num = _font(_MEAS_FONTS["num"], True)
    f_wide = _font(_MEAS_FONTS["wide"], True)
    f_ident = _font(_MEAS_FONTS["ident"], True)
    f_pill = _font(_MEAS_FONTS["status"], True)

    all_rows = rows + ([subtotal] if subtotal else [])
    widths: dict = {}
    fonts: dict = {}

    for key, label in specs:
        if key == "name":
            continue
        pad = 4 if emp_type == "rso" else PAD_X
        w = draw.textlength(label, font=f_hdr) + pad * 2
        for r in all_rows:
            if key == "status":
                lbl = STATUS_LABELS.get(r.get("status", ""), r.get("status", ""))
                tw = draw.textlength(lbl, font=f_pill) + (14 if emp_type == "rso" else 20)
                w = max(w, tw + 4)
            elif key in ("market", "own"):
                tw = draw.textlength(str(r.get(key, "")), font=f_wide)
                w = max(w, tw + 6)
            elif key == "ident":
                tw = draw.textlength(str(r.get(key, "")), font=f_ident)
                w = max(w, tw + 6)
            else:
                tw = draw.textlength(str(r.get(key, "")), font=f_num)
                w = max(w, tw + pad * 2)
        widths[key] = max(int(math.ceil(w)), SMALL_MIN_COL)

    # Per-column max fonts used when drawing cells (design units).
    for key, _ in specs:
        if key == "name":
            fonts[key] = NAME_FONT_MAX
        elif key == "status":
            fonts[key] = 10.5
        elif key in ("market", "own"):
            fonts[key] = 11.0
        elif key == "ident":
            fonts[key] = 12.0
        else:
            fonts[key] = 13.0

    # Employee Name column: content-sized to the longest name in this table
    # (per-section) so no leftover space is absorbed. The font steps down when
    # the full name would crowd the other columns, keeping every name visible
    # with no extra column gap for realistic inputs.
    name_label = next((lbl for k, lbl in specs if k == "name"), "Employee Name")
    avail = TBL_X1 - TBL_X0
    name_cap = int(avail * NAME_CAP_RATIO)
    longest = max((str(r.get("name") or "") for r in all_rows), key=len, default=name_label)
    header_w = int(draw.textlength(name_label, font=f_hdr)) + PAD_X * 2
    other_total = sum(widths.values())

    def _name_width(fs: float) -> int:
        return max(int(math.ceil(draw.textlength(longest, font=_font(int(round(fs)), True)))) + PAD_X * 2,
                   header_w, SMALL_MIN_COL)

    name_fs = _name_font_size(draw, longest, name_cap - PAD_X * 2)
    fonts["name"] = name_fs
    widths["name"] = _name_width(name_fs)
    total = sum(widths.values())

    if total > avail:
        # Stage 1: keep every column content-based; simply shrink the name font
        # until the longest name + all other columns fit the canvas (full text).
        fs = name_fs
        while fs >= NAME_FONT_MIN:
            if _name_width(fs) + other_total <= avail:
                fonts["name"] = fs
                widths["name"] = _name_width(fs)
                break
            fs -= 0.5
        total = sum(widths.values())

    if total > avail:
        # Stage 2 (realistic long names): shrink the other columns' fonts too
        # (their cells still render every character, just smaller) and give the
        # name column the leftover. Only a truly excessive name would then
        # ellipsize at draw time.
        name_floor = _name_width(NAME_FONT_MIN)
        factor = (avail - name_floor) / other_total if other_total else 1.0
        for key in list(widths):
            if key == "name":
                continue
            minw = max(SMALL_MIN_COL, int(math.ceil(widths[key] * _MIN_FONT_RATIO.get(key, 0.75))))
            widths[key] = max(minw, int(widths[key] * factor))
        widths["name"] = max(header_w, avail - sum(widths[k] for k in widths if k != "name"))
        fonts["name"] = _name_font_size(draw, longest, widths["name"] - PAD_X * 2)
        total = sum(widths.values())

    total = sum(widths.values())
    # Fill the available width: scale every column width AND its max font by the
    # same factor (proportions unchanged => no gap inside any cell). The table
    # only ever grows, never shrinks below its content-sized minimum.
    scale = min(avail / total, MAX_TABLE_SCALE) if total < avail else 1.0
    if scale > 1.0:
        widths = {k: max(SMALL_MIN_COL, int(round(w * scale))) for k, w in widths.items()}
        fonts = {k: round(f * scale, 1) for k, f in fonts.items()}
        total = int(round(sum(widths.values())))
        # Exact fit: absorb the rounding remainder on the name column.
        widths["name"] += avail - total
        total = sum(widths.values())

    return widths, total, fonts, scale


def _name_font_size(draw, longest: str, max_w: float) -> float:
    """Largest name font in [NAME_FONT_MIN, NAME_FONT_MAX] (0.5 steps) that
    fits ``longest`` within ``max_w``. Falls back to the minimum if even that
    overflows (cells then ellipsize via _fit_font)."""
    size = float(NAME_FONT_MAX)
    while size >= NAME_FONT_MIN:
        if draw.textlength(longest, font=_font(int(round(size)), True)) <= max_w:
            return size
        size -= 0.5
    return float(NAME_FONT_MIN)


def _draw_row_cells(draw, x, y, row_h, specs, widths, fonts, cells, *, emp_type, is_sub):
    cy = y + row_h / 2
    for key, label in specs:
        w = widths[key]
        if key == "name":
            fill = SUB_INK if is_sub else TEXT_DARK
            # Dynamic max font: computed per section (largest size the longest
            # name fits), steps down smoothly for longer names
            max_s = fonts.get(key, NAME_FONT_MAX) if not is_sub else 13.5
            f_name, name_txt = _fit_font(draw, cells.get("name", ""), w - PAD_X * 2,
                                         max_size=max_s, min_size=9.5, bold=True)
            draw.text((x + PAD_X, cy), name_txt, font=f_name, fill=fill, anchor="lm")
        elif key == "status":
            lbl = STATUS_LABELS.get(cells.get("status", ""), cells.get("status", ""))
            f_st, lbl_fit = _fit_font(draw, lbl, w - 8, max_size=fonts.get("status", 10.5),
                                      min_size=9.0, bold=True)
            pill_w = int(draw.textlength(lbl_fit, font=f_st)) + (14 if emp_type == "rso" else 18)
            pill_h = 20 if emp_type == "rso" else 22
            _draw_status_pill(draw, x + (w - pill_w) / 2, y + (row_h - pill_h) / 2, pill_h,
                              cells.get("status", ""), lbl_fit, font_size=int(round(f_st.size)))
        elif key in ("market", "own"):
            fill = SUB_INK if is_sub else TEXT_DARK
            # Dynamically maximized detail cells
            f_wide, wide_txt = _fit_font(draw, str(cells.get(key, "")), w - 4,
                                         max_size=fonts.get(key, 11.0), min_size=9.0, bold=True)
            draw.text((x + w / 2, cy), wide_txt, font=f_wide, fill=fill, anchor="mm")
        elif key == "ident":
            fill = SUB_INK if is_sub else MUTED
            # Dynamically maximized identifier cells
            f_id, id_txt = _fit_font(draw, str(cells.get(key, "")), w - 4,
                                     max_size=fonts.get(key, 12.0), min_size=9.5, bold=True)
            draw.text((x + w / 2, cy), id_txt, font=f_id, fill=fill, anchor="mm")
        else:
            fill = SUB_INK if is_sub else TEXT_DARK
            if key == "pct" and not is_sub:
                fill = cells.get("pct_color", TEXT_DARK)
            elif key == "projpct" and not is_sub:
                fill = cells.get("projpct_color", TEXT_DARK)
            # Dynamically maximized numeric cells (13.5 for subtotal, else per-column)
            max_s = 13.5 if is_sub else fonts.get(key, 13.0)
            f_num, num_txt = _fit_font(draw, str(cells.get(key, "")), w - 4,
                                       max_size=max_s, min_size=10.0, bold=True)
            draw.text((x + w / 2, cy), num_txt, font=f_num, fill=fill, anchor="mm")
        x += w


def _draw_table(draw, y, emp_type: str, rows, subtotal) -> None:
    specs = _table_specs(emp_type)
    widths, total_w, fonts, scale = _compute_widths(draw, specs, rows, subtotal, emp_type=emp_type)
    x1 = TBL_X0 + total_w
    hdr_max = min(11.5 * scale, 13.5)  # headers grow with the table zoom

    # Modern header with gradient effect
    draw.rectangle([TBL_X0, y, x1, y + HEADER_H], fill=TABLE_HDR_BG)
    draw.rectangle([TBL_X0, y, x1, y + 2], fill=ACCENT)  # Accent line

    xx = TBL_X0
    for key, label in specs:
        w = widths[key]
        if key == "name":
            f_hdr, h_txt = _fit_font(draw, label, w - PAD_X * 2, max_size=hdr_max, min_size=9.5, bold=True)
            draw.text((xx + PAD_X, y + HEADER_H / 2), h_txt, font=f_hdr, fill=TEXT_DARK, anchor="lm")
        else:
            f_hdr, h_txt = _fit_font(draw, label, w - 4, max_size=hdr_max, min_size=9.0, bold=True)
            draw.text((xx + w / 2, y + HEADER_H / 2), h_txt, font=f_hdr, fill=TEXT_DARK, anchor="mm")
        xx += w
    yy = y + HEADER_H

    # Data rows with alternating subtle backgrounds
    for i, r in enumerate(rows):
        if emp_type == "bp":
            bg = BP_ROW_BG if i % 2 == 0 else WHITE
        else:
            bg = WHITE if i % 2 == 0 else "#FAFBFC"
        draw.rectangle([TBL_X0, yy, x1, yy + ROW_H], fill=bg)
        _draw_row_cells(draw, TBL_X0, yy, ROW_H, specs, widths, fonts, r,
                        emp_type=emp_type, is_sub=False)
        yy += ROW_H

    # Modern subtotal row with accent
    if subtotal:
        draw.rectangle([TBL_X0, yy, x1, yy + SUB_H], fill=SUB_ROW_BG)
        draw.rectangle([TBL_X0, yy, x1, yy + 2], fill=ACCENT)  # Top accent line
        _draw_row_cells(draw, TBL_X0, yy, SUB_H, specs, widths, fonts, subtotal,
                        emp_type=emp_type, is_sub=True)
        yy += SUB_H

    # Vertical grid lines (lighter and cleaner)
    xx = TBL_X0
    for key in [s[0] for s in specs[:-1]]:
        xx += widths[key]
        draw.line([(xx, y), (xx, yy)], fill=GRID_LINE, width=1)

    # Modern outer border with rounded effect (corners)
    draw.rectangle([TBL_X0, y, x1, yy], outline=OUTER_LINE, width=2)


def _draw_table_caption(draw, y, title, count, emp_type, table_right: int | None = None) -> int:
    # Simple left-aligned text without badge
    draw.text((TBL_X0, y + CAPTION_H / 2), title,
              font=_font(13.5, True), fill=TEXT_DARK, anchor="lm")
    if count:
        # Modern count badge aligned to the table's actual right edge so it
        # never floats over the empty space left of a content-wide table.
        right = table_right if table_right is not None else TBL_X1
        count_text = f"{count} Employees"
        count_f = _font(10.5, True)
        count_w = int(draw.textlength(count_text, font=count_f)) + 20
        count_x = right - count_w
        draw.rounded_rectangle([count_x, y + CAPTION_H / 2 - 10, right, y + CAPTION_H / 2 + 10],
                              radius=10, fill=ACCENT_SOFT, outline=ACCENT, width=1)
        draw.text((count_x + count_w / 2, y + CAPTION_H / 2), count_text,
                  font=count_f, fill=ACCENT, anchor="mm")
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
            "projpct": _pct(projpct),
            "projpct_color": _pct_color(projpct),
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
        "projpct": _pct(projpct),
        "projpct_color": _pct_color(projpct),
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
        _rso_w = _compute_widths(draw, _table_specs("rso"),
                                 block["rso_rows"], block["rso_sub"], "rso")[1]
        yy = _draw_table_caption(draw, yy, "RSO - Team Performance",
                                 len(block["rso_rows"]), "rso", TBL_X0 + _rso_w)
        _draw_table(draw, yy, "rso", block["rso_rows"], block["rso_sub"])
        yy += _table_height(len(block["rso_rows"])) + TBL_SPLIT_GAP
    if block["bp_rows"]:
        _bp_w = _compute_widths(draw, _table_specs("bp"),
                                block["bp_rows"], block["bp_sub"], "bp")[1]
        yy = _draw_table_caption(draw, yy, "BP - Team Performance",
                                 len(block["bp_rows"]), "bp", TBL_X0 + _bp_w)
        _draw_table(draw, yy, "bp", block["bp_rows"], block["bp_sub"])
        yy += _table_height(len(block["bp_rows"]))
    block["bottom"] = yy


def _draw_footer(draw, y) -> None:
    # Modern light footer without top line
    draw.rectangle([TBL_X0, y, TBL_X1, y + FOOTER_H], fill=WHITE)

    # Icon placeholders (circles)
    draw.ellipse([TBL_X0 + 14, y + FOOTER_H / 2 - 8, TBL_X0 + 30, y + FOOTER_H / 2 + 8],
                fill=ACCENT)

    draw.text((TBL_X0 + 40, y + FOOTER_H / 2), "Together We Grow  •  Success Tomorrow",
              font=_font(11.5, True), fill=PRIMARY, anchor="lm")

    date_str = now_naive().strftime("%d %B %Y, %I:%M %p").lstrip("0")

    # Right side with icon
    draw.ellipse([TBL_X1 - 30, y + FOOTER_H / 2 - 8, TBL_X1 - 14, y + FOOTER_H / 2 + 8],
                fill=EMERALD)

    draw.text((TBL_X1 - 40, y + FOOTER_H / 2),
              f"Generated by OrangeFlow  •  {date_str}",
              font=_font(11.5, True), fill=MUTED, anchor="rm")


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
        # Add gap between blocks (except first one)
        if i > 0:
            cursor += 12
        b["y"] = cursor
        cursor += eh

    s = _active_scale()
    img = Image.new("RGB", (WIDTH * s, max(int(canvas_h), 60) * s), BG_COLOR)
    draw = ScaledDraw(ImageDraw.Draw(img))

    _draw_header(draw, house_name, house_code, summary, today, 0)
    for top in page_headers:
        _draw_header(draw, house_name, house_code, summary, today, top)
    _draw_summary_table(draw, HDR_H + 12, summary)
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
