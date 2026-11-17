"""Report engine: grouped query over one metric x one dimension x one period.

Turns `(metric, dimension, filters, target, period)` into one SQL aggregate,
then computes target / percentage / status in Python over the aggregated rows.
The working set is bounded by entities (or days), never by raw rows.
"""

from dataclasses import dataclass, field
from datetime import date, datetime, time
from typing import Any

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.employee import Employee
from app.models.itopup_detail import ITopUpDetail
from app.models.retailer import Retailer
from app.models.route import Route, RetailerRoute
from app.models.scratch_card_issue import ScratchCardIssue
from app.models.supervisor_assignment import SupervisorRSOAssignment
from app.models.user import User
from app.services.report_engine.dimensions import DIMENSIONS, SOURCE_DIMENSIONS
from app.services.report_engine.metrics import get_metric, supports_target_source
from app.services.report_engine.scope import resolve_data_scope
from app.services.report_engine.status import compute_status
from app.services.report_engine.targets import PeriodTarget, resolve_period_target


@dataclass(frozen=True)
class ReportFilter:
    retailer_ids: tuple[int, ...] = ()
    employee_ids: tuple[int, ...] = ()
    route_codes: tuple[str, ...] = ()
    supervisor_ids: tuple[int, ...] = ()


@dataclass(frozen=True)
class ReportSort:
    field: str = "achievement"
    order: str = "desc"


@dataclass(frozen=True)
class ReportRequest:
    metric: str
    date_from: date
    date_to: date
    group_by: str
    filters: ReportFilter = field(default_factory=ReportFilter)
    target_source: str = "none"
    custom_value: float | None = None
    sort: ReportSort = field(default_factory=ReportSort)
    page: int = 1
    per_page: int = 50


@dataclass(frozen=True)
class ReportRow:
    key: Any
    label: str
    sublabel: str
    achievement: float | int
    target: float | int | None
    adjusted_target: float | int | None
    percent_applied: float | None
    proration_factor: float | None
    percentage: float | None
    remaining: float | int | None
    status: str
    is_null_bucket: bool


SORTABLE = {
    "key", "label", "achievement", "target", "adjusted_target",
    "percentage", "remaining", "status",
}
STATUS_ORDER = {s: i for i, s in enumerate((
    "achieved", "on_track", "needs_attention", "behind", "no_target", "not_applicable",
))}


def _has_route_code(model: type) -> bool:
    return hasattr(model, "route_code")


