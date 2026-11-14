"""SIM Issue report API — `/api/sim-issues/report/*`.

Lives under the `/api/sim-issues` prefix so the `/reports/sim-issues` plan leaf
(`config/modules.py → LEAF_TO_API_PREFIXES`) keeps working for leaf-only plans.
"""
import logging
from datetime import date
from io import BytesIO
from typing import List, Optional, Sequence

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.house import House
from app.models.supervisor_assignment import SupervisorRSOAssignment
from app.models.user import User
from app.routers.deps import get_db, get_house_context, has_permission
from app.services import sim_issue_report_service as svc
from app.services.active_lso_report_service import _house_options, get_employee_profile
from app.utils.access_control import is_admin_user
from app.utils.timezone import now_naive

logger = logging.getLogger("app.routers.sim_issue_report")

router = APIRouter(prefix="/api/sim-issues/report", tags=["SIM Issue Report"])

VALID_STATUSES = ("all", "issued", "pending")
MAX_EXPORT_ROWS = 50000


# ---------------------------------------------------------------- helpers


def _csv_ints(raw: Optional[str]) -> List[int]:
    if not raw:
        return []
    out: List[int] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            out.append(int(part))
        except ValueError:
            continue
    return out


def _csv_strs(raw: Optional[str]) -> List[str]:
    if not raw:
        return []
    return [p.strip() for p in raw.split(",") if p.strip()]


def _resolve_period(
    start_date: Optional[date], end_date: Optional[date]
) -> tuple:
    today = now_naive().date()
    if not start_date and not end_date:
        start_date = date(today.year, today.month, 1)
        end_date = today
    elif not start_date:
        start_date = date(end_date.year, end_date.month, 1)
    elif not end_date:
        end_date = today
    if start_date > end_date:
        raise HTTPException(status_code=400, detail="start_date cannot be after end_date")
    return start_date, end_date


async def _resolve_scope(
    db: AsyncSession,
    current_user: User,
    house_id: Optional[int],
    house_ctx: Optional[int],
) -> tuple:
    """House + employee scope for the caller.

    Returns ``(house_id, allowed_employee_ids | None, accessible_house_ids, role_mode)``.
    A non-super-admin can never open another tenant's house, and RSO/supervisor
    accounts are pinned to their own employee scope.
    """
    role_names = {r.name.strip().lower() for r in current_user.roles}
    emp = await get_employee_profile(db, current_user.id)

    if "rso" in role_names:
        if not emp or emp.employee_type != "rso" or not emp.house_id or emp.status != "Active":
            raise HTTPException(
                status_code=403,
                detail="No active RSO employee profile linked to this account",
            )
        if house_id and house_id != emp.house_id:
            raise HTTPException(status_code=403, detail="Access denied to this house")
        return emp.house_id, [emp.id], [emp.house_id], "rso"

    if "supervisor" in role_names:
        if (
            not emp
            or emp.employee_type != "supervisor"
            or not emp.house_id
            or emp.status != "Active"
        ):
            raise HTTPException(
                status_code=403,
                detail="No active supervisor employee profile linked to this account",
            )
        if house_id and house_id != emp.house_id:
            raise HTTPException(status_code=403, detail="Access denied to this house")
        members = [
            r[0]
            for r in (
                await db.execute(
                    select(SupervisorRSOAssignment.member_employee_id).where(
                        SupervisorRSOAssignment.supervisor_employee_id == emp.id,
                        SupervisorRSOAssignment.house_id == emp.house_id,
                    )
                )
            ).all()
        ]
        return emp.house_id, sorted({emp.id, *members}), [emp.house_id], "supervisor"

    accessible = [h.id for h in current_user.houses]
    if not accessible:
        if not is_admin_user(current_user):
            raise HTTPException(status_code=403, detail="No house assigned to this account")
        accessible = [r[0] for r in (await db.execute(select(House.id))).all()]
    if not accessible:
        raise HTTPException(status_code=403, detail="No house assigned to this account")

    target = house_id or house_ctx or accessible[0]
    if target not in accessible:
        raise HTTPException(status_code=403, detail="You do not have access to this house")
    return target, None, accessible, "admin"


def _pick_employee_ids(
    requested: Sequence[int], allowed: Optional[Sequence[int]]
) -> Optional[List[int]]:
    if allowed is None:
        return list(requested) or None
    if not requested:
        return list(allowed)
    allowed_set = set(allowed)
    picked = [eid for eid in requested if eid in allowed_set]
    if not picked:
        raise HTTPException(
            status_code=403, detail="You do not have access to the selected employees"
        )
    return picked


async def _filters_payload(
    db: AsyncSession,
    current_user: User,
    house_id: Optional[int],
    house_ctx: Optional[int],
) -> dict:
    resolved, allowed, accessible, role_mode = await _resolve_scope(
        db, current_user, house_id, house_ctx
    )
    houses = await _house_options(db, accessible)
    options = await svc.get_filter_options(db, resolved, allowed)
    return {
        "success": True,
        "role_mode": role_mode,
        "houses": houses,
        "employees": options["employees"],
        "products": options["products"],
        "promotions": options["promotions"],
        "defaults": {
            "house_id": resolved,
            "employee_ids": list(allowed) if allowed else [],
        },
        "today": now_naive().date().isoformat(),
    }


