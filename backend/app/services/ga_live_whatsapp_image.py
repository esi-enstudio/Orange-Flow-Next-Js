"""Server-side GA Live Report image builder for WhatsApp chat delivery.

Renders the GA Live Report as a PNG image:

- Gradient blue header with house meta + big "Total Activations" box
- DD SUMMARY: a plain title over a single-row metric table
- SUPERVISOR PERFORMANCE: one basic table for all supervisors
- RSO PERFORMANCE: one basic table for every RSO
- BP PERFORMANCE: one basic table for every BP

The layout is a single full-width column (portrait strip) with small margins, so
the image reads as one tall page on a phone and fills an A4 page when printed.
"""
import io
import math
from contextlib import contextmanager
from datetime import date

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy.ext.asyncio import AsyncSession

# We deliberately generate very large (multi-thousand pixel) report images at
# RENDER_SCALE below — the size is intended, not a decompression bomb.
Image.MAX_IMAGE_PIXELS = None

from app.services.ga_live_whatsapp_text import _load_report_data, _fmt
from app.utils.timezone import now_naive

FONT_REG = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"

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

# ── Layout ──
# Narrow portrait canvas: the whole report is one full-width column so it reads
# as a tall strip on a phone and fills an A4 page width when printed.
IMG_W = 800
PAGE_PAD = 0             # no page margin — the report is full-bleed
CARD_PAD = 10            # inner padding of the report content
INNER = IMG_W - 2 * PAGE_PAD - 2 * CARD_PAD  # content width
GAP = 8                  # minimum gap between sections
HDR_H = 118
SECTION_TITLE_H = 20     # plain section title (no underline rule)
TBL_F_HEAD = 11          # table header font size
TBL_F_CELL = 11          # table body font size

# Minimum canvas height keeps the image portrait (taller than wide) even for a
# house with no employees.
PORTRAIT_MIN_RATIO = 1.0

_FONTS: dict = {}


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    key = (size, bold)
    if key not in _FONTS:
        _FONTS[key] = ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)
    return _FONTS[key]


# ── Native high-resolution rendering ──
# All layout math stays in the IMG_W-wide design space; ScaledDraw renders every
# coordinate and font natively at RENDER_SCALE so text stays crisp when zoomed,
# instead of LANCZOS-upsampling a low-res canvas.
# RENDER_SCALE = 12 produced a very large send image (IMG_W * 12): a ~7s build, a
# 2.5MB PNG and a multi-minute PDF conversion. 4 keeps the canvas comfortably
# above any phone/WhatsApp display while cutting build to ~1.5s and making
# document/PDF sends near-instant. Now that the canvas is portrait-friendly
# (IMG_W = 800) a scale-4 send is 3200px wide.
RENDER_SCALE = 4

# The active render scale. Defaults to RENDER_SCALE; ``_temp_scale`` swaps it
# for lighter (faster) preview renders — e.g. the WhatsApp Report Delivery
# preview renders at a reduced scale since it is only shown on screen.
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
    units (proxy position + font both scale together, keeping the ratio).
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

    def arc(self, xy, start, end, fill=None, width=1, **kw):
        self._draw.arc(self._sc(xy), start, end, fill=fill,
                       width=int(width * self.s), **kw)


PCT_MAX_TEXT = "100.00%"  # widest value _pct() can emit


def _pct(part, whole) -> str:
    """Percentage with a fixed 2-decimal format (e.g. 6.98%, 100.00%).

    Deliberately local to the image builder instead of reusing the shared
    ``ga_live_whatsapp_text._pct``, which renders 1 decimal and feeds the text
    report's fixed-width tables whose ``%`` column is only 6 chars wide - with 2
    decimals ``100.00%`` would be silently truncated to ``100.00`` there.
    """
    try:
        if not whole:
            return "0.00%"
        return f"{float(part) / float(whole) * 100:.2f}%"
    except (TypeError, ValueError, ZeroDivisionError):
        return "0.00%"


def _ellipsize(draw, text, font, max_w: float) -> str:
    s = str(text)
    if draw.textlength(s, font=font) <= max_w:
        return s
    while s and draw.textlength(s + "…", font=font) > max_w:
        s = s[:-1]
    return s + "…" if s else s


# ── Column / table helpers ──
def _fit_widths(weights: list[int], avail: int) -> list[int]:
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


def _table_heights(f_head, f_cell):
    head_h = f_head.size + 10
    row_h = f_cell.size + 7
    return head_h, row_h


def _live_display(ci, text, live_cols):
    """Mirror the '● N' decoration applied to live columns."""
    if ci in live_cols:
        num = str(text).replace("●", "").strip()
        if num in ("0", "", "-", "0%", "None"):
            return num or ""
        return f"● {num}"
    return str(text)