def _build_dimension_expressions(model: type, dimension: str, house_id: int, date_to: date):
    """Return (key_expr, label_expr, sublabel_expr, joins, normalize_fn).

    `joins` are callables(query) -> query applying outerjoins.
    `normalize_fn(key, label, sublabel)` -> (key, label, sublabel, is_null_bucket)
    with null-bucket labels filled in.
    """
    dim = DIMENSIONS[dimension]
    owner_emp = aliased(Employee)      # Retailer.employee, the owning RSO/BP
    sup_emp = aliased(Employee)        # supervisor employee
    route_as_of = datetime.combine(date_to, time.max)

    joins: list = []

    if dimension == "rso":
        def rso_joins(q):
            return q.outerjoin(owner_emp, Retailer.employee_id == owner_emp.id)
        key_expr = owner_emp.id
        label_expr = owner_emp.employee_name
        sublabel_expr = owner_emp.dms_code
        joins = [rso_joins]

    elif dimension == "bp":
        def bp_joins(q):
            return q.outerjoin(owner_emp, Retailer.employee_id == owner_emp.id)
        key_expr = case((owner_emp.employee_type == "bp", owner_emp.id), else_=None)
        label_expr = case((owner_emp.employee_type == "bp", owner_emp.employee_name), else_=None)
        sublabel_expr = case((owner_emp.employee_type == "bp", owner_emp.dms_code), else_=None)
        joins = [bp_joins]

    elif dimension == "supervisor":
        def sup_joins(q):
            q = q.outerjoin(owner_emp, Retailer.employee_id == owner_emp.id)
            q = q.outerjoin(
                SupervisorRSOAssignment,
                and_(
                    SupervisorRSOAssignment.member_employee_id == owner_emp.id,
                    SupervisorRSOAssignment.house_id == house_id,
                ),
            )
            q = q.outerjoin(sup_emp, sup_emp.id == SupervisorRSOAssignment.supervisor_employee_id)
            return q
        key_expr = sup_emp.id
        label_expr = sup_emp.employee_name
        sublabel_expr = sup_emp.dms_code
        joins = [sup_joins]

    elif dimension == "retailer":
        key_expr = Retailer.id
        label_expr = Retailer.name
        sublabel_expr = Retailer.retailer_code

    elif dimension == "route":
        if _has_route_code(model):
            def route_joins(q):
                return q.outerjoin(
                    Route,
                    and_(
                        Route.code == model.route_code,
                        Route.house_id == house_id,
                        Route.is_deleted.is_(False),
                    ),
                )
            key_expr = model.route_code
            label_expr = model.route_code
            sublabel_expr = Route.name
            joins = [route_joins]
        else:
            def route_joins(q):
                q = q.outerjoin(
                    RetailerRoute,
                    and_(
                        RetailerRoute.retailer_id == Retailer.id,
                        RetailerRoute.is_primary.is_(True),
                        RetailerRoute.status == "active",
                        RetailerRoute.effective_from <= route_as_of,
                        or_(
                            RetailerRoute.effective_to.is_(None),
                            RetailerRoute.effective_to >= route_as_of,
                        ),
                    ),
                )
                q = q.outerjoin(
                    Route,
                    and_(
                        Route.id == RetailerRoute.route_id,
                        Route.house_id == house_id,
                        Route.is_deleted.is_(False),
                    ),
                )
                return q
            key_expr = Route.code
            label_expr = Route.code
            sublabel_expr = Route.name
            joins = [route_joins]

    elif dimension == "date":
        key_expr = None  # set by caller to the metric date column
        label_expr = None  # set by caller
        sublabel_expr = None

    else:
        raise ValueError(f"unknown dimension {dimension}")

    def make_normalize():
        if dimension == "date":
            def normalize(key, label, sublabel):
                if key is None:
                    return None, dim.null_label_en, "", True
                return key, label, "", False
        else:
            def normalize(key, label, sublabel):
                if key is None:
                    return None, dim.null_label_en, "", True
                return key, label or dim.null_label_en, sublabel or "", False
        return normalize

    return key_expr, label_expr, sublabel_expr, joins, make_normalize()


