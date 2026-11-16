"""Route-wise RSO performance report.

Attribution is **as of the activation date**:

* Each activation carries a ``route_code`` snapshot (the retailer's primary
  route at import time).
* Route ownership comes from ``employee_routes`` effective windows, so a route
  that moved from RSO A to RSO B mid-month splits the month correctly and an
  RSO keeps the activations they actually earned.

Two counting modes:

``primary`` (default) — one row per activation through its ``route_code``
snapshot. Totals reconcile with the house total; nothing is double counted.
``all`` — an activation counts for every route the retailer sat on that day.
Per-route numbers stay correct but the report total can exceed the house total
(a multi-route retailer feeds several routes), which is why the toggle exists.
"""
from collections import defaultdict
from datetime import date
from typing import Iterable, Optional

from sqlalchemy import Numeric, and_, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activation import Activation
from app.models.employee import Employee
from app.models.route import EmployeeRoute, RetailerRoute, Route


def _attribution_subquery(
    house_ids: list[int],
    from_date: date,
    to_date: date,
    mode: str,
):
    """Dated attribution rows: activation -> route -> owning RSO."""
    route_effective = [
        func.date(EmployeeRoute.effective_from) <= Activation.activation_date,
        or_(
            EmployeeRoute.effective_to.is_(None),
            func.date(EmployeeRoute.effective_to) > Activation.activation_date,
        ),
    ]

    columns = [
        Activation.id.label("activation_id"),
        Activation.retailer_id.label("retailer_id"),
        Activation.product_code.label("product_code"),
        Activation.selling_price.label("selling_price"),
        Route.id.label("route_id"),
        Route.code.label("route_code"),
        EmployeeRoute.employee_id.label("employee_id"),
    ]

    conditions = [
        Activation.house_id.in_(house_ids),
        Activation.activation_date.isnot(None),
        Activation.activation_date >= from_date,
        Activation.activation_date <= to_date,
    ]

    if mode == "all":
        stmt = (
            select(*columns)
            .select_from(Activation)
            .join(RetailerRoute, RetailerRoute.retailer_id == Activation.retailer_id)
            .join(Route, Route.id == RetailerRoute.route_id)
            .outerjoin(
                EmployeeRoute,
                and_(
                    EmployeeRoute.route_id == Route.id,
                    EmployeeRoute.status.in_(("active", "inactive")),
                    *route_effective,
                ),
            )
            .where(
                *conditions,
                RetailerRoute.status.in_(("active", "inactive")),
                func.date(RetailerRoute.effective_from) <= Activation.activation_date,
                or_(
                    RetailerRoute.effective_to.is_(None),
                    func.date(RetailerRoute.effective_to) > Activation.activation_date,
                ),
            )
        )
    else:
        stmt = (
            select(*columns)
            .select_from(Activation)
            .join(
                Route,
                and_(
                    Route.house_id == Activation.house_id,
                    Route.code == Activation.route_code,
                ),
            )
            .outerjoin(
                EmployeeRoute,
                and_(
                    EmployeeRoute.route_id == Route.id,
                    EmployeeRoute.status.in_(("active", "inactive")),
                    *route_effective,
                ),
            )
            .where(*conditions, Activation.route_code.isnot(None))
        )
    return stmt.subquery()


