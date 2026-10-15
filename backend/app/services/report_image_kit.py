"""Shared drawing primitives for the basic report images.

The GA Live and Activation report images share one visual language: a plain
header, a small title above each section, and fully bordered tables whose
columns are sized from their own content. This module owns that machinery so
both builders render identical-looking tables without duplicating the layout
code.

Layout math throughout stays in *design units* at a fixed canvas width;
``ScaledDraw`` multiplies every coordinate and font by the active render scale,
so a single render call produces a high-resolution PNG with crisp text.
"""
import math
from contextlib import contextmanager

from PIL import ImageFont

# ── Design palette (basic, print-friendly) ──
REPORT_BG = "#FFFFFF"
INK = "#12345B"

TOTAL_BG = "#EFFFF5"
TOTAL_INK = "#08773D"

TH_BG = "#EDF6FD"
TH_INK = "#123B68"
TD_BORDER = "#CBD9E6"
TOTAL_ROW_BG = "#E7F4FC"
LIVE_INK = "#0AA65A"

# ── Table layout constants shared by every section ──
SECTION_TITLE_H = 20     # plain section title band (no underline rule)
SECTION_TITLE_FONT = 13  # section title font size
TBL_F_HEAD = 11          # table header font size
TBL_F_CELL = 11          # table body font size

# Font candidates, most preferred first. The deployment image ships Liberation;
# DejaVu is the fallback so a bare dev machine can still render a report.
FONT_REG_CANDIDATES = [
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]
FONT_BOLD_CANDIDATES = [
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]

PCT_MAX_TEXT = "100.00%"  # widest value pct_2dp() can emit

_FONTS: dict = {}
_FONTS_SCALED: dict = {}


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    """Load a font at ``size`` design units, cached per (size, bold).

    Falls back to the bundled default font when none of the candidates are
    installed, so a missing font degrades the look instead of failing a send.
    """
    key = (size, bool(bold))
    font = _FONTS.get(key)
    if font is None:
        for path in (FONT_BOLD_CANDIDATES if bold else FONT_REG_CANDIDATES):
            try:
                font = ImageFont.truetype(path, size)
                break
            except (OSError, IOError):
                continue
        if font is None:
            try:
                font = ImageFont.load_default(size)
            except TypeError:  # Pillow < 10.1 has no size argument
                font = ImageFont.load_default()
        _FONTS[key] = font
    return font


def scaled_font(font: ImageFont.FreeTypeFont, scale: int) -> ImageFont.FreeTypeFont:
    """The same face as ``font`` re-loaded at ``scale`` times its size."""
    key = (getattr(font, "path", None), int(font.size * scale))
    f = _FONTS_SCALED.get(key)
    if f is None:
        try:
            f = ImageFont.truetype(font.path, int(font.size * scale))
        except (AttributeError, OSError, IOError):
            return font
        _FONTS_SCALED[key] = f
    return f


class RenderScale:
    """Per-report render scale.

    Every builder owns its own instance so a reduced-scale preview of one
    report can never change the resolution of a report rendered concurrently
    for another report type.
    """

    def __init__(self, default: int):
        self._default = default
        self._override: int | None = None

    def active(self) -> int:
        return self._override if self._override is not None else self._default

    @contextmanager
    def temp(self, scale: int):
        prev = self._override
        self._override = scale
        try:
            yield
        finally:
            self._override = prev


