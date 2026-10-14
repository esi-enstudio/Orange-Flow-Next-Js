"""Recharge Report image builder for WhatsApp/Telegram delivery.

Renders the current month's Recharge Dashboard (/reports/recharge) as a PNG image
in the same simple, print-friendly style as the GA Live and Activation report
images: a plain header with one highlighted metric box, a single-row house
summary table, and one plain bordered table each for supervisors and RSOs.

The layout is a single full-width column (portrait strip) with small margins, so
the image reads as one tall page on a phone and fills an A4 page when printed.

Business rules mirror the dashboard page:
    * Status    -> projectionStatus(achievement %, projection %) identity with
                   the page (achieved / on track / needs attention / behind)
    * DRR       -> ceil(remaining / days_remaining), like the page table
    * Proj %    -> projection / target, the value the page status is based on
    * Daily Req -> remaining / remaining working days (Fridays excluded)
    * Rows      -> already ranked by achievement % by RechargeReportService
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
from app.services.recharge_report_service import RechargeReportService
from app.services.report_image_kit import (
    INK,
    REPORT_BG,
    SECTION_TITLE_H,
    TOTAL_BG,
    TOTAL_INK,
    RenderScale,
    ScaledDraw,
    ellipsize,
    fmt_num,
    load_font,
    pct_2dp,
    render_section,
    table_height,
)
from app.utils.timezone import now_naive

# ── Layout ──
# Narrow portrait canvas: the whole report is one full-width column so it reads
# as a tall strip on a phone and fills an A4 page width when printed. Same
# geometry as the GA Live and Activation report images, so all three look like
# siblings.
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
# All layout math stays in the IMG_W-wide design space; ScaledDraw renders every
# coordinate and font natively at RENDER_SCALE so text stays crisp when zoomed.
# A scale-4 send is 3200px wide, comfortably above any phone display while
# keeping the build fast and the PNG small enough for WhatsApp.
RENDER_SCALE = 4

_scale = RenderScale(RENDER_SCALE)


def _active_scale() -> int:
    return _scale.active()


# ── Report variants ──
# The dashboard's report-type toggle switches which target the report measures:
# the plain Recharge report uses the house's total recharge target, while the EV
# Secondary report uses the EV C2C target. RechargeReportService already applies
# that variant to the summary and to every RSO/supervisor row, so the image only
# needs to pass it through and label itself accordingly.
REPORT_TYPES = {
    "recharge": {
        "title": "Recharge Report",
        "service_report_type": "recharge",
    },
    "recharge_ev_secondary": {
        "title": "EV Secondary Report",
        "service_report_type": "ev_secondary",
    },
}

# ── Section column sets ──
HOUSE_LABELS = ["Target", "Ach", "%", "Remain", "Daily Req", "Daily Avg",
                "Projection", "Proj %"]
SUPERVISOR_LABELS = ["#", "Supervisor Name", "Pool No", "Target", "Ach", "%", "Remain",
                     "DRR", "Proj %", "Yest C2C", "Yest C2S", "Status"]
RSO_LABELS = ["#", "RSO Name", "ITop No", "Target", "Ach", "%", "Remain",
              "DRR", "Proj %", "Yest C2C", "Yest C2S", "Status"]


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
    """Daily required run rate: what each remaining working day must deliver."""
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
def _render_header(draw, x, y, house_name, house_code, summary, today: date,
                   report_title: str) -> int:
    x1 = x + INNER
    pad_x = 16
    date_str = today.strftime("%d %B %Y")
    time_str = now_naive().strftime("%I:%M %p").lstrip("0").replace(" 0", " ")

    # metric box (right) — measured first so the brand text can be kept clear of it
    lbl = "Yesterday Recharge"
    val = fmt_num(summary.get("yesterday_achievement") or 0)
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

    draw.text((tx, y + 50), report_title, font=load_font(28, True),
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
def _render_house_summary(draw, x, y, w, summary) -> int:
    """House summary: plain title + a single-row metric table."""
    target = float(summary.get("monthly_target") or 0)
    achievement = float(summary.get("achievement") or 0)
    projection = float(summary.get("projection") or 0)
    values = [
        fmt_num(target),
        fmt_num(achievement),
        pct_2dp(achievement, target),
        fmt_num(summary.get("remaining") or 0),
        fmt_num(summary.get("daily_required") or 0),
        fmt_num(summary.get("daily_average") or 0),
        fmt_num(projection),
        pct_2dp(projection, target),
    ]
    # Evenly split metric cells (no left-aligned name column), mirroring the
    # summary grid in the HTML dashboard.
    return render_section(draw, x, y, w, "HOUSE SUMMARY", HOUSE_LABELS, [values],
                          weights=[1] * len(HOUSE_LABELS), left_cols=())


def _supervisor_rows(supervisors: list[dict], days_remaining: int):
    """Rows + total for the SUPERVISOR PERFORMANCE table."""
    rows = []
    tot = {"target": 0.0, "ach": 0.0, "remain": 0.0, "proj": 0.0,
           "c2c": 0.0, "c2s": 0.0}
    for i, sup in enumerate(supervisors):
        target, ach, ach_pct, proj, proj_pct = _metrics(sup)
        remain = _remaining(sup)
        yest_c2c = float(sup.get("yesterday_c2c") or 0)
        yest_c2s = float(sup.get("yesterday_c2s") or 0)
        rows.append([
            str(i + 1), str(sup.get("name") or ""),
            str(sup.get("pool_number") or sup.get("dms_code") or "-"),
            fmt_num(target), fmt_num(ach), pct_2dp(ach, target),
            fmt_num(remain), _drr(remain, days_remaining), pct_2dp(proj, target),
            fmt_num(yest_c2c), fmt_num(yest_c2s),
            _status_label(ach_pct, proj_pct),
        ])
        tot["target"] += target
        tot["ach"] += ach
        tot["remain"] += remain
        tot["proj"] += proj
        tot["c2c"] += yest_c2c
        tot["c2s"] += yest_c2s

    if not rows:
        return [], None

    total_row = [
        f"Total ({len(rows)} Supervisor)", "", "",
        fmt_num(tot["target"]), fmt_num(tot["ach"]), pct_2dp(tot["ach"], tot["target"]),
        fmt_num(tot["remain"]), _drr(tot["remain"], days_remaining),
        pct_2dp(tot["proj"], tot["target"]),
        fmt_num(tot["c2c"]), fmt_num(tot["c2s"]), "",
    ]
    return rows, total_row


def _rso_rows(rsos: list[dict], days_remaining: int):
    """Rows + total for the RSO PERFORMANCE table."""
    rows = []
    tot = {"target": 0.0, "ach": 0.0, "remain": 0.0, "proj": 0.0,
           "c2c": 0.0, "c2s": 0.0}
    for i, r in enumerate(rsos):
        target, ach, ach_pct, proj, proj_pct = _metrics(r)
        remain = _remaining(r)
        yest_c2c = float(r.get("yesterday_c2c") or 0)
        yest_c2s = float(r.get("yesterday_c2s") or 0)
        rows.append([
            str(i + 1), str(r.get("name") or ""),
            str(r.get("itop_number") or r.get("dms_code") or "-"),
            fmt_num(target), fmt_num(ach), pct_2dp(ach, target),
            fmt_num(remain), _drr(remain, days_remaining), pct_2dp(proj, target),
            fmt_num(yest_c2c), fmt_num(yest_c2s),
            _status_label(ach_pct, proj_pct),
        ])
        tot["target"] += target
        tot["ach"] += ach
        tot["remain"] += remain
        tot["proj"] += proj
        tot["c2c"] += yest_c2c
        tot["c2s"] += yest_c2s

    if not rows:
        return [], None

    total_row = [
        f"Total ({len(rows)} RSO)", "", "",
        fmt_num(tot["target"]), fmt_num(tot["ach"]), pct_2dp(tot["ach"], tot["target"]),
        fmt_num(tot["remain"]), _drr(tot["remain"], days_remaining),
        pct_2dp(tot["proj"], tot["target"]),
        fmt_num(tot["c2c"]), fmt_num(tot["c2s"]), "",
    ]
    return rows, total_row


# ── Render ──
def _render_image(house_name: str, house_code: str, dashboard: dict, today: date,
                  report_title: str) -> bytes:
    summary = dashboard.get("summary") or {}
    days_remaining = int(summary.get("days_remaining") or 0)

    sup_rows, sup_total = _supervisor_rows(dashboard.get("supervisor_performance") or [],
                                           days_remaining)
    rso_rows, rso_total = _rso_rows(dashboard.get("rso_performance") or [], days_remaining)

    # Height accounting mirrors the render pass below exactly.
    body_h = SECTION_TITLE_H + table_height(1)                   # HOUSE SUMMARY
    if sup_rows:
        body_h += GAP + SECTION_TITLE_H + table_height(len(sup_rows) + 1)
    if rso_rows:
        body_h += GAP + SECTION_TITLE_H + table_height(len(rso_rows) + 1)

    cx = PAGE_PAD + CARD_PAD
    total_h = PAGE_PAD + CARD_PAD + HDR_H + GAP + body_h + PAGE_PAD + CARD_PAD
    # Guard against a wide strip for tiny datasets — the report must stay portrait.
    canvas_h = max(total_h, int(IMG_W * PORTRAIT_MIN_RATIO))
    s = _active_scale()
    img = Image.new("RGB", (IMG_W * s, max(canvas_h, 60) * s), REPORT_BG)
    draw = ScaledDraw(ImageDraw.Draw(img), _scale)

    y = PAGE_PAD + CARD_PAD
    y = _render_header(draw, cx, y, house_name, house_code, summary, today, report_title)
    y += GAP
    y = _render_house_summary(draw, cx, y, INNER, summary)
    if sup_rows:
        y += GAP
        y = render_section(draw, cx, y, INNER, "SUPERVISOR PERFORMANCE",
                           SUPERVISOR_LABELS, sup_rows, total_row=sup_total, total_span=3)
    if rso_rows:
        y += GAP
        y = render_section(draw, cx, y, INNER, "RSO PERFORMANCE",
                           RSO_LABELS, rso_rows, total_row=rso_total, total_span=3)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


async def _build(db: AsyncSession, house_id: int, report_type: str,
                 scale: int | None) -> bytes:
    """Build the current month's report image for one report-type variant."""
    variant = REPORT_TYPES[report_type]
    today = now_naive().date()
    svc = RechargeReportService(db, house_id, today.month, today.year,
                                variant["service_report_type"])
    dashboard = {
        "summary": await svc.get_summary(),
        "rso_performance": await svc.get_rso_performance(),
        "supervisor_performance": await svc.get_supervisor_performance(),
    }

    result = await db.execute(select(House).where(House.id == house_id))
    house = result.scalar_one_or_none()
    house_name = (house.name or "") if house else "Unknown"
    house_code = (house.code or "") if house else ""

    if scale is None:
        return _render_image(house_name, house_code, dashboard, today, variant["title"])
    with _scale.temp(scale):
        return _render_image(house_name, house_code, dashboard, today, variant["title"])


async def build_recharge_report_image(
    db: AsyncSession, house_id: int, scale: int | None = None
) -> bytes:
    """Total-recharge variant of the Recharge Report (report_type `recharge`).

    ``scale`` overrides the default RENDER_SCALE - used for fast, reduced-size
    preview renders. ``None`` produces the full-resolution send-quality image.
    """
    return await _build(db, house_id, "recharge", scale)


async def build_recharge_ev_report_image(
    db: AsyncSession, house_id: int, scale: int | None = None
) -> bytes:
    """EV C2C variant of the Recharge Report (report_type `recharge_ev_secondary`)."""
    return await _build(db, house_id, "recharge_ev_secondary", scale)
