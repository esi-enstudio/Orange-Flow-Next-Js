import io
import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, UploadFile, File, Form
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.deps import get_db, has_permission, get_house_context
from app.models.user import User
from app.models.house import House
from app.models.ga_report_event import GaReportEvent
from app.models.ga_report_template import GaReportTemplate
from app.models.ga_report_target import GaReportTarget
from app.models.retailer import Retailer
from app.services.ga_report_builder_service import (
    GaReportBuilderService,
    ReportConfig,
    COLUMN_KEYS,
    ACTIVATION_METRICS,
)
from app.services.whatsapp_service_client import (
    whatsapp_service_client,
    WhatsAppServiceError,
)
from app.utils.access_control import is_admin_user
from app.utils.activity_logger import log_activity
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["GA Report Builder"])


async def _resolve_house(
    db: AsyncSession,
    current_user: User,
    q_house_id: Optional[int],
    header_house_id: Optional[int],
) -> Optional[int]:
    if q_house_id and q_house_id != header_house_id:
        if not is_admin_user(current_user):
            user_house_ids = [h.id for h in current_user.houses]
            if q_house_id not in user_house_ids:
                raise HTTPException(status_code=403, detail="You do not have access to this house")
    target_house_id = q_house_id or header_house_id
    if not target_house_id:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            target_house_id = user_house_ids[0]
    if not target_house_id:
        house_res = await db.execute(select(House.id).limit(1))
        target_house_id = house_res.scalar_one_or_none()
    return target_house_id


def _require_house_id(target_house_id: Optional[int]):
    if not target_house_id:
        raise HTTPException(status_code=400, detail="house_id is required")
    return target_house_id


