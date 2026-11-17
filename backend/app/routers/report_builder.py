"""API endpoints for the registry-driven, house-scoped report builder."""

from datetime import date, datetime, time
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings
from app.models.employee import Employee
from app.models.retailer import Retailer
from app.models.route import RetailerRoute, Route
from app.models.supervisor_assignment import SupervisorRSOAssignment
from app.models.user import User
from app.routers.deps import get_db, has_permission, require_house_context
from app.schemas.report_engine import ReportExportRequest, ReportQueryRequest
from app.services.report_engine.dimensions import DIMENSIONS, DIMENSION_ORDER, SOURCE_DIMENSIONS
from app.services.report_engine.engine import ReportFilter, ReportRequest, ReportSort, run_report
from app.services.report_engine.metrics import METRICS
from app.services.report_engine.scope import resolve_data_scope
from app.services.report_engine.status import STATUS_VALUES
from app.services.report_engine.targets import (
    TargetSourceNotAvailable,
    TargetSourceUnavailableForMetric,
    TargetValueInvalid,
    TargetValueRequired,
)
from app.utils.activity_logger import log_activity

router = APIRouter(prefix="/api/v1/report-builder", tags=["report-builder"])
PHASE_1_TARGET_SOURCES = ("house", "custom", "none")


def _error(
    code: str,
    message: str,
    fields: dict | None = None,
    *,
    status_code: int = 422,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "success": False,
            "error": {
                "code": code,
                "error_code": code.lower(),
                "message": message,
                "fields": fields or {},
            },
        },
    )


def _engine_request(payload: ReportQueryRequest) -> ReportRequest:
    return ReportRequest(
        metric=payload.metric,
        date_from=payload.date_from,
        date_to=payload.date_to,
        group_by=payload.group_by,
        filters=ReportFilter(
            retailer_ids=tuple(payload.filters.retailer_ids),
            employee_ids=tuple(payload.filters.employee_ids),
            route_codes=tuple(payload.filters.route_codes),
            supervisor_ids=tuple(payload.filters.supervisor_ids),
        ),
        target_source=payload.target.source,
        custom_value=payload.target.value,
        sort=ReportSort(field=payload.sort.field, order=payload.sort.order),
        page=payload.page,
        per_page=payload.per_page,
    )


def _known_engine_error(error: ValueError) -> JSONResponse:
    args = error.args
    code = str(args[0]) if args else "VALIDATION_ERROR"
    message = str(args[1]) if len(args) > 1 else str(error)
    fields = args[2] if len(args) > 2 and isinstance(args[2], dict) else {}
    if code == "CROSS_HOUSE_REFERENCE":
        return _error(code, message, fields, status_code=403)
    if code not in {
        "UNKNOWN_METRIC",
        "GROUP_BY_MULTI_UNSUPPORTED",
        "TARGET_SOURCE_UNAVAILABLE_FOR_METRIC",
        "TARGET_SOURCE_INCOMPATIBLE",
        "TARGET_SOURCE_NOT_AVAILABLE",
    }:
        return _error("VALIDATION_ERROR", message, fields)
    return _error(code, message, fields)


def _validate_payload(payload: ReportQueryRequest) -> JSONResponse | None:
    if payload.house_id is not None:
        return _error(
            "HOUSE_ID_IN_BODY",
            "House scope must be supplied with the X-House-ID header",
            {"house_id": "Do not include house_id in the request body"},
        )
    if payload.date_to < payload.date_from:
        return _error(
            "VALIDATION_ERROR",
            "date_to must not be earlier than date_from",
            {"date_to": "Must be on or after date_from"},
        )
    if not payload.group_by:
        return _error(
            "VALIDATION_ERROR",
            "Choose one grouping dimension",
            {"group_by": "At least one dimension is required"},
        )
    if len(payload.group_by) > 1:
        return _error(
            "GROUP_BY_MULTI_UNSUPPORTED",
            "Phase 1 accepts exactly one group_by dimension",
            {"group_by": "Choose exactly one dimension"},
        )
    if payload.metric not in METRICS:
        return _error(
            "VALIDATION_ERROR",
            f"Unknown metric {payload.metric}",
            {"metric": "Choose a supported metric"},
        )
    if payload.target.percent is not None or payload.target.proration:
        fields = {}
        if payload.target.percent is not None:
            fields["target.percent"] = "Percentage targets are not available in phase 1"
        if payload.target.proration:
            fields["target.proration"] = "Target proration is not available in phase 1"
        return _error("VALIDATION_ERROR", "Target adjustment is not available in phase 1", fields)
    return None


