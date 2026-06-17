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
from app.utils.activation_rules import get_excluded_codes, exclude_clause

THIN_BORDER = Border(
    left=Side(style='thin'), right=Side(style='thin'),
    top=Side(style='thin'), bottom=Side(style='thin'),
)
HEADER_FILL = PatternFill(start_color="1F4E79", end_color="1F4E79", fill_type="solid")
HEADER_FONT = Font(name="Calibri", bold=True, color="FFFFFF", size=11)
TITLE_FONT = Font(name="Calibri", bold=True, size=14)
SUB_FONT = Font(name="Calibri", size=10, color="555555")
BODY_FONT = Font(name="Calibri", size=10)
BOLD_FONT = Font(name="Calibri", bold=True, size=10)


def _style_header(ws, row, cols):
    for c in range(1, cols + 1):
        cell = ws.cell(row=row, column=c)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = THIN_BORDER


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


async def export_ga_live_performance_excel(
    db: AsyncSession,
    house_id: int,
    today: date,
) -> bytes:
    yesterday = today - timedelta(days=1)

    section_configs = await _load_export_section_configs(db, house_id)

    # Collect exclusion rules from relevant sections
    exclude_products_total: list[str] = []
    exclude_tags_total: list[str] = []

    for section_key in ["total_activation", "distribution", "supervisors", "rsos", "bps"]:
        cfg = section_configs.get(section_key)
        if cfg:
            exclude_products_total.extend(cfg["exclude_product_codes"])
            exclude_tags_total.extend(cfg["exclude_retailer_tags"])

    excluded_retailer_ids = await _get_excluded_retailer_ids_by_tags(db, house_id, exclude_tags_total)

    # ── Employee data ──
    emp_rows = await db.execute(
        select(Employee.id, Employee.user_id, Employee.dms_code, Employee.itop_number,
               Employee.personal_number, Employee.assisted_retailer_code, Employee.pool_number,
               Employee.employee_type)
        .where(Employee.house_id == house_id)
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

    # ── Helper: build counts for an employee's retailers ──
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

    # ── Sheet 1: RSO Report ──
    ws_rso = wb.active
    ws_rso.title = "RSO Report"
    ws_rso.cell(row=1, column=1, value="RSO Performance Report").font = TITLE_FONT
    ws_rso.cell(row=2, column=1, value=f"Date: {today}").font = SUB_FONT
    rso_headers = [
        "Name", "ITop Number", "Assisted Code",
        "Today Own", "Today Market", "Today Total",
        "Yesterday Own", "Yesterday Market", "Yesterday Total",
    ]
    header_row = 4
    for c, h in enumerate(rso_headers, 1):
        ws_rso.cell(row=header_row, column=c, value=h)
    _style_header(ws_rso, header_row, len(rso_headers))

    rso_row = header_row + 1
    totals = [0] * 9
    for e in rso_list:
        emp_id = e.id
        ret_ids = emp_retailer_map.get(emp_id, set())
        code = e.assisted_retailer_code

        t_own = await _today_own_count(ret_ids, code)
        t_total = await _today_count(ret_ids)
        y_own = await _yesterday_own_count(ret_ids, code)
        y_total = await _yesterday_count(ret_ids)

        user_name = user_name_map.get(e.user_id) if e.user_id else ""

        row_data = [
            user_name or e.dms_code or f"#{emp_id}",
            e.itop_number or "",
            code or "",
            t_own,
            t_total - t_own,
            t_total,
            y_own,
            y_total - y_own,
            y_total,
        ]
        for ci, val in enumerate(row_data, 1):
            cell = ws_rso.cell(row=rso_row, column=ci, value=val)
            cell.font = BODY_FONT
            cell.border = THIN_BORDER
            cell.alignment = Alignment(horizontal="left" if ci == 1 else "center", vertical="center")
            if isinstance(val, (int, float)):
                totals[ci - 1] += val
        rso_row += 1

    # Total row
    ws_rso.cell(row=rso_row, column=1, value="Total").font = BOLD_FONT
    ws_rso.cell(row=rso_row, column=1).alignment = Alignment(horizontal="left", vertical="center")
    ws_rso.cell(row=rso_row, column=1).border = THIN_BORDER
    for ci in range(2, len(rso_headers) + 1):
        cell = ws_rso.cell(row=rso_row, column=ci, value=totals[ci - 1])
        cell.font = BOLD_FONT
        cell.border = THIN_BORDER
        cell.alignment = Alignment(horizontal="center", vertical="center")

    for ci in range(1, len(rso_headers) + 1):
        ws_rso.column_dimensions[chr(64 + ci) if ci <= 26 else "A"].width = 18

    # ── Sheet 2: BP Report ──
    ws_bp = wb.create_sheet("BP Report")
    ws_bp.cell(row=1, column=1, value="BP Performance Report").font = TITLE_FONT
    ws_bp.cell(row=2, column=1, value=f"Date: {today}").font = SUB_FONT
    bp_headers = ["Name", "Pool Number", "Assisted Code", "Today Activation", "Yesterday Activation"]
    header_row = 4
    for c, h in enumerate(bp_headers, 1):
        ws_bp.cell(row=header_row, column=c, value=h)
    _style_header(ws_bp, header_row, len(bp_headers))

    bp_row = header_row + 1
    bp_totals = [0, 0]
    for e in bp_list:
        codes = bp_code_map.get(e.id, [])
        if e.assisted_retailer_code and e.assisted_retailer_code not in codes:
            codes.append(e.assisted_retailer_code)
        today_count = await _bp_today(codes)
        yest_count = await _bp_yesterday(codes)
        user_name = user_name_map.get(e.user_id) if e.user_id else ""

        row_data = [user_name or e.dms_code or f"#{e.id}", e.pool_number or "", e.assisted_retailer_code or "", today_count, yest_count]
        for ci, val in enumerate(row_data, 1):
            cell = ws_bp.cell(row=bp_row, column=ci, value=val)
            cell.font = BODY_FONT
            cell.border = THIN_BORDER
            cell.alignment = Alignment(horizontal="center", vertical="center")
            if isinstance(val, (int, float)):
                bp_totals[ci - 4] += val
        bp_row += 1

    for ci in range(1, len(bp_headers) + 1):
        cell = ws_bp.cell(row=bp_row, column=ci)
        cell.font = BOLD_FONT
        cell.border = THIN_BORDER
        cell.alignment = Alignment(horizontal="center", vertical="center")
        if ci == 1:
            cell.value = "Total"
            cell.alignment = Alignment(horizontal="left", vertical="center")
        elif ci >= 4:
            cell.value = bp_totals[ci - 4]

    for ci in range(1, len(bp_headers) + 1):
        ws_bp.column_dimensions[chr(64 + ci) if ci <= 26 else "A"].width = 20

    # ── Sheet 3: Supervisor Report ──
    ws_sup = wb.create_sheet("Supervisor Report")
    ws_sup.cell(row=1, column=1, value="Supervisor Performance Report").font = TITLE_FONT
    ws_sup.cell(row=2, column=1, value=f"Date: {today}").font = SUB_FONT
    sup_headers = ["Name", "Pool Number", "Today Activation", "Yesterday Activation"]
    header_row = 4
    for c, h in enumerate(sup_headers, 1):
        ws_sup.cell(row=header_row, column=c, value=h)
    _style_header(ws_sup, header_row, len(sup_headers))

    sup_row = header_row + 1
    sup_totals = [0, 0]
    for e in sup_list:
        ret_ids = emp_retailer_map.get(e.id, set())
        user_name = user_name_map.get(e.user_id) if e.user_id else ""
        # Supervisor counts without BP filter (they oversee all including BP)
        today_count = await _today_count(ret_ids, bp_filter=False)
        yest_count = await _yesterday_count(ret_ids, bp_filter=False)

        row_data = [user_name or e.dms_code or f"#{e.id}", e.pool_number or "", today_count, yest_count]
        for ci, val in enumerate(row_data, 1):
            cell = ws_sup.cell(row=sup_row, column=ci, value=val)
            cell.font = BODY_FONT
            cell.border = THIN_BORDER
            cell.alignment = Alignment(horizontal="center", vertical="center")
            if isinstance(val, (int, float)):
                sup_totals[ci - 3] += val
        sup_row += 1

    for ci in range(1, len(sup_headers) + 1):
        cell = ws_sup.cell(row=sup_row, column=ci)
        cell.font = BOLD_FONT
        cell.border = THIN_BORDER
        cell.alignment = Alignment(horizontal="center", vertical="center")
        if ci == 1:
            cell.value = "Total"
            cell.alignment = Alignment(horizontal="left", vertical="center")
        elif ci >= 3:
            cell.value = sup_totals[ci - 3]

    for ci in range(1, len(sup_headers) + 1):
        ws_sup.column_dimensions[chr(64 + ci) if ci <= 26 else "A"].width = 22

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.getvalue()