async def build_rso_route_report(
    db: AsyncSession,
    house_ids: list[int],
    from_date: date,
    to_date: date,
    employee_ids: Optional[Iterable[int]] = None,
    route_ids: Optional[Iterable[int]] = None,
    product_codes: Optional[Iterable[str]] = None,
    mode: str = "primary",
) -> dict:
    """Route-wise activations grouped by owning RSO for the given window."""
    mode = "all" if str(mode).lower() == "all" else "primary"
    if not house_ids:
        return _empty_report(from_date, to_date, mode)

    attribution = _attribution_subquery(house_ids, from_date, to_date, mode)
    employee_ids = [int(eid) for eid in (employee_ids or []) if eid]
    route_ids = [int(rid) for rid in (route_ids or []) if rid]
    product_codes = [code for code in (product_codes or []) if code]

    conditions = []
    if employee_ids:
        conditions.append(attribution.c.employee_id.in_(employee_ids))
    if route_ids:
        conditions.append(attribution.c.route_id.in_(route_ids))
    if product_codes:
        conditions.append(attribution.c.product_code.in_(product_codes))

    amount = func.coalesce(
        func.sum(cast(attribution.c.selling_price, Numeric(14, 2))), 0
    ).label("amount")

    rows_stmt = (
        select(
            Employee.id.label("employee_id"),
            Employee.employee_name,
            Employee.employee_id.label("employee_code"),
            Employee.dms_code,
            attribution.c.route_id,
            attribution.c.route_code,
            func.count(func.distinct(attribution.c.retailer_id)).label("active_retailers"),
            func.count(attribution.c.activation_id).label("activations"),
            amount,
        )
        .select_from(attribution)
        .outerjoin(Employee, Employee.id == attribution.c.employee_id)
        .where(*conditions)
        .group_by(
            Employee.id,
            Employee.employee_name,
            Employee.employee_id,
            Employee.dms_code,
            attribution.c.route_id,
            attribution.c.route_code,
        )
        .order_by(Employee.employee_name, attribution.c.route_code)
    )
    raw_rows = (await db.execute(rows_stmt)).all()

    product_stmt = (
        select(
            attribution.c.employee_id,
            attribution.c.route_id,
            attribution.c.product_code,
            func.count(attribution.c.activation_id).label("activations"),
            func.coalesce(
                func.sum(cast(attribution.c.selling_price, Numeric(14, 2))), 0
            ).label("amount"),
        )
        .select_from(attribution)
        .where(*conditions)
        .group_by(
            attribution.c.employee_id,
            attribution.c.route_id,
            attribution.c.product_code,
        )
        .order_by(func.count(attribution.c.activation_id).desc())
    )
    products: dict[tuple, list] = defaultdict(list)
    for emp_id, route_id, product_code, count, product_amount in (
        await db.execute(product_stmt)
    ).all():
        products[(emp_id, route_id)].append(
            {
                "product_code": product_code or "(none)",
                "activations": int(count or 0),
                "amount": float(product_amount or 0),
            }
        )

    route_ids_in_rows = {row.route_id for row in raw_rows}
    retailer_counts = await _route_retailer_counts(db, route_ids_in_rows)

    data = []
    for row in raw_rows:
        products_for_row = products.get((row.employee_id, row.route_id), [])
        data.append(
            {
                "employee_id": row.employee_id,
                "rso_name": row.employee_name or row.dms_code or "Unassigned",
                "rso_code": row.employee_code or row.dms_code,
                "route_id": row.route_id,
                "route_code": row.route_code,
                "retailer_count": retailer_counts.get(row.route_id, 0),
                "active_retailers": int(row.active_retailers or 0),
                "activations": int(row.activations or 0),
                "amount": float(row.amount or 0),
                "products": products_for_row,
            }
        )

    totals = {
        "activations": sum(item["activations"] for item in data),
        "amount": round(sum(item["amount"] for item in data), 2),
        "retailers": len(
            {
                retailer_id
                for retailer_id in (
                    await db.execute(
                        select(attribution.c.retailer_id)
                        .select_from(attribution)
                        .where(*conditions)
                        .distinct()
                    )
                ).scalars()
                if retailer_id
            }
        ),
        "unassigned_activations": sum(
            item["activations"] for item in data if item["employee_id"] is None
        ),
        "routes": len({item["route_id"] for item in data}),
    }
    no_route_activations = await _no_route_activations(
        db, house_ids, from_date, to_date, product_codes
    )

    return {
        "success": True,
        "mode": mode,
        "from_date": from_date.isoformat(),
        "to_date": to_date.isoformat(),
        "data": data,
        "summary": {
            **totals,
            "no_route_activations": no_route_activations,
        },
    }


async def _route_retailer_counts(
    db: AsyncSession, route_ids: set[int]
) -> dict[int, int]:
    if not route_ids:
        return {}
    rows = await db.execute(
        select(RetailerRoute.route_id, func.count(func.distinct(RetailerRoute.retailer_id)))
        .where(
            RetailerRoute.route_id.in_(route_ids),
            RetailerRoute.status == "active",
        )
        .group_by(RetailerRoute.route_id)
    )
    return {route_id: int(count or 0) for route_id, count in rows.all()}


async def _no_route_activations(
    db: AsyncSession,
    house_ids: list[int],
    from_date: date,
    to_date: date,
    product_codes: list[str],
) -> int:
    conditions = [
        Activation.house_id.in_(house_ids),
        Activation.activation_date >= from_date,
        Activation.activation_date <= to_date,
        or_(Activation.route_code.is_(None), Activation.route_code == ""),
    ]
    if product_codes:
        conditions.append(Activation.product_code.in_(product_codes))
    return (
        await db.execute(
            select(func.count()).select_from(Activation).where(*conditions)
        )
    ).scalar() or 0


def _empty_report(from_date: date, to_date: date, mode: str) -> dict:
    return {
        "success": True,
        "mode": mode,
        "from_date": from_date.isoformat(),
        "to_date": to_date.isoformat(),
        "data": [],
        "summary": {
            "activations": 0,
            "amount": 0.0,
            "retailers": 0,
            "unassigned_activations": 0,
            "routes": 0,
            "no_route_activations": 0,
        },
    }