@router.get("/options")
async def report_builder_options(
    current_user: User = Depends(has_permission("report_builder.view")),
):
    metrics = []
    matrix: dict[str, dict[str, list[str]]] = {}
    for metric in METRICS.values():
        sources = [source for source in PHASE_1_TARGET_SOURCES if source in metric.supported_sources]
        metrics.append({
            "key": metric.key,
            "label_en": metric.label_en,
            "label_bn": metric.label_bn,
            "value_type": metric.value_type,
            "target_sources": sources,
        })
        matrix[metric.key] = {
            source: [
                dimension for dimension in DIMENSION_ORDER
                if dimension in SOURCE_DIMENSIONS.get(source, frozenset())
            ]
            for source in sources
        }

    return {
        "metrics": metrics,
        "dimensions": [
            {
                "key": dim.key,
                "label_en": dim.label_en,
                "label_bn": dim.label_bn,
            }
            for dim in (DIMENSIONS[key] for key in DIMENSION_ORDER)
        ],
        "matrix": matrix,
        "statuses": list(STATUS_VALUES),
        "export_sync_max_rows": settings.REPORT_EXPORT_SYNC_MAX_ROWS,
    }


@router.get("/filter-options")
async def report_builder_filter_options(
    type: Literal["retailer", "employee", "supervisor", "route"] = Query(...),
    search: str | None = Query(None, max_length=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("report_builder.view")),
    house_id: int = Depends(require_house_context),
):
    scope = await resolve_data_scope(db, user=current_user, house_id=house_id)
    pattern = f"%{search.strip()}%" if search and search.strip() else None
    if type == "retailer":
        query = select(Retailer.id, Retailer.name, Retailer.retailer_code).where(
            Retailer.house_id == house_id
        )
        if scope.condition is not None:
            query = query.where(scope.condition)
        if pattern:
            query = query.where(or_(Retailer.name.ilike(pattern), Retailer.retailer_code.ilike(pattern)))
        result = await db.execute(query.order_by(Retailer.name, Retailer.id).limit(20))
        return [
            {"id": row.id, "label": row.name, "sublabel": row.retailer_code}
            for row in result.all()
        ]

    if type == "employee":
        query = (
            select(Employee.id, Employee.employee_name, Employee.dms_code)
            .join(Retailer, Retailer.employee_id == Employee.id)
            .where(Employee.house_id == house_id, Retailer.house_id == house_id)
            .distinct()
        )
        if scope.condition is not None:
            query = query.where(scope.condition)
        if pattern:
            query = query.where(or_(Employee.employee_name.ilike(pattern), Employee.dms_code.ilike(pattern)))
        result = await db.execute(
            query.order_by(Employee.employee_name, Employee.id).limit(20)
        )
        return [
            {"id": row.id, "label": row.employee_name or row.dms_code or str(row.id), "sublabel": row.dms_code}
            for row in result.all()
        ]

    if type == "supervisor":
        query = (
            select(Employee.id, Employee.employee_name, Employee.dms_code)
            .join(
                SupervisorRSOAssignment,
                SupervisorRSOAssignment.supervisor_employee_id == Employee.id,
            )
            .join(
                Retailer,
                Retailer.employee_id == SupervisorRSOAssignment.member_employee_id,
            )
            .where(
                Employee.house_id == house_id,
                SupervisorRSOAssignment.house_id == house_id,
                Retailer.house_id == house_id,
            )
            .distinct()
        )
        if scope.condition is not None:
            query = query.where(scope.condition)
        if pattern:
            query = query.where(or_(Employee.employee_name.ilike(pattern), Employee.dms_code.ilike(pattern)))
        result = await db.execute(
            query.order_by(Employee.employee_name, Employee.id).limit(20)
        )
        return [
            {"id": row.id, "label": row.employee_name or row.dms_code or str(row.id), "sublabel": row.dms_code}
            for row in result.all()
        ]

    today = date.today()
    now_start = datetime.combine(today, time.min)
    query = (
        select(Route.id, Route.code, Route.name)
        .join(RetailerRoute, RetailerRoute.route_id == Route.id)
        .join(Retailer, Retailer.id == RetailerRoute.retailer_id)
        .where(
            Route.house_id == house_id,
            Route.is_deleted.is_(False),
            Route.is_active.is_(True),
            RetailerRoute.status == "active",
            RetailerRoute.is_primary.is_(True),
            RetailerRoute.effective_from <= datetime.combine(today, time.max),
            or_(RetailerRoute.effective_to.is_(None), RetailerRoute.effective_to >= now_start),
            Retailer.house_id == house_id,
        )
        .distinct()
    )
    if scope.condition is not None:
        query = query.where(scope.condition)
    if pattern:
        query = query.where(or_(Route.code.ilike(pattern), Route.name.ilike(pattern)))
    result = await db.execute(query.order_by(Route.code, Route.id).limit(20))
    return [
        {"id": row.code, "label": row.code, "sublabel": row.name}
        for row in result.all()
    ]