async def _get_owned_event(db: AsyncSession, current_user: User, event_id: int) -> GaReportEvent:
    result = await db.execute(
        select(GaReportEvent).where(
            GaReportEvent.id == event_id,
            GaReportEvent.is_deleted == False,  # noqa: E712
        )
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if not is_admin_user(current_user):
        user_house_ids = [h.id for h in current_user.houses]
        if event.house_id not in user_house_ids:
            raise HTTPException(status_code=403, detail="You do not have access to this event")
    return event


async def _get_owned_template(db: AsyncSession, current_user: User, template_id: int) -> GaReportTemplate:
    result = await db.execute(
        select(GaReportTemplate).where(
            GaReportTemplate.id == template_id,
            GaReportTemplate.is_deleted == False,  # noqa: E712
        )
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    if not is_admin_user(current_user):
        user_house_ids = [h.id for h in current_user.houses]
        if template.house_id not in user_house_ids:
            raise HTTPException(status_code=403, detail="You do not have access to this template")
    return template


async def _replace_event_targets(
    db: AsyncSession,
    event: GaReportEvent,
    target_type: str,
    entries: list,
    current_user: User,
):
    """Replace all targets for an event+type (soft-delete old, insert new)."""
    existing = await db.execute(
        select(GaReportTarget).where(
            GaReportTarget.event_id == event.id,
            GaReportTarget.target_type == target_type,
            GaReportTarget.is_deleted == False,  # noqa: E712
        )
    )
    for t in existing.scalars().all():
        t.is_deleted = True
        t.deleted_at = now_naive()
        t.deleted_by = current_user.id

    for e in entries or []:
        if not isinstance(e, dict):
            continue
        slab = int(e.get("slab") or 1)
        try:
            value = float(e.get("target_value") or 0)
        except (TypeError, ValueError):
            value = 0
        if target_type == "retailer":
            code = str(e.get("retailer_code") or "").strip()
            if not code:
                continue
            db.add(GaReportTarget(
                house_id=event.house_id,
                event_id=event.id,
                target_type=target_type,
                entity_id=e.get("entity_id"),
                retailer_code=code,
                slab=slab,
                target_value=value,
                created_by=current_user.id,
                updated_by=current_user.id,
            ))
        else:
            entity_id = e.get("entity_id")
            if entity_id is None:
                continue
            db.add(GaReportTarget(
                house_id=event.house_id,
                event_id=event.id,
                target_type=target_type,
                entity_id=int(entity_id),
                retailer_code=None,
                slab=slab,
                target_value=value,
                created_by=current_user.id,
                updated_by=current_user.id,
            ))
    await db.commit()


# ------------------------------------------------------------------ schemas


class EventCreate(BaseModel):
    name: str
    start_date: str
    end_date: str
    description: Optional[str] = None
    config: Optional[dict] = None
    targets: Optional[dict] = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        return v

    @field_validator("start_date", "end_date")
    @classmethod
    def _date(cls, v: str) -> str:
        try:
            date.fromisoformat(v)
        except ValueError:
            raise ValueError("dates must be in YYYY-MM-DD format")
        return v


class EventUpdate(BaseModel):
    name: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    description: Optional[str] = None
    config: Optional[dict] = None
    targets: Optional[dict] = None


class TemplateCreate(BaseModel):
    name: str
    event_id: Optional[int] = None
    config: dict = {}

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        return v


class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    event_id: Optional[int] = None
    config: Optional[dict] = None


class ReportPayload(BaseModel):
    house_id: Optional[int] = None
    event_id: Optional[int] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    target_type: Optional[str] = None
    retailer_codes: list[str] = []
    rso_ids: list[int] = []
    bp_ids: list[int] = []
    slabs: Optional[int] = None
    columns: list = []
    filters: dict = {}
    sort_by: Optional[str] = None
    sort_order: str = "desc"
    targets: list = []

    @field_validator("target_type")
    @classmethod
    def _type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("rso", "bp", "retailer"):
            raise ValueError("target_type must be 'rso', 'bp' or 'retailer'")
        return v

    @field_validator("sort_order")
    @classmethod
    def _order(cls, v: str) -> str:
        if v not in ("asc", "desc"):
            raise ValueError("sort_order must be 'asc' or 'desc'")
        return v

    @field_validator("start_date", "end_date")
    @classmethod
    def _date(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        try:
            date.fromisoformat(v)
        except ValueError:
            raise ValueError("dates must be in YYYY-MM-DD format")
        return v


class WhatsAppSendPayload(BaseModel):
    house_id: Optional[int] = None
    event_id: Optional[int] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    retailer_codes: list[str] = []
    rso_ids: list[int] = []
    columns: list = []
    filters: dict = {}
    sort_by: Optional[str] = None
    sort_order: str = "desc"
    whatsapp_chat_id: str
    whatsapp_chat_name: Optional[str] = None
    caption: Optional[str] = None
    format: str = "image"

    @field_validator("format")
    @classmethod
    def _format(cls, v: str) -> str:
        if v not in ("image", "text", "excel"):
            raise ValueError("format must be 'image', 'text' or 'excel'")
        return v


# ------------------------------------------------------------------ columns & entities


@router.get("/ga-report-builder/columns")
async def get_columns(
    current_user: User = Depends(has_permission("ga_report_builder.view")),
):
    return {"success": True, "data": GaReportBuilderService.column_options()}


@router.get("/ga-report-builder/entities")
async def get_entities(
    entity_type: str = Query("retailer", pattern="^(rso|bp|retailer)$"),
    search: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=5000),
    q_house_id: Optional[int] = Query(None, alias="house_id"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ga_report_builder.view")),
    header_house_id: Optional[int] = Depends(get_house_context),
):
    target_house_id = await _resolve_house(db, current_user, q_house_id, header_house_id)
    _require_house_id(target_house_id)
    service = GaReportBuilderService(db, ReportConfig({"house_id": target_house_id}))
    return {"success": True, "data": await service.get_entities(entity_type, search, limit=limit)}


@router.get("/ga-report-builder/exclusions")
async def get_exclusions(
    q_house_id: Optional[int] = Query(None, alias="house_id"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ga_report_builder.view")),
    header_house_id: Optional[int] = Depends(get_house_context),
):
    target_house_id = await _resolve_house(db, current_user, q_house_id, header_house_id)
    _require_house_id(target_house_id)
    service = GaReportBuilderService(db, ReportConfig({"house_id": target_house_id}))
    return {"success": True, "data": await service.get_exclusion_options()}


@router.post("/ga-report-builder/targets/preview")
async def preview_targets_upload(
    file: UploadFile = File(...),
    slab: int = Form(1),
    q_house_id: Optional[int] = Query(None, alias="house_id"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ga_report_builder.create")),
    header_house_id: Optional[int] = Depends(get_house_context),
):
    """Parse a retailer-target Excel file (col 1 = Retailer Code, col 2 = Target).

    Validates retailer codes against the house and returns a preview without
    persisting anything. Actual targets are saved with the event (EventCreate/Update targets).
    """
    target_house_id = await _resolve_house(db, current_user, q_house_id, header_house_id)
    _require_house_id(target_house_id)

    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(await file.read()), data_only=True)
    ws = wb.active
    parsed: list[dict] = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row or len(row) < 2:
            continue
        code = str(row[0]).strip() if row[0] is not None else ""
        if not code:
            continue
        try:
            tval = float(row[1])
        except (TypeError, ValueError):
            tval = None
        parsed.append({"retailer_code": code, "target_value": tval, "valid_target": tval is not None})

    valid_codes: set[str] = set()
    codes = [r["retailer_code"] for r in parsed]
    if codes:
        res = await db.execute(
            select(Retailer.retailer_code).where(
                Retailer.house_id == target_house_id,
                Retailer.retailer_code.in_(codes),
            )
        )
        valid_codes = {row[0] for row in res.all()}
    for r in parsed:
        r["valid_retailer"] = r["retailer_code"] in valid_codes

    matched = sum(1 for r in parsed if r["valid_retailer"] and r["valid_target"])
    return {
        "success": True,
        "data": {
            "slab": slab,
            "rows": parsed,
            "total": len(parsed),
            "matched": matched,
            "invalid": len(parsed) - matched,
        },
    }


# ------------------------------------------------------------------ events


@router.get("/ga-report-builder/events")
async def list_events(
    q_house_id: Optional[int] = Query(None, alias="house_id"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ga_report_builder.view")),
    header_house_id: Optional[int] = Depends(get_house_context),
):
    target_house_id = await _resolve_house(db, current_user, q_house_id, header_house_id)
    query = select(GaReportEvent).where(GaReportEvent.is_deleted == False)  # noqa: E712
    if target_house_id:
        query = query.where(GaReportEvent.house_id == target_house_id)
    query = query.order_by(GaReportEvent.start_date.desc())
    result = await db.execute(query)
    events = result.scalars().all()
    return {
        "success": True,
        "data": [
            {
                "id": e.id,
                "house_id": e.house_id,
                "name": e.name,
                "start_date": e.start_date.isoformat(),
                "end_date": e.end_date.isoformat(),
                "description": e.description,
                "config": e.config or {},
            }
            for e in events
        ],
    }


@router.get("/ga-report-builder/events/{event_id}/targets")
async def get_event_targets(
    event_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ga_report_builder.view")),
):
    await _get_owned_event(db, current_user, event_id)
    result = await db.execute(
        select(GaReportTarget).where(
            GaReportTarget.event_id == event_id,
            GaReportTarget.is_deleted == False,  # noqa: E712
        ).order_by(GaReportTarget.slab.asc())
    )
    return {
        "success": True,
        "data": [
            {
                "id": t.id,
                "target_type": t.target_type,
                "entity_id": t.entity_id,
                "retailer_code": t.retailer_code,
                "slab": t.slab,
                "target_value": t.target_value,
            }
            for t in result.scalars().all()
        ],
    }


@router.post("/ga-report-builder/events")
async def create_event(
    data: EventCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ga_report_builder.create")),
    header_house_id: Optional[int] = Depends(get_house_context),
    q_house_id: Optional[int] = Query(None, alias="house_id"),
):
    target_house_id = await _resolve_house(db, current_user, q_house_id, header_house_id)
    _require_house_id(target_house_id)
    start = date.fromisoformat(data.start_date)
    end = date.fromisoformat(data.end_date)
    if start > end:
        raise HTTPException(status_code=400, detail="start_date cannot be after end_date")

    event = GaReportEvent(
        house_id=target_house_id,
        name=data.name,
        start_date=start,
        end_date=end,
        description=data.description,
        config=data.config or {},
        created_by=current_user.id,
        updated_by=current_user.id,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)

    if data.targets and data.targets.get("target_type"):
        await _replace_event_targets(
            db, event, data.targets["target_type"], data.targets.get("entries") or [], current_user
        )

    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="ga_report_builder",
        action="event.create",
        record_id=event.id,
        record_identifier=event.name,
        new_values={"house_id": event.house_id, "start_date": data.start_date, "end_date": data.end_date},
        request=request,
        status_code=201,
    )
    return {"success": True, "data": {"id": event.id}}


@router.patch("/ga-report-builder/events/{event_id}")
async def update_event(
    event_id: int,
    data: EventUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ga_report_builder.edit")),
):
    event = await _get_owned_event(db, current_user, event_id)
    if event.end_date < now_naive().date():
        raise HTTPException(
            status_code=400,
            detail="Event period has ended and can no longer be edited",
        )
    old_values = {"name": event.name, "start_date": event.start_date.isoformat(), "end_date": event.end_date.isoformat()}
    new_values = dict(old_values)

    if data.name is not None:
        event.name = data.name.strip()
        new_values["name"] = event.name
    if data.description is not None:
        event.description = data.description
    if data.start_date is not None:
        event.start_date = date.fromisoformat(data.start_date)
        new_values["start_date"] = data.start_date
    if data.end_date is not None:
        event.end_date = date.fromisoformat(data.end_date)
        new_values["end_date"] = data.end_date
    if data.config is not None:
        event.config = data.config
        new_values["config"] = data.config
    if event.start_date > event.end_date:
        raise HTTPException(status_code=400, detail="start_date cannot be after end_date")
    event.updated_by = current_user.id
    await db.commit()

    if data.targets and data.targets.get("target_type"):
        await _replace_event_targets(
            db, event, data.targets["target_type"], data.targets.get("entries") or [], current_user
        )

    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="ga_report_builder",
        action="event.edit",
        record_id=event.id,
        record_identifier=event.name,
        old_values=old_values,
        new_values=new_values,
        request=request,
    )
    return {"success": True, "data": {"id": event.id}}


@router.delete("/ga-report-builder/events/{event_id}")
async def delete_event(
    event_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ga_report_builder.delete")),
):
    event = await _get_owned_event(db, current_user, event_id)
    event.is_deleted = True
    event.deleted_at = now_naive()
    event.deleted_by = current_user.id
    await db.commit()

    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="ga_report_builder",
        action="event.delete",
        record_id=event.id,
        record_identifier=event.name,
        old_values={"name": event.name, "start_date": event.start_date.isoformat(), "end_date": event.end_date.isoformat()},
        request=request,
    )
    return {"success": True, "data": {"id": event.id}}


@router.delete("/ga-report-builder/events/{event_id}/permanent")
async def permanent_delete_event(
    event_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ga_report_builder.delete.permanent")),
):
    event = await _get_owned_event(db, current_user, event_id)

    event_data = {
        "name": event.name,
        "start_date": event.start_date.isoformat(),
        "end_date": event.end_date.isoformat(),
    }

    templates = (
        await db.execute(select(GaReportTemplate).where(GaReportTemplate.event_id == event_id))
    ).scalars().all()
    for tpl in templates:
        tpl.event_id = None
        cfg = dict(tpl.config or {})
        cfg.pop("event_id", None)
        tpl.config = cfg

    await db.delete(event)
    await db.commit()

    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="ga_report_builder",
        action="event.permanent_delete",
        record_id=event.id,
        record_identifier=event.name,
        old_values=event_data,
        request=request,
    )
    return {"success": True, "data": {"id": event.id}}


# ------------------------------------------------------------------ templates


@router.get("/ga-report-builder/templates")
async def list_templates(
    q_house_id: Optional[int] = Query(None, alias="house_id"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ga_report_builder.view")),
    header_house_id: Optional[int] = Depends(get_house_context),
):
    target_house_id = await _resolve_house(db, current_user, q_house_id, header_house_id)
    query = select(GaReportTemplate).where(GaReportTemplate.is_deleted == False)  # noqa: E712
    if target_house_id:
        query = query.where(GaReportTemplate.house_id == target_house_id)
    query = query.order_by(GaReportTemplate.name.asc())
    result = await db.execute(query)
    templates = result.scalars().all()
    return {
        "success": True,
        "data": [
            {
                "id": t.id,
                "house_id": t.house_id,
                "name": t.name,
                "event_id": t.event_id,
                "config": t.config or {},
            }
            for t in templates
        ],
    }


@router.post("/ga-report-builder/templates")
async def create_template(
    data: TemplateCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ga_report_builder.create")),
    header_house_id: Optional[int] = Depends(get_house_context),
    q_house_id: Optional[int] = Query(None, alias="house_id"),
):
    target_house_id = await _resolve_house(db, current_user, q_house_id, header_house_id)
    _require_house_id(target_house_id)
    template = GaReportTemplate(
        house_id=target_house_id,
        name=data.name,
        event_id=data.event_id,
        config=data.config or {},
        created_by=current_user.id,
        updated_by=current_user.id,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)

    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="ga_report_builder",
        action="template.create",
        record_id=template.id,
        record_identifier=template.name,
        new_values={"house_id": template.house_id, "event_id": template.event_id},
        request=request,
        status_code=201,
    )
    return {"success": True, "data": {"id": template.id}}


@router.patch("/ga-report-builder/templates/{template_id}")
async def update_template(
    template_id: int,
    data: TemplateUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ga_report_builder.edit")),
):
    template = await _get_owned_template(db, current_user, template_id)
    old_values = {"name": template.name, "event_id": template.event_id}
    new_values = dict(old_values)
    if data.name is not None:
        template.name = data.name.strip()
        new_values["name"] = template.name
    if data.event_id is not None:
        template.event_id = data.event_id
        new_values["event_id"] = data.event_id
    if data.config is not None:
        template.config = data.config
        new_values["config"] = data.config
    template.updated_by = current_user.id
    await db.commit()

    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="ga_report_builder",
        action="template.edit",
        record_id=template.id,
        record_identifier=template.name,
        old_values=old_values,
        new_values=new_values,
        request=request,
    )
    return {"success": True, "data": {"id": template.id}}