class ScaledDraw:
    """Wrap ImageDraw so every coordinate/font renders at the active scale.

    ``textlength`` is intentionally NOT scaled so layout math stays in design
    units (position + font both scale together, keeping the ratio).
    """

    def __init__(self, draw, scale: RenderScale):
        self._draw = draw
        self._scale = scale

    def _sc(self, p):
        if isinstance(p, (list, tuple)):
            return type(p)(self._sc(x) for x in p)
        return int(p * self._scale.active())

    def text(self, xy, text: str, font=None, fill=None, anchor=None, **kw):
        self._draw.text(
            self._sc(xy), text,
            font=scaled_font(font, self._scale.active()) if font is not None else None,
            fill=fill, anchor=anchor, **kw,
        )

    def textlength(self, text: str, font=None, **kw):
        return self._draw.textlength(text, font=font, **kw)

    def line(self, xy, fill=None, width=1, **kw):
        self._draw.line(self._sc(xy), fill=fill, width=int(width * self._scale.active()), **kw)

    def rectangle(self, xy, fill=None, outline=None, width=1, **kw):
        self._draw.rectangle(self._sc(xy), fill=fill, outline=outline,
                             width=int(width * self._scale.active()), **kw)

    def rounded_rectangle(self, xy, radius=0, fill=None, outline=None, width=1, **kw):
        self._draw.rounded_rectangle(self._sc(xy), radius=radius * self._scale.active(),
                                     fill=fill, outline=outline,
                                     width=int(width * self._scale.active()), **kw)

    def ellipse(self, xy, fill=None, outline=None, width=1, **kw):
        self._draw.ellipse(self._sc(xy), fill=fill, outline=outline,
                           width=int(width * self._scale.active()), **kw)

    def arc(self, xy, start, end, fill=None, width=1, **kw):
        self._draw.arc(self._sc(xy), start, end, fill=fill,
                       width=int(width * self._scale.active()), **kw)


# ── Formatting helpers ──
def fmt_num(n) -> str:
    """Thousands-separated number: whole values stay whole, decimals keep one digit."""
    if n is None:
        return "0"
    try:
        v = float(n)
    except (TypeError, ValueError):
        return str(n)
    if abs(v - round(v)) < 0.05:
        return f"{int(round(v)):,}"
    return f"{v:,.1f}"


def pct_2dp(part, whole) -> str:
    """Percentage with a fixed 2-decimal format (e.g. 6.98%, 100.00%).

    Deliberately 2 decimals instead of the text report's 1: these tables sit in
    a fixed-width ``%`` column floored to ``PCT_MAX_TEXT``, so the wider form
    always fits while matching the precision the dashboard shows.
    """
    try:
        if not whole:
            return "0.00%"
        return f"{float(part) / float(whole) * 100:.2f}%"
    except (TypeError, ValueError, ZeroDivisionError):
        return "0.00%"


def ellipsize(draw, text, font, max_w: float) -> str:
    s = str(text)
    if draw.textlength(s, font=font) <= max_w:
        return s
    while s and draw.textlength(s + "…", font=font) > max_w:
        s = s[:-1]
    return s + "…" if s else s