@router.post("/query")
async def query_report_builder(
    payload: ReportQueryRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("report_builder.view")),
    house_id: int = Depends(require_house_context),
):
    invalid = _validate_payload(payload)
    if invalid is not None:
        return invalid
    request_data = _engine_request(payload)
    try:
        result = await run_report(
            db, user=current_user, house_id=house_id, req=request_data
        )
    except TargetValueRequired as error:
        return _error("TARGET_VALUE_REQUIRED", str(error), {"target.value": str(error)})
    except TargetValueInvalid as error:
        return _error("TARGET_VALUE_INVALID", str(error), {"target.value": str(error)})
    except TargetSourceUnavailableForMetric as error:
        return _error(
            "TARGET_SOURCE_UNAVAILABLE_FOR_METRIC",
            str(error),
            {"target.source": str(error)},
        )
    except TargetSourceNotAvailable as error:
        return _error("TARGET_SOURCE_NOT_AVAILABLE", str(error), {"target.source": str(error)})
    except ValueError as error:
        return _known_engine_error(error)

    result.pop("all_rows", None)
    return {"success": True, **result}


@router.post("/export")
async def export_report_builder(
    payload: ReportExportRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("report_builder.export")),
    _view_user: User = Depends(has_permission("report_builder.view")),
    house_id: int = Depends(require_house_context),
):
    invalid = _validate_payload(payload)
    if invalid is not None:
        return invalid

    from app.services.report_engine.excel import build_report_workbook

    try:
        result = await run_report(
            db, user=current_user, house_id=house_id, req=_engine_request(payload)
        )
    except TargetValueRequired as error:
        return _error("TARGET_VALUE_REQUIRED", str(error), {"target.value": str(error)})
    except TargetValueInvalid as error:
        return _error("TARGET_VALUE_INVALID", str(error), {"target.value": str(error)})
    except TargetSourceUnavailableForMetric as error:
        return _error(
            "TARGET_SOURCE_UNAVAILABLE_FOR_METRIC",
            str(error),
            {"target.source": str(error)},
        )
    except TargetSourceNotAvailable as error:
        return _error("TARGET_SOURCE_NOT_AVAILABLE", str(error), {"target.source": str(error)})
    except ValueError as error:
        return _known_engine_error(error)

    rows = result["all_rows"]
    if len(rows) > settings.REPORT_EXPORT_SYNC_MAX_ROWS:
        return _error(
            "EXPORT_TOO_LARGE",
            f"Report has {len(rows)} grouped rows; narrow the date range or filters.",
            {"rows": f"Maximum is {settings.REPORT_EXPORT_SYNC_MAX_ROWS}"},
        )

    from app.utils.timezone import now_naive

    workbook = build_report_workbook(
        meta=result["meta"],
        rows=rows,
        summary=result["summary"],
        warnings=result["warnings"],
        filters_text=payload.filters.model_dump_json(),
        generated_by=current_user.name,
        generated_at=now_naive(),
    )
    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="report_builder",
        action="export",
        request=request,
    )
    filename = (
        f"report_builder_{payload.metric}_{payload.date_from.isoformat()}_"
        f"{payload.date_to.isoformat()}.xlsx"
    )
    return Response(
        content=workbook,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
