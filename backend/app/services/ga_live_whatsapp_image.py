"""Server-side GA Live Report image builder for WhatsApp chat delivery.

Renders the GA Live Report as a PNG image that mirrors the design in
``GA_Live_Report_September_2026.html``:

- Gradient blue header with house meta + big "Total Activations" box
- DD SUMMARY + TEAM SUMMARY cards
- SUPERVISOR PERFORMANCE table
- Per-supervisor panels with RSO & BP mini-tables

The supervisor grid is dynamic: a house with a single supervisor renders the
supervisor-wise section in one column, multiple supervisors render two columns.
"""
import io
import math
from datetime import date

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.ga_live_whatsapp_text import _load_report_data, _fmt, _pct
from app.utils.timezone import now_naive

FONT_REG = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"

# ── Design palette (mirrors GA_Live_Report_September_2026.html) ──
PAGE_BG = "#EEF3F8"
REPORT_BG = "#FFFFFF"
INK = "#12345B"
MUTED = "#6B7F96"

HEADER_G1 = "#073B73"
HEADER_G2 = "#075F9F"
TOTAL_BG = "#EFFFF5"
TOTAL_INK = "#08773D"

DD_BORDER = "#1688DF"
DD_G1 = "#0870C9"
DD_G2 = "#12A5DC"
TEAM_BORDER = "#15A8A4"
TEAM_G1 = "#087D78"
TEAM_G2 = "#16AAA6"
SECTION_BORDER = "#176CC0"
SECTION_G1 = "#095DA4"
SECTION_G2 = "#248BD0"

TH_BG = "#EDF6FD"
TH_INK = "#123B68"
TD_BORDER = "#CBD9E6"
TOTAL_ROW_BG = "#E7F4FC"
LIVE_INK = "#0AA65A"
BLUE_INK = "#0956A0"
GREEN_INK = "#07833F"
RED_INK = "#DF1E27"
PURPLE_INK = "#5C2BBD"
SEP_INK = "#D6E2ED"
BP_TITLE_INK = "#176C9F"
BADGE_INK = "#164B78"
FADE_WHITE = "#DFEFFF"
SUBPANEL_WHITE = "#DCEBFF"

SUP_HEAD_COLORS = ["#0879C9", "#139B69", "#F18B14", "#E73A4C"]
SUP_BORDER_COLORS = ["#0D79CB", "#16A76D", "#F08A16", "#E73B50"]

# ── Layout ──
IMG_W = 1080
PAGE_PAD = 12            # page background margin around the white report card
CARD_PAD = 14            # inner padding of the report card
CARD_R = 14              # report card corner radius
INNER = IMG_W - 2 * PAGE_PAD - 2 * CARD_PAD  # content width
GAP = 12
HDR_H = 118
TBAR_H = 34
PANEL_HEAD_H = 40
TITLE_ICON_X = 13
TITLE_ICON_W = 18
TITLE_ICON_GAP = 7

_FONTS: dict = {}


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    key = (size, bold)
    if key not in _FONTS:
        _FONTS[key] = ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)
    return _FONTS[key]


# ── Colour / gradient helpers ──
def _hex(c: str):
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def _blend(c1: str, c2: str, f: float) -> str:
    a = _hex(c1)
    b = _hex(c2)
    return "#{:02X}{:02X}{:02X}".format(
        *(round(x + (y - x) * f) for x, y in zip(a, b))
    )


def _grad(img: Image.Image, box, c1: str, c2: str, r: int = 0, top_only: bool = False):
    """Paint a horizontal gradient c1→c2 into ``box`` with optional rounded
    corners; when ``top_only`` the radius only applies to the two top corners."""
    x0, y0, x1, y1 = box
    w, h = int(x1 - x0), int(y1 - y0)
    grad = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(grad)
    for xx in range(w):
        f = xx / (w - 1) if w > 1 else 0
        d.line([(xx, 0), (xx, h)], fill=_blend(c1, c2, f))
    mask = Image.new("L", (w, h), 0)
    dm = ImageDraw.Draw(mask)
    dm.rounded_rectangle([0, 0, w, h], radius=r, fill=255)
    if top_only and r:
        dm.rectangle([0, int(r), w, h], fill=255)
    img.paste(grad, (int(x0), int(y0)), mask)


