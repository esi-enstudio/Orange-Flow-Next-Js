"""Activation Report image builder for WhatsApp/Telegram delivery.

Renders the current month's Activation Dashboard as a clean business-style
PNG mirroring the `/reports/activations` dashboard rules:

    * Status        -> projectionStatus(achPct, projPct) identity with the
                       dashboard page: achieved / on_track / needs_attention /
                       behind (see ``projectionStatus`` in page.tsx)
    * Percentage    -> coloured by pct thresholds (>=100 emerald, >=70 blue,
                       >=40 amber, else red)
    * Achieved      -> achievement vs house/month target
    * DRR           -> ceil(remaining / max(days_remaining, 1)) like the page table
    * RSO           -> Market GA (Yest/MTD) + Own GA (Yest/MTD/Day) columns
    * BP            -> Yesterday + Day Count columns
    * Daily Require -> daily_required (excl. Fridays); subtitle shows the with-Friday value
    * Subtotal      -> aggregated per group using the dashboard formulas
                       (pct from totals, D.Avg = totalAch / days_elapsed, etc.)

Layout follows the reference design: navy header with brand tagline, house
metric-card rows, per-supervisor navy banner + employee table, footer.
"""
import io
import math
from contextlib import contextmanager
from datetime import date

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy.ext.asyncio import AsyncSession

# We deliberately generate large (multi-thousand pixel) report images at
# RENDER_SCALE below — the size is intended, not a decompression bomb.
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

# ── Design palette (business report) ──
BG_COLOR = "#F4F7FC"
WHITE = "#FFFFFF"
NAVY = "#084182"
NAVY_SOFT = "#B3D4FF"
PURPLE = "#403294"
TABLE_HDR_BG = "#DEEBFF"
BP_ROW_BG = "#F4F5F7"
SUB_ROW_BG = "#EAF2FF"
CARD_BORDER = "#E0E6ED"
TEXT_DARK = "#172B4D"
MUTED = "#5E6C84"
SUB_INK = "#084182"
GRAY_DARK = "#172B4D"
AMBER = "#F59E0B"

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


# ── Dashboard business rules (mirror page.tsx / export-activations.ts) ──
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


# ── Layout constants (design units, 1000 wide → portrait ratio) ──
WIDTH = 1000
TBL_X0 = 24
TBL_X1 = WIDTH - 24
HDR_H = 120
BANNER_H = 55
HEADER_H = 26
ROW_H = 28
SUB_H = 24
FOOTER_H = 44

# Minimum canvas aspect: height is always ≥ WIDTH × PORTRAIT_MIN_RATIO, so the
# generated report is portrait (taller than wide) even for small datasets.
PORTRAIT_MIN_RATIO = 1.1

# Table column text anchor x positions (start of each column cell).
COL = {
    "num": 24,
    "name": 70,
    "target": 245,
    "achievement": 297,
    "pct": 351,
    "remaining": 395,
    "drr": 445,
    "davg": 493,
    "proj": 539,
    "market": 619,     # RSO  — Market GA (Yest/MTD)
    "own": 711,        # RSO  — Own GA (Yest/MTD/Day)
    "yest": 619,       # BP / Supervisor — Yesterday
    "days": 711,       # BP   — Day Count
    "status": 820,
}
# Column right boundaries (for ellipsizing cell text).
COL_END = {
    "num": 68,
    "name": 242,
    "target": 295,
    "achievement": 349,
    "pct": 393,
    "remaining": 443,
    "drr": 491,
    "davg": 537,
    "proj": 615,
    "market": 709,
    "own": 801,
    "yest": 709,
    "days": 801,
    "status": 960,
}

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


# ── Native high-resolution rendering ──
# All layout math stays in the 1000-wide design space; ScaledDraw renders
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
    key = (font.path, int(font.size * _active_scale()))
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
    while s and draw.textlength(s + "…", font=font) > max_w:
        s = s[:-1]
    return s + "…" if s else s


# ── Formatting helpers ──
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