@router.delete("/ga-report-builder/templates/{template_id}")
async def delete_template(
    template_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ga_report_builder.delete")),
):
    template = await _get_owned_template(db, current_user, template_id)
    template.is_deleted = True
    template.deleted_at = now_naive()
    template.deleted_by = current_user.id
    await db.commit()

    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="ga_report_builder",
        action="template.delete",
        record_id=template.id,
        record_identifier=template.name,
        old_values={"name": template.name},
        request=request,
    )
    return {"success": True, "data": {"id": template.id}}


# ------------------------------------------------------------------ report build / export / whatsapp


async def _config_from_payload(db: AsyncSession, current_user: User, payload: ReportPayload) -> ReportConfig:
    target_house_id = await _resolve_house(db, current_user, payload.house_id, None)
    _require_house_id(target_house_id)
    raw = payload.model_dump()
    raw["house_id"] = target_house_id

    # If an event is selected, prefer its window over arbitrary dates.
    if payload.event_id:
        event = await _get_owned_event(db, current_user, payload.event_id)
        raw["start_date"] = event.start_date.isoformat()
        raw["end_date"] = event.end_date.isoformat()
        raw["event_name"] = event.name
        ev_cfg = event.config or {}
        # Only fall back to the event's config for fields the payload did not set.
        # The report builder always sends target_type/bp_ids/slabs (so its edits win);
        # the WhatsApp payload omits them (so the event's canonical values are used).
        if raw.get("target_type") is None and ev_cfg.get("target_type"):
            raw["target_type"] = ev_cfg["target_type"]
        if raw.get("bp_ids") is None and ev_cfg.get("bp_ids"):
            raw["bp_ids"] = ev_cfg["bp_ids"]
        if raw.get("slabs") is None and ev_cfg.get("slabs"):
            raw["slabs"] = ev_cfg["slabs"]

    cfg = ReportConfig(raw)
    return cfg