def _ellipsize(draw, text, font, max_w: float) -> str:
    s = str(text)
    if draw.textlength(s, font=font) <= max_w:
        return s
    while s and draw.textlength(s + "…", font=font) > max_w:
        s = s[:-1]
    return s + "…" if s else s


# ── Small drawn icons (stand in for the HTML emoji) ──
def _icon(draw, x, cy, kind: str, color: str):
    if kind == "target":
        r = 8
        cx = x + r
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=color, width=2)
        draw.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], outline=color, width=2)
        draw.ellipse([cx - 1.5, cy - 1.5, cx + 1.5, cy + 1.5], fill=color)
    elif kind == "team":
        for dpx in (0, 7):
            hx = x + dpx + 3
            draw.ellipse([hx - 3.2, cy - 6, hx + 3.2, cy], fill=color)
            draw.arc([hx - 6, cy - 1, hx + 6, cy + 7], start=180, end=360, fill=color, width=2)
    elif kind == "person":
        draw.ellipse([x + 2 - 4, cy - 8, x + 2 + 4, cy], fill=color)
        draw.arc([x + 2 - 7, cy - 1, x + 2 + 7, cy + 8], start=180, end=360, fill=color, width=2)
    elif kind == "chart":
        draw.line([(x, cy + 3), (x + 14, cy + 3)], fill=color, width=2)
        draw.rectangle([x + 1, cy - 3, x + 3, cy + 3], fill=color)
        draw.rectangle([x + 5, cy - 8, x + 7, cy + 3], fill=color)
        draw.rectangle([x + 9, cy - 5, x + 11, cy + 3], fill=color)


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
    head_h = f_head.size + 12
    row_h = f_cell.size + 9
    return head_h, row_h


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
    f_head,
    f_cell,
    borderless=False,
    border_color=None,
) -> int:
    """Draw a bordered table starting at (x, y). Returns the height used."""
    n = len(labels)
    if n == 0:
        return 0
    left_cols = left_cols or []
    live_cols = live_cols or []
    weights = weights or [6 if i in left_cols else 4 for i in range(n)]
    widths = _fit_widths(weights, width)
    head_h, row_h = _table_heights(f_head, f_cell)
    all_rows = rows if total_row is None else rows + [total_row]

    def _live_text(ci, text):
        if ci in live_cols:
            num = str(text).replace("●", "").strip()
            if num in ("0", "", "-", "0%", None):
                return num or ""
            return f"● {num}"
        return str(text)

    # header
    draw.rectangle([x, y, x + width, y + head_h], fill=TH_BG)
    for ci, lab in enumerate(labels):
        cw = widths[ci]
        tx = x + sum(widths[:ci])
        if ci in left_cols:
            draw.text((tx + 5, y + head_h / 2), str(lab), font=f_head, fill=TH_INK, anchor="lm")
        else:
            draw.text((tx + cw / 2, y + head_h / 2), str(lab), font=f_head, fill=TH_INK, anchor="mm")

    yy = y + head_h
    for ri, row in enumerate(all_rows):
        is_total = total_row is not None and ri == len(rows)
        if is_total:
            draw.rectangle([x, yy, x + width, yy + row_h], fill=TOTAL_ROW_BG)
        font = f_head if is_total else f_cell
        color = LIVE_INK if is_total else INK
        for ci in range(n):
            val = row[ci] if ci < len(row) else ""
            txt = _live_text(ci, val)
            cw = widths[ci]
            tx = x + sum(widths[:ci])
            cell_color = LIVE_INK if (ci in live_cols and txt.startswith("●")) else color
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
        for ci in range(1, n):
            lx = x + sum(widths[:ci])
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


def _sup_metrics(sup: dict, team_rso: list, team_bp: list, days_remaining: int):
    target = sum(r.get("target", 0) or 0 for r in team_rso) + sum(
        b.get("target", 0) or 0 for b in team_bp
    )
    ach = sum(max(0, (r.get("target", 0) or 0) - (r.get("remaining", 0) or 0)) for r in team_rso) + sum(
        max(0, (b.get("target", 0) or 0) - (b.get("remaining", 0) or 0)) for b in team_bp
    )
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