# ── Drawing ──
def _draw_metric_card(draw, x, y, w, h, title, value, color, subtitle=None):
    draw.rounded_rectangle([x, y, x + w, y + h], radius=8, fill=WHITE,
                           outline=CARD_BORDER, width=1)
    draw.text((x + 18, y + 18), title, font=_font(11, True), fill=MUTED, anchor="lm")
    draw.text((x + 18, y + 42), value, font=_font(20, True), fill=color, anchor="lm")
    if subtitle:
        draw.text((x + 18, y + 62), subtitle, font=_font(8.5, True), fill=MUTED, anchor="lm")


def _draw_header(draw, house_name, house_code, today: date) -> None:
    draw.rectangle([(0, 0), (WIDTH, HDR_H)], fill=NAVY)

    date_str = today.strftime("%d %b %Y")
    month_year = today.strftime("%B %Y")
    time_str = now_naive().strftime("%I:%M %p").lstrip("0")

    draw.text((30, 42), "Activation Report", font=_font(34, True), fill=WHITE, anchor="lm")
    draw.text((30, 82), f"{house_name} ({house_code})".strip(),
              font=_font(21, True), fill=NAVY_SOFT, anchor="lm")
    draw.text((30, 106), f"Date: {date_str}   |   Time: {time_str}   |   {month_year}",
              font=_font(14, True), fill=WHITE, anchor="lm")

    # Right brand tagline (three lines)
    tx = WIDTH - 270
    draw.text((tx, 24), "More Activation", font=_font(14, True), fill=WHITE, anchor="lm")
    draw.text((tx, 46), "Stronger Network", font=_font(14, True), fill=WHITE, anchor="lm")
    draw.text((tx, 68), "Better Tomorrow", font=_font(14, True), fill=WHITE, anchor="lm")


def _draw_summary_cards(draw, summary) -> int:
    """Draw the two metric-card rows; returns the y just below them."""
    card_h = 80
    y = HDR_H + 20
    ach_pct = float(summary.get("achievement_percentage") or 0)
    exp_pct = float(summary.get("expected_percentage") or 0)

    row1 = [
        ("House Target", _fmt(summary.get("monthly_target") or 0), GRAY_DARK, None),
        ("House Achievement", _fmt(summary.get("achievement") or 0), TEXT_DARK, None),
        ("Achievement %", _pct(ach_pct), _pct_color(ach_pct), None),
        ("Remaining", _fmt(summary.get("remaining") or 0), AMBER, None),
    ]
    row2 = [
        ("Daily Require", _fmt(math.ceil(summary.get("daily_required") or 0)), PURPLE, None),
        ("Daily Average", _fmt(round(summary.get("daily_average") or 0)), "#3B82F6", None),
        ("Projection", _fmt(round(summary.get("projection") or 0)),
         _pct_color(exp_pct) if exp_pct >= 70 else AMBER, None),
        ("Expected %", _pct(exp_pct), _pct_color(exp_pct), None),
        ("Yest. Activation", _fmt(summary.get("yesterday_activation") or 0), PURPLE, None),
    ]

    for ri, row in enumerate((row1, row2)):
        step = 235 if ri == 0 else 186
        card_w = 225 if ri == 0 else 180
        for ci, (label, value, color, _sub) in enumerate(row):
            _draw_metric_card(draw, 30 + ci * step, y, card_w, card_h, label, value, color)
        y += card_h + 10

    # Subtitle line under the cards (days / fridays info like the page subtitles)
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
    return y + 18


def _draw_banner(draw, y, title, stats, status: str) -> None:
    draw.rectangle([TBL_X0, y, TBL_X1, y + BANNER_H], fill=NAVY)
    f_title = _font(17, True)
    draw.text((50, y + BANNER_H / 2),
              _ellipsize(draw, title, f_title, 300),
              font=f_title, fill=WHITE, anchor="lm")
    sx = 360
    for label, val in stats:
        draw.text((sx, y + 10), label, font=_font(9.5, True), fill=NAVY_SOFT, anchor="lm")
        draw.text((sx, y + 33), val, font=_font(14, True), fill=WHITE, anchor="lm")
        sx += 68

    if status:
        label = STATUS_LABELS.get(status, status)
        h = 26
        _draw_status_pill(draw, TBL_X1 - 16, y + (BANNER_H - h) / 2, h, status,
                          label, align="right")