# -------------------------------------------------------------- endpoints


@router.get("/filters")
async def sim_issue_report_filters(
    house_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sim_issues.view")),
    house_ctx: Optional[int] = Depends(get_house_context),
):
    return await _filters_payload(db, current_user, house_id, house_ctx)


@router.get("/summary")
async def sim_issue_report_summary(
    house_id: Optional[int] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    employee_ids: Optional[str] = Query(None),
    product_codes: Optional[str] = Query(None),
    promotions: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sim_issues.view")),
    house_ctx: Optional[int] = Depends(get_house_context),
):
    resolved, allowed, _, _ = await _resolve_scope(db, current_user, house_id, house_ctx)
    start_date, end_date = _resolve_period(start_date, end_date)
    picked = _pick_employee_ids(_csv_ints(employee_ids), allowed)
    data = await svc.get_summary(
        db,
        resolved,
        start_date,
        end_date,
        employee_ids=picked,
        product_codes=_csv_strs(product_codes),
        promotions=_csv_strs(promotions),
        search=search,
        today=now_naive().date(),
    )
    return {"success": True, **data}


@router.get("/retailers")
async def sim_issue_report_retailers(
    house_id: Optional[int] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    employee_id: Optional[int] = Query(None),
    employee_ids: Optional[str] = Query(None),
    product_codes: Optional[str] = Query(None),
    promotions: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    status: str = Query("all"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sim_issues.view")),
    house_ctx: Optional[int] = Depends(get_house_context),
):
    if status not in VALID_STATUSES:
        raise HTTPException(
            status_code=400, detail=f"Invalid status. Allowed: {', '.join(VALID_STATUSES)}"
        )
    resolved, allowed, _, _ = await _resolve_scope(db, current_user, house_id, house_ctx)
    start_date, end_date = _resolve_period(start_date, end_date)
    requested = _csv_ints(employee_ids)
    if employee_id:
        requested.append(employee_id)
    picked = _pick_employee_ids(requested, allowed)
    data = await svc.get_retailers(
        db,
        resolved,
        start_date,
        end_date,
        employee_ids=picked,
        product_codes=_csv_strs(product_codes),
        promotions=_csv_strs(promotions),
        search=search,
        status=status,
        page=page,
        per_page=per_page,
    )
    return {"success": True, **data}


@router.get("/details")
async def sim_issue_report_details(
    house_id: Optional[int] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    employee_id: Optional[int] = Query(None),
    employee_ids: Optional[str] = Query(None),
    product_codes: Optional[str] = Query(None),
    promotions: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    retailer_code: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sim_issues.view")),
    house_ctx: Optional[int] = Depends(get_house_context),
):
    resolved, allowed, _, _ = await _resolve_scope(db, current_user, house_id, house_ctx)
    start_date, end_date = _resolve_period(start_date, end_date)
    requested = _csv_ints(employee_ids)
    if employee_id:
        requested.append(employee_id)
    picked = _pick_employee_ids(requested, allowed)
    data = await svc.get_details(
        db,
        resolved,
        start_date,
        end_date,
        employee_ids=picked,
        product_codes=_csv_strs(product_codes),
        promotions=_csv_strs(promotions),
        search=search,
        retailer_code=retailer_code,
        page=page,
        per_page=per_page,
    )
    return {"success": True, **data}


# ---------------------------------------------------------------- export


def _fmt_date(value) -> str:
    return value.strftime("%d %b %Y") if value else ""


def _write_table(
    ws,
    title: str,
    subtitle: str,
    headers: Sequence[str],
    rows: Sequence[Sequence],
    widths: Sequence[int],
) -> None:
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    ws.append([title])
    ws["A1"].font = Font(bold=True, size=14, color="1F4E79")
    ws.append([subtitle])
    ws["A2"].font = Font(size=10, color="666666")
    ws.append([])
    header_row = ws.max_row + 1
    ws.append(list(headers))
    for ci in range(1, len(headers) + 1):
        cell = ws.cell(row=header_row, column=ci)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", start_color="1F4E79")
        cell.alignment = Alignment(horizontal="center")
    for row in rows:
        ws.append(list(row))
    for ci, width in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(ci)].width = width


