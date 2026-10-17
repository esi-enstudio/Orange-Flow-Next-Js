"""Activation Report image builder for WhatsApp/Telegram delivery.

Renders the current month's Activation Dashboard (/reports/activations) as a PNG
image in the same simple, print-friendly style as the GA Live report image: a
plain header with one highlighted metric box, a single-row house summary table,
and one plain bordered table each for supervisors, RSOs and BPs.

The layout is a single full-width column with small margins, rendered in the
requested orientation: ``portrait`` reads as one tall page on a phone, while
``landscape`` uses the width of an A4 landscape sheet and therefore fits a
larger table font. Every section renders at one shared font size — the largest
that fits the chosen canvas — so no table looks bigger or smaller than the
others in the same image.

Business rules mirror the dashboard page:
    * Status    -> projectionStatus(achievement %, projection %) identity with
                   the page (achieved / on track / needs attention / behind)
    * DRR       -> ceil(remaining / days_remaining), like the page table
    * Proj %    -> projection / target, the value the page status is based on
    * RSO       -> Yest Own / Tot come from the RSO's assisted retailer code
                   (yesterday and month-to-date); Yest Mkt / Tot are the market
                   activation counts for the same two periods
    * BP        -> Yesterday GA and Day Count come from the assisted code
    * Others    -> members owned by no supervisor get their own row, so the
                   supervisor table always reconciles with the RSO/BP tables
"""
import io
import math
from datetime import date

from PIL import Image, ImageDraw
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# We deliberately generate large (multi-thousand pixel) report images at
# RENDER_SCALE below - the size is intended, not a decompression bomb.
Image.MAX_IMAGE_PIXELS = None

from app.models.house import House
from app.services.activation_report_service import ActivationReportService
from app.services.report_image_kit import (
    INK,
    REPORT_BG,
    SECTION_TITLE_FONT,
    SECTION_TITLE_H,
    TOTAL_BG,
    TOTAL_INK,
    RenderScale,
    ScaledDraw,
    content_weights,
    ellipsize,
    fit_widths,
    fmt_num,
    load_font,
    pct_2dp,
    render_section,
    table_height,
)
from app.utils.timezone import now_naive

# ── Layout ──
# The whole report is one full-width column so it reads as one page on a phone
# and fills an A4 page width when printed. Same geometry as the GA Live report
# image, so both reports look like siblings. Landscape uses the width of an A4
# landscape sheet (800 * 297/210), so either orientation fills its matching A4
# paper without margins.
PORTRAIT_W = 800
LANDSCAPE_W = 1131
ORIENTATIONS = {"portrait": PORTRAIT_W, "landscape": LANDSCAPE_W}
DEFAULT_ORIENTATION = "portrait"
PAGE_PAD = 0             # no page margin — the report is full-bleed
CARD_PAD = 10            # inner padding of the report content
GAP = 8                  # minimum gap between sections
HDR_H = 118

# Minimum canvas height keeps the sheet in its orientation's shape even for a
# house with no employees: portrait stays taller than wide, landscape keeps an
# A4-landscape ratio (height = width * 210/297).
MIN_HEIGHT_RATIO = {"portrait": 1.0, "landscape": 210 / 297}

# ── Native high-resolution rendering ──
# All layout math stays in the design-space width; ScaledDraw renders every
# coordinate and font natively at RENDER_SCALE so text stays crisp when zoomed.
# A scale-4 send is 3200px (4524px in landscape) wide, comfortably above any
# phone display while keeping the build fast and the PNG small enough for
# WhatsApp.
RENDER_SCALE = 4

_scale = RenderScale(RENDER_SCALE)


def _active_scale() -> int:
    return _scale.active()


# ── Section column sets ──
HOUSE_LABELS = ["Target", "Ach", "%", "Remain", "Daily Req", "Daily Avg",
                "Projection", "Proj %"]
SUPERVISOR_LABELS = ["#", "Supervisor Name", "Pool", "RSO", "BP", "Target", "Ach",
                     "%", "Remain", "DRR", "Proj %", "Status"]