def _draw_table_header(draw, y, type: str) -> None:
    draw.rectangle([TBL_X0, y, TBL_X1, y + HEADER_H], fill=TABLE_HDR_BG)
    for x, label in _header_labels(type):
        draw.text((x, y + HEADER_H / 2), label, font=_font(11, True),
                  fill=TEXT_DARK, anchor="lm")


def _header_labels(type: str):
    common = [
        (COL["num"], "#"),
        (COL["name"], "Employee Name"),
        (COL["target"], "Target"),
        (COL["achievement"], "Achiev."),
        (COL["pct"], "Achv %"),
        (COL["remaining"], "Remain"),
        (COL["drr"], "DRR"),
        (COL["davg"], "D.Avg"),
        (COL["proj"], "Projection"),
    ]
    if type == "rso":
        extra = [(COL["market"], "Market GA"), (COL["own"], "Own GA")]
    elif type == "bp":
        extra = [(COL["yest"], "Yesterday"), (COL["days"], "Day")]
    else:
        extra = [(COL["yest"], "Yesterday")]
    return common + extra + [(COL["status"], "Status")]


def _draw_status_pill(draw, x, y, h, status: str, label=None, align="left",
                      font_size=11) -> None:
    label = label or STATUS_LABELS.get(status, status)
    f = _font(font_size, True)
    w = int(draw.textlength(label, font=f)) + 20
    if align == "right":
        x = x - w
    draw.rounded_rectangle([x, y, x + w, y + h], radius=h / 2,
                           fill=_status_color(status))
    draw.text((x + w / 2, y + h / 2), label, font=f, fill=WHITE, anchor="mm")


def _draw_value_row(draw, y, cells: dict, *, emp_type: str) -> None:
    bg = BP_ROW_BG if emp_type == "bp" else WHITE
    draw.rectangle([TBL_X0, y, TBL_X1, y + ROW_H], fill=bg)

    draw.text((COL["num"], y + ROW_H / 2), cells["num"], font=_font(12, True),
              fill=TEXT_DARK, anchor="lm")

    # Name + identifier subtitle (mirrors dashboard name cell)
    draw.text((COL["name"], y + 10),
              _ellipsize(draw, cells["name"], _font(13, True),
                         COL_END["name"] - COL["name"] - 4),
              font=_font(13, True), fill=TEXT_DARK, anchor="lm")
    draw.text((COL["name"], y + 23),
              _ellipsize(draw, cells.get("ident", ""), _font(9.5, True),
                         COL_END["name"] - COL["name"] - 4),
              font=_font(9.5, True), fill=MUTED, anchor="lm")

    for key in ("target", "achievement", "remaining", "drr", "davg"):
        draw.text((COL[key], y + ROW_H / 2 - 1), cells[key], font=_font(12, True),
                  fill=TEXT_DARK, anchor="lm")

    draw.text((COL["pct"], y + ROW_H / 2 - 1), cells["pct"], font=_font(12, True),
              fill=cells["pct_color"], anchor="lm")

    # Projection (value + proj %)
    draw.text((COL["proj"], y + 9), cells["proj"], font=_font(12, True),
              fill=TEXT_DARK, anchor="lm")
    draw.text((COL["proj"], y + 21), _pct(cells.get("projpct")), font=_font(9.5, True),
              fill=MUTED, anchor="lm")

    if emp_type == "rso":
        my, mm = cells["market"]
        draw.text((COL["market"], y + 8), f"Yest: {my}", font=_font(10.5, True),
                  fill=TEXT_DARK, anchor="lm")
        draw.text((COL["market"], y + 20), f"MTD: {mm}", font=_font(9.5, True),
                  fill=MUTED, anchor="lm")
        oy, om, od = cells["own"]
        draw.text((COL["own"], y + 6), f"Yest: {oy}", font=_font(10.5, True),
                  fill=TEXT_DARK, anchor="lm")
        draw.text((COL["own"], y + 17), f"MTD: {om}", font=_font(9.5, True),
                  fill=MUTED, anchor="lm")
        draw.text((COL["own"], y + 27), f"Day: {od}", font=_font(9.5, True),
                  fill=MUTED, anchor="lm")
    else:
        draw.text((COL["yest"], y + ROW_H / 2 - 1), cells["yest"], font=_font(12, True),
                  fill=TEXT_DARK, anchor="lm")
        if emp_type == "bp":
            draw.text((COL["days"], y + ROW_H / 2 - 1), cells["days"], font=_font(12, True),
                      fill=TEXT_DARK, anchor="lm")

    _draw_status_pill(draw, TBL_X1 - 16, y + (ROW_H - 22) / 2, 22,
                      cells["status"], align="right")

    draw.line([(TBL_X0, y + ROW_H), (TBL_X1, y + ROW_H)], fill=CARD_BORDER, width=1)


