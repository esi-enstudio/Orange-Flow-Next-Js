"""Server-side GA Live Report text builder for WhatsApp chat delivery.

Renders the same report the Excel builder produces (ga_live_whatsapp_excel.py)
as plain text, split into WhatsApp-sized messages so the full report can be
pasted directly into a group instead of sending the .xlsx file.
"""
import math
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.house import House
from app.models.ga_section_config import GaSectionConfig
from app.services.ga_live_service import GaLiveQueryBuilder
from app.services.activation_report_service import ActivationReportService
from app.utils.activation_rules import get_excluded_codes
from app.utils.timezone import now_naive

# Keep each chunk comfortably under WhatsApp's 4096-char limit.
WA_MESSAGE_LIMIT = 3800


def _fmt(n) -> str:
    try:
        return f"{int(n):,}"
    except (TypeError, ValueError):
        return "0"


def _pct(part, whole) -> str:
    try:
        if not whole:
            return "0%"
        pct = round(float(part) / float(whole) * 100, 1)
        return f"{pct}%"
    except (TypeError, ValueError):
        return "0%"


def _table_lines(header: list[str], rows: list[list[str]], widths: list[int]) -> list[str]:
    fmt_header = "  ".join(h.ljust(w)[:w] for h, w in zip(header, widths))
    sep = "  ".join("-" * w for w in widths)
    lines = [fmt_header, sep]
    for row in rows:
        cells = []
        for val, w in zip(row, widths):
            s = str(val)
            cells.append(s.ljust(w)[:w])
        lines.append("  ".join(cells))
    return lines


async def _load_report_data(db: AsyncSession, house_id: int, today: date):
    house_res = await db.execute(select(House).where(House.id == house_id))
    house = house_res.scalar_one_or_none()
    if not house:
        raise ValueError(f"House {house_id} not found")

    builder = GaLiveQueryBuilder(db, house_id, today, today)
    data = await builder.build_all()

    excluded_codes = await get_excluded_codes(db)
    cfg_res = await db.execute(
        select(GaSectionConfig).where(
            GaSectionConfig.house_id == house_id,
            GaSectionConfig.section_key == "total_activation",
        )
    )
    cfg = cfg_res.scalar_one_or_none()
    exclude_tag_names = (cfg.exclude_retailer_tags or []) if cfg else []
    exclude_product_codes = set(excluded_codes)
    if cfg and cfg.exclude_product_codes:
        exclude_product_codes |= set(cfg.exclude_product_codes)

    service = ActivationReportService(
        db,
        house_id,
        today.month,
        today.year,
        exclude_tag_names=exclude_tag_names,
        exclude_product_codes=exclude_product_codes,
    )
    summary = await service.get_summary()
    return house, data, summary