# ── Column / table helpers ──
def fit_widths(weights: list[int], avail: int) -> list[int]:
    if not weights:
        return []
    total = sum(weights)
    widths = [max(1, avail * w // total) for w in weights]
    order = sorted(range(len(widths)), key=lambda i: widths[i], reverse=True)
    i = 0
    while i < 500:
        diff = avail - sum(widths)
        if diff == 0:
            break
        if diff > 0:
            widths[order[i % len(order)]] += 1
        else:
            big = order[0]
            if widths[big] > 2:
                widths[big] -= 1
            else:
                break
        i += 1
        order = sorted(range(len(widths)), key=lambda i: widths[i], reverse=True)
    return widths


def table_heights(f_head, f_cell):
    head_h = f_head.size + 10
    row_h = f_cell.size + 7
    return head_h, row_h


def table_height(rows: int, f_head=None, f_cell=None) -> int:
    """Height of a table with ``rows`` body rows, including its header."""
    hh, rh = table_heights(f_head or load_font(TBL_F_HEAD, True),
                           f_cell or load_font(TBL_F_CELL, True))
    return hh + rh * rows


def _live_display(ci, text, live_cols):
    """Mirror the '● N' decoration applied to live columns."""
    if ci in live_cols:
        num = str(text).replace("●", "").strip()
        if num in ("0", "", "-", "0%", "None"):
            return num or ""
        return f"● {num}"
    return str(text)


def content_weights(labels, rows, f_head, f_cell, live_cols, margin=8, max_total=None,
                    total_row=None, total_span=0, pct_floor_text: str | None = PCT_MAX_TEXT):
    """Compute integer column weights sized to the widest label/cell text.

    Each column is sized to fit its widest content (plus ``margin``), so every
    value stays fully visible instead of being ellipsized away. ``total_row``
    (when given) is measured too, but only for columns outside ``total_span``:
    when the total row's leading label spans several columns (``total_span > 0``)
    it is measured against the combined width of those columns instead, so a
    label like "Total (9 RSO)" never inflates the serial-number column along
    side it. ``max_total`` caps the combined weight when content cannot
    otherwise fit. ``pct_floor_text`` floors the ``%`` column to a fixed widest
    value (pass ``None`` to size it from content only, e.g. when percentages are
    rendered as whole numbers).
    """
    n = len(labels)
    if n == 0:
        return []
    req = [0.0] * n
    for ci in range(n):
        w = f_head.getlength(str(labels[ci]))
        for r in rows:
            v = r[ci] if ci < len(r) else ""
            w = max(w, f_cell.getlength(_live_display(ci, v, live_cols)))
        if total_row is not None and (total_span == 0 or ci >= total_span):
            w = max(w, f_head.getlength(str(total_row[ci]) if ci < len(total_row) else ""))
        req[ci] = math.ceil(w + margin)
    if max_total and sum(req) > max_total:
        scale = max_total / sum(req)
        req = [max(1, int(r * scale)) for r in req]
    if total_row is not None and total_span > 0 and len(total_row):
        span_w = sum(req[:total_span])
        need = f_head.getlength(str(total_row[0])) + margin
        if need > span_w:
            req[total_span - 1] += need - span_w
    # Percentage columns are floored to the widest value the renderer can ever
    # emit, independently of this render's data. Sizing them purely from the
    # current content meant a render full of small percentages (e.g. "6.98%")
    # narrowed the column, and a later 100.00% was ellipsized to "100.0...".
    # Applied last because the max_total cap above only shrinks the total, which
    # makes every column proportionally wider in pixels - so a weight equal to
    # the required pixels is always enough.
    if pct_floor_text:
        pct_min = math.ceil(f_cell.getlength(pct_floor_text) + margin)
        for ci, lb in enumerate(labels):
            if str(lb).strip() == "%":
                req[ci] = max(req[ci], pct_min)
    return [max(1, r) for r in req]


def draw_table(
    draw,
    x: int,
    y: int,
    width: int,
    labels: list[str],
    rows: list[list],
    *,
    weights: list[int] | None = None,
    left_cols: list[int] | None = None,
    live_cols: list[int] | None = None,
    total_row: list | None = None,
    total_span: int = 0,
    f_head,
    f_cell,
    borderless=False,
    border_color=None,
    th_bg: str | None = None,
    th_ink: str | None = None,
    cell_ink: str | None = None,
    live_dot: str | None = None,
    cell_color_map: dict[int, dict[str, str]] | None = None,
) -> int:
    """Draw a bordered table starting at (x, y). Returns the height used.

    When ``total_span > 0`` the total row's value in column 0 is drawn as a
    merged cell spanning columns ``0..total_span-1`` (interior vertical borders
    are omitted inside that span on the total row), so a label like
    "Total (9 RSO)" no longer widens the serial-number column.

    ``cell_color_map`` maps a column index to a ``{cell text: colour}`` lookup so
    a column can colour its values by value (e.g. a status column: green for
    "Achieved", red for "Behind"); values with no entry keep the normal ink.
    """
    n = len(labels)
    if n == 0:
        return 0
    left_cols = left_cols or []
    live_cols = live_cols or []
    weights = weights or [6 if i in left_cols else 4 for i in range(n)]
    widths = fit_widths(weights, width)
    head_h, row_h = table_heights(f_head, f_cell)
    all_rows = rows if total_row is None else rows + [total_row]

    th_bg = th_bg or TH_BG
    th_ink = th_ink or TH_INK
    cell_ink = cell_ink or INK
    live_dot = live_dot or LIVE_INK

    # header
    draw.rectangle([x, y, x + width, y + head_h], fill=th_bg)
    for ci, lab in enumerate(labels):
        cw = widths[ci]
        tx = x + sum(widths[:ci])
        if ci in left_cols:
            draw.text((tx + 5, y + head_h / 2), str(lab), font=f_head, fill=th_ink, anchor="lm")
        else:
            draw.text((tx + cw / 2, y + head_h / 2), str(lab), font=f_head, fill=th_ink, anchor="mm")

    yy = y + head_h
    for ri, row in enumerate(all_rows):
        is_total = total_row is not None and ri == len(rows)
        span = total_span if is_total and total_span else 1
        if is_total:
            draw.rectangle([x, yy, x + width, yy + row_h], fill=TOTAL_ROW_BG)
        font = f_head if is_total else f_cell
        # Same colour rule for the total row as for every normal row: only the
        # live columns (Live GA / Own / Market) are green, all other columns use
        # the normal cell ink.
        color = cell_ink
        for ci in range(n):
            if is_total and span > 1:
                if ci == 0:
                    merged_w = sum(widths[:span])
                    disp = ellipsize(draw, str(row[0] if row else ""), font, merged_w - 10)
                    draw.text((x + 5, yy + row_h / 2), disp, font=font, fill=color, anchor="lm")
                    continue
                if ci < span:
                    continue
            val = row[ci] if ci < len(row) else ""
            txt = _live_display(ci, val, live_cols)
            cw = widths[ci]
            tx = x + sum(widths[:ci])
            cell_color = live_dot if (ci in live_cols and txt.startswith("●")) else color
            if not is_total and cell_color_map:
                mapped = cell_color_map.get(ci)
                if mapped and txt in mapped:
                    cell_color = mapped[txt]
            disp = ellipsize(draw, txt, font, cw - 8)
            if ci in left_cols:
                draw.text((tx + 5, yy + row_h / 2), disp, font=font, fill=cell_color, anchor="lm")
            else:
                draw.text((tx + cw / 2, yy + row_h / 2), disp, font=font, fill=cell_color, anchor="mm")
        yy += row_h

    # borders (skipped when borderless; border_color overrides default TD_BORDER)
    if not borderless:
        bc = border_color or TD_BORDER
        draw.rectangle([x, y, x + width, yy], outline=bc)
        total_y0 = y + head_h + len(rows) * row_h
        for ci in range(1, n):
            lx = x + sum(widths[:ci])
            if total_span and total_row is not None and ci < total_span:
                draw.line([(lx, y), (lx, total_y0)], fill=bc)
                draw.line([(lx, total_y0 + row_h), (lx, yy)], fill=bc)
            else:
                draw.line([(lx, y), (lx, yy)], fill=bc)
        n_inner = len(all_rows)
        if n_inner > 1:
            for r in range(1, n_inner):
                ly = y + head_h + r * row_h
                draw.line([(x, ly), (x + width, ly)], fill=bc)
    return head_h + row_h * len(all_rows)


def draw_section_title(draw, x, y, text, font_size: int = SECTION_TITLE_FONT) -> int:
    """Draw a plain section title, returning the y of the table below it.

    ``font_size`` lets a report with a roomier canvas use a larger heading while
    every other report keeps the default.
    """
    draw.text((x, y + 10), text, font=load_font(font_size, True), fill=INK, anchor="lm")
    return y + SECTION_TITLE_H


def render_section(draw, x, y, w, title, labels, rows, *, live_cols=(), total_row=None,
                   total_span=0, left_cols=(1,), weights=None, borderless=False,
                   f_head=None, f_cell=None, cell_color_map=None,
                   title_font_size: int = SECTION_TITLE_FONT) -> int:
    """Basic section: a plain title above a full-width bordered table.

    Returns the y directly below the table. ``weights`` overrides the default
    content-sized columns (used by the single-row metric summary, whose cells
    are evenly split). ``f_head`` / ``f_cell`` / ``title_font_size`` let a report
    override the default fonts (e.g. a wider canvas with more readable text);
    callers that pass no fonts keep the shared defaults. ``cell_color_map``
    is forwarded to :func:`draw_table` to colour values by text (e.g. status).
    """
    y = draw_section_title(draw, x, y, title, font_size=title_font_size)
    f_head = f_head or load_font(TBL_F_HEAD, True)
    f_cell = f_cell or load_font(TBL_F_CELL, True)
    if weights is None:
        weights = content_weights(labels, rows, f_head, f_cell, live_cols,
                                  max_total=w, total_row=total_row, total_span=total_span)
    draw_table(draw, x, y, w, labels, rows, weights=weights, left_cols=list(left_cols),
               live_cols=list(live_cols), total_row=total_row, total_span=total_span,
               f_head=f_head, f_cell=f_cell, borderless=borderless,
               cell_color_map=cell_color_map)
    return y + table_height(len(rows) + (1 if total_row is not None else 0), f_head, f_cell)