def _draw_subtotal_row(draw, y, cells: dict, *, emp_type: str) -> None:
    draw.rectangle([TBL_X0, y, TBL_X1, y + SUB_H], fill=SUB_ROW_BG)

    draw.text((COL["name"], y + SUB_H / 2), cells["name"], font=_font(13, True),
              fill=SUB_INK, anchor="lm")
    for key in ("target", "achievement", "remaining", "drr", "davg"):
        draw.text((COL[key], y + SUB_H / 2), cells[key], font=_font(13, True),
                  fill=SUB_INK, anchor="lm")
    draw.text((COL["pct"], y + SUB_H / 2), cells["pct"], font=_font(13, True),
              fill=cells["pct_color"], anchor="lm")
    draw.text((COL["proj"], y + SUB_H / 2 - 6), cells["proj"], font=_font(13, True),
              fill=SUB_INK, anchor="lm")
    draw.text((COL["proj"], y + SUB_H / 2 + 6), _pct(cells.get("projpct")),
              font=_font(9.5, True), fill=MUTED, anchor="lm")

    if emp_type == "rso":
        my, mm = cells["market"]
        draw.text((COL["market"], y + 8), f"Yest: {my}", font=_font(10.5, True),
                  fill=SUB_INK, anchor="lm")
        draw.text((COL["market"], y + 19), f"MTD: {mm}", font=_font(9.5, True),
                  fill=MUTED, anchor="lm")
        oy, om, od = cells["own"]
        draw.text((COL["own"], y + 6), f"Yest: {oy}", font=_font(10.5, True),
                  fill=SUB_INK, anchor="lm")
        draw.text((COL["own"], y + 16), f"MTD: {om}", font=_font(9.5, True),
                  fill=MUTED, anchor="lm")
        draw.text((COL["own"], y + 24), f"Day: {od}", font=_font(9.5, True),
                  fill=MUTED, anchor="lm")
    else:
        draw.text((COL["yest"], y + SUB_H / 2), cells["yest"], font=_font(13, True),
                  fill=SUB_INK, anchor="lm")
        if emp_type == "bp":
            draw.text((COL["days"], y + SUB_H / 2), cells["days"], font=_font(13, True),
                      fill=SUB_INK, anchor="lm")

    _draw_status_pill(draw, TBL_X1 - 16, y + (SUB_H - 20) / 2, 20,
                      cells["status"], align="right")


def _draw_footer(draw, y) -> None:
    draw.rectangle([TBL_X0, y, TBL_X1, y + FOOTER_H], fill=NAVY)
    draw.text((TBL_X0 + 16, y + FOOTER_H / 2), "Together We Grow  |  Success Tomorrow",
              font=_font(12, True), fill=WHITE, anchor="lm")
    date_str = now_naive().strftime("%d %B %Y, %I:%M %p")
    draw.text((TBL_X1 - 16, y + FOOTER_H / 2),
              f"Generated by OrangeFlow  |  {date_str}",
              font=_font(12, True), fill=WHITE, anchor="rm")


