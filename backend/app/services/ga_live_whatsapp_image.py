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

from PIL import Image, ImageDraw
from sqlalchemy.ext.asyncio import AsyncSession

# We deliberately generate very large (multi-thousand pixel) report images at
# RENDER_SCALE below — the size is intended, not a decompression bomb.
Image.MAX_IMAGE_PIXELS = None

from app.services.ga_live_whatsapp_text import _load_report_data, _fmt
from app.services.report_image_kit import (
    INK,
    REPORT_BG,
    SECTION_TITLE_H,
    TOTAL_BG,
    TOTAL_INK,
    RenderScale,
    ScaledDraw,
    ellipsize,
    load_font,
    pct_2dp,
    render_section,
    table_height,
)
from app.utils.timezone import now_naive

# ── Layout ──
# Narrow portrait canvas: the whole report is one full-width column so it reads
# as a tall strip on a phone and fills an A4 page width when printed.
IMG_W = 800
PAGE_PAD = 0             # no page margin — the report is full-bleed
CARD_PAD = 10            # inner padding of the report content
INNER = IMG_W - 2 * PAGE_PAD - 2 * CARD_PAD  # content width
GAP = 8                  # minimum gap between sections
HDR_H = 118

# Minimum canvas height keeps the image portrait (taller than wide) even for a
# house with no employees.
PORTRAIT_MIN_RATIO = 1.0

# ── Native high-resolution rendering ──
# The active render scale. Defaults to RENDER_SCALE; ``_temp_scale`` swaps it
# for lighter (faster) preview renders — e.g. the WhatsApp Report Delivery
# preview renders at a reduced scale since it is only shown on screen.
#
# RENDER_SCALE = 12 produced a very large send image (IMG_W * 12): a ~7s build, a
# 2.5MB PNG and a multi-minute PDF conversion. 4 keeps the canvas comfortably
# above any phone/WhatsApp display while cutting build to ~1.5s and making
# document/PDF sends near-instant. Now that the canvas is portrait-friendly
# (IMG_W = 800) a scale-4 send is 3200px wide.
RENDER_SCALE = 4

_scale = RenderScale(RENDER_SCALE)


def _active_scale() -> int:
    return _scale.active()


@contextmanager
def _temp_scale(scale: int):
    with _scale.temp(scale):
        yield


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
    fl = load_font(15, True)
    fv = load_font(40, True)
    box_w = max(draw.textlength(lbl, font=fl), draw.textlength(val, font=fv)) + 40
    box_w = max(box_w, 200)
    box_h = 80
    bx = x1 - pad_x - box_w
    by = y + (HDR_H - box_h) // 2

    # brand (left) — text column, vertically centred (mirrors HTML .brand)
    tx = x + pad_x
    brand_max = bx - tx - 10  # keep clear of the total box

    f_title = load_font(28, True)
    f_meta = load_font(14, True)
    title = "GA Live Report"
    base = y + 50  # baseline of the report title (h1 in HTML)
    draw.text((tx, base), title, font=f_title, fill=INK, anchor="ls")
    draw.text((tx, y + 74), ellipsize(
        draw, f"House: {house.name or ''} ({house.code or ''})", f_meta, brand_max),
        font=f_meta, fill=INK, anchor="lm")
    draw.text((tx, y + 94), f"Generated: {date_str}, {time_str}",
              font=f_meta, fill=INK, anchor="lm")

    draw.rounded_rectangle([bx, by, bx + box_w, by + box_h], radius=9,
                           fill=TOTAL_BG, outline=TOTAL_INK, width=2)
    draw.text((bx + box_w / 2, by + 17), lbl, font=fl, fill=TOTAL_INK, anchor="mm")
    draw.text((bx + box_w / 2, by + 52), val, font=fv, fill=TOTAL_INK, anchor="mm")
    return y + HDR_H