def _team_summary_rows(data: dict, summary: dict) -> list[list]:
    s = data.get("summary", {})
    monthly_target = summary.get("monthly_target", 0)
    achievement = summary.get("achievement", 0)
    daily_required = summary.get("daily_required_with_friday", 0)
    remaining = summary.get("remaining", 0)
    bp_ach = sum(b.get("own_activation", 0) for b in data.get("bps", []))
    active_sup = sum(1 for sup in data.get("supervisors", [])
                     if (sup.get("total_activation", 0) or 0) > 0)
    return [
        [
            "Supervisor", _n(s.get("total_supervisors", 0)), _fmt(monthly_target),
            _fmt(achievement), _pct(achievement, monthly_target), _fmt(remaining),
            _fmt(daily_required), _n(active_sup),
        ],
        [
            "RSO", _n(s.get("total_rso", 0)), _fmt(monthly_target),
            _fmt(achievement), _pct(achievement, monthly_target), _fmt(remaining),
            _fmt(daily_required), _n(s.get("active_rso", 0)),
        ],
        [
            "BP", _n(s.get("total_bp", 0)), "-", _fmt(bp_ach), "-", "-", "-",
            _n(s.get("active_bp", 0)),
        ],
    ]


# ── Sections ──
def _render_header(img, draw, x, y, house, data, today: date) -> int:
    x1 = x + INNER
    _grad(img, [x, y, x1, y + HDR_H], HEADER_G1, HEADER_G2, r=10)
    pad_x = 20
    month_year = today.strftime("%B %Y")
    date_str = today.strftime("%d %B %Y")
    time_str = now_naive().strftime("%I:%M %p").lstrip("0").replace(" 0", " ")
    total_activations = data.get("summary", {}).get("total_activations", 0)

    # brand (left) — text column, vertically centred (mirrors HTML .brand)
    tx = x + pad_x

    f_title = _font(34, True)
    f_span = _font(23, True)
    f_meta = _font(17, True)
    title = "GA Live Report"
    base = y + 50  # baseline shared by title + "(month year)" span (h1 in HTML)
    draw.text((tx, base), title, font=f_title, fill="#FFFFFF", anchor="ls")
    draw.text(
        (tx + draw.textlength(title, font=f_title) + 9, base),
        f"({month_year})", font=f_span, fill="#FFFFFF", anchor="ls",
    )
    draw.text((tx, y + 73), f"House: {house.name or ''} ({house.code or ''})",
              font=f_meta, fill="#FFFFFF", anchor="lm")
    draw.text((tx, y + 93), f"Generated: {date_str}, {time_str}",
              font=f_meta, fill="#FFFFFF", anchor="lm")

    # total box (right)
    lbl = "Total Activations"
    val = _fmt(total_activations)
    fl = _font(16, True)
    fv = _font(48, True)
    box_w = max(draw.textlength(lbl, font=fl), draw.textlength(val, font=fv)) + 56
    box_w = max(box_w, 260)
    box_h = 88
    bx = x1 - pad_x - box_w
    by = y + (HDR_H - box_h) // 2
    draw.rounded_rectangle([bx, by, bx + box_w, by + box_h], radius=9, fill=TOTAL_BG)
    draw.text((bx + box_w / 2, by + 18), lbl, font=fl, fill=TOTAL_INK, anchor="mm")
    draw.text((bx + box_w / 2, by + 62), val, font=fv, fill=TOTAL_INK, anchor="mm")
    return y + HDR_H


def _card_frame(draw, x, y, w, h, border):
    draw.rounded_rectangle([x, y, x + w - 1, y + h], radius=9, outline=border,
                           width=2, fill=REPORT_BG)