# ── Data / row builders ──
def _perf_row(perf: dict, idx: int, emp_type: str, days_remaining: int) -> dict:
    """Build a display row dict from an employee performance entry, applying
    the dashboard page's status + colour rules."""
    remaining = perf.get("remaining") or 0
    pct = float(perf.get("percentage") or 0)
    proj = float(perf.get("projection") or 0)
    target = float(perf.get("target") or 0)
    projpct = round(proj / target * 100) if target else 0
    status = _projection_status(pct, projpct)

    row = {
        "num": str(idx),
        "name": str(perf.get("name") or ""),
        "target": _fmt(perf.get("target") or 0),
        "achievement": _fmt(perf.get("achievement") or 0),
        "pct": _pct(pct),
        "pct_color": _pct_color(pct),
        "remaining": _fmt(remaining),
        "drr": _fmt(_ceil_div(remaining, days_remaining)),
        "davg": _fmt(perf.get("daily_average") or 0),
        "proj": _fmt(round(proj)),
        "projpct": projpct,
        "status": status,
    }
    if emp_type == "rso":
        row["ident"] = " · ".join(filter(None, [perf.get("dms_code"), perf.get("itop_number")]))
        row["market"] = (_fmt(perf.get("market_yesterday") or 0),
                         _fmt(perf.get("market_activation") or 0))
        row["own"] = (_fmt(perf.get("yesterday_activation") or 0),
                      _fmt(perf.get("month_total_activation") or 0),
                      _fmt(perf.get("active_days") or 0))
    else:
        row["ident"] = str(perf.get("pool_number") or "")
        row["yest"] = _fmt(perf.get("yesterday_activation") or 0)
        if emp_type == "bp":
            row["days"] = _fmt(perf.get("active_days") or 0)
    return row


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
        "name": f"Subtotal ({len(rows)})",
        "target": _fmt(target),
        "achievement": _fmt(ach),
        "pct": _pct(pct),
        "pct_color": _pct_color(pct),
        "remaining": _fmt(remaining),
        "drr": _fmt(_ceil_div(remaining, days_remaining)),
        "davg": _fmt(davg),
        "proj": _fmt(round(proj)),
        "projpct": projpct,
        "status": status,
    }
    if emp_type == "rso":
        row["ident"] = ""
        row["market"] = (_fmt(sum(r.get("market_yesterday") or 0 for r in rows)),
                         _fmt(sum(r.get("market_activation") or 0 for r in rows)))
        row["own"] = (_fmt(sum(r.get("yesterday_activation") or 0 for r in rows)),
                      _fmt(sum(r.get("month_total_activation") or 0 for r in rows)),
                      _fmt(sum(r.get("active_days") or 0 for r in rows)))
    else:
        row["ident"] = ""
        row["yest"] = _fmt(sum(r.get("yesterday_activation") or 0 for r in rows))
        if emp_type == "bp":
            row["days"] = _fmt(sum(r.get("active_days") or 0 for r in rows))
    return row


