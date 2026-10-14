"""Active LSO Report image builder for WhatsApp/Telegram delivery.

Renders the current month's Active LSO Report (/reports/active-lso) as a PNG
image in the same simple, print-friendly style as the GA Live report image: a
plain header with one highlighted metric box, a single-row summary table, and
one plain bordered table each for supervisors and RSOs.

The layout is a single full-width column (portrait strip) with small margins, so
the image reads as one tall page on a phone and fills an A4 page when printed.

Business rules mirror the dashboard page:
    * Target   -> rso_targets.lso_target_modified (fallback: rso_targets.lso)
    * Ach      -> retailers that qualify as Active LSO for the month
    * %        -> Ach / Target, the value the page status is based on
    * Remain   -> Target - Ach (signed: negative when over-achieved)
    * DRR      -> ceil(remaining / days_remaining), signed the same way
    * Active   -> configured threshold: N+ distinct C2S days AND M+ BDT
"""
import io
import math
from datetime import date, datetime, timedelta
from contextlib import contextmanager

from PIL import Image, ImageDraw
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# We deliberately generate large (multi-thousand pixel) report images at
# RENDER_SCALE below - the size is intended, not a decompression bomb.
Image.MAX_IMAGE_PIXELS = None

from app.models.house import House
from app.services.active_lso_report_service import ActiveLsoReportService
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
# geometry as the GA Live report image, so both reports look like siblings.
IMG_W = 800
PAGE_PAD = 0             # no page margin — the report is full-bleed
CARD_PAD = 10            # inner padding of the report content
INNER = IMG_W - 2 * PAGE_PAD - 2 * CARD_PAD  # content width
GAP = 8                  # minimum gap between sections
HDR_H = 118
NOTE_H = 18              # caption line under the summary table

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

NOTE_INK = "#5B7290"

MUTED = "-"


def _active_scale() -> int:
    return _scale.active()


@contextmanager
def _temp_scale(scale: int):
    with _scale.temp(scale):
        yield


# ── Section column sets ──
SUMMARY_LABELS = ["RSOs", "Retailers", "Target", "Ach", "Remain", "%", "DRR"]
SUPERVISOR_LABELS = ["#", "Supervisor Name", "RSO", "Retailers", "Target", "Ach",
                     "%", "Remain", "DRR"]
RSO_LABELS = ["#", "RSO Name", "Supervisor", "Retailers", "Target", "Ach",
              "%", "Remain", "DRR"]


# ── Data prep ──
def _num(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _drr_text(remaining, days_remaining) -> str:
    """Daily required rate, signed like the page (negative when over-achieved)."""
    if not days_remaining:
        return "0"
    ratio = _num(remaining) / days_remaining
    return fmt_num(math.ceil(ratio) if ratio >= 0 else math.floor(ratio))


def _period_text(period: dict) -> str:
    start = period.get("start_date") or ""
    end = period.get("end_date") or ""
    try:
        start = datetime.fromisoformat(str(start)).strftime("%d %b %Y")
    except ValueError:
        pass
    try:
        end = datetime.fromisoformat(str(end)).strftime("%d %b %Y")
    except ValueError:
        pass
    if start and end:
        return f"Period: {start} - {end}"
    return ""


def _threshold_text(period: dict) -> str:
    days = period.get("active_threshold_days")
    amount = period.get("active_threshold_amount")
    if days is None or amount is None:
        return ""
    return (f"Active = {fmt_num(days)}+ distinct C2S days and "
            f"{fmt_num(amount)}+ BDT in the period")


# ── Header ──
def _render_header(draw, x, y, house_name, house_code, summary, period, today: date) -> int:
    x1 = x + INNER
    pad_x = 16
    date_str = today.strftime("%d %B %Y")
    time_str = now_naive().strftime("%I:%M %p").lstrip("0").replace(" 0", " ")

    # metric box (right) — measured first so the brand text can be kept clear of it
    lbl = "Achievement"
    val = pct_2dp(summary.get("achieved"), summary.get("target"))
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

    draw.text((tx, y + 44), "Active LSO Report", font=load_font(28, True),
              fill=INK, anchor="ls")
    f_meta = load_font(14, True)
    draw.text((tx, y + 66), ellipsize(
        draw, f"House: {house_name or ''} ({house_code or ''})", f_meta, brand_max),
        font=f_meta, fill=INK, anchor="lm")
    draw.text((tx, y + 86), ellipsize(
        draw, _period_text(period), f_meta, brand_max),
        font=f_meta, fill=INK, anchor="lm")
    draw.text((tx, y + 106), f"Generated: {date_str}, {time_str}",
              font=f_meta, fill=INK, anchor="lm")

    draw.rounded_rectangle([bx, by, bx + box_w, by + box_h], radius=9,
                           fill=TOTAL_BG, outline=TOTAL_INK, width=2)
    draw.text((bx + box_w / 2, by + 17), lbl, font=fl, fill=TOTAL_INK, anchor="mm")
    draw.text((bx + box_w / 2, by + 52), val, font=fv, fill=TOTAL_INK, anchor="mm")
    return y + HDR_H


# ── Sections ──
def _render_summary(draw, x, y, w, summary, days_remaining: int) -> int:
    """House summary: plain title + a single-row metric table."""
    values = [
        fmt_num(summary.get("rso_count")),
        fmt_num(summary.get("retailer_count")),
        fmt_num(summary.get("target")),
        fmt_num(summary.get("achieved")),
        fmt_num(summary.get("remaining")),
        pct_2dp(summary.get("achieved"), summary.get("target")),
        _drr_text(summary.get("remaining"), days_remaining),
    ]
    # Evenly split metric cells (no left-aligned name column), mirroring the
    # summary grid in the HTML dashboard.
    return render_section(draw, x, y, w, "SUMMARY", SUMMARY_LABELS, [values],
                          weights=[1] * len(SUMMARY_LABELS), left_cols=())


def _render_threshold_note(draw, x, y, period) -> int:
    """Small caption explaining what counts as an Active LSO this month."""
    text = _threshold_text(period)
    if not text:
        return y
    draw.text((x, y + 10), text, font=load_font(11, True), fill=NOTE_INK, anchor="lm")
    return y + NOTE_H


def _supervisor_rows(dashboard: dict, days_remaining: int):
    """Rows + total for the SUPERVISOR PERFORMANCE table (all supervisors)."""
    supervisors = dashboard.get("supervisor_summary") or []
    rows = []
    sums = {"rso": 0, "ret": 0, "target": 0.0, "ach": 0.0, "remain": 0.0}
    for idx, sup in enumerate(supervisors):
        target = _num(sup.get("target"))
        ach = _num(sup.get("achieved"))
        remain = _num(sup.get("remaining"))
        rso_count = int(_num(sup.get("rso_count")))
        retailers = int(_num(sup.get("retailer_count")))
        rows.append([
            str(idx + 1), str(sup.get("supervisor_name") or MUTED),
            str(rso_count), str(retailers),
            fmt_num(target), fmt_num(ach), pct_2dp(ach, target),
            fmt_num(remain), _drr_text(remain, days_remaining),
        ])
        sums["rso"] += rso_count
        sums["ret"] += retailers
        sums["target"] += target
        sums["ach"] += ach
        sums["remain"] += remain

    if not rows:
        return [], None

    total_row = [
        f"Total ({len(rows)} Supervisor)", "",
        str(sums["rso"]), str(sums["ret"]),
        fmt_num(sums["target"]), fmt_num(sums["ach"]),
        pct_2dp(sums["ach"], sums["target"]), fmt_num(sums["remain"]),
        _drr_text(sums["remain"], days_remaining),
    ]
    return rows, total_row


def _rso_rows(rows_in: list, days_remaining: int):
    """Rows + total for the RSO PERFORMANCE table (every RSO in one table).

    The page's order (grouped by supervisor, then name) is preserved so the
    image can be read side by side with the dashboard table.
    """
    rows = []
    tot = {"ret": 0, "target": 0.0, "ach": 0.0, "remain": 0.0}
    for i, r in enumerate(rows_in):
        target = _num(r.get("target"))
        ach = _num(r.get("achieved"))
        remain = _num(r.get("remaining"))
        retailers = int(_num(r.get("retailer_count")))
        rows.append([
            str(i + 1), str(r.get("name") or MUTED),
            str(r.get("supervisor_name") or MUTED), str(retailers),
            fmt_num(target), fmt_num(ach), pct_2dp(ach, target),
            fmt_num(remain), _drr_text(remain, days_remaining),
        ])
        tot["ret"] += retailers
        tot["target"] += target
        tot["ach"] += ach
        tot["remain"] += remain

    if not rows:
        return [], None

    total_row = [
        f"Total ({len(rows)} RSO)", "", "",
        str(tot["ret"]), fmt_num(tot["target"]), fmt_num(tot["ach"]),
        pct_2dp(tot["ach"], tot["target"]), fmt_num(tot["remain"]),
        _drr_text(tot["remain"], days_remaining),
    ]
    return rows, total_row


# ── Render ──
def _render_image(house_name: str, house_code: str, dashboard: dict, today: date) -> bytes:
    summary = dashboard.get("summary") or {}
    period = dashboard.get("period") or {}
    days_remaining = int(_num(period.get("days_remaining")))

    sup_rows, sup_total = _supervisor_rows(dashboard, days_remaining)
    rso_rows, rso_total = _rso_rows(dashboard.get("rows") or [], days_remaining)
    note_h = NOTE_H if _threshold_text(period) else 0

    # Height accounting mirrors the render pass below exactly.
    body_h = SECTION_TITLE_H + table_height(1) + note_h      # SUMMARY + note
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
    y = _render_header(draw, cx, y, house_name, house_code, summary, period, today)
    y += GAP
    y = _render_summary(draw, cx, y, INNER, summary, days_remaining)
    y = _render_threshold_note(draw, cx, y, period)
    if sup_rows:
        y += GAP
        y = render_section(draw, cx, y, INNER, "SUPERVISOR PERFORMANCE",
                           SUPERVISOR_LABELS, sup_rows,
                           total_row=sup_total, total_span=2)
    if rso_rows:
        y += GAP
        y = render_section(draw, cx, y, INNER, "RSO PERFORMANCE",
                           RSO_LABELS, rso_rows,
                           total_row=rso_total, total_span=2)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


async def build_active_lso_report_image(
    db: AsyncSession, house_id: int, scale: int | None = None
) -> bytes:
    """Build the current month's Active LSO Report as a PNG image.

    ``scale`` overrides the default RENDER_SCALE - used for fast, reduced-size
    preview renders. ``None`` produces the full-resolution send-quality image.
    """
    today = now_naive().date()
    start_date = today.replace(day=1)
    if today.month == 12:
        end_date = date(today.year + 1, 1, 1) - timedelta(days=1)
    else:
        end_date = date(today.year, today.month + 1, 1) - timedelta(days=1)

    svc = ActiveLsoReportService(db, house_id, start_date, end_date)
    dashboard = await svc.build_dashboard()

    result = await db.execute(select(House).where(House.id == house_id))
    house = result.scalar_one_or_none()
    house_name = (house.name or "") if house else "Unknown"
    house_code = (house.code or "") if house else ""

    if scale is None:
        return _render_image(house_name, house_code, dashboard, today)
    with _temp_scale(scale):
        return _render_image(house_name, house_code, dashboard, today)