RSO_LABELS = ["#", "RSO Name", "ITop No", "Target", "Ach", "%", "Remain", "DRR",
              "Proj %", "Yest Own", "Tot", "Yest Mkt", "Tot", "Status"]
BP_LABELS = ["#", "BP Name", "Pool No", "Target", "Ach", "%", "Remain", "DRR",
             "Proj %", "Yest GA", "Day Count", "Status"]


# ── Status rules (mirror projectionStatus in page.tsx) ──
STATUS_LABELS = {
    "achieved": "Achieved",
    "on_track": "On Track",
    "needs_attention": "Needs Attention",
    "behind": "Behind",
}


def _projection_status(ach_pct: float, proj_pct: float) -> str:
    if ach_pct >= 100:
        return "achieved"
    if proj_pct >= 100:
        return "on_track"
    if proj_pct >= 95:
        return "needs_attention"
    return "behind"


def _status_label(ach_pct: float, proj_pct: float) -> str:
    return STATUS_LABELS[_projection_status(ach_pct, proj_pct)]


# ── Data prep ──
def _drr(remaining: float, days_remaining: int) -> str:
    """Daily required run rate: what each remaining day must deliver."""
    if remaining <= 0:
        return "0"
    return fmt_num(math.ceil(remaining / max(days_remaining, 1)))


def _metrics(item: dict) -> tuple[float, float, float, float, float]:
    """(target, achievement, achievement %, projection, projection %)."""
    target = float(item.get("target") or 0)
    ach = float(item.get("achievement") or 0)
    proj = float(item.get("projection") or 0)
    ach_pct = round(ach / target * 100, 1) if target else 0
    proj_pct = round(proj / target * 100) if target else 0
    return target, ach, ach_pct, proj, proj_pct


def _remaining(item: dict) -> float:
    return max(0.0, float(item.get("remaining") or 0))


# ── Header ──
def _render_header(draw, x, y, inner, house_name, house_code, summary, today: date) -> int:
    x1 = x + inner
    pad_x = 16
    date_str = today.strftime("%d %B %Y")
    time_str = now_naive().strftime("%I:%M %p").lstrip("0").replace(" 0", " ")

    # metric box (right) — measured first so the brand text can be kept clear of it
    lbl = "Yesterday Activation"
    val = fmt_num(summary.get("yesterday_activation") or 0)
    fl = load_font(15, True)
    fv = load_font(40, True)
    box_w = max(draw.textlength(lbl, font=fl), draw.textlength(val, font=fv)) + 40
    box_w = max(box_w, 200)
    box_h = 80
    bx = x1 - pad_x - box_w
    by = y + (HDR_H - box_h) // 2

    # brand (left) — text column, vertically centred
    tx = x + pad_x
    brand_max = bx - tx - 10  # keep clear of the metric box

    draw.text((tx, y + 50), "Activation Report", font=load_font(28, True),
              fill=INK, anchor="ls")
    f_meta = load_font(14, True)
    draw.text((tx, y + 74), ellipsize(
        draw, f"House: {house_name or ''} ({house_code or ''})", f_meta, brand_max),
        font=f_meta, fill=INK, anchor="lm")
    draw.text((tx, y + 94), f"Generated: {date_str}, {time_str}",
              font=f_meta, fill=INK, anchor="lm")

    draw.rounded_rectangle([bx, by, bx + box_w, by + box_h], radius=9,
                           fill=TOTAL_BG, outline=TOTAL_INK, width=2)
    draw.text((bx + box_w / 2, by + 17), lbl, font=fl, fill=TOTAL_INK, anchor="mm")
    draw.text((bx + box_w / 2, by + 52), val, font=fv, fill=TOTAL_INK, anchor="mm")
    return y + HDR_H