@router.post("/ga-report-builder/report")
async def build_report(
    payload: ReportPayload,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ga_report_builder.view")),
):
    cfg = await _config_from_payload(db, current_user, payload)
    service = GaReportBuilderService(db, cfg)
    report = await service.build_report()
    return {"success": True, "data": report}


@router.post("/ga-report-builder/report/export")
async def export_report(
    payload: ReportPayload,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ga_report_builder.export")),
):
    cfg = await _config_from_payload(db, current_user, payload)
    service = GaReportBuilderService(db, cfg)
    excel = await service.build_report_excel()
    return Response(
        content=excel,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=ga_report.xlsx"},
    )


@router.post("/ga-report-builder/whatsapp/send")
async def whatsapp_send(
    payload: WhatsAppSendPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("ga_report_builder.send")),
):
    cfg = await _config_from_payload(db, current_user, payload)
    service = GaReportBuilderService(db, cfg)

    # Resolve house for JWT token
    house_res = await db.execute(select(House).where(House.id == cfg.house_id))
    house = house_res.scalar_one_or_none()
    if not house or not house.wa_jwt_token:
        raise HTTPException(status_code=400, detail="WhatsApp not configured for this house. Run setup first.")
    jwt_token = house.wa_jwt_token

    try:
        if payload.format == "image":
            data = await service.build_report_image()
            filename = "ga_report.png"
            mimetype = "image/png"
        elif payload.format == "text":
            chunks = await service.build_report_text()
            for chunk in chunks:
                await whatsapp_service_client.send_text(jwt_token, payload.whatsapp_chat_id, chunk)
            await _log_whatsapp(db, current_user, request, cfg, payload, chunks=len(chunks))
            return {"success": True, "data": {"format": "text", "messages": len(chunks)}}
        else:
            data = await service.build_report_excel()
            filename = "ga_report.xlsx"
            mimetype = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    except Exception as e:
        await log_activity(
            db,
            user_id=current_user.id,
            user_name=current_user.name,
            module="ga_report_builder",
            action="whatsapp_send_failed",
            record_identifier=payload.whatsapp_chat_name or payload.whatsapp_chat_id,
            new_values={"error": str(e)},
            request=request,
            status_code=500,
        )
        raise HTTPException(status_code=502, detail=f"Report build failed: {e}")

    try:
        if payload.format == "image":
            await whatsapp_service_client.send_image(
                jwt_token=jwt_token,
                chat_jid=payload.whatsapp_chat_id,
                filename=filename,
                image_bytes=data,
                caption=payload.caption or f"GA Report ({cfg.start_date} to {cfg.end_date})",
            )
        else:
            await whatsapp_service_client.send_file(
                jwt_token=jwt_token,
                chat_jid=payload.whatsapp_chat_id,
                filename=filename,
                file_bytes=data,
                caption=payload.caption or f"GA Report ({cfg.start_date} to {cfg.end_date})",
                mimetype=mimetype,
            )
    except WhatsAppServiceError as e:
        await log_activity(
            db,
            user_id=current_user.id,
            user_name=current_user.name,
            module="ga_report_builder",
            action="whatsapp_send_failed",
            record_identifier=payload.whatsapp_chat_name or payload.whatsapp_chat_id,
            new_values={"error": f"{e.code}: {e.message}"},
            request=request,
            status_code=502,
        )
        raise HTTPException(status_code=502, detail=f"{e.code}: {e.message}")

    await _log_whatsapp(db, current_user, request, cfg, payload, chunks=1)
    return {"success": True, "data": {"format": payload.format, "messages": 1}}


async def _log_whatsapp(db, current_user, request, cfg, payload, chunks: int):
    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="ga_report_builder",
        action="whatsapp_send",
        record_identifier=payload.whatsapp_chat_name or payload.whatsapp_chat_id,
        new_values={
            "house_id": cfg.house_id,
            "chat": payload.whatsapp_chat_name,
            "format": payload.format,
            "messages": chunks,
            "start_date": cfg.start_date,
            "end_date": cfg.end_date,
            "retailers": len(cfg.retailer_codes),
        },
        request=request,
    )