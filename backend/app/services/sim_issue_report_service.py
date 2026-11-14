"""SIM Issue coverage report service.

Answers two questions the DMS export cannot:

1. Which of an RSO/BP's retailers actually issued a SIM in the period, and which
   are still pending. "Pending" is measured against the eligible retailer base
   only — ``enabled = Yes`` **and** ``sim_seller = Yes``, the same universe the
   Active SSO report uses.
2. Retailer and raw SIM level detail for any date or date range.

Attribution is ``retailers.employee_id`` (the assisted-code rule is already
applied when retailers are linked). A SIM whose retailer is missing from the
master is bucketed as "Unassigned" and never counted as pending.
"""
from datetime import date
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.retailer import Retailer
from app.models.sim_issue import SimIssue
from app.services.active_lso_report_service import employee_options, supervisor_map


def coverage_pct(issued: int, total: int) -> float:
    """Coverage of the eligible retailer base, one decimal."""
    if not total:
        return 0.0
    return round((issued / total) * 100, 1)


def _eligible_conditions(
    house_id: int,
    employee_ids: Optional[Sequence[int]] = None,
    search: Optional[str] = None,
) -> List:
    conditions = [
        Retailer.house_id == house_id,
        Retailer.enabled.ilike("y%"),
        Retailer.sim_seller.ilike("y%"),
    ]
    if employee_ids:
        conditions.append(Retailer.employee_id.in_(list(employee_ids)))
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        conditions.append(
            or_(Retailer.retailer_code.ilike(pattern), Retailer.name.ilike(pattern))
        )
    return conditions


def _sim_conditions(
    house_id: int,
    start_date: date,
    end_date: date,
    product_codes: Sequence[str] = (),
    promotions: Sequence[str] = (),
    search: Optional[str] = None,
) -> List:
    conditions = [
        SimIssue.house_id == house_id,
        SimIssue.issue_date.is_not(None),
        SimIssue.issue_date >= start_date,
        SimIssue.issue_date <= end_date,
    ]
    if product_codes:
        conditions.append(SimIssue.product_code.in_(list(product_codes)))
    if promotions:
        conditions.append(SimIssue.promotion.in_(list(promotions)))
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        conditions.append(
            or_(
                SimIssue.retailer_code.ilike(pattern),
                SimIssue.retailer_name.ilike(pattern),
            )
        )
    return conditions


async def _employee_meta(
    db: AsyncSession,
    house_id: int,
    employee_ids: Iterable[Optional[int]],
    target_month: date,
) -> Dict[int, dict]:
    """Display metadata (name/code/type/supervisor) for owners in one house."""
    ids = sorted({eid for eid in employee_ids if eid})
    if not ids:
        return {}
    rows = (
        await db.execute(
            select(
                Employee.id,
                Employee.employee_name,
                Employee.dms_code,
                Employee.employee_id,
                Employee.employee_type,
            ).where(Employee.id.in_(ids), Employee.house_id == house_id)
        )
    ).all()
    if not rows:
        return {}

    sup_map = await supervisor_map(db, [r[0] for r in rows], target_month)
    sup_names = {
        o["id"]: o["name"]
        for o in await employee_options(db, list(set(sup_map.values())))
    }
    return {
        r[0]: {
            "name": r[1] or r[2] or r[3] or f"EMP-{r[0]}",
            "code": r[3] or r[2],
            "dms_code": r[2],
            "employee_type": (r[4] or "unknown").lower(),
            "supervisor_id": sup_map.get(r[0]),
            "supervisor_name": sup_names.get(sup_map.get(r[0])),
        }
        for r in rows
    }


def _blank_row(employee_id: Optional[int], meta: Optional[dict]) -> dict:
    meta = meta or {}
    return {
        "employee_id": employee_id,
        "name": meta.get("name", ""),
        "code": meta.get("code"),
        "dms_code": meta.get("dms_code"),
        "employee_type": meta.get("employee_type", "unassigned"),
        "supervisor_id": meta.get("supervisor_id"),
        "supervisor_name": meta.get("supervisor_name"),
        "retailers_total": 0,
        "retailers_issued": 0,
        "retailers_pending": 0,
        "sims": 0,
        "coverage_pct": 0.0,
        "last_issue_date": None,
        "daily": {},
        "_last_date": None,
    }


def _finalize_rows(rows: Dict[Optional[int], dict]) -> List[dict]:
    for row in rows.values():
        row["retailers_pending"] = max(0, row["retailers_total"] - row["retailers_issued"])
        row["coverage_pct"] = coverage_pct(row["retailers_issued"], row["retailers_total"])
        row["last_issue_date"] = (
            row["_last_date"].isoformat() if row["_last_date"] else None
        )
        row.pop("_last_date", None)
        row["daily"] = [
            {"date": day.isoformat(), **counts}
            for day, counts in sorted(row["daily"].items())
        ]
    type_order = {"rso": 0, "bp": 1, "bsp": 1, "rbsp": 1, "unassigned": 9}
    return sorted(
        rows.values(),
        key=lambda r: (
            type_order.get(r["employee_type"], 5),
            (r["name"] or "").lower(),
            r["employee_id"] or 0,
        ),
    )