def _content_weights(labels, rows, f_head, f_cell, live_cols, margin=8, max_total=None,
                     total_row=None, total_span=0):
    """Compute integer column weights sized to the widest label/cell text.

    Each column is sized to fit its widest content (plus ``margin``), so every
    value stays fully visible instead of being ellipsized away. ``total_row``
    (when given) is measured too, but only for columns outside ``total_span``:
    when the total row's leading label spans several columns (``total_span > 0``)
    it is measured against the combined width of those columns instead, so a
    label like "Total (9 RSO)" never inflates the serial-number column along
    side it. ``max_total`` caps the combined weight when content cannot
    otherwise fit.
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
    # Percentage columns are floored to the widest value _pct() can ever emit,
    # independently of this render's data. Sizing them purely from the current
    # content meant a render full of small percentages (e.g. "6.98%") narrowed
    # the column, and a later 100.00% was ellipsized to "100.0...". Applied last
    # because the max_total cap above only shrinks the total, which makes every
    # column proportionally wider in pixels - so a weight equal to the required
    # pixels is always enough.
    pct_min = math.ceil(f_cell.getlength(PCT_MAX_TEXT) + margin)
    for ci, lb in enumerate(labels):
        if str(lb).strip() == "%":
            req[ci] = max(req[ci], pct_min)
    return [max(1, r) for r in req]


def _draw_table(
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
) -> int:
    """Draw a bordered table starting at (x, y). Returns the height used.

    When ``total_span > 0`` the total row's value in column 0 is drawn as a
    merged cell spanning columns ``0..total_span-1`` (interior vertical borders
    are omitted inside that span on the total row), so a label like
    "Total (9 RSO)" no longer widens the serial-number column.
    """
    n = len(labels)
    if n == 0:
        return 0
    left_cols = left_cols or []
    live_cols = live_cols or []
    weights = weights or [6 if i in left_cols else 4 for i in range(n)]
    widths = _fit_widths(weights, width)
    head_h, row_h = _table_heights(f_head, f_cell)
    all_rows = rows if total_row is None else rows + [total_row]

    th_bg = th_bg or TH_BG
    th_ink = th_ink or TH_INK
    cell_ink = cell_ink or INK
    live_dot = live_dot or LIVE_INK

    def _live_text(ci, text):
        if ci in live_cols:
            num = str(text).replace("●", "").strip()
            if num in ("0", "", "-", "0%", None):
                return num or ""
            return f"● {num}"
        return str(text)

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
                    disp = _ellipsize(draw, str(row[0] if row else ""), font, merged_w - 10)
                    draw.text((x + 5, yy + row_h / 2), disp, font=font, fill=color, anchor="lm")
                    continue
                if ci < span:
                    continue
            val = row[ci] if ci < len(row) else ""
            txt = _live_text(ci, val)
            cw = widths[ci]
            tx = x + sum(widths[:ci])
            cell_color = live_dot if (ci in live_cols and txt.startswith("●")) else color
            disp = _ellipsize(draw, txt, font, cw - 8)
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


# ── Data prep ──
def _n(v) -> str:
    try:
        return str(int(v))
    except (TypeError, ValueError):
        return "0"


def _today_target(item: dict, days_remaining: int) -> int:
    rem = item.get("remaining", 0) or 0
    if rem > 0 and days_remaining:
        return math.ceil(rem / days_remaining)
    return 0


def _ach(item: dict) -> int:
    """Actual month achievement (unclamped, can exceed target).

    ``remaining`` is stored already clamped (``max(0, target - achievement)``),
    so deriving achievement from it would cap the value at the target and hide
    over-achievement. Use the explicit ``achievement`` field when present and
    only fall back to ``target - remaining`` for other callers.
    """
    v = item.get("achievement")
    if v is not None:
        return int(v)
    return max(0, (item.get("target", 0) or 0) - (item.get("remaining", 0) or 0))


def _sup_metrics(sup: dict, team_rso: list, team_bp: list, days_remaining: int,
                 target_override: int = None) -> tuple[int, int, float, int, int]:
    # Target comes from the authoritative supervisor_targets.total_ga when
    # available; otherwise fall back to the sum of individual member targets.
    if target_override is not None:
        target = target_override
    else:
        target = sum(r.get("target", 0) or 0 for r in team_rso) + sum(
            b.get("target", 0) or 0 for b in team_bp
        )
    ach = sum(_ach(r) for r in team_rso) + sum(_ach(b) for b in team_bp)
    pct = round(ach / target * 100, 1) if target else 0
    remain = max(0, target - ach)
    drr = math.ceil(remain / max(days_remaining, 1)) if remain > 0 else 0
    return target, ach, pct, remain, drr


def _team_by_supervisor(sup: dict, data: dict) -> tuple[list, list]:
    rso_ids = set(sup.get("team_rso_ids") or [])
    bp_ids = set(sup.get("team_bp_ids") or [])
    team_rso = [r for r in data.get("rsos", []) if r.get("employee_id") in rso_ids]
    team_bp = [b for b in data.get("bps", []) if b.get("employee_id") in bp_ids]
    team_rso.sort(key=lambda r: r.get("total_activation", 0), reverse=True)
    team_bp.sort(key=lambda b: b.get("own_activation", 0), reverse=True)
    return team_rso, team_bp


# ── Sections ──
SUPERVISOR_LABELS = ["#", "Name", "Pool", "RSO", "BP", "Target", "Ach", "%", "Remain", "DRR", "Live GA"]
RSO_LABELS = ["#", "RSO Name", "ITop No", "Assisted", "TGT", "Ach", "%", "Remain", "DRR", "Live GA", "Own", "Market"]
BP_LABELS = ["#", "BP Name", "Pool No", "Assisted", "TGT", "Ach", "%", "Remain", "DRR", "Live GA"]


def _render_header(draw, x, y, house, data, today: date) -> int:
    x1 = x + INNER
    pad_x = 16
    date_str = today.strftime("%d %B %Y")
    time_str = now_naive().strftime("%I:%M %p").lstrip("0").replace(" 0", " ")
    total_activations = data.get("summary", {}).get("total_activations", 0)

    # total box (right) — measured first so the brand text can be kept clear of it
    lbl = "Total Activations"
    val = _fmt(total_activations)
    fl = _font(15, True)
    fv = _font(40, True)
    box_w = max(draw.textlength(lbl, font=fl), draw.textlength(val, font=fv)) + 40
    box_w = max(box_w, 200)
    box_h = 80
    bx = x1 - pad_x - box_w
    by = y + (HDR_H - box_h) // 2

    # brand (left) — text column, vertically centred (mirrors HTML .brand)
    tx = x + pad_x
    brand_max = bx - tx - 10  # keep clear of the total box

    f_title = _font(28, True)
    f_meta = _font(14, True)
    title = "GA Live Report"
    base = y + 50  # baseline of the report title (h1 in HTML)
    draw.text((tx, base), title, font=f_title, fill=INK, anchor="ls")
    draw.text((tx, y + 74), _ellipsize(
        draw, f"House: {house.name or ''} ({house.code or ''})", f_meta, brand_max),
        font=f_meta, fill=INK, anchor="lm")
    draw.text((tx, y + 94), f"Generated: {date_str}, {time_str}",
              font=f_meta, fill=INK, anchor="lm")

    draw.rounded_rectangle([bx, by, bx + box_w, by + box_h], radius=9,
                           fill=TOTAL_BG, outline=TOTAL_INK, width=2)
    draw.text((bx + box_w / 2, by + 17), lbl, font=fl, fill=TOTAL_INK, anchor="mm")
    draw.text((bx + box_w / 2, by + 52), val, font=fv, fill=TOTAL_INK, anchor="mm")
    return y + HDR_H


def _table_h(rows: int) -> int:
    """Height of a table with ``rows`` body rows, including its header."""
    hh, rh = _table_heights(_font(TBL_F_HEAD, True), _font(TBL_F_CELL, True))
    return hh + rh * rows


def _draw_section_title(draw, x, y, text) -> int:
    """Draw a plain section title, returning the y of the table below it."""
    draw.text((x, y + 10), text, font=_font(13, True), fill=INK, anchor="lm")
    return y + SECTION_TITLE_H


def _render_section(draw, x, y, w, title, labels, rows, live_cols, total_row,
                    total_span=0) -> int:
    """Basic section: a plain title above a full-width bordered table."""
    y = _draw_section_title(draw, x, y, title)
    f_head = _font(TBL_F_HEAD, True)
    f_cell = _font(TBL_F_CELL, True)
    weights = _content_weights(labels, rows, f_head, f_cell, live_cols,
                               max_total=w, total_row=total_row, total_span=total_span)
    _draw_table(draw, x, y, w, labels, rows, weights=weights, left_cols=[1],
                live_cols=live_cols, total_row=total_row, total_span=total_span,
                f_head=f_head, f_cell=f_cell)
    return y + _table_h(len(rows) + (1 if total_row is not None else 0))


def _render_dd_summary(draw, x, y, w, summary) -> int:
    """Very basic DD summary: plain title + a single-row metric table."""
    labels = ["Target", "Ach", "Remain", "%", "DRR (w/ Fri)"]
    target = summary.get("monthly_target", 0)
    achievement = summary.get("achievement", 0)
    values = [
        _fmt(target),
        _fmt(achievement),
        _fmt(summary.get("remaining", 0)),
        _pct(achievement, target),
        _fmt(summary.get("daily_required_with_friday", 0)),
    ]
    y = _draw_section_title(draw, x, y, "DD SUMMARY")
    _draw_table(draw, x, y, w, labels, [values], weights=[1] * len(labels),
                f_head=_font(TBL_F_HEAD, True), f_cell=_font(TBL_F_CELL, True))
    return y + _table_h(1)


def _supervisor_rows(data, summary):
    """Rows + total for the SUPERVISOR PERFORMANCE table (all supervisors)."""
    days_remaining = summary.get("days_remaining", 0)
    sup_target_map = summary.get("supervisor_target_map", {}) or {}
    rows = []
    sums = {"rso": 0, "bp": 0, "target": 0, "ach": 0, "remain": 0, "drr": 0, "live": 0}
    for idx, sup in enumerate(data.get("supervisors", [])):
        team_rso, team_bp = _team_by_supervisor(sup, data)
        target, ach, _p, remain, drr = _sup_metrics(
            sup, team_rso, team_bp, days_remaining,
            target_override=sup_target_map.get(sup.get("employee_id")),
        )
        live = sup.get("total_activation", 0) or 0
        rows.append([
            _n(idx + 1), sup.get("name", ""), sup.get("pool_number", "") or "-",
            _n(len(team_rso)), _n(len(team_bp)),
            _fmt(target), _fmt(ach), _pct(ach, target), _fmt(remain), _fmt(drr),
            _n(live),
        ])
        sums["rso"] += len(team_rso)
        sums["bp"] += len(team_bp)
        sums["target"] += target
        sums["ach"] += ach
        sums["remain"] += remain
        sums["drr"] += drr
        sums["live"] += live
    total_row = [
        "", "Total", "-", _n(sums["rso"]), _n(sums["bp"]),
        _fmt(sums["target"]), _fmt(sums["ach"]),
        _pct(sums["ach"], sums["target"]) if sums["target"] else "0.00%",
        _fmt(sums["remain"]), _fmt(sums["drr"]), _n(sums["live"]),
    ]
    return rows, total_row


def _rso_rows(rsos, days_remaining):
    """Rows + total for the RSO table (every RSO in a single table)."""
    rows = []
    tot = {"trg": 0, "ach": 0, "rem": 0, "own": 0, "mkt": 0}
    ordered = sorted(rsos, key=lambda r: r.get("total_activation", 0) or 0, reverse=True)
    for i, r in enumerate(ordered):
        target = r.get("target", 0) or 0
        ach = _ach(r)
        remain = r.get("remaining", 0) or 0
        drr = math.ceil(remain / max(days_remaining, 1)) if remain > 0 else 0
        own = r.get("own_activation", 0) or 0
        mkt = r.get("market_activation", 0) or 0
        rows.append([
            _n(i + 1), r.get("name", ""), r.get("itop_number", "") or "-",
            r.get("assisted_code", "") or "-",
            _fmt(target), _fmt(ach), _pct(ach, target), _fmt(remain), _fmt(drr),
            _n(own + mkt), _n(own), _n(mkt),
        ])
        tot["trg"] += target
        tot["ach"] += ach
        tot["rem"] += remain
        tot["own"] += own
        tot["mkt"] += mkt
    total_row = [
        f"Total ({len(rows)} RSO)", "", "", "",
        _fmt(tot["trg"]), _fmt(tot["ach"]), _pct(tot["ach"], tot["trg"]),
        _fmt(tot["rem"]),
        _fmt(math.ceil(tot["rem"] / max(days_remaining, 1)) if tot["rem"] > 0 else 0),
        _n(tot["own"] + tot["mkt"]), _n(tot["own"]), _n(tot["mkt"]),
    ]
    return rows, total_row


def _bp_rows(bps, days_remaining):
    """Rows + total for the BP table (every BP in a single table)."""
    rows = []
    tot = {"trg": 0, "ach": 0, "rem": 0, "live": 0}
    ordered = sorted(bps, key=lambda b: b.get("own_activation", 0) or 0, reverse=True)
    for i, b in enumerate(ordered):
        target = b.get("target", 0) or 0
        ach = _ach(b)
        remain = max(0, b.get("remaining", 0) or 0)
        drr = math.ceil(remain / max(days_remaining, 1)) if remain > 0 else 0
        live = b.get("own_activation", 0) or 0
        rows.append([
            _n(i + 1), b.get("name", ""), b.get("pool_number", "") or "-",
            b.get("assisted_code", "") or "-",
            _fmt(target), _fmt(ach), _pct(ach, target), _fmt(remain), _fmt(drr),
            _n(live),
        ])
        tot["trg"] += target
        tot["ach"] += ach
        tot["rem"] += remain
        tot["live"] += live
    total_row = [
        f"Total ({len(rows)} BP)", "", "", "",
        _fmt(tot["trg"]), _fmt(tot["ach"]), _pct(tot["ach"], tot["trg"]),
        _fmt(tot["rem"]),
        _fmt(math.ceil(tot["rem"] / max(days_remaining, 1)) if tot["rem"] > 0 else 0),
        _n(tot["live"]),
    ]
    return rows, total_row


def _render_image(house, data: dict, summary: dict, today: date) -> bytes:
    days_remaining = summary.get("days_remaining", 0)
    sup_rows, sup_total = _supervisor_rows(data, summary)
    rso_rows, rso_total = _rso_rows(data.get("rsos", []), days_remaining)
    bp_rows, bp_total = _bp_rows(data.get("bps", []), days_remaining)

    # Height accounting mirrors the render pass below exactly.
    body_h = SECTION_TITLE_H + _table_h(1)                       # DD SUMMARY
    if sup_rows:
        body_h += GAP + SECTION_TITLE_H + _table_h(len(sup_rows) + 1)
    if rso_rows:
        body_h += GAP + SECTION_TITLE_H + _table_h(len(rso_rows) + 1)
    if bp_rows:
        body_h += GAP + SECTION_TITLE_H + _table_h(len(bp_rows) + 1)

    cx = PAGE_PAD + CARD_PAD
    total_h = PAGE_PAD + CARD_PAD + HDR_H + GAP + body_h + PAGE_PAD + CARD_PAD
    # Guard against a wide strip for tiny datasets — the report must stay portrait.
    canvas_h = max(total_h, int(IMG_W * PORTRAIT_MIN_RATIO))
    s = _active_scale()
    img = Image.new("RGB", (IMG_W * s, max(canvas_h, 60) * s), REPORT_BG)
    draw = ScaledDraw(ImageDraw.Draw(img))

    y = PAGE_PAD + CARD_PAD
    y = _render_header(draw, cx, y, house, data, today)
    y += GAP
    y = _render_dd_summary(draw, cx, y, INNER, summary)
    if sup_rows:
        y += GAP
        y = _render_section(draw, cx, y, INNER, "SUPERVISOR PERFORMANCE",
                            SUPERVISOR_LABELS, sup_rows, [10], sup_total)
    if rso_rows:
        y += GAP
        y = _render_section(draw, cx, y, INNER, "RSO PERFORMANCE",
                            RSO_LABELS, rso_rows, [9, 10, 11], rso_total, total_span=4)
    if bp_rows:
        y += GAP
        y = _render_section(draw, cx, y, INNER, "BP PERFORMANCE",
                            BP_LABELS, bp_rows, [9], bp_total, total_span=4)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


PREVIEW_SCALE = 4


def _render_preview_image(house, data, summary, today: date) -> bytes:
    """Full GA Live report rendered at a reduced (fast) scale for on-screen
    preview only — proportions/layout are identical to the full-res render."""
    with _temp_scale(PREVIEW_SCALE):
        return _render_image(house, data, summary, today)


async def build_ga_live_report_image(
    db: AsyncSession, house_id: int, scale: int | None = None
) -> bytes:
    """Build the GA live report as a PNG image.

    ``scale`` overrides the default RENDER_SCALE — used for fast, reduced-size
    preview renders. ``None`` produces the full-resolution send-quality image.
    """
    today = now_naive().date()
    house, data, summary = await _load_report_data(db, house_id, today)
    if scale is None:
        return _render_image(house, data, summary, today)
    with _temp_scale(scale):
        return _render_image(house, data, summary, today)


async def build_ga_live_report_image_preview(db: AsyncSession, house_id: int) -> bytes:
    """Build the GA live report at a reduced scale for the WhatsApp preview modal.

    Runs significantly faster than the full-res build (~1s vs ~10s) and
    produces a much smaller PNG — the preview only needs to be viewable on
    screen, while scheduled/directed sends keep the full-resolution render.
    """
    today = now_naive().date()
    house, data, summary = await _load_report_data(db, house_id, today)
    return _render_preview_image(house, data, summary, today)