def _render_top_grid(img, draw, x, y, data, summary) -> int:
    w = INNER
    dd_w = int(w * 1 / 2.18)
    team_w = w - dd_w - GAP
    monthly_target = summary.get("monthly_target", 0)
    achievement = summary.get("achievement", 0)
    remaining = summary.get("remaining", 0)
    daily_required = summary.get("daily_required_with_friday", 0)

    # ── DD SUMMARY card (height matches TEAM SUMMARY; grid rows stretch) ──
    labels = ["Team", "Total", "Target", "Ach", "%", "Remain", "DRR", "Live GA"]
    weights = [14, 8, 11, 10, 9, 11, 9, 12]
    rows = _team_summary_rows(data, summary)
    f_head = _font(11, True)
    f_cell = _font(11, True)
    head_h, row_h = _table_heights(f_head, f_cell)
    table_h = head_h + row_h * len(rows)
    top_h = TBAR_H + 7 + table_h + 7

    title_cy = y + TBAR_H / 2 + 1

    dd_values = [
        ("Target", _fmt(monthly_target), BLUE_INK),
        ("Ach", _fmt(achievement), GREEN_INK),
        ("Remain", _fmt(remaining), RED_INK),
        ("%", _pct(achievement, monthly_target), INK),
        ("DRR", _fmt(daily_required), PURPLE_INK),
    ]
    label_h = 18
    val_h = 32
    content_h = label_h + 8 + val_h
    inner = y + TBAR_H + (top_h - TBAR_H - content_h) // 2
    label_cy = inner + 9
    val_cy = inner + 9 + 8 + 16
    sep_top = inner - 6
    sep_bot = inner + content_h + 6
    _card_frame(draw, x, y, dd_w, top_h, DD_BORDER)
    _grad(img, [x + 1, y + 1, x + dd_w - 1, y + TBAR_H + 1], DD_G1, DD_G2, r=8, top_only=True)
    _icon(draw, x + TITLE_ICON_X, title_cy, "target", "#FFFFFF")
    draw.text((x + TITLE_ICON_X + TITLE_ICON_W + TITLE_ICON_GAP, title_cy),
              "DD SUMMARY", font=_font(16, True), fill="#FFFFFF", anchor="lm")
    vcw = dd_w / len(dd_values)
    for c_idx, (lab, val, color) in enumerate(dd_values):
        vx = x + vcw * c_idx
        if c_idx > 0:
            draw.line([(vx, sep_top), (vx, sep_bot)], fill=SEP_INK)
        draw.text((vx + vcw / 2, label_cy), lab, font=_font(14, True), fill=MUTED, anchor="mm")
        draw.text((vx + vcw / 2, val_cy), val, font=_font(26, True), fill=color, anchor="mm")

    # ── TEAM SUMMARY card ──
    cx = x + dd_w + GAP
    _card_frame(draw, cx, y, team_w, top_h, TEAM_BORDER)
    _grad(img, [cx + 1, y + 1, cx + team_w - 1, y + TBAR_H + 1], TEAM_G1, TEAM_G2, r=8, top_only=True)
    _icon(draw, cx + TITLE_ICON_X, title_cy, "team", "#FFFFFF")
    draw.text((cx + TITLE_ICON_X + TITLE_ICON_W + TITLE_ICON_GAP, title_cy),
              "TEAM SUMMARY", font=_font(16, True), fill="#FFFFFF", anchor="lm")
    _draw_table(
        draw, cx + 8, y + TBAR_H + 7, team_w - 16, labels, rows,
        weights=weights, left_cols=[0], live_cols=[7], f_head=f_head, f_cell=f_cell,
        borderless=False, border_color=SEP_INK,
    )

    return y + top_h


def _render_supervisor_section(img, draw, x, y, data, summary) -> int:
    w = INNER
    supervisors = data.get("supervisors", [])
    days_remaining = summary.get("days_remaining", 0)
    total_rso = int(data.get("summary", {}).get("total_rso", 0))
    total_bp = int(data.get("summary", {}).get("total_bp", 0))

    rows = []
    sums = {"target": 0, "ach": 0, "remain": 0, "drr": 0}
    for idx, sup in enumerate(supervisors):
        team_rso, team_bp = _team_by_supervisor(sup, data)
        target, ach, pct, remain, drr = _sup_metrics(sup, team_rso, team_bp, days_remaining)
        sums["target"] += target
        sums["ach"] += ach
        sums["remain"] += remain
        sums["drr"] += drr
        rows.append([
            _n(idx + 1), sup.get("name", ""), sup.get("pool_number", "") or "-",
            _n(sup.get("rso_count", len(team_rso))),
            _n(sup.get("bp_count", len(team_bp))),
            _fmt(target), _fmt(ach), _pct(ach, target), _fmt(remain), _fmt(drr),
            _n(len(team_rso)),
        ])
    total_row = [
        "", "Total", "-", _n(total_rso), _n(total_bp),
        _fmt(sums["target"]), _fmt(sums["ach"]),
        _pct(sums["ach"], sums["target"]), _fmt(sums["remain"]), _fmt(sums["drr"]),
        _n(total_rso),
    ]

    labels = ["#", "Name", "Pool", "RSO", "BP", "Target", "Ach", "%", "Remain", "DRR", "Live GA"]
    weights = [4, 22, 18, 6, 6, 13, 13, 10, 13, 11, 12]
    f_head = _font(11, True)
    f_cell = _font(11, True)
    head_h, row_h = _table_heights(f_head, f_cell)
    table_h = head_h + row_h * (len(rows) + 1)
    body_h = TBAR_H + 6 + table_h + 6
    _card_frame(draw, x, y, w, body_h, SECTION_BORDER)
    _grad(img, [x + 1, y + 1, x + w - 1, y + TBAR_H + 1], SECTION_G1, SECTION_G2, r=8, top_only=True)
    _icon(draw, x + TITLE_ICON_X, y + TBAR_H / 2 + 1, "person", "#FFFFFF")
    draw.text((x + TITLE_ICON_X + TITLE_ICON_W + TITLE_ICON_GAP, y + TBAR_H / 2 + 1),
              "SUPERVISOR PERFORMANCE", font=_font(16, True), fill="#FFFFFF", anchor="lm")
    _draw_table(
        draw, x + 8, y + TBAR_H + 6, w - 16, labels, rows,
        weights=weights, left_cols=[1], live_cols=[10], total_row=total_row,
        f_head=f_head, f_cell=f_cell,
    )
    return y + body_h