async def get_summary(
    db: AsyncSession,
    house_id: int,
    start_date: date,
    end_date: date,
    employee_ids: Optional[Sequence[int]] = None,
    product_codes: Sequence[str] = (),
    promotions: Sequence[str] = (),
    search: Optional[str] = None,
    today: Optional[date] = None,
) -> dict:
    today = today or date.today()
    target_month = date(start_date.year, start_date.month, 1)

    universe = {
        eid: int(total or 0)
        for eid, total in (
            await db.execute(
                select(Retailer.employee_id, func.count(Retailer.id))
                .where(*_eligible_conditions(house_id, employee_ids, search))
                .group_by(Retailer.employee_id)
            )
        ).all()
    }

    # Distinct eligible retailers that issued at least once in the whole range.
    issued_range = {
        eid: int(count or 0)
        for eid, count in (
            await db.execute(
                select(
                    Retailer.employee_id,
                    func.count(func.distinct(Retailer.retailer_code)),
                )
                .select_from(Retailer)
                .join(SimIssue, SimIssue.retailer_code == Retailer.retailer_code)
                .where(
                    *_eligible_conditions(house_id, employee_ids, search),
                    *_sim_conditions(
                        house_id, start_date, end_date, product_codes, promotions
                    ),
                )
                .group_by(Retailer.employee_id)
            )
        ).all()
    }

    issued_daily = {
        (eid, day): int(count or 0)
        for eid, day, count in (
            await db.execute(
                select(
                    Retailer.employee_id,
                    SimIssue.issue_date,
                    func.count(func.distinct(Retailer.retailer_code)),
                )
                .select_from(Retailer)
                .join(SimIssue, SimIssue.retailer_code == Retailer.retailer_code)
                .where(
                    *_eligible_conditions(house_id, employee_ids, search),
                    *_sim_conditions(
                        house_id, start_date, end_date, product_codes, promotions
                    ),
                )
                .group_by(Retailer.employee_id, SimIssue.issue_date)
            )
        ).all()
    }

    # Raw SIM activity, attributed through the retailer master when possible.
    sims_q = (
        select(Retailer.employee_id, SimIssue.issue_date, func.count(SimIssue.id))
        .select_from(SimIssue)
        .outerjoin(
            Retailer,
            and_(
                Retailer.retailer_code == SimIssue.retailer_code,
                Retailer.house_id == house_id,
            ),
        )
        .where(
            *_sim_conditions(
                house_id,
                start_date,
                end_date,
                product_codes,
                promotions,
                search,
            )
        )
        .group_by(Retailer.employee_id, SimIssue.issue_date)
    )
    if employee_ids:
        sims_q = sims_q.where(Retailer.employee_id.in_(list(employee_ids)))
    sim_rows = (await db.execute(sims_q)).all()

    totals_row = (
        await db.execute(
            select(
                func.count(SimIssue.id),
                func.count(func.distinct(SimIssue.retailer_code)),
            ).where(
                *_sim_conditions(
                    house_id,
                    start_date,
                    end_date,
                    product_codes,
                    promotions,
                    search,
                )
            )
        )
    ).first()

    owner_ids = list(universe.keys()) + [r[0] for r in sim_rows if r[0]]
    meta = await _employee_meta(db, house_id, owner_ids, target_month)

    rows: Dict[Optional[int], dict] = {}

    def row_for(owner_id: Optional[int]) -> dict:
        key = owner_id if owner_id in meta else None
        if key not in rows:
            rows[key] = _blank_row(key, meta.get(key))
        return rows[key]

    for eid, total in universe.items():
        row_for(eid)["retailers_total"] += total
    for eid, issued in issued_range.items():
        row_for(eid)["retailers_issued"] = issued
    for (eid, day), count in issued_daily.items():
        row = row_for(eid)
        row["daily"].setdefault(day, {"sims": 0, "retailers": 0})
        row["daily"][day]["retailers"] += count
    for eid, day, sims in sim_rows:
        row = row_for(eid)
        row["sims"] += int(sims or 0)
        row["daily"].setdefault(day, {"sims": 0, "retailers": 0})
        row["daily"][day]["sims"] += int(sims or 0)
        if row["_last_date"] is None or day > row["_last_date"]:
            row["_last_date"] = day

    finalized = _finalize_rows(rows)

    daily_totals: Dict[str, dict] = {}
    for row in finalized:
        for point in row["daily"]:
            bucket = daily_totals.setdefault(
                point["date"], {"date": point["date"], "sims": 0, "retailers": 0}
            )
            bucket["sims"] += point["sims"]
            bucket["retailers"] += point["retailers"]

    retailer_total = sum(r["retailers_total"] for r in finalized)
    retailer_issued = sum(r["retailers_issued"] for r in finalized)

    return {
        "period": {
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "total_days": (end_date - start_date).days + 1,
            "today": today.isoformat(),
        },
        "totals": {
            "sims": int(totals_row[0] or 0) if totals_row else 0,
            "retailers_total": retailer_total,
            "retailers_issued": retailer_issued,
            "retailers_pending": max(0, retailer_total - retailer_issued),
            "coverage_pct": coverage_pct(retailer_issued, retailer_total),
            "employees": len([r for r in finalized if r["employee_id"]]),
            "days_with_data": len([d for d in daily_totals.values() if d["sims"]]),
        },
        "rows": finalized,
        "daily_totals": sorted(daily_totals.values(), key=lambda d: d["date"]),
    }