# ── Sections ──
def _house_values(summary: dict) -> list[str]:
    target = float(summary.get("monthly_target") or 0)
    achievement = float(summary.get("achievement") or 0)
    projection = float(summary.get("projection") or 0)
    return [
        fmt_num(target),
        fmt_num(achievement),
        pct_2dp(achievement, target),
        fmt_num(summary.get("remaining") or 0),
        fmt_num(summary.get("daily_required") or 0),
        fmt_num(summary.get("daily_average") or 0),
        fmt_num(projection),
        pct_2dp(projection, target),
    ]


def _render_house_summary(draw, x, y, w, summary, f_head, f_cell, title_font_size) -> int:
    """House summary: plain title + a single-row metric table."""
    # Evenly split metric cells (no left-aligned name column), mirroring the
    # summary grid in the HTML dashboard.
    return render_section(draw, x, y, w, "HOUSE SUMMARY", HOUSE_LABELS,
                          [_house_values(summary)],
                          weights=[1] * len(HOUSE_LABELS), left_cols=(),
                          f_head=f_head, f_cell=f_cell, title_font_size=title_font_size)


def _team_counts(sup: dict) -> tuple[int, int]:
    team = sup.get("team") or []
    rso = sum(1 for m in team if (m.get("employee_type") or "").lower() == "rso")
    bp = sum(1 for m in team if (m.get("employee_type") or "").lower() == "bp")
    return rso, bp


def _supervisor_rows(dashboard: dict, days_remaining: int):
    """Rows + total for the SUPERVISOR PERFORMANCE table (all supervisors)."""
    supervisors = dashboard.get("supervisor_performance") or []
    rows = []
    assigned_ids: set[int] = set()
    sums = {"rso": 0, "bp": 0, "target": 0.0, "ach": 0.0, "remain": 0.0, "proj": 0.0}

    for idx, sup in enumerate(supervisors):
        assigned_ids.update(m["employee_id"] for m in (sup.get("team") or [])
                            if m.get("employee_id"))
        rso_count, bp_count = _team_counts(sup)
        target, ach, ach_pct, proj, proj_pct = _metrics(sup)
        remain = _remaining(sup)
        rows.append([
            str(idx + 1), str(sup.get("name") or ""), str(sup.get("pool_number") or "-"),
            str(rso_count), str(bp_count),
            fmt_num(target), fmt_num(ach), pct_2dp(ach, target),
            fmt_num(remain), _drr(remain, days_remaining), pct_2dp(proj, target),
            _status_label(ach_pct, proj_pct),
        ])
        sums["rso"] += rso_count
        sums["bp"] += bp_count
        sums["target"] += target
        sums["ach"] += ach
        sums["remain"] += remain
        sums["proj"] += proj

    # Members owned by no supervisor get their own row, so the RSO and BP tables
    # still reconcile with this one.
    unassigned_rso = [r for r in (dashboard.get("rso_performance") or [])
                      if r.get("id") not in assigned_ids]
    unassigned_bp = [b for b in (dashboard.get("bp_performance") or [])
                     if b.get("id") not in assigned_ids]
    if unassigned_rso or unassigned_bp:
        members = unassigned_rso + unassigned_bp
        target = sum(float(m.get("target") or 0) for m in members)
        ach = sum(float(m.get("achievement") or 0) for m in members)
        proj = sum(float(m.get("projection") or 0) for m in members)
        remain = sum(_remaining(m) for m in members)
        ach_pct = round(ach / target * 100, 1) if target else 0
        proj_pct = round(proj / target * 100) if target else 0
        rows.append([
            str(len(rows) + 1), "Others (Unassigned)", "-",
            str(len(unassigned_rso)), str(len(unassigned_bp)),
            fmt_num(target), fmt_num(ach), pct_2dp(ach, target),
            fmt_num(remain), _drr(remain, days_remaining), pct_2dp(proj, target),
            _status_label(ach_pct, proj_pct),
        ])
        sums["rso"] += len(unassigned_rso)
        sums["bp"] += len(unassigned_bp)
        sums["target"] += target
        sums["ach"] += ach
        sums["remain"] += remain
        sums["proj"] += proj

    if not rows:
        return [], None

    total_row = [
        f"Total ({len(rows)} Supervisor)", "", "-",
        str(sums["rso"]), str(sums["bp"]),
        fmt_num(sums["target"]), fmt_num(sums["ach"]),
        pct_2dp(sums["ach"], sums["target"]),
        fmt_num(sums["remain"]),
        _drr(sums["remain"], days_remaining),
        pct_2dp(sums["proj"], sums["target"]),
        "",
    ]
    return rows, total_row