def _panel_height(team_rso: list, team_bp: list) -> int:
    f_head = _font(10, True)
    f_cell = _font(10, True)
    hh, rh = _table_heights(f_head, f_cell)
    rso_table_h = hh + rh * (len(team_rso) + 1) if team_rso else 16
    bp_table_h = hh + rh * (len(team_bp) + 1) if team_bp else 0
    bp_block = 9 + (18 if team_bp else 0) + bp_table_h if team_bp else 0
    return 6 + PANEL_HEAD_H + 7 + rso_table_h + bp_block + 6


def _render_panel(img, draw, x, y, w, sup, team_rso, team_bp, idx, days_remaining) -> int:
    h = _panel_height(team_rso, team_bp)
    border = SUP_BORDER_COLORS[idx % 4]
    head_color = SUP_HEAD_COLORS[idx % 4]
    _card_frame(draw, x, y, w, h, border)

    # head bar
    _grad(img, [x + 1, y + 1, x + w - 1, y + PANEL_HEAD_H + 1], head_color, head_color,
          r=8, top_only=True)
    _icon(draw, x + TITLE_ICON_X, y + PANEL_HEAD_H / 2 - 4, "person", "#FFFFFF")

    sup_t, sup_a, sup_p, _, _ = _sup_metrics(sup, team_rso, team_bp, days_remaining)
    badge_text = f"Target {_fmt(sup_t)} | Ach {_fmt(sup_a)} | {_pct(sup_a, sup_t)}"
    badge_font = _font(10, True)
    badge_w = draw.textlength(badge_text, font=badge_font) + 18
    badge_h = 20
    badge_x = x + w - 10 - badge_w
    name_x = x + TITLE_ICON_X + TITLE_ICON_W + TITLE_ICON_GAP
    name_avail = badge_x - name_x - 6
    name = _ellipsize(draw, f"Supervisor {idx + 1}: {sup.get('name', '')}",
                      _font(13, True), name_avail)
    draw.text((name_x, y + PANEL_HEAD_H / 2 - 5), name, font=_font(13, True),
              fill="#FFFFFF", anchor="lm")
    draw.text((name_x, y + PANEL_HEAD_H / 2 + 10),
              f"({len(team_rso)} RSO | {len(team_bp)} BP)", font=_font(10, True),
              fill=SUBPANEL_WHITE, anchor="lm")
    draw.rounded_rectangle([badge_x, y + (PANEL_HEAD_H - badge_h) / 2,
                            badge_x + badge_w, y + (PANEL_HEAD_H + badge_h) / 2],
                           radius=12, fill="#FFFFFF")
    draw.text((badge_x + badge_w / 2, y + PANEL_HEAD_H / 2), badge_text,
              font=badge_font, fill=BADGE_INK, anchor="mm")

    pad = 7
    yy = y + PANEL_HEAD_H + pad
    inner_w = w - pad * 2
    f_head = _font(10, True)
    f_cell = _font(10, True)
    hh, rh = _table_heights(f_head, f_cell)

    # RSO mini-table
    rso_labels = ["#", "RSO Name", "Pool", "AC", "Trgt", "Own", "Mkt", "Total", "%",
                  "Rem", "YOwn", "YMkt", "YTot", "Live"]
    rso_weights = [3, 15, 9, 8, 5, 5, 5, 6, 6, 5, 5, 5, 6, 7]
    rso_rows = []
    su = {"trg": 0, "own": 0, "mkt": 0, "tot": 0, "rem": 0, "yown": 0, "ymkt": 0, "ytot": 0}
    for i, r in enumerate(team_rso):
        trg = _today_target(r, days_remaining)
        total = r.get("total_activation", 0) or 0
        own = r.get("own_activation", 0) or 0
        mkt = r.get("market_activation", 0) or 0
        rem = max(0, trg - total)
        yown = r.get("yesterday_own", 0) or 0
        ymkt = r.get("yesterday_market", 0) or 0
        ytot = r.get("yesterday_total", 0) or 0
        su["trg"] += trg
        su["own"] += own
        su["mkt"] += mkt
        su["tot"] += total
        su["rem"] += rem
        su["yown"] += yown
        su["ymkt"] += ymkt
        su["ytot"] += ytot
        rso_rows.append([
            _n(i + 1), r.get("name", ""), r.get("itop_number", "") or "-",
            r.get("assisted_code", "") or "-", _n(trg), _n(own), _n(mkt), _n(total),
            _pct(total, trg) if trg else "0%", _n(rem), _n(yown), _n(ymkt), _n(ytot),
            _n(total),
        ])
    if team_rso:
        rso_total = [
            f"Total ({len(team_rso)} RSO)", "", "", "", _n(su["trg"]), _n(su["own"]),
            _n(su["mkt"]), _n(su["tot"]), _pct(su["tot"], su["trg"]) if su["trg"] else "0%",
            _n(su["rem"]), _n(su["yown"]), _n(su["ymkt"]), _n(su["ytot"]),
            _n(len(team_rso)),
        ]
        yy += _draw_table(draw, x + pad, yy, inner_w, rso_labels, rso_rows,
                          weights=rso_weights, left_cols=[1], live_cols=[13],
                          total_row=rso_total, f_head=f_head, f_cell=f_cell)
    else:
        draw.text((x + pad + 4, yy), "No RSO assigned", font=_font(11), fill=MUTED, anchor="lm")
        yy += 16

    yy += 9

    # BP block
    if team_bp:
        bp_labels = ["#", "BP Name", "Pool", "AC", "Trgt", "Ach", "%", "Rem", "YGA", "Live"]
        bp_weights = [3, 15, 10, 8, 7, 6, 7, 6, 6, 7]
        draw.line([(x + pad, yy), (x + w - pad, yy)], fill=SEP_INK)
        yy += 6
        draw.text((x + pad + 2, yy), f"BP ({len(team_bp)})", font=_font(14, True),
                  fill=BP_TITLE_INK, anchor="lm")
        yy += 18
        bp_rows = []
        su2 = {"trg": 0, "ach": 0, "rem": 0, "yga": 0}
        for i, b in enumerate(team_bp):
            trg = _today_target(b, days_remaining)
            ach = b.get("own_activation", 0) or 0
            rem = max(0, trg - ach)
            yga = b.get("yesterday_activation", 0) or 0
            su2["trg"] += trg
            su2["ach"] += ach
            su2["rem"] += rem
            su2["yga"] += yga
            bp_rows.append([
                _n(i + 1), b.get("name", ""), b.get("pool_number", "") or "-",
                b.get("assisted_code", "") or "-", _n(trg), _n(ach),
                _pct(ach, trg) if trg else "0%", _n(rem), _n(yga), _n(ach),
            ])
        bp_total = [
            f"Total ({len(team_bp)} BP)", "", "", "", _n(su2["trg"]), _n(su2["ach"]),
            _pct(su2["ach"], su2["trg"]) if su2["trg"] else "0%",
            _n(su2["rem"]), _n(su2["yga"]), _n(len(team_bp)),
        ]
        yy += _draw_table(draw, x + pad, yy, inner_w, bp_labels, bp_rows,
                          weights=bp_weights, left_cols=[1], live_cols=[9],
                          total_row=bp_total, f_head=f_head, f_cell=f_cell)
    else:
        draw.text((x + pad + 4, yy), "No BP assigned", font=_font(11), fill=MUTED, anchor="lm")
    return yy