def _build_blocks(dashboard: dict, days_remaining: int) -> list[dict]:
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

        sup_pct = float(sup.get("percentage") or 0)
        sup_proj = float(sup.get("projection") or 0)
        sup_target = float(sup.get("target") or 0)
        sup_projpct = round(sup_proj / sup_target * 100) if sup_target else 0
        blocks.append({
            "title": f"Supervisor: {sup.get('name') or ''}",
            "stats": [
                ("Target", _fmt(sup.get("target") or 0)),
                ("Achievement", _fmt(sup.get("achievement") or 0)),
                ("Achv %", _pct(sup_pct)),
                ("Remaining", _fmt(sup.get("remaining") or 0)),
                ("Projection", _fmt(round(sup_proj))),
                ("Proj %", str(round(sup_projpct)) + "%"),
                ("Yest. Act.", _fmt(sup.get("yesterday_activation") or 0)),
            ],
            "status": _projection_status(sup_pct, sup_projpct),
            "rso_data": rso_data,
            "bp_data": bp_data,
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
        yest = sum(r.get("yesterday_activation") or 0 for r in data)
        u_pct = round(ach / target * 100) if target else 0
        u_projpct = round(proj / target * 100) if target else 0
        blocks.append({
            "title": "Others (Unassigned)",
            "stats": [
                ("Target", _fmt(target)),
                ("Achievement", _fmt(ach)),
                ("Achv %", _pct(u_pct)),
                ("Remaining", _fmt(remaining)),
                ("Projection", _fmt(round(proj))),
                ("Proj %", str(round(u_projpct)) + "%"),
                ("Yest. Act.", _fmt(yest)),
            ],
            "status": _projection_status(u_pct, u_projpct),
            "rso_data": unassigned_rso,
            "bp_data": unassigned_bp,
        })

    return blocks


def _block_height(n_rso: int, n_bp: int) -> int:
    h = BANNER_H + HEADER_H + 8
    if n_rso:
        h += ROW_H * n_rso + SUB_H
    h += 8
    if n_bp:
        h += ROW_H * n_bp + SUB_H
    return h + 16


def _render_image(house_name: str, house_code: str, dashboard: dict,
                  today: date) -> bytes:
    summary = dashboard.get("summary", {})
    days_remaining = summary.get("days_remaining") or 0
    days_elapsed = summary.get("days_elapsed") or 0

    blocks = _build_blocks(dashboard, days_remaining)

    # ── Measure total height (must mirror the draw flow below) ──
    total_h = HDR_H + 20 + 80 + 10 + 80 + 10 + 18
    for block in blocks:
        total_h += _block_height(len(block["rso_data"]), len(block["bp_data"]))
    if blocks:
        total_h += 16
    total_h += FOOTER_H + 20

    # ── Portrait guarantee: pad the height so it's always ≥ 1.1×WIDTH.
    # Extra space is spread over the section gaps so it looks like generous
    # spacing instead of a blank strip. ──
    pad = max(0, int(WIDTH * PORTRAIT_MIN_RATIO) - total_h)
    top_extra = min(60, pad)
    pad -= top_extra
    if blocks:
        foot_extra = min(60, pad)
        pad -= foot_extra
        n = len(blocks)
        block_extra = pad // n
        foot_extra += pad - block_extra * n
    else:
        block_extra = 0
        foot_extra = pad
    total_h += top_extra + foot_extra + block_extra * len(blocks)

    s = _active_scale()
    img = Image.new("RGB", (WIDTH * s, max(int(total_h), 60) * s), BG_COLOR)
    draw = ScaledDraw(ImageDraw.Draw(img))

    _draw_header(draw, house_name, house_code, today)
    y = _draw_summary_cards(draw, summary)
    y += top_extra

    for block in blocks:
        _draw_banner(draw, y, block["title"], block["stats"], block["status"])
        yy = y + BANNER_H + 4
        if block["rso_data"] or block["bp_data"]:
            _draw_table_header(draw, yy, "rso" if block["rso_data"] else "bp")
            yy += HEADER_H + 3

        if block["rso_data"]:
            for i, perf in enumerate(block["rso_data"]):
                _draw_value_row(draw, yy, _perf_row(
                    perf, i + 1, "rso", days_remaining), emp_type="rso")
                yy += ROW_H
            _draw_subtotal_row(draw, yy, _group_subtotal(
                block["rso_data"], "rso", days_remaining, days_elapsed), emp_type="rso")
            yy += SUB_H + 6

        if block["bp_data"]:
            for i, perf in enumerate(block["bp_data"]):
                _draw_value_row(draw, yy, _perf_row(
                    perf, i + 1, "bp", days_remaining), emp_type="bp")
                yy += ROW_H
            _draw_subtotal_row(draw, yy, _group_subtotal(
                block["bp_data"], "bp", days_remaining, days_elapsed), emp_type="bp")
            yy += SUB_H

        y = yy + 16 + block_extra

    if blocks:
        y += 16 + foot_extra
    _draw_footer(draw, y)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


async def build_activation_report_image(
    db: AsyncSession, house_id: int, scale: int | None = None
) -> bytes:
    """Build the current month's Activation Report as a PNG image.

    ``scale`` overrides the default RENDER_SCALE — used for fast, reduced-size
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