def _rso_rows(rsos: list[dict], days_remaining: int):
    """Rows + total for the RSO PERFORMANCE table (every RSO)."""
    rows = []
    tot = {"target": 0.0, "ach": 0.0, "remain": 0.0, "proj": 0.0,
           "yest_own": 0.0, "own": 0.0, "yest_market": 0.0, "market": 0.0}
    ordered = sorted(rsos, key=lambda r: float(r.get("percentage") or 0), reverse=True)
    for i, r in enumerate(ordered):
        target, ach, ach_pct, proj, proj_pct = _metrics(r)
        remain = _remaining(r)
        yest_own = float(r.get("yesterday_activation") or 0)
        own = float(r.get("month_total_activation") or 0)
        yest_market = float(r.get("market_yesterday") or 0)
        market = float(r.get("market_activation") or 0)
        rows.append([
            str(i + 1), str(r.get("name") or ""),
            str(r.get("itop_number") or r.get("dms_code") or "-"),
            fmt_num(target), fmt_num(ach), pct_2dp(ach, target),
            fmt_num(remain), _drr(remain, days_remaining), pct_2dp(proj, target),
            fmt_num(yest_own), fmt_num(own),
            fmt_num(yest_market), fmt_num(market),
            _status_label(ach_pct, proj_pct),
        ])
        tot["target"] += target
        tot["ach"] += ach
        tot["remain"] += remain
        tot["proj"] += proj
        tot["yest_own"] += yest_own
        tot["own"] += own
        tot["yest_market"] += yest_market
        tot["market"] += market

    if not rows:
        return [], None

    total_row = [
        f"Total ({len(rows)} RSO)", "", "",
        fmt_num(tot["target"]), fmt_num(tot["ach"]), pct_2dp(tot["ach"], tot["target"]),
        fmt_num(tot["remain"]), _drr(tot["remain"], days_remaining),
        pct_2dp(tot["proj"], tot["target"]),
        fmt_num(tot["yest_own"]), fmt_num(tot["own"]),
        fmt_num(tot["yest_market"]), fmt_num(tot["market"]), "",
    ]
    return rows, total_row


def _bp_rows(bps: list[dict], days_remaining: int):
    """Rows + total for the BP PERFORMANCE table (every BP)."""
    rows = []
    tot = {"target": 0.0, "ach": 0.0, "remain": 0.0, "proj": 0.0,
           "yest": 0.0, "days": 0.0}
    ordered = sorted(bps, key=lambda b: float(b.get("percentage") or 0), reverse=True)
    for i, b in enumerate(ordered):
        target, ach, ach_pct, proj, proj_pct = _metrics(b)
        remain = _remaining(b)
        yest = float(b.get("yesterday_activation") or 0)
        days = float(b.get("active_days") or 0)
        rows.append([
            str(i + 1), str(b.get("name") or ""), str(b.get("pool_number") or "-"),
            fmt_num(target), fmt_num(ach), pct_2dp(ach, target),
            fmt_num(remain), _drr(remain, days_remaining), pct_2dp(proj, target),
            fmt_num(yest), fmt_num(days),
            _status_label(ach_pct, proj_pct),
        ])
        tot["target"] += target
        tot["ach"] += ach
        tot["remain"] += remain
        tot["proj"] += proj
        tot["yest"] += yest
        tot["days"] += days

    if not rows:
        return [], None

    total_row = [
        f"Total ({len(rows)} BP)", "", "",
        fmt_num(tot["target"]), fmt_num(tot["ach"]), pct_2dp(tot["ach"], tot["target"]),
        fmt_num(tot["remain"]), _drr(tot["remain"], days_remaining),
        pct_2dp(tot["proj"], tot["target"]),
        fmt_num(tot["yest"]), fmt_num(tot["days"]), "",
    ]
    return rows, total_row


# ── Font sizing ──
# Every table in one image renders at the same font size — the largest size at
# which every section still fits the canvas for this house's data. Numeric
# columns must never lose a digit, so only the free-text name column of the RSO
# table may give way (down to RSO_NAME_MIN_W, ~14 characters at the largest
# sizes). The house summary cells are evenly split, so its longest label/value
# is the one section that can cap the font (e.g. a wide "Projection" header).
FONT_MIN = 8
FONT_MAX = 22

RSO_NAME_COL = 1
RSO_NAME_MIN_W = 130


def _fits_even(labels, values, inner: int, font) -> bool:
    """True when all labels/values fit their evenly split column of the row."""
    widths = fit_widths([1] * len(labels), inner)
    for ci, label in enumerate(labels):
        worst = font.getlength(str(label))
        if ci < len(values):
            worst = max(worst, font.getlength(str(values[ci])))
        if widths[ci] < worst + 8:
            return False
    return True


def _rso_weights(rows, total_row, font, inner: int) -> list[int]:
    """Column weights for the RSO table with an elastic name column."""
    weights = content_weights(RSO_LABELS, rows, font, font, (),
                              total_row=total_row, total_span=3)
    overflow = sum(weights) - inner
    if overflow > 0:
        weights[RSO_NAME_COL] = max(RSO_NAME_MIN_W, weights[RSO_NAME_COL] - overflow)
    return weights


def _fits_full(labels, rows, total_row, total_span: int, inner: int, font) -> bool:
    """True when every cell of the table fits at its natural width."""
    req = content_weights(labels, rows, font, font, (),
                          total_row=total_row, total_span=total_span)
    return sum(req) <= inner


def _fits_rso(rows, total_row, inner: int, font) -> bool:
    """True when the RSO table fits with only its name column elided."""
    req = content_weights(RSO_LABELS, rows, font, font, (),
                          total_row=total_row, total_span=3)
    overflow = sum(req) - inner
    if overflow > 0:
        req[RSO_NAME_COL] = max(RSO_NAME_MIN_W, req[RSO_NAME_COL] - overflow)
    return sum(req) <= inner


def _uniform_font_size(dashboard, sup_rows, sup_total, rso_rows, rso_total,
                       bp_rows, bp_total, inner: int) -> int:
    """Largest font size at which every rendered section fits the canvas."""
    summary_values = _house_values(dashboard.get("summary") or {})
    for size in range(FONT_MAX, FONT_MIN - 1, -1):
        font = load_font(size, True)
        if not _fits_even(HOUSE_LABELS, summary_values, inner, font):
            continue
        if sup_rows and not _fits_full(SUPERVISOR_LABELS, sup_rows, sup_total, 2, inner, font):
            continue
        if rso_rows and not _fits_rso(rso_rows, rso_total, inner, font):
            continue
        if bp_rows and not _fits_full(BP_LABELS, bp_rows, bp_total, 3, inner, font):
            continue
        return size
    return FONT_MIN