@router.get("/export")
async def sim_issue_report_export(
    view: str = Query("summary"),
    house_id: Optional[int] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    employee_id: Optional[int] = Query(None),
    employee_ids: Optional[str] = Query(None),
    product_codes: Optional[str] = Query(None),
    promotions: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    status: str = Query("all"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("sim_issues.export")),
    house_ctx: Optional[int] = Depends(get_house_context),
):
    if view not in ("summary", "retailers", "details"):
        raise HTTPException(
            status_code=400, detail="view must be summary, retailers or details"
        )
    from openpyxl import Workbook

    if status not in VALID_STATUSES:
        raise HTTPException(
            status_code=400, detail=f"Invalid status. Allowed: {', '.join(VALID_STATUSES)}"
        )

    resolved, allowed, _, _ = await _resolve_scope(db, current_user, house_id, house_ctx)
    start_date, end_date = _resolve_period(start_date, end_date)
    requested = _csv_ints(employee_ids)
    if employee_id:
        requested.append(employee_id)
    picked = _pick_employee_ids(requested, allowed)
    products = _csv_strs(product_codes)
    promos = _csv_strs(promotions)

    house = await db.get(House, resolved)
    house_name = house.name if house else f"House {resolved}"
    period_label = f"{_fmt_date(start_date)} – {_fmt_date(end_date)}"

    wb = Workbook()
    ws = wb.active
    if view == "summary":
        data = await svc.get_summary(
            db, resolved, start_date, end_date,
            employee_ids=picked, product_codes=products, promotions=promos,
            search=search, today=now_naive().date(),
        )
        ws.title = "Summary"
        _write_table(
            ws,
            f"SIM Issue Summary — {house_name}",
            f"Period: {period_label}",
            [
                "RSO / BP", "Type", "Supervisor", "Code", "Retailers",
                "Issued", "Pending", "SIMs", "Coverage %", "Last Issue",
            ],
            [
                [
                    r["name"] or "Unassigned",
                    (r["employee_type"] or "").upper(),
                    r["supervisor_name"] or "",
                    r["code"] or "",
                    r["retailers_total"],
                    r["retailers_issued"],
                    r["retailers_pending"],
                    r["sims"],
                    r["coverage_pct"],
                    _fmt_date(date.fromisoformat(r["last_issue_date"])) if r["last_issue_date"] else "",
                ]
                for r in data["rows"]
            ],
            [28, 10, 24, 16, 11, 9, 9, 9, 11, 14],
        )
        daily_rows = []
        for r in data["rows"]:
            for point in r["daily"]:
                daily_rows.append(
                    [
                        r["name"] or "Unassigned",
                        (r["employee_type"] or "").upper(),
                        r["code"] or "",
                        _fmt_date(date.fromisoformat(point["date"])),
                        point["sims"],
                        point["retailers"],
                    ]
                )
        ws2 = wb.create_sheet("Daily Breakdown")
        _write_table(
            ws2,
            f"SIM Issue Daily Breakdown — {house_name}",
            f"Period: {period_label}",
            ["RSO / BP", "Type", "Code", "Date", "SIMs", "Retailers"],
            daily_rows,
            [28, 10, 16, 14, 9, 11],
        )
    elif view == "retailers":
        data = await svc.get_retailers(
            db, resolved, start_date, end_date,
            employee_ids=picked, product_codes=products, promotions=promos,
            search=search, status=status, page=1, per_page=MAX_EXPORT_ROWS,
        )
        ws.title = "Retailers"
        _write_table(
            ws,
            f"SIM Issue Retailer Coverage — {house_name}",
            f"Period: {period_label} | Status: {status} | "
            f"Issued {data['issued']} / {data['total']}",
            [
                "RSO / BP", "Supervisor", "Retailer Code", "Retailer Name",
                "iTopUp No", "Status", "SIMs", "First Issue", "Last Issue",
            ],
            [
                [
                    r["employee_name"] or "Unassigned",
                    r["supervisor_name"] or "",
                    r["retailer_code"],
                    r["name"],
                    r["itop_number"] or "",
                    r["status"].upper(),
                    r["sim_count"],
                    _fmt_date(date.fromisoformat(r["first_issue_date"])) if r["first_issue_date"] else "",
                    _fmt_date(date.fromisoformat(r["last_issue_date"])) if r["last_issue_date"] else "",
                ]
                for r in data["rows"]
            ],
            [26, 24, 16, 30, 14, 10, 8, 14, 14],
        )
    else:
        data = await svc.get_details(
            db, resolved, start_date, end_date,
            employee_ids=picked, product_codes=products, promotions=promos,
            search=search, page=1, per_page=MAX_EXPORT_ROWS,
        )
        ws.title = "SIM Details"
        _write_table(
            ws,
            f"SIM Issue Details — {house_name}",
            f"Period: {period_label}",
            [
                "Date", "Retailer Code", "Retailer Name", "RSO / BP", "Type",
                "Product Code", "Product Name", "Promotion", "SIM No",
                "Price", "Cluster", "Distributor",
            ],
            [
                [
                    _fmt_date(date.fromisoformat(r["issue_date"])) if r["issue_date"] else "",
                    r["retailer_code"] or "",
                    r["retailer_name"] or "",
                    r["employee_name"] or "Unassigned",
                    (r["employee_type"] or "").upper(),
                    r["product_code"] or "",
                    r["product_name"] or "",
                    r["promotion"] or "",
                    r["sim_no"] or "",
                    r["selling_price"] if r["selling_price"] is not None else "",
                    r["cluster_market"] or "",
                    r["distributor_name"] or "",
                ]
                for r in data["rows"]
            ],
            [13, 15, 28, 24, 8, 13, 24, 18, 22, 10, 16, 24],
        )

    buf = BytesIO()
    wb.save(buf)
    filename = f"sim_issue_{view}_{start_date:%Y%m%d}_{end_date:%Y%m%d}.xlsx"
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