async def get_retailers(
    db: AsyncSession,
    house_id: int,
    start_date: date,
    end_date: date,
    employee_ids: Optional[Sequence[int]] = None,
    product_codes: Sequence[str] = (),
    promotions: Sequence[str] = (),
    search: Optional[str] = None,
    status: str = "all",
    page: int = 1,
    per_page: int = 20,
) -> dict:
    sim_sub = (
        select(
            SimIssue.retailer_code.label("retailer_code"),
            func.count(SimIssue.id).label("sim_count"),
            func.min(SimIssue.issue_date).label("first_date"),
            func.max(SimIssue.issue_date).label("last_date"),
        )
        .where(
            *_sim_conditions(
                house_id, start_date, end_date, product_codes, promotions
            )
        )
        .group_by(SimIssue.retailer_code)
        .subquery()
    )

    base = (
        select(
            Retailer.retailer_code,
            Retailer.name,
            Retailer.itop_number,
            Retailer.employee_id,
            Employee.employee_name,
            Employee.dms_code,
            Employee.employee_type,
            func.coalesce(sim_sub.c.sim_count, 0).label("sim_count"),
            sim_sub.c.first_date,
            sim_sub.c.last_date,
        )
        .select_from(Retailer)
        .outerjoin(sim_sub, sim_sub.c.retailer_code == Retailer.retailer_code)
        .outerjoin(
            Employee,
            and_(Employee.id == Retailer.employee_id, Employee.house_id == house_id),
        )
        .where(*_eligible_conditions(house_id, employee_ids, search))
    )

    if status == "issued":
        filtered = base.where(func.coalesce(sim_sub.c.sim_count, 0) > 0)
    elif status == "pending":
        filtered = base.where(func.coalesce(sim_sub.c.sim_count, 0) == 0)
    elif status == "all":
        filtered = base
    else:
        raise ValueError("status must be all, issued or pending")

    total = (
        await db.execute(select(func.count()).select_from(base.subquery()))
    ).scalar() or 0
    issued = (
        await db.execute(
            select(func.count()).select_from(
                base.where(func.coalesce(sim_sub.c.sim_count, 0) > 0).subquery()
            )
        )
    ).scalar() or 0

    page = max(1, page)
    offset = (page - 1) * per_page
    rows = (
        await db.execute(
            filtered.order_by(Retailer.employee_id, Retailer.retailer_code)
            .offset(offset)
            .limit(per_page)
        )
    ).all()

    target_month = date(start_date.year, start_date.month, 1)
    meta = await _employee_meta(
        db, house_id, [r[3] for r in rows if r[3]], target_month
    )

    return {
        "total": int(total),
        "issued": int(issued),
        "pending": max(0, int(total) - int(issued)),
        "page": page,
        "per_page": per_page,
        "rows": [
            {
                "retailer_code": r[0],
                "name": r[1],
                "itop_number": r[2],
                "employee_id": r[3],
                "employee_name": (
                    meta.get(r[3], {}).get("name")
                    or r[4]
                    or r[5]
                    or None
                ),
                "employee_type": meta.get(r[3], {}).get("employee_type"),
                "supervisor_name": meta.get(r[3], {}).get("supervisor_name"),
                "status": "issued" if int(r[7] or 0) > 0 else "pending",
                "sim_count": int(r[7] or 0),
                "first_issue_date": r[8].isoformat() if r[8] else None,
                "last_issue_date": r[9].isoformat() if r[9] else None,
            }
            for r in rows
        ],
    }