# ── Render ──
def _render_image(house_name: str, house_code: str, dashboard: dict, today: date,
                  orientation: str = DEFAULT_ORIENTATION) -> bytes:
    img_w = ORIENTATIONS.get(orientation) or PORTRAIT_W
    inner = img_w - 2 * PAGE_PAD - 2 * CARD_PAD

    summary = dashboard.get("summary") or {}
    days_remaining = int(summary.get("days_remaining") or 0)

    sup_rows, sup_total = _supervisor_rows(dashboard, days_remaining)
    rso_rows, rso_total = _rso_rows(dashboard.get("rso_performance") or [], days_remaining)
    bp_rows, bp_total = _bp_rows(dashboard.get("bp_performance") or [], days_remaining)

    # One shared font size for every table, as large as the canvas allows. The
    # section titles ride along one notch above the table font (capped so they
    # still fit the title band).
    font_size = _uniform_font_size(dashboard, sup_rows, sup_total, rso_rows, rso_total,
                                   bp_rows, bp_total, inner)
    f_head = load_font(font_size, True)
    f_cell = load_font(font_size, True)
    title_font_size = max(SECTION_TITLE_FONT, min(font_size + 2, 16))

    # Height accounting mirrors the render pass below exactly.
    body_h = SECTION_TITLE_H + table_height(1, f_head, f_cell)   # HOUSE SUMMARY
    if sup_rows:
        body_h += GAP + SECTION_TITLE_H + table_height(len(sup_rows) + 1, f_head, f_cell)
    if rso_rows:
        body_h += GAP + SECTION_TITLE_H + table_height(len(rso_rows) + 1, f_head, f_cell)
    if bp_rows:
        body_h += GAP + SECTION_TITLE_H + table_height(len(bp_rows) + 1, f_head, f_cell)

    cx = PAGE_PAD + CARD_PAD
    total_h = PAGE_PAD + CARD_PAD + HDR_H + GAP + body_h + PAGE_PAD + CARD_PAD
    # Guard against a short strip for tiny datasets — the sheet must keep the
    # chosen orientation's shape.
    canvas_h = max(total_h, int(img_w * MIN_HEIGHT_RATIO.get(orientation, 1.0)))
    s = _active_scale()
    img = Image.new("RGB", (img_w * s, max(canvas_h, 60) * s), REPORT_BG)
    draw = ScaledDraw(ImageDraw.Draw(img), _scale)

    y = PAGE_PAD + CARD_PAD
    y = _render_header(draw, cx, y, inner, house_name, house_code, summary, today)
    y += GAP
    y = _render_house_summary(draw, cx, y, inner, summary, f_head, f_cell, title_font_size)
    if sup_rows:
        y += GAP
        y = render_section(draw, cx, y, inner, "SUPERVISOR PERFORMANCE",
                           SUPERVISOR_LABELS, sup_rows, total_row=sup_total, total_span=2,
                           f_head=f_head, f_cell=f_cell, title_font_size=title_font_size)
    if rso_rows:
        y += GAP
        y = render_section(draw, cx, y, inner, "RSO PERFORMANCE",
                           RSO_LABELS, rso_rows, total_row=rso_total, total_span=3,
                           f_head=f_head, f_cell=f_cell, title_font_size=title_font_size,
                           weights=_rso_weights(rso_rows, rso_total, f_cell, inner))
    if bp_rows:
        y += GAP
        y = render_section(draw, cx, y, inner, "BP PERFORMANCE",
                           BP_LABELS, bp_rows, total_row=bp_total, total_span=3,
                           f_head=f_head, f_cell=f_cell, title_font_size=title_font_size)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


async def build_activation_report_image(
    db: AsyncSession, house_id: int, scale: int | None = None,
    orientation: str = DEFAULT_ORIENTATION,
) -> bytes:
    """Build the current month's Activation Report as a PNG image.

    ``scale`` overrides the default RENDER_SCALE - used for fast, reduced-size
    preview renders. ``None`` produces the full-resolution send-quality image.
    ``orientation`` is ``"portrait"`` (default) or ``"landscape"``; an unknown
    value falls back to portrait.
    """
    orientation = orientation if orientation in ORIENTATIONS else DEFAULT_ORIENTATION

    today = now_naive().date()
    svc = ActivationReportService(db, house_id, today.month, today.year, target_role="HOUSE")
    dashboard = await svc.build_dashboard()

    result = await db.execute(select(House).where(House.id == house_id))
    house = result.scalar_one_or_none()
    house_name = (house.name or "") if house else "Unknown"
    house_code = (house.code or "") if house else ""

    if scale is None:
        return _render_image(house_name, house_code, dashboard, today, orientation)
    with _scale.temp(scale):
        return _render_image(house_name, house_code, dashboard, today, orientation)