def _render_all(
    house,
    data: dict,
    summary: dict,
    today: date,
) -> list[str]:
    """Render the full report as a list of message chunks."""
    lines: list[str] = []

    month_year = today.strftime("%B %Y")
    date_str = today.strftime("%d %B %Y")
    time_str = now_naive().strftime("%I:%M %p").lstrip("0").replace(" 0", " ")

    total_activations = data["summary"].get("total_activations", 0)
    monthly_target = summary.get("monthly_target", 0)
    achievement = summary.get("achievement", 0)
    ach_pct = summary.get("achievement_percentage", 0)
    remaining = summary.get("remaining", 0)
    daily_required = summary.get("daily_required_with_friday", 0)
    days_remaining = summary.get("days_remaining", 0)

    lines.append(f"*GA Live Report ({month_year})*")
    lines.append(f"House: {house.name or ''} ({house.code or ''})")
    lines.append(f"Generated: {date_str}, {time_str}")
    lines.append("")
    lines.append(f"*Total Activations: {_fmt(total_activations)}*")
    lines.append("")
    lines.append("*DD Summary*")
    lines.append(
        f"Target: {_fmt(monthly_target)} | Ach: {_fmt(achievement)} | "
        f"{_pct(achievement, monthly_target)} | Remain: {_fmt(remaining)} | "
        f"DRR: {_fmt(daily_required)}"
    )
    lines.append("")

    rsos = sorted(data.get("rsos", []), key=lambda x: str(x.get("itop_number") or ""))
    bps = sorted(data.get("bps", []), key=lambda x: str(x.get("pool_number") or ""))
    ccs = sorted(data.get("ccs", []), key=lambda x: str(x.get("name") or ""))
    supervisors = data.get("supervisors", [])

    if rsos:
        lines.append("```")
        lines.append("*RSO PERFORMANCE*")
        rso_header = ["#", "Name", "ITop", "AC", "Trgt", "Own", "Mkt", "Total", "%", "Rem", "YOwn", "YMkt", "YTot"]
        rso_widths = [3, 18, 13, 12, 6, 6, 6, 7, 5, 6, 6, 6, 6]
        rso_rows = []
        for i, item in enumerate(rsos):
            target = (
                math.ceil(item["remaining"] / max(days_remaining, 1))
                if item.get("remaining", 0) > 0
                else 0
            )
            total = item.get("total_activation", 0)
            remain = max(0, target - total)
            rso_rows.append(
                [
                    str(i + 1),
                    str(item.get("name", "")),
                    str(item.get("itop_number", "") or ""),
                    str(item.get("assisted_code", "") or ""),
                    _fmt(target),
                    _fmt(item.get("own_activation", 0)),
                    _fmt(item.get("market_activation", 0)),
                    _fmt(total),
                    _pct(total, target),
                    _fmt(remain),
                    _fmt(item.get("yesterday_own", 0)),
                    _fmt(item.get("yesterday_market", 0)),
                    _fmt(item.get("yesterday_total", 0)),
                ]
            )
        lines.extend(_table_lines(rso_header, rso_rows, rso_widths))
        lines.append("```")
        lines.append("")

    if bps:
        lines.append("```")
        lines.append("*BP PERFORMANCE*")
        bp_header = ["#", "Name", "Pool", "AC", "Trgt", "Ach", "%", "Rem", "YGA"]
        bp_widths = [3, 18, 13, 12, 6, 6, 5, 6, 6]
        bp_rows = []
        for i, item in enumerate(bps):
            target = (
                math.ceil(item["remaining"] / max(days_remaining, 1))
                if item.get("remaining", 0) > 0
                else 0
            )
            ach = item.get("own_activation", 0)
            remain = max(0, target - ach)
            bp_rows.append(
                [
                    str(i + 1),
                    str(item.get("name", "")),
                    str(item.get("pool_number", "") or ""),
                    str(item.get("assisted_code", "") or ""),
                    _fmt(target),
                    _fmt(ach),
                    _pct(ach, target),
                    _fmt(remain),
                    _fmt(item.get("yesterday_activation", 0)),
                ]
            )
        lines.extend(_table_lines(bp_header, bp_rows, bp_widths))
        lines.append("```")
        lines.append("")

    if ccs:
        lines.append("```")
        lines.append("*CC PERFORMANCE*")
        cc_header = ["#", "Name", "AC", "Pool", "TGA", "TotGA", "YGA", "Days"]
        cc_widths = [3, 20, 12, 13, 6, 8, 8, 6]
        cc_rows = [
            [
                str(i + 1),
                str(item.get("name", "")),
                str(item.get("assisted_code", "") or ""),
                str(item.get("pool_number", "") or ""),
                _fmt(item.get("own_activation", 0)),
                _fmt(item.get("total_ga", 0) or 0),
                _fmt(item.get("yesterday_activation", 0) or 0),
                str(item.get("day_count", 0) or 0),
            ]
            for i, item in enumerate(ccs)
        ]
        lines.extend(_table_lines(cc_header, cc_rows, cc_widths))
        lines.append("```")
        lines.append("")

    if supervisors:
        lines.append("```")
        lines.append("*SUPERVISOR PERFORMANCE*")
        sup_header = ["#", "Name", "Pool", "TGA", "YGA"]
        sup_widths = [3, 22, 16, 6, 6]
        sup_rows = [
            [
                str(i + 1),
                str(item.get("name", "")),
                str(item.get("pool_number", "") or ""),
                _fmt(item.get("total_activation", 0)),
                _fmt(item.get("yesterday_total", 0) or 0),
            ]
            for i, item in enumerate(supervisors)
        ]
        lines.extend(_table_lines(sup_header, sup_rows, sup_widths))
        lines.append("```")
        lines.append("")

    return _chunk_lines(lines)


def _chunk_lines(lines: list[str]) -> list[str]:
    """Split rendered lines into WhatsApp-sized message chunks."""
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for line in lines:
        if current and current_len + len(line) + 1 > WA_MESSAGE_LIMIT:
            chunks.append("\n".join(current))
            current = []
            current_len = 0
        current.append(line)
        current_len += len(line) + 1
    if current:
        chunks.append("\n".join(current))
    return chunks


async def build_ga_live_report_text(db: AsyncSession, house_id: int) -> list[str]:
    """Build the full GA live report as a list of WhatsApp-ready text messages."""
    today = now_naive().date()
    house, data, summary = await _load_report_data(db, house_id, today)
    return _render_all(house, data, summary, today)