async def get_details(
    db: AsyncSession,
    house_id: int,
    start_date: date,
    end_date: date,
    employee_ids: Optional[Sequence[int]] = None,
    product_codes: Sequence[str] = (),
    promotions: Sequence[str] = (),
    search: Optional[str] = None,
    retailer_code: Optional[str] = None,
    page: int = 1,
    per_page: int = 50,
) -> dict:
    conditions = _sim_conditions(
        house_id, start_date, end_date, product_codes, promotions, search
    )
    if retailer_code:
        conditions.append(SimIssue.retailer_code == retailer_code)
    if employee_ids:
        conditions.append(Retailer.employee_id.in_(list(employee_ids)))

    base = (
        select(
            SimIssue.id,
            SimIssue.issue_date,
            SimIssue.retailer_code,
            SimIssue.retailer_name,
            SimIssue.product_code,
            SimIssue.product_name,
            SimIssue.promotion,
            SimIssue.sim_no,
            SimIssue.selling_price,
            SimIssue.cluster_market,
            SimIssue.distributor_name,
            Retailer.employee_id,
            Employee.employee_name,
            Employee.dms_code,
            Employee.employee_type,
        )
        .select_from(SimIssue)
        .outerjoin(
            Retailer,
            and_(
                Retailer.retailer_code == SimIssue.retailer_code,
                Retailer.house_id == house_id,
            ),
        )
        .outerjoin(
            Employee,
            and_(Employee.id == Retailer.employee_id, Employee.house_id == house_id),
        )
        .where(*conditions)
    )

    total = (
        await db.execute(select(func.count()).select_from(base.subquery()))
    ).scalar() or 0

    page = max(1, page)
    offset = (page - 1) * per_page
    rows = (
        await db.execute(
            base.order_by(SimIssue.issue_date.desc(), SimIssue.id.desc())
            .offset(offset)
            .limit(per_page)
        )
    ).all()

    return {
        "total": int(total),
        "page": page,
        "per_page": per_page,
        "rows": [
            {
                "id": r[0],
                "issue_date": r[1].isoformat() if r[1] else None,
                "retailer_code": r[2],
                "retailer_name": r[3],
                "product_code": r[4],
                "product_name": r[5],
                "promotion": r[6],
                "sim_no": r[7],
                "selling_price": float(r[8]) if r[8] is not None else None,
                "cluster_market": r[9],
                "distributor_name": r[10],
                "employee_id": r[11],
                "employee_name": r[12] or r[13] or None,
                "employee_type": (r[14] or "").lower() or None,
            }
            for r in rows
        ],
    }


async def get_filter_options(
    db: AsyncSession,
    house_id: int,
    allowed_employee_ids: Optional[Sequence[int]] = None,
    today: Optional[date] = None,
) -> dict:
    today = today or date.today()
    conditions = [
        Employee.house_id == house_id,
        Employee.status == "Active",
        Employee.employee_type.in_(("rso", "bp")),
    ]
    if allowed_employee_ids is not None:
        conditions.append(Employee.id.in_(list(allowed_employee_ids)))
    employees = (
        await db.execute(
            select(
                Employee.id,
                Employee.employee_name,
                Employee.dms_code,
                Employee.employee_id,
                Employee.employee_type,
            )
            .where(*conditions)
            .order_by(Employee.employee_name)
        )
    ).all()

    sup_map = await supervisor_map(
        db,
        [e[0] for e in employees],
        date(today.year, today.month, 1),
    )
    sup_names = {
        o["id"]: o["name"]
        for o in await employee_options(db, list(set(sup_map.values())))
    }

    products = (
        await db.execute(
            select(
                SimIssue.product_code,
                func.max(SimIssue.product_name),
                func.count(SimIssue.id),
            )
            .where(
                SimIssue.house_id == house_id,
                SimIssue.product_code.is_not(None),
                SimIssue.product_code != "",
            )
            .group_by(SimIssue.product_code)
            .order_by(SimIssue.product_code)
        )
    ).all()

    promotions = (
        await db.execute(
            select(SimIssue.promotion, func.count(SimIssue.id))
            .where(
                SimIssue.house_id == house_id,
                SimIssue.promotion.is_not(None),
                SimIssue.promotion != "",
            )
            .group_by(SimIssue.promotion)
            .order_by(SimIssue.promotion)
        )
    ).all()

    return {
        "employees": [
            {
                "id": e[0],
                "name": e[1] or e[2] or e[3] or f"EMP-{e[0]}",
                "code": e[3] or e[2],
                "dms_code": e[2],
                "employee_type": (e[4] or "unknown").lower(),
                "supervisor_name": sup_names.get(sup_map.get(e[0])),
            }
            for e in employees
        ],
        "products": [
            {"code": p[0], "name": p[1], "count": int(p[2] or 0)} for p in products
        ],
        "promotions": [
            {"value": p[0], "count": int(p[1] or 0)} for p in promotions
        ],
    }