def _render_footer(img, draw, x, y, today: date) -> int:
    w = INNER
    h = 44
    date_str = today.strftime("%d %B %Y")
    time_str = now_naive().strftime("%I:%M %p").lstrip("0").replace(" 0", " ")
    _grad(img, [x, y, x + w, y + h], HEADER_G1, HEADER_G2, r=10)
    f = _font(12, True)
    _icon(draw, x + 16, y + h / 2, "chart", "#FFFFFF")
    draw.text((x + 34, y + h / 2), "Together We Grow  |  Target Today  |  Success Tomorrow",
              font=f, fill="#FFFFFF", anchor="lm")
    right = f"Generated by (এখানে প্রজেক্টের নাম হবে)  |  {date_str}, {time_str}"
    draw.text((x + w - 16, y + h / 2), right, font=f, fill="#FFFFFF", anchor="rm")
    return y + h


def _render_image(house, data: dict, summary: dict, today: date) -> bytes:
    supervisors = data.get("supervisors", [])
    days_remaining = summary.get("days_remaining", 0)
    grid_cols = 1 if len(supervisors) == 1 else 2
    panels = [(sup, _team_by_supervisor(sup, data)) for sup in supervisors]
    grid_rows = [panels[i:i + grid_cols] for i in range(0, len(panels), grid_cols)]
    grid_h = 0
    if grid_rows:
        for row in grid_rows:
            grid_h += max(_panel_height(tr, tb) for _, (tr, tb) in row) + GAP
        grid_h -= GAP

    f_head = _font(11, True)
    head_h, row_h = _table_heights(f_head, _font(11))
    sup_tbl_h = head_h + row_h * (len(supervisors) + 1)

    team_rows = _team_summary_rows(data, summary)
    hh_t, rh_t = _table_heights(_font(11, True), _font(11))
    top_grid_h = TBAR_H + 7 + hh_t + rh_t * len(team_rows) + 7

    cx = PAGE_PAD + CARD_PAD
    total_h = (
        PAGE_PAD + CARD_PAD
        + HDR_H + GAP
        + top_grid_h + GAP
        + ((TBAR_H + 6 + sup_tbl_h + 6) if supervisors else 0)
        + (GAP if supervisors else 0)
        + grid_h
        + (GAP if grid_h else 0)
        + 44
        + PAGE_PAD + CARD_PAD
    )
    img = Image.new("RGB", (IMG_W, max(total_h, 60)), PAGE_BG)
    draw = ImageDraw.Draw(img)

    # white report card
    draw.rounded_rectangle(
        [PAGE_PAD, PAGE_PAD, IMG_W - PAGE_PAD, total_h - PAGE_PAD],
        radius=CARD_R, fill=REPORT_BG,
    )

    y = PAGE_PAD + CARD_PAD
    y = _render_header(img, draw, cx, y, house, data, today)
    y += GAP
    y = _render_top_grid(img, draw, cx, y, data, summary)
    y += GAP
    if supervisors:
        y = _render_supervisor_section(img, draw, cx, y, data, summary)
        y += GAP
        y = _render_supervisor_grid(img, cx, y, data, summary, grid_rows)
        y += GAP
    y = _render_footer(img, draw, cx, y, today)

    iw, ih = img.size
    img = img.resize((iw * 2, ih * 2), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _render_supervisor_grid(img, x, y, data, summary, grid_rows) -> int:
    draw = ImageDraw.Draw(img)
    days_remaining = summary.get("days_remaining", 0)
    supervisors = data.get("supervisors", [])
    cols = 1 if len(supervisors) == 1 else 2
    w = INNER
    panel_w = (w - GAP * (cols - 1)) // cols if cols > 1 else w

    yy = y
    for row in grid_rows:
        row_h = max(_panel_height(tr, tb) for _, (tr, tb) in row)
        for ci, (sup, (team_rso, team_bp)) in enumerate(row):
            idx = supervisors.index(sup)
            px = x + ci * (panel_w + GAP) if cols > 1 else x
            _render_panel(img, draw, px, yy, panel_w, sup, team_rso, team_bp, idx, days_remaining)
        yy += row_h + GAP
    return yy - GAP


async def build_ga_live_report_image(db: AsyncSession, house_id: int) -> bytes:
    """Build the full GA live report as a PNG image."""
    today = now_naive().date()
    house, data, summary = await _load_report_data(db, house_id, today)
    return _render_image(house, data, summary, today)