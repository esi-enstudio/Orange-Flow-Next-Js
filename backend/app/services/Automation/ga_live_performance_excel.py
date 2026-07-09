import io
from datetime import date, timedelta
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

from app.models.live_activation import LiveActivation
from app.models.activation import Activation
from app.models.retailer import Retailer
from app.models.employee import Employee
from app.models.user import User
from app.models.bp_retailer_code import BpRetailerCode
from app.models.ga_filter import RetailerFilter, FilterTag
from app.models.ga_section_config import GaSectionConfig
from app.utils.activation_rules import exclude_clause

# ── Style constants (matching frontend activations export) ──
HEADER_BG = "1E293B"
SUBHEADER_BG = "F1F5F9"
ROW_ALT = "F8FAFC"
BORDER_COLOR = "E2E8F0"
TEXT_DARK = "1E293B"
TEXT_MUTED = "64748B"

THIN_BORDER = Border(
    left=Side(style='thin', color=BORDER_COLOR),
    right=Side(style='thin', color=BORDER_COLOR),
    top=Side(style='thin', color=BORDER_COLOR),
    bottom=Side(style='thin', color=BORDER_COLOR),
)
HEADER_FILL = PatternFill(start_color=HEADER_BG, end_color=HEADER_BG, fill_type="solid")
SUBHEADER_FILL = PatternFill(start_color=SUBHEADER_BG, end_color=SUBHEADER_BG, fill_type="solid")
ROW_ALT_FILL = PatternFill(start_color=ROW_ALT, end_color=ROW_ALT, fill_type="solid")

HEADER_FONT = Font(name="Calibri", bold=True, color="FFFFFF", size=10)
SUBHEADER_FONT = Font(name="Calibri", bold=True, color=TEXT_DARK, size=10)
TITLE_FONT = Font(name="Calibri", bold=True, color=TEXT_DARK, size=14)
SUBTITLE_FONT = Font(name="Calibri", color=TEXT_MUTED, size=10)
BODY_FONT = Font(name="Calibri", color=TEXT_DARK, size=10)
BOLD_FONT = Font(name="Calibri", bold=True, color=TEXT_DARK, size=10)


async def _load_export_section_configs(db: AsyncSession, house_id: int) -> dict[str, dict]:
    result = await db.execute(
        select(GaSectionConfig).where(GaSectionConfig.house_id == house_id)
    )
    configs: dict[str, dict] = {}
    for cfg in result.scalars().all():
        configs[cfg.section_key] = {
            "exclude_product_codes": cfg.exclude_product_codes or [],
            "exclude_retailer_tags": cfg.exclude_retailer_tags or [],
            "selected_employee_ids": cfg.selected_employee_ids or [],
        }
    return configs


async def _get_excluded_retailer_ids_by_tags(
    db: AsyncSession, house_id: int, tag_names: list[str]
) -> set[int]:
    excluded: set[int] = set()
    for tag_name in tag_names:
        result = await db.execute(
            select(RetailerFilter.retailer_id)
            .join(FilterTag, RetailerFilter.tag_id == FilterTag.id)
            .where(FilterTag.name == tag_name, RetailerFilter.house_id == house_id)
        )
        excluded |= {row[0] for row in result.all()}
    return excluded


def _apply_exclusions_to_query(query, model, exclude_product_codes: list[str], excluded_retailer_ids: set[int]):
    if exclude_product_codes:
        clause = exclude_clause(model, set(exclude_product_codes))
        if clause is not None:
            query = query.where(clause)
    if excluded_retailer_ids:
        query = query.where(
            and_(
                model.retailer_id != None,
                model.retailer_id.notin_(excluded_retailer_ids),
            )
        )
    return query


def _build_sheet(ws, title_text, subtitle_text, headers, rows, numeric_cols):
    nc = len(headers)

    # Row 1: Title (merged across all columns)
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=nc)
    c = ws.cell(row=1, column=1, value=title_text)
    c.font = TITLE_FONT
    c.alignment = Alignment(vertical="center", horizontal="left")
    for ci in range(1, nc + 1):
        ws.cell(row=1, column=ci).border = THIN_BORDER

    # Row 2: Subtitle (merged across all columns)
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=nc)
    c = ws.cell(row=2, column=1, value=subtitle_text)
    c.font = SUBTITLE_FONT
    c.alignment = Alignment(vertical="center", horizontal="left")
    for ci in range(1, nc + 1):
        ws.cell(row=2, column=ci).border = THIN_BORDER

    # Row 4: Column headers
    hr = 4
    for ci, h in enumerate(headers, 1):
        c = ws.cell(row=hr, column=ci, value=h)
        c.font = SUBHEADER_FONT
        c.fill = SUBHEADER_FILL
        c.alignment = Alignment(horizontal="center", vertical="center")
        c.border = THIN_BORDER

    # Data rows (starting at row 5)
    dr = hr + 1
    totals = [0] * nc
    for ri, row_data in enumerate(rows):
        alt = ri % 2 == 1
        for ci, val in enumerate(row_data, 1):
            c = ws.cell(row=dr, column=ci, value=val)
            c.font = BODY_FONT
            c.border = THIN_BORDER
            c.alignment = Alignment(
                horizontal="left" if ci == 1 else "center",
                vertical="center"
            )
            if alt:
                c.fill = ROW_ALT_FILL
            if isinstance(val, (int, float)):
                totals[ci - 1] += val
        dr += 1

    # Total row
    for ci in range(1, nc + 1):
        c = ws.cell(row=dr, column=ci)
        c.font = BOLD_FONT
        c.border = THIN_BORDER
        c.alignment = Alignment(
            horizontal="left" if ci == 1 else "center",
            vertical="center"
        )
        if ci == 1:
            c.value = "Total"
        elif ci in numeric_cols:
            c.value = totals[ci - 1]

    # Column widths
    for ci in range(1, nc + 1):
        col_letter = chr(64 + ci)
        ws.column_dimensions[col_letter].width = 20


async def export_ga_live_performance_excel(
    db: AsyncSession,
    house_id: int,
    today: date,
) -> bytes:
    yesterday = today - timedelta(days=1)

    section_configs = await _load_export_section_configs(db, house_id)

    exclude_products_total: list[str] = []
    exclude_tags_total: list[str] = []

    for section_key in ["total_activation", "distribution", "supervisors", "rsos", "bps"]:
        cfg = section_configs.get(section_key)
        if cfg:
            exclude_products_total.extend(cfg["exclude_product_codes"])
            exclude_tags_total.extend(cfg["exclude_retailer_tags"])

    excluded_retailer_ids = await _get_excluded_retailer_ids_by_tags(db, house_id, exclude_tags_total)

    emp_rows = await db.execute(
        select(Employee.id, Employee.user_id, Employee.dms_code, Employee.itop_number,
               Employee.personal_number, Employee.assisted_retailer_code, Employee.pool_number,
               Employee.employee_type)
        .where(Employee.house_id == house_id, Employee.status == "Active")
    )
    all_employees = emp_rows.all()

    user_ids = [e.user_id for e in all_employees if e.user_id]
    user_name_map: dict[int, str] = {}
    if user_ids:
        users_res = await db.execute(select(User.id, User.name).where(User.id.in_(user_ids)))
        for uid, uname in users_res.all():
            user_name_map[uid] = uname

    ret_rows = await db.execute(
        select(Retailer.id, Retailer.retailer_code, Retailer.name, Retailer.employee_id)
        .where(Retailer.house_id == house_id)
    )
    retailers = ret_rows.all()
    emp_retailer_map: dict[int, set[int]] = {}
    for r in retailers:
        if r.employee_id:
            emp_retailer_map.setdefault(r.employee_id, set()).add(r.id)

    bp_code_rows = await db.execute(
        select(BpRetailerCode.bp_employee_id, BpRetailerCode.retailer_code)
        .where(BpRetailerCode.house_id == house_id)
    )
    bp_code_map: dict[int, list[str]] = {}
    all_bp_codes: set[str] = set()
    for bp_emp_id, r_code in bp_code_rows.all():
        bp_code_map.setdefault(bp_emp_id, []).append(r_code)
        all_bp_codes.add(r_code)

    rso_list = [e for e in all_employees if e.employee_type == "rso"]
    bp_list = [e for e in all_employees if e.employee_type == "bp"]
    sup_list = [e for e in all_employees if e.employee_type == "supervisor"]

    async def _today_count(retailer_ids: set[int], bp_filter: bool = True):
        if not retailer_ids:
            return 0
        q = select(func.count()).where(
            LiveActivation.retailer_id.in_(retailer_ids),
            LiveActivation.house_id == house_id,
        )
        q = _apply_exclusions_to_query(q, LiveActivation, exclude_products_total, excluded_retailer_ids)
        if bp_filter and all_bp_codes:
            q = q.where(LiveActivation.retailer_code.notin_(all_bp_codes))
        res = await db.execute(q)
        return res.scalar() or 0

    async def _today_own_count(retailer_ids: set[int], code: str | None, bp_filter: bool = True):
        if not retailer_ids or not code:
            return 0
        q = select(func.count()).where(
            and_(
                LiveActivation.retailer_code == code,
                LiveActivation.retailer_id.in_(retailer_ids),
            ),
            LiveActivation.house_id == house_id,
        )
        q = _apply_exclusions_to_query(q, LiveActivation, exclude_products_total, excluded_retailer_ids)
        if bp_filter and all_bp_codes:
            q = q.where(LiveActivation.retailer_code.notin_(all_bp_codes))
        res = await db.execute(q)
        return res.scalar() or 0

    async def _yesterday_count(retailer_ids: set[int], bp_filter: bool = True):
        if not retailer_ids:
            return 0
        q = select(func.count()).where(
            Activation.retailer_id.in_(retailer_ids),
            Activation.house_id == house_id,
            Activation.activation_date == yesterday,
        )
        q = _apply_exclusions_to_query(q, Activation, exclude_products_total, excluded_retailer_ids)
        if bp_filter and all_bp_codes:
            q = q.where(Activation.retailer_code.notin_(all_bp_codes))
        res = await db.execute(q)
        return res.scalar() or 0

    async def _yesterday_own_count(retailer_ids: set[int], code: str | None, bp_filter: bool = True):
        if not retailer_ids or not code:
            return 0
        q = select(func.count()).where(
            and_(
                Activation.retailer_code == code,
                Activation.retailer_id.in_(retailer_ids),
            ),
            Activation.house_id == house_id,
            Activation.activation_date == yesterday,
        )
        q = _apply_exclusions_to_query(q, Activation, exclude_products_total, excluded_retailer_ids)
        if bp_filter and all_bp_codes:
            q = q.where(Activation.retailer_code.notin_(all_bp_codes))
        res = await db.execute(q)
        return res.scalar() or 0

    async def _bp_today(codes: list[str]):
        if not codes:
            return 0
        q = select(func.count()).where(
            LiveActivation.retailer_code.in_(codes),
            LiveActivation.house_id == house_id,
        )
        q = _apply_exclusions_to_query(q, LiveActivation, exclude_products_total, excluded_retailer_ids)
        res = await db.execute(q)
        return res.scalar() or 0

    async def _bp_yesterday(codes: list[str]):
        if not codes:
            return 0
        q = select(func.count()).where(
            Activation.retailer_code.in_(codes),
            Activation.house_id == house_id,
            Activation.activation_date == yesterday,
        )
        q = _apply_exclusions_to_query(q, Activation, exclude_products_total, excluded_retailer_ids)
        res = await db.execute(q)
        return res.scalar() or 0

    # ── Build Excel ──
    wb = Workbook()
    date_str = str(today)

    # ── Sheet 1: RSO Report ──
    ws_rso = wb.active
    ws_rso.title = "RSO Report"
    rso_headers = [
        "Name", "ITop Number", "Assisted Code",
        "Today Own", "Today Market", "Today Total",
        "Yesterday Own", "Yesterday Market", "Yesterday Total",
    ]
    rso_numeric_cols = {4, 5, 6, 7, 8, 9}
    rso_rows = []
    for e in rso_list:
        emp_id = e.id
        ret_ids = emp_retailer_map.get(emp_id, set())
        code = e.assisted_retailer_code
        t_own = await _today_own_count(ret_ids, code)
        t_total = await _today_count(ret_ids)
        y_own = await _yesterday_own_count(ret_ids, code)
        y_total = await _yesterday_count(ret_ids)
        user_name = user_name_map.get(e.user_id) if e.user_id else ""
        rso_rows.append([
            user_name or e.dms_code or f"#{emp_id}",
            e.itop_number or "",
            code or "",
            t_own,
            t_total - t_own,
            t_total,
            y_own,
            y_total - y_own,
            y_total,
        ])
    _build_sheet(ws_rso, "RSO Performance Report", f"Date: {date_str}", rso_headers, rso_rows, rso_numeric_cols)

    # ── Sheet 2: BP Report ──
    ws_bp = wb.create_sheet("BP Report")
    bp_headers = ["Name", "Pool Number", "Assisted Code", "Today Activation", "Yesterday Activation"]
    bp_numeric_cols = {4, 5}
    bp_rows = []
    for e in bp_list:
        codes = bp_code_map.get(e.id, [])
        if e.assisted_retailer_code and e.assisted_retailer_code not in codes:
            codes.append(e.assisted_retailer_code)
        today_count = await _bp_today(codes)
        yest_count = await _bp_yesterday(codes)
        user_name = user_name_map.get(e.user_id) if e.user_id else ""
        bp_rows.append([
            user_name or e.dms_code or f"#{e.id}",
            e.pool_number or "",
            e.assisted_retailer_code or "",
            today_count,
            yest_count,
        ])
    _build_sheet(ws_bp, "BP Performance Report", f"Date: {date_str}", bp_headers, bp_rows, bp_numeric_cols)

    # ── Sheet 3: Supervisor Report ──
    ws_sup = wb.create_sheet("Supervisor Report")
    sup_headers = ["Name", "Pool Number", "Today Activation", "Yesterday Activation"]
    sup_numeric_cols = {3, 4}
    sup_rows = []
    for e in sup_list:
        ret_ids = emp_retailer_map.get(e.id, set())
        user_name = user_name_map.get(e.user_id) if e.user_id else ""
        today_count = await _today_count(ret_ids, bp_filter=False)
        yest_count = await _yesterday_count(ret_ids, bp_filter=False)
        sup_rows.append([
            user_name or e.dms_code or f"#{e.id}",
            e.pool_number or "",
            today_count,
            yest_count,
        ])
    _build_sheet(ws_sup, "Supervisor Performance Report", f"Date: {date_str}", sup_headers, sup_rows, sup_numeric_cols)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.getvalue()