async def run_report(
    db: AsyncSession,
    *,
    user: User,
    house_id: int,
    req: ReportRequest,
    today: date | None = None,
) -> dict:
    from app.utils.timezone import now_naive

    if today is None:
        today = now_naive().date()

    metric = get_metric(req.metric)
    if metric is None:
        raise ValueError("UNKNOWN_METRIC", f"Unknown metric {req.metric}", {"metric": req.metric})

    dimensions = req.group_by if isinstance(req.group_by, list) else [req.group_by]
    if len(dimensions) != 1:
        raise ValueError(
            "GROUP_BY_MULTI_UNSUPPORTED",
            "Phase 1 accepts exactly one group_by dimension",
            {"group_by": req.group_by},
        )
    dimension = dimensions[0]

    if not supports_target_source(req.metric, req.target_source):
        raise ValueError(
            "TARGET_SOURCE_UNAVAILABLE_FOR_METRIC",
            f"Target source {req.target_source} is not available for metric {req.metric}",
            {"target.source": req.target_source},
        )
    if req.target_source in ("rso", "bp", "supervisor", "retailer_custom"):
        raise ValueError(
            "TARGET_SOURCE_NOT_AVAILABLE",
            f"Target source {req.target_source} is implemented in phase 1b",
            {"target.source": req.target_source},
        )
    if dimension not in SOURCE_DIMENSIONS.get(req.target_source, set()):
        raise ValueError(
            "TARGET_SOURCE_INCOMPATIBLE",
            f"Target source {req.target_source} cannot be combined with grouping by {dimension}",
            {"group_by": dimension},
        )

    # --- scope -----------------------------------------------------------
    scope = await resolve_data_scope(db, user=user, house_id=house_id)

    # --- validate filter ids are in-house (else 403) ---------------------
    warnings: list[dict] = []
    await _validate_filters_in_house(db, house_id, req.filters)

    # --- out-of-scope detection -----------------------------------------
    has_any_filter = any((
        req.filters.retailer_ids, req.filters.employee_ids,
        req.filters.route_codes, req.filters.supervisor_ids,
    ))
    if has_any_filter:
        scope_ids = await _scope_accessible_ids(
            db, scope, house_id, req.filters, date_to=req.date_to
        )
        if not scope_ids:
            warnings.append({
                "code": "FILTER_IDS_OUT_OF_SCOPE",
                "message": "One or more filter ids are outside your data-permission scope",
                "count": 1,
            })

    # --- period target ---------------------------------------------------
    period_target: PeriodTarget = await resolve_period_target(
        db=db,
        source=req.target_source,
        metric_key=req.metric,
        house_id=house_id,
        date_from=req.date_from,
        date_to=req.date_to,
        custom_value=req.custom_value,
    )

    # --- grouped SQL -----------------------------------------------------
    model = metric.model
    date_column = getattr(model, metric.date_column)

    key_expr, label_expr, sublabel_expr, joins, normalize = _build_dimension_expressions(
        model, dimension, house_id, req.date_to
    )
    if dimension == "date":
        key_expr = date_column
        label_expr = date_column

    agg = func.count() if metric.value_type == "count" else func.coalesce(
        func.sum(getattr(model, metric.sum_column)), 0
    )

    from sqlalchemy import literal

    if dimension == "date":
        select_cols = [
            date_column.label("key"),
            date_column.label("label"),
            literal("").label("sublabel"),
            agg.label("achievement"),
        ]
        group_cols = [date_column]
    else:
        select_cols = [
            key_expr.label("key"),
            label_expr.label("label"),
            sublabel_expr.label("sublabel"),
            agg.label("achievement"),
        ]
        group_cols = [key_expr, label_expr, sublabel_expr]

    q = select(*select_cols).select_from(model)
    q = q.outerjoin(Retailer, Retailer.id == model.retailer_id)
    for join_fn in joins:
        q = join_fn(q)

    conditions = [
        model.house_id == house_id,
        date_column >= req.date_from,
        date_column <= req.date_to,
    ]
    for col, val in metric.row_filters:
        conditions.append(getattr(model, col) == val)
    if scope.condition is not None:
        conditions.append(scope.condition)

    # --- dimension-independent filter joins ------------------------------
    need_supervisor_join = dimension != "supervisor" and bool(req.filters.supervisor_ids)
    need_route_join = dimension != "route" and bool(req.filters.route_codes)
    supervisor_join_added = False
    route_join_added = False

    if need_supervisor_join:
        supervisor_filter_owner = aliased(Employee)

        def sup_filter_join(q):
            q = q.outerjoin(
                supervisor_filter_owner,
                Retailer.employee_id == supervisor_filter_owner.id,
            )
            q = q.outerjoin(
                SupervisorRSOAssignment,
                and_(
                    SupervisorRSOAssignment.member_employee_id == supervisor_filter_owner.id,
                    SupervisorRSOAssignment.house_id == house_id,
                ),
            )
            return q
        q = sup_filter_join(q)
        supervisor_join_added = True

    if need_route_join and not _has_route_code(model):
        def route_filter_join(q):
            q = q.outerjoin(
                RetailerRoute,
                and_(
                    RetailerRoute.retailer_id == Retailer.id,
                    RetailerRoute.is_primary.is_(True),
                    RetailerRoute.status == "active",
                    RetailerRoute.effective_from <= datetime.combine(req.date_to, time.max),
                    or_(
                        RetailerRoute.effective_to.is_(None),
                        RetailerRoute.effective_to >= datetime.combine(req.date_to, time.max),
                    ),
                ),
            )
            q = q.outerjoin(
                Route,
                and_(
                    Route.id == RetailerRoute.route_id,
                    Route.house_id == house_id,
                    Route.is_deleted.is_(False),
                ),
            )
            return q
        q = route_filter_join(q)
        route_join_added = True

    # --- filter conditions -----------------------------------------------
    if req.filters.retailer_ids:
        conditions.append(Retailer.id.in_(req.filters.retailer_ids))
    if req.filters.employee_ids:
        conditions.append(Retailer.employee_id.in_(req.filters.employee_ids))
    if req.filters.supervisor_ids:
        col = SupervisorRSOAssignment.supervisor_employee_id
        if supervisor_join_added:
            conditions.append(col.in_(req.filters.supervisor_ids))
        else:
            # dimension IS supervisor: the join already exists via sup_joins
            conditions.append(col.in_(req.filters.supervisor_ids))
    if req.filters.route_codes:
        if _has_route_code(model):
            conditions.append(model.route_code.in_(req.filters.route_codes))
        else:
            conditions.append(Route.code.in_(req.filters.route_codes))

    q = q.where(and_(*conditions)).group_by(*group_cols)

    result = await db.execute(q)
    raw_rows = result.all()

    # --- normalize + compute target/percentage/status --------------------
    rows: list[ReportRow] = []
    row_comparison_suppressed = (dimension == "date" and req.target_source in ("house", "custom"))

    for key, label, sublabel, achievement in raw_rows:
        k, lab, sub, is_null = normalize(key, label, sublabel)
        if dimension == "date" and hasattr(k, "strftime"):
            lab = k.strftime("%d %b %Y")
        ach = int(achievement) if metric.value_type == "count" else round(float(achievement or 0), 2)

        target = period_target.target
        adjusted_target = period_target.adjusted_target

        if req.target_source == "none" or row_comparison_suppressed:
            percentage = None
            status = "not_applicable"
            remaining = None
        else:
            if target is None or target <= 0:
                percentage = None
                status = "no_target"
                remaining = None
            else:
                percentage = round(ach / target * 100, 1)
                remaining = max(round(target - ach, 2), 0)
                status = compute_status(
                    percentage=percentage,
                    target=target,
                    date_from=req.date_from,
                    date_to=req.date_to,
                    today=today,
                )

        rows.append(ReportRow(
            key=k, label=lab, sublabel=sub,
            achievement=ach, target=target, adjusted_target=adjusted_target,
            percent_applied=period_target.percent_applied,
            proration_factor=period_target.proration_factor,
            percentage=percentage, remaining=remaining, status=status,
            is_null_bucket=is_null,
        ))

    # --- sort ------------------------------------------------------------
    sort_field = req.sort.field if req.sort.field in SORTABLE else "achievement"
    sort_order = (req.sort.order or "desc").lower()
    if sort_order not in ("asc", "desc"):
        sort_order = "desc"

    def sort_key(r):
        if sort_field == "status":
            val = STATUS_ORDER.get(r.status, 99)
        elif sort_field == "key":
            return (0 if r.key is None else 1, str(r.key), r.label)
        elif sort_field == "achievement":
            val = r.achievement
        elif sort_field == "target":
            val = r.target if r.target is not None else -1
        elif sort_field == "adjusted_target":
            val = r.adjusted_target if r.adjusted_target is not None else -1
        elif sort_field == "percentage":
            val = r.percentage if r.percentage is not None else -1
        elif sort_field == "remaining":
            val = r.remaining if r.remaining is not None else -1
        else:  # label
            val = r.label
        return (0 if r.key is None else 1, val, r.label)

    reverse = sort_order == "desc"
    rows.sort(key=sort_key, reverse=reverse)

    # --- paginate --------------------------------------------------------
    total = len(rows)
    total_pages = max(1, -(-total // req.per_page)) if total else 1
    page = max(1, min(req.page, total_pages))
    start = (page - 1) * req.per_page
    page_rows = rows[start:start + req.per_page]

    # --- summary ---------------------------------------------------------
    total_ach = sum(r.achievement for r in rows)
    if req.target_source == "none":
        s_target = None
        s_adjusted = None
        s_pct = None
        s_remaining = None
        s_status = "not_applicable"
    else:
        s_target = period_target.target
        s_adjusted = period_target.adjusted_target
        if s_target is None or s_target <= 0:
            s_pct = None
            s_remaining = None
            s_status = "no_target"
        else:
            s_pct = round(total_ach / s_target * 100, 1)
            s_remaining = max(round(s_target - total_ach, 2), 0)
            s_status = compute_status(
                percentage=s_pct,
                target=s_target,
                date_from=req.date_from,
                date_to=req.date_to,
                today=today,
            )

    summary = {
        "achievement": total_ach,
        "target": s_target,
        "adjusted_target": s_adjusted,
        "percent_applied": period_target.percent_applied,
        "proration_factor": period_target.proration_factor,
        "percentage": s_pct,
        "remaining": s_remaining,
        "status": s_status,
        "row_count": total,
    }

    meta = {
        "metric": req.metric,
        "metric_label_en": metric.label_en,
        "metric_label_bn": metric.label_bn,
        "group_by": dimension,
        "dimension_label_en": DIMENSIONS[dimension].label_en,
        "dimension_label_bn": DIMENSIONS[dimension].label_bn,
        "date_from": req.date_from.isoformat(),
        "date_to": req.date_to.isoformat(),
        "target_source": req.target_source,
        "value_type": metric.value_type,
        "target_is_period_level": True,
        "row_comparison_suppressed": row_comparison_suppressed,
    }

    return {
        "data": [
            {
                "key": r.key,
                "label": r.label,
                "sublabel": r.sublabel,
                "achievement": r.achievement,
                "target": r.target,
                "adjusted_target": r.adjusted_target,
                "percent_applied": r.percent_applied,
                "proration_factor": r.proration_factor,
                "percentage": r.percentage,
                "remaining": r.remaining,
                "status": r.status,
                "is_null_bucket": r.is_null_bucket,
            }
            for r in page_rows
        ],
        "summary": summary,
        "pagination": {
            "page": page,
            "per_page": req.per_page,
            "total": total,
            "total_pages": total_pages,
            "has_next": page < total_pages,
            "has_prev": page > 1,
        },
        "meta": meta,
        "warnings": warnings,
        "all_rows": rows,
    }


async def _validate_filters_in_house(db: AsyncSession, house_id: int, filters: ReportFilter) -> None:
    """Reject filter identifiers that refer outside the selected house."""
    for field, ids, model in (
        ("retailer_ids", filters.retailer_ids, Retailer),
        ("employee_ids", filters.employee_ids, Employee),
        ("supervisor_ids", filters.supervisor_ids, Employee),
    ):
        if not ids:
            continue
        result = await db.execute(
            select(model.id).where(model.id.in_(ids), model.house_id == house_id)
        )
        missing = set(ids) - set(result.scalars().all())
        if missing:
            raise ValueError(
                "CROSS_HOUSE_REFERENCE",
                f"{field} reference(s) {sorted(missing)} do not belong to house {house_id}",
                {f"filters.{field}": sorted(missing)},
            )

    if filters.route_codes:
        result = await db.execute(
            select(Route.code).where(
                Route.code.in_(filters.route_codes),
                Route.house_id == house_id,
                Route.is_deleted.is_(False),
            )
        )
        in_house = set(result.scalars().all())
        result = await db.execute(
            select(Route.code).where(
                Route.code.in_(set(filters.route_codes) - in_house),
                Route.house_id != house_id,
                Route.is_deleted.is_(False),
            )
        )
        cross_house = set(result.scalars().all())
        if cross_house:
            raise ValueError(
                "CROSS_HOUSE_REFERENCE",
                f"Route code(s) {sorted(cross_house)} do not belong to house {house_id}",
                {"filters.route_codes": sorted(cross_house)},
            )


async def _scope_accessible_ids(
    db: AsyncSession,
    scope,
    house_id: int,
    filters: ReportFilter,
    *,
    date_to: date,
) -> set:
    """Retailer ids from the filters that are within the user's data-permission scope."""
    accessible: set = set()

    async def add_matching_retailers(query):
        query = query.where(Retailer.house_id == house_id)
        if scope.condition is not None:
            query = query.where(scope.condition)
        result = await db.execute(query)
        accessible.update(result.scalars().all())

    # retailer ids
    if filters.retailer_ids:
        await add_matching_retailers(
            select(Retailer.id).where(Retailer.id.in_(filters.retailer_ids))
        )

    # employee ids (filter by owner employee)
    if filters.employee_ids:
        await add_matching_retailers(
            select(Retailer.id).where(Retailer.employee_id.in_(filters.employee_ids))
        )

    if filters.supervisor_ids:
        await add_matching_retailers(
            select(Retailer.id)
            .join(
                SupervisorRSOAssignment,
                and_(
                    SupervisorRSOAssignment.member_employee_id == Retailer.employee_id,
                    SupervisorRSOAssignment.house_id == house_id,
                ),
            )
            .where(
                SupervisorRSOAssignment.supervisor_employee_id.in_(filters.supervisor_ids)
            )
        )

    if filters.route_codes:
        route_date = datetime.combine(date_to, time.max)
        await add_matching_retailers(
            select(Retailer.id)
            .join(
                RetailerRoute,
                and_(
                    RetailerRoute.retailer_id == Retailer.id,
                    RetailerRoute.is_primary.is_(True),
                    RetailerRoute.status == "active",
                    RetailerRoute.effective_from <= route_date,
                    or_(
                        RetailerRoute.effective_to.is_(None),
                        RetailerRoute.effective_to >= route_date,
                    ),
                ),
            )
            .join(
                Route,
                and_(
                    Route.id == RetailerRoute.route_id,
                    Route.house_id == house_id,
                    Route.is_deleted.is_(False),
                ),
            )
            .where(Route.code.in_(filters.route_codes))
        )

    return accessible