def _render_dd_summary(draw, x, y, w, summary) -> int:
    """Very basic DD summary: plain title + a single-row metric table."""
    labels = ["Target", "Ach", "Remain", "%", "DRR (w/ Fri)"]
    target = summary.get("monthly_target", 0)
    achievement = summary.get("achievement", 0)
    values = [
        _fmt(target),
        _fmt(achievement),
        _fmt(summary.get("remaining", 0)),
        pct_2dp(achievement, target),
        _fmt(summary.get("daily_required_with_friday", 0)),
    ]
    # Evenly split metric cells (no left-aligned name column), mirroring the
    # summary grid in the HTML dashboard.
    return render_section(draw, x, y, w, "DD SUMMARY", labels, [values],
                          weights=[1] * len(labels), left_cols=())


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
            _fmt(target), _fmt(ach), pct_2dp(ach, target), _fmt(remain), _fmt(drr),
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
        pct_2dp(sums["ach"], sums["target"]) if sums["target"] else "0.00%",
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
            _fmt(target), _fmt(ach), pct_2dp(ach, target), _fmt(remain), _fmt(drr),
            _n(own + mkt), _n(own), _n(mkt),
        ])
        tot["trg"] += target
        tot["ach"] += ach
        tot["rem"] += remain
        tot["own"] += own
        tot["mkt"] += mkt
    total_row = [
        f"Total ({len(rows)} RSO)", "", "", "",
        _fmt(tot["trg"]), _fmt(tot["ach"]), pct_2dp(tot["ach"], tot["trg"]),
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
            _fmt(target), _fmt(ach), pct_2dp(ach, target), _fmt(remain), _fmt(drr),
            _n(live),
        ])
        tot["trg"] += target
        tot["ach"] += ach
        tot["rem"] += remain
        tot["live"] += live
    total_row = [
        f"Total ({len(rows)} BP)", "", "", "",
        _fmt(tot["trg"]), _fmt(tot["ach"]), pct_2dp(tot["ach"], tot["trg"]),
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
    body_h = SECTION_TITLE_H + table_height(1)                   # DD SUMMARY
    if sup_rows:
        body_h += GAP + SECTION_TITLE_H + table_height(len(sup_rows) + 1)
    if rso_rows:
        body_h += GAP + SECTION_TITLE_H + table_height(len(rso_rows) + 1)
    if bp_rows:
        body_h += GAP + SECTION_TITLE_H + table_height(len(bp_rows) + 1)

    cx = PAGE_PAD + CARD_PAD
    total_h = PAGE_PAD + CARD_PAD + HDR_H + GAP + body_h + PAGE_PAD + CARD_PAD
    # Guard against a wide strip for tiny datasets — the report must stay portrait.
    canvas_h = max(total_h, int(IMG_W * PORTRAIT_MIN_RATIO))
    s = _active_scale()
    img = Image.new("RGB", (IMG_W * s, max(canvas_h, 60) * s), REPORT_BG)
    draw = ScaledDraw(ImageDraw.Draw(img), _scale)

    y = PAGE_PAD + CARD_PAD
    y = _render_header(draw, cx, y, house, data, today)
    y += GAP
    y = _render_dd_summary(draw, cx, y, INNER, summary)
    if sup_rows:
        y += GAP
        y = render_section(draw, cx, y, INNER, "SUPERVISOR PERFORMANCE",
                           SUPERVISOR_LABELS, sup_rows, live_cols=[10], total_row=sup_total)
    if rso_rows:
        y += GAP
        y = render_section(draw, cx, y, INNER, "RSO PERFORMANCE",
                           RSO_LABELS, rso_rows, live_cols=[9, 10, 11],
                           total_row=rso_total, total_span=4)
    if bp_rows:
        y += GAP
        y = render_section(draw, cx, y, INNER, "BP PERFORMANCE",
                           BP_LABELS, bp_rows, live_cols=[9],
                           total_row=bp_total, total_span=4)

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
