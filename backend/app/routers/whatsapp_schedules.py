import json
import logging
import re
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.deps import get_db, has_any_permission, get_current_user, require_house_context, get_house_context
from app.models.whatsapp_schedule import WhatsAppSchedule
from app.models.whatsapp_delivery_log import WhatsAppDeliveryLog
from app.models.user import User
from app.models.house import House
from app.services.whatsapp_service_client import (
    whatsapp_service_client,
    WhatsAppServiceError,
)
from app.services.whatsapp_schedule_service import (
    send_schedule_report,
    send_direct_report,
    compute_next_run,
    get_schedule_targets,
    get_schedule_target_names,
    get_report_image,
    compose_report_png,
)
from app.services.whatsapp_token import resolve_house_wa_target
from app.utils.activity_logger import log_activity
from app.utils.access_control import is_admin_user
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["WhatsApp Report Schedules"])

TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")

# Render scale used for on-screen report previews.
PREVIEW_SCALE = 4

# The report-delivery module is usable by the Live Activations schedulers and by
# report-sharing users: either permission unlocks the schedule endpoints (the
# same pair /whatsapp/status and /whatsapp/groups already accept).
SCHEDULE_PERMISSIONS = ["live_activations.schedule", "reports.whatsapp_share"]

ALLOWED_REPORT_TYPES = ("ga_live", "active_lso", "active_sso", "activation", "recharge",
                        "recharge_ev_secondary", "active_sso_inactive_retailers")

# Report types that render a slice of the data instead of the whole house. The
# schedule/send must carry these keys in ``report_params`` (e.g. one RSO's
# inactive-retailer list needs ``employee_id``).
REQUIRED_REPORT_PARAMS = {
    "active_sso_inactive_retailers": ("employee_id",),
}

# Optional context a filtered report type can carry. Only the *required* keys
# identify a report's slice (used to group schedules); the optional ones (e.g.
# the period the modal was showing) shape the render without splitting the list.
OPTIONAL_REPORT_PARAMS = {
    "active_sso_inactive_retailers": ("start_date", "end_date"),
}


def _validate_report_type_value(v: str) -> None:
    if v not in ALLOWED_REPORT_TYPES:
        raise ValueError(f"report_type must be one of {ALLOWED_REPORT_TYPES}")


def _validate_report_params(report_type: str, params: Optional[dict]) -> Optional[dict]:
    """Normalize the per-report context for a report type.

    Returns ``None`` for house-wide reports (any incoming context is dropped so
    one report type can never be rendered with another one's context) and the
    normalized dict for a filtered report type, raising ``ValueError`` when a
    required key is missing or invalid.
    """
    required = REQUIRED_REPORT_PARAMS.get(report_type)
    if not required:
        return None
    supplied = params or {}
    normalized: dict = {}
    for key in required:
        if isinstance(supplied.get(key), bool):
            raise ValueError(f"report_params.{key} must be an integer for report_type '{report_type}'")
        try:
            value = int(supplied[key])
        except (KeyError, TypeError, ValueError):
            raise ValueError(f"report_params.{key} is required for report_type '{report_type}'")
        if value <= 0:
            raise ValueError(f"report_params.{key} must be a positive integer")
        normalized[key] = value

    for key in OPTIONAL_REPORT_PARAMS.get(report_type, ()):
        raw = supplied.get(key)
        if raw in (None, ""):
            continue
        try:
            normalized[key] = date.fromisoformat(str(raw)).isoformat()
        except ValueError:
            raise ValueError(f"report_params.{key} must be an ISO date (YYYY-MM-DD)")

    start, end = normalized.get("start_date"), normalized.get("end_date")
    if bool(start) != bool(end):
        raise ValueError("report_params.start_date and end_date must be provided together")
    if start and end and start > end:
        raise ValueError("report_params.start_date must not be after end_date")
    return normalized


def _matches_report_context(schedule, report_type: str, context: Optional[dict]) -> bool:
    """Whether a schedule belongs to the given context.

    Only the report type's *required* keys are compared, so a period the modal
    happens to be showing never hides a schedule created for the same slice.
    """
    identity = REQUIRED_REPORT_PARAMS.get(report_type)
    if not context or not identity:
        return True
    stored = _decode_report_params(getattr(schedule, "report_params", None)) or {}
    return all(str(stored.get(key)) == str(context.get(key)) for key in identity)


def _decode_report_params(raw: Optional[str]) -> Optional[dict]:
    """Parse a ``report_params`` value coming from a query string (JSON object)."""
    if not raw:
        return None
    try:
        decoded = json.loads(raw)
    except (ValueError, TypeError):
        raise ValueError("report_params must be a JSON object")
    if not isinstance(decoded, dict):
        raise ValueError("report_params must be a JSON object")
    return decoded


def _validate_orientation_value(v: str) -> str:
    if v not in ("portrait", "landscape"):
        raise ValueError("orientation must be 'portrait' or 'landscape'")
    return v


class ScheduleCreate(BaseModel):
    schedule_type: str = "daily"  # daily | interval
    schedule_time: Optional[str] = None  # daily: fixed time; interval: optional first-run time ("00:00" = start immediately)
    interval_minutes: Optional[int] = None  # required when schedule_type == interval
    start_time: Optional[str] = None  # interval: daily delivery window start ("HH:MM", inclusive)
    end_time: Optional[str] = None  # interval: daily delivery window end ("HH:MM", inclusive)
    channel: str = "whatsapp"  # whatsapp | telegram
    report_type: str = "ga_live"  # ga_live | active_lso | active_sso | ...
    report_params: Optional[dict] = None  # per-report context for filtered report types
    whatsapp_chat_id: Optional[str] = None  # legacy single recipient; falls back to target_ids
    whatsapp_chat_name: Optional[str] = None
    target_ids: Optional[list[str]] = None  # multi-recipient chat ids
    target_names: Optional[list[str]] = None  # display names parallel to target_ids
    starts_on: Optional[date] = None  # schedule inactive before this date
    ends_on: Optional[date] = None  # schedule inactive after this date (null = never expires)
    timezone_name: Optional[str] = None
    caption: Optional[str] = None
    send_as: str = "image"  # image | document | pdf
    orientation: str = "portrait"  # portrait | landscape (orientation-aware reports)

    @field_validator("schedule_type")
    @classmethod
    def _validate_type(cls, v: str) -> str:
        if v not in ("daily", "interval"):
            raise ValueError("schedule_type must be 'daily' or 'interval'")
        return v

    @field_validator("channel")
    @classmethod
    def _validate_channel(cls, v: str) -> str:
        if v not in ("whatsapp", "telegram"):
            raise ValueError("channel must be 'whatsapp' or 'telegram'")
        return v

    @field_validator("send_as")
    @classmethod
    def _validate_send_as(cls, v: str) -> str:
        if v not in ("image", "document", "pdf"):
            raise ValueError("send_as must be 'image', 'document' or 'pdf'")
        return v

    @field_validator("orientation")
    @classmethod
    def _validate_orientation(cls, v: str) -> str:
        return _validate_orientation_value(v)

    @field_validator("report_type")
    @classmethod
    def _validate_report_type(cls, v: str) -> str:
        _validate_report_type_value(v)
        return v

    @field_validator("schedule_time")
    @classmethod
    def _validate_time(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not TIME_RE.match(v):
            raise ValueError("schedule_time must be in HH:MM 24-hour format")
        return v

    @field_validator("start_time", "end_time")
    @classmethod
    def _validate_window_time(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not TIME_RE.match(v):
            raise ValueError("start_time/end_time must be in HH:MM 24-hour format")
        return v

    @field_validator("interval_minutes")
    @classmethod
    def _validate_interval(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and (v < 1 or v > 1440):
            raise ValueError("interval_minutes must be between 1 and 1440")
        return v

    @field_validator("whatsapp_chat_id")
    @classmethod
    def _validate_chat(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.strip()
        return v or None


class ScheduleUpdate(BaseModel):
    schedule_type: Optional[str] = None
    schedule_time: Optional[str] = None
    interval_minutes: Optional[int] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    channel: Optional[str] = None
    report_type: Optional[str] = None
    report_params: Optional[dict] = None
    whatsapp_chat_id: Optional[str] = None
    whatsapp_chat_name: Optional[str] = None
    target_ids: Optional[list[str]] = None
    target_names: Optional[list[str]] = None
    starts_on: Optional[date] = None
    ends_on: Optional[date] = None
    timezone_name: Optional[str] = None
    caption: Optional[str] = None
    send_as: Optional[str] = None  # image | document | pdf
    orientation: Optional[str] = None  # portrait | landscape
    is_active: Optional[bool] = None

    @field_validator("schedule_type")
    @classmethod
    def _validate_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("daily", "interval"):
            raise ValueError("schedule_type must be 'daily' or 'interval'")
        return v

    @field_validator("channel")
    @classmethod
    def _validate_channel(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("whatsapp", "telegram"):
            raise ValueError("channel must be 'whatsapp' or 'telegram'")
        return v

    @field_validator("send_as")
    @classmethod
    def _validate_send_as(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("image", "document", "pdf"):
            raise ValueError("send_as must be 'image', 'document' or 'pdf'")
        return v

    @field_validator("orientation")
    @classmethod
    def _validate_orientation(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            _validate_orientation_value(v)
        return v

    @field_validator("report_type")
    @classmethod
    def _validate_report_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            _validate_report_type_value(v)
        return v

    @field_validator("schedule_time")
    @classmethod
    def _validate_time(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not TIME_RE.match(v):
            raise ValueError("schedule_time must be in HH:MM 24-hour format")
        return v

    @field_validator("start_time", "end_time")
    @classmethod
    def _validate_window_time(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not TIME_RE.match(v):
            raise ValueError("start_time/end_time must be in HH:MM 24-hour format")
        return v

    @field_validator("interval_minutes")
    @classmethod
    def _validate_interval(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and (v < 1 or v > 1440):
            raise ValueError("interval_minutes must be between 1 and 1440")
        return v


class DirectSendPayload(BaseModel):
    """Payload for sending a report immediately without creating a schedule."""
    channel: str = "whatsapp"  # whatsapp | telegram
    report_type: str = "ga_live"
    report_params: Optional[dict] = None  # per-report context for filtered report types
    whatsapp_chat_id: Optional[str] = None  # legacy single recipient
    whatsapp_chat_name: Optional[str] = None
    whatsapp_chat_ids: Optional[list[str]] = None  # multi-recipient chat ids
    whatsapp_chat_names: Optional[list[str]] = None
    caption: Optional[str] = None
    send_as: str = "image"  # image | document | pdf
    orientation: str = "portrait"  # portrait | landscape (orientation-aware reports)

    @field_validator("channel")
    @classmethod
    def _validate_channel(cls, v: str) -> str:
        if v not in ("whatsapp", "telegram"):
            raise ValueError("channel must be 'whatsapp' or 'telegram'")
        return v

    @field_validator("send_as")
    @classmethod
    def _validate_send_as(cls, v: str) -> str:
        if v not in ("image", "document", "pdf"):
            raise ValueError("send_as must be 'image', 'document' or 'pdf'")
        return v

    @field_validator("orientation")
    @classmethod
    def _validate_orientation(cls, v: str) -> str:
        return _validate_orientation_value(v)

    @field_validator("report_type")
    @classmethod
    def _validate_report_type(cls, v: str) -> str:
        _validate_report_type_value(v)
        return v


def _build_targets_cross(
    target_ids: Optional[list[str]],
    target_names: Optional[list[str]],
    chat_id: Optional[str],
    chat_name: Optional[str],
) -> tuple[list[tuple[str, str]], str, str]:
    """Collapse the create/update recipient fields into (pairs, ids_json, names_json)."""
    ids = [i.strip() for i in (target_ids or []) if i and i.strip()]
    if ids:
        names_raw = target_names or []
        names = [
            (names_raw[i] if i < len(names_raw) else ids[i]).strip()
            for i in range(len(ids))
        ]
        pairs = list(zip(ids, names))
        return pairs, json.dumps(ids), json.dumps(names)
    cid = (chat_id or "").strip()
    if cid:
        cname = (chat_name or cid).strip()
        return [(cid, cname)], json.dumps([cid]), json.dumps([cname])
    return [], "", ""


def _serialize_schedule(s: WhatsAppSchedule) -> dict:
    targets = get_schedule_targets(s)
    next_run = compute_next_run(s)
    return {
        "id": s.id,
        "house_id": s.house_id,
        "schedule_type": s.schedule_type,
        "schedule_time": s.schedule_time,
        "interval_minutes": s.interval_minutes,
        "start_time": getattr(s, "start_time", None),
        "end_time": getattr(s, "end_time", None),
        "channel": getattr(s, "channel", "whatsapp") or "whatsapp",
        "report_type": getattr(s, "report_type", "ga_live") or "ga_live",
        "report_params": _decode_report_params(getattr(s, "report_params", None)),
        "send_as": getattr(s, "send_as", "image") or "image",
        "orientation": getattr(s, "orientation", "portrait") or "portrait",
        "whatsapp_chat_id": s.whatsapp_chat_id,
        "whatsapp_chat_name": s.whatsapp_chat_name,
        "target_ids": [t[0] for t in targets],
        "target_names": [t[1] for t in targets],
        "starts_on": s.starts_on.isoformat() if s.starts_on else None,
        "ends_on": s.ends_on.isoformat() if s.ends_on else None,
        "timezone_name": s.timezone_name or "Asia/Dhaka",
        "caption": s.caption,
        "is_active": bool(s.is_active),
        "last_run_date": s.last_run_date.isoformat() if s.last_run_date else None,
        "last_status": s.last_status,
        "last_error": s.last_error,
        "last_run_at": s.last_run_at.isoformat() if s.last_run_at else None,
        "next_run_at": next_run.isoformat() if next_run else None,
        "created_by": s.created_by,
    }


def _serialize_log(l: WhatsAppDeliveryLog) -> dict:
    try:
        chat_names = json.loads(l.chat_names) if l.chat_names else []
    except (ValueError, TypeError):
        chat_names = []
    return {
        "id": l.id,
        "schedule_id": l.schedule_id,
        "house_id": l.house_id,
        "report_type": l.report_type,
        "channel": l.channel,
        "triggered_by": l.triggered_by,
        "target_count": l.target_count,
        "delivered_count": l.delivered_count,
        "status": l.status,
        "error": l.error,
        "chat_names": chat_names,
        "created_at": l.created_at.isoformat() if l.created_at else None,
    }


async def _verify_house_access(current_user: User, house_id: int):
    if is_admin_user(current_user):
        return house_id
    user_house_ids = [h.id for h in current_user.houses]
    if house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="You do not have access to this house")
    return house_id


async def _get_owned_schedule(db: AsyncSession, current_user: User, schedule_id: int) -> WhatsAppSchedule:
    result = await db.execute(
        select(WhatsAppSchedule).where(
            WhatsAppSchedule.id == schedule_id,
            WhatsAppSchedule.is_deleted == False,  # noqa: E712
        )
    )
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    await _verify_house_access(current_user, schedule.house_id)
    return schedule


def _validate_window(starts_on: Optional[date], ends_on: Optional[date]) -> None:
    if starts_on and ends_on and starts_on > ends_on:
        raise HTTPException(status_code=400, detail="starts_on must be on or before ends_on")


def _validate_time_window(start_time: Optional[str], end_time: Optional[str]) -> tuple[str, str]:
    """Validate an interval delivery window and return it with shelf defaults."""
    st = start_time or "00:00"
    en = end_time or "23:59"
    if st > en:
        raise HTTPException(status_code=400, detail="start_time must be on or before end_time")
    return st, en


@router.get("/whatsapp-schedules")
async def list_schedules(
    house_id: Optional[int] = Query(None),
    report_type: Optional[str] = Query(None),
    report_params: Optional[str] = Query(None),  # JSON context for filtered report types
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_any_permission(SCHEDULE_PERMISSIONS)),
):
    if house_id:
        await _verify_house_access(current_user, house_id)
    else:
        if is_admin_user(current_user):
            house_id = None
        else:
            user_house_ids = [h.id for h in current_user.houses]
            if len(user_house_ids) == 1:
                house_id = user_house_ids[0]
            else:
                raise HTTPException(status_code=400, detail="house_id is required when user has multiple houses")

    query = select(WhatsAppSchedule).where(
        WhatsAppSchedule.is_deleted == False,  # noqa: E712
    )
    if house_id:
        query = query.where(WhatsAppSchedule.house_id == house_id)
    if report_type:
        query = query.where(WhatsAppSchedule.report_type == report_type)
    query = query.order_by(WhatsAppSchedule.schedule_time.asc())

    result = await db.execute(query)
    schedules = list(result.scalars().all())
    if report_type and report_params:
        try:
            context = _validate_report_params(report_type, _decode_report_params(report_params))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        schedules = [s for s in schedules if _matches_report_context(s, report_type, context)]
    return {
        "success": True,
        "data": [_serialize_schedule(s) for s in schedules],
    }


@router.post("/whatsapp-schedules")
async def create_schedule(
    data: ScheduleCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_any_permission(SCHEDULE_PERMISSIONS)),
    house_context: int = Depends(require_house_context),
):
    await _verify_house_access(current_user, house_context)
    _validate_window(data.starts_on, data.ends_on)

    schedule_type = data.schedule_type or "daily"
    if schedule_type == "interval" and not data.interval_minutes:
        raise HTTPException(status_code=400, detail="interval_minutes is required for interval schedules")
    if schedule_type == "daily" and not data.schedule_time:
        raise HTTPException(status_code=400, detail="schedule_time is required for daily schedules")

    start_time, end_time = _validate_time_window(data.start_time, data.end_time)

    channel = data.channel or "whatsapp"

    # Resolve recipients snapshot for the schedule record
    pairs, ids_json, names_json = _build_targets_cross(
        data.target_ids, data.target_names, data.whatsapp_chat_id, data.whatsapp_chat_name
    )
    chat_id: str = ""
    chat_name: str = ""
    if channel == "whatsapp":
        if not pairs:
            raise HTTPException(status_code=400, detail="Select at least one WhatsApp group or contact")
        chat_id, chat_name = pairs[0]
    else:
        # Telegram: delivery resolves the house's linked group at send time;
        # store a display snapshot now.
        house_res = await db.execute(select(House).where(House.id == house_context))
        house_row = house_res.scalar_one_or_none()
        chat_id = (house_row.telegram_chat_id if house_row else "") or ""
        chat_name = (house_row.telegram_chat_name if house_row else "") or "Telegram"
        ids_json, names_json = "", ""

    try:
        report_params = _validate_report_params(data.report_type or "ga_live", data.report_params)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    schedule = WhatsAppSchedule(
        house_id=house_context,
        schedule_type=schedule_type,
        schedule_time=data.schedule_time or "00:00",
        interval_minutes=data.interval_minutes,
        start_time=start_time,
        end_time=end_time,
        channel=channel,
        report_type=data.report_type or "ga_live",
        report_params=json.dumps(report_params) if report_params else None,
        send_as=data.send_as or "image",
        orientation=data.orientation or "portrait",
        whatsapp_chat_id=chat_id or "-",
        whatsapp_chat_name=chat_name or "-",
        target_ids=ids_json or None,
        target_names=names_json or None,
        caption=data.caption,
        starts_on=data.starts_on,
        ends_on=data.ends_on,
        timezone_name=data.timezone_name or "Asia/Dhaka",
        is_active=True,
        created_by=current_user.id,
        updated_by=current_user.id,
    )
    db.add(schedule)
    await db.commit()
    await db.refresh(schedule)

    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="live_activations",
        action="schedule.create",
        record_id=schedule.id,
        record_identifier=f"{schedule.whatsapp_chat_name} ({schedule.schedule_type})",
        new_values={
            "house_id": schedule.house_id,
            "schedule_type": schedule.schedule_type,
            "schedule_time": schedule.schedule_time,
            "interval_minutes": schedule.interval_minutes,
            "start_time": schedule.start_time,
            "end_time": schedule.end_time,
            "targets": schedule.whatsapp_chat_name,
        },
        request=request,
        status_code=201,
    )

    return {"success": True, "data": {"id": schedule.id}}


@router.patch("/whatsapp-schedules/{schedule_id}")
async def update_schedule(
    schedule_id: int,
    data: ScheduleUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_any_permission(SCHEDULE_PERMISSIONS)),
):
    schedule = await _get_owned_schedule(db, current_user, schedule_id)
    _validate_window(data.starts_on, data.ends_on)

    old_values = {
        "schedule_type": schedule.schedule_type,
        "schedule_time": schedule.schedule_time,
        "interval_minutes": schedule.interval_minutes,
        "start_time": schedule.start_time,
        "end_time": schedule.end_time,
        "channel": getattr(schedule, "channel", "whatsapp") or "whatsapp",
        "report_type": getattr(schedule, "report_type", "ga_live") or "ga_live",
        "report_params": _decode_report_params(getattr(schedule, "report_params", None)),
        "orientation": getattr(schedule, "orientation", "portrait") or "portrait",
        "whatsapp_chat_name": schedule.whatsapp_chat_name,
        "whatsapp_chat_id": schedule.whatsapp_chat_id,
        "caption": schedule.caption,
        "is_active": bool(schedule.is_active),
        "starts_on": schedule.starts_on.isoformat() if schedule.starts_on else None,
        "ends_on": schedule.ends_on.isoformat() if schedule.ends_on else None,
        "timezone_name": schedule.timezone_name,
    }
    new_values = dict(old_values)

    if data.schedule_type is not None:
        schedule.schedule_type = data.schedule_type
        new_values["schedule_type"] = data.schedule_type
    if "schedule_time" in data.model_fields_set:
        schedule.schedule_time = data.schedule_time
        new_values["schedule_time"] = data.schedule_time
    if data.interval_minutes is not None:
        schedule.interval_minutes = data.interval_minutes
        new_values["interval_minutes"] = data.interval_minutes
    if data.start_time is not None:
        schedule.start_time = data.start_time
        new_values["start_time"] = data.start_time
    if data.end_time is not None:
        schedule.end_time = data.end_time
        new_values["end_time"] = data.end_time
    if data.channel is not None:
        schedule.channel = data.channel
        new_values["channel"] = data.channel
    if data.report_type is not None:
        schedule.report_type = data.report_type
        new_values["report_type"] = data.report_type
    if data.report_params is not None or data.report_type is not None:
        # Re-validate whenever the type changes too: a schedule can never keep
        # context that does not belong to (or is missing for) its report type.
        try:
            report_params = _validate_report_params(
                schedule.report_type, data.report_params
                if data.report_params is not None
                else _decode_report_params(getattr(schedule, "report_params", None)),
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        schedule.report_params = json.dumps(report_params) if report_params else None
        new_values["report_params"] = report_params
    if data.send_as is not None:
        schedule.send_as = data.send_as
        new_values["send_as"] = data.send_as
    if data.orientation is not None:
        schedule.orientation = data.orientation
        new_values["orientation"] = data.orientation
    if data.starts_on is not None:
        schedule.starts_on = data.starts_on
        new_values["starts_on"] = str(data.starts_on)
    if data.ends_on is not None:
        schedule.ends_on = data.ends_on
        new_values["ends_on"] = str(data.ends_on)
    if data.timezone_name is not None:
        schedule.timezone_name = data.timezone_name
        new_values["timezone_name"] = data.timezone_name
    # Recipients: target_ids present in the patch replaces the recipient list;
    # a bare whatsapp_chat_id updates a single recipient.
    if data.target_ids is not None:
        pairs, ids_json, names_json = _build_targets_cross(
            data.target_ids, data.target_names, None, None
        )
        if not pairs:
            raise HTTPException(status_code=400, detail="Select at least one WhatsApp group or contact")
        schedule.whatsapp_chat_id = pairs[0][0]
        schedule.whatsapp_chat_name = pairs[0][1]
        schedule.target_ids = ids_json or None
        schedule.target_names = names_json or None
        new_values["whatsapp_chat_name"] = schedule.whatsapp_chat_name
    elif data.whatsapp_chat_id is not None:
        cid = data.whatsapp_chat_id.strip()
        if not cid:
            raise HTTPException(status_code=400, detail="whatsapp_chat_id cannot be empty")
        schedule.whatsapp_chat_id = cid
        schedule.whatsapp_chat_name = (data.whatsapp_chat_name or cid).strip()
        schedule.target_ids = json.dumps([cid])
        schedule.target_names = json.dumps([schedule.whatsapp_chat_name])
        new_values["whatsapp_chat_name"] = schedule.whatsapp_chat_name
    if data.whatsapp_chat_name is not None and data.whatsapp_chat_id is None and data.target_ids is None:
        schedule.whatsapp_chat_name = data.whatsapp_chat_name
        new_values["whatsapp_chat_name"] = data.whatsapp_chat_name
    if data.caption is not None:
        schedule.caption = data.caption
        new_values["caption"] = data.caption
    if data.is_active is not None:
        schedule.is_active = data.is_active
        new_values["is_active"] = data.is_active
    if schedule.schedule_type == "interval" and not schedule.interval_minutes:
        raise HTTPException(status_code=400, detail="interval_minutes is required for interval schedules")
    if schedule.schedule_type == "daily" and not schedule.schedule_time:
        raise HTTPException(status_code=400, detail="schedule_time is required for daily schedules")
    _validate_time_window(schedule.start_time, schedule.end_time)
    schedule.updated_by = current_user.id
    await db.commit()

    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="live_activations",
        action="schedule.edit",
        record_id=schedule.id,
        record_identifier=f"{schedule.whatsapp_chat_name} ({schedule.schedule_time})",
        old_values=old_values,
        new_values=new_values,
        request=request,
    )
    return {"success": True, "data": {"id": schedule.id}}


@router.delete("/whatsapp-schedules/{schedule_id}")
async def delete_schedule(
    schedule_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_any_permission(SCHEDULE_PERMISSIONS)),
):
    schedule = await _get_owned_schedule(db, current_user, schedule_id)

    old_values = {
        "schedule_time": schedule.schedule_time,
        "whatsapp_chat_name": schedule.whatsapp_chat_name,
    }
    schedule.is_deleted = True
    schedule.deleted_at = now_naive()
    schedule.deleted_by = current_user.id
    schedule.is_active = False
    await db.commit()

    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="live_activations",
        action="schedule.delete",
        record_id=schedule.id,
        record_identifier=f"{schedule.whatsapp_chat_name} ({schedule.schedule_time})",
        old_values=old_values,
        request=request,
    )
    return {"success": True, "data": {"id": schedule.id}}


@router.post("/whatsapp-schedules/{schedule_id}/duplicate")
async def duplicate_schedule(
    schedule_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_any_permission(SCHEDULE_PERMISSIONS)),
):
    """Clone a schedule. The copy starts fresh (never ran) and is active."""
    source = await _get_owned_schedule(db, current_user, schedule_id)

    targets = get_schedule_targets(source)
    first_id = targets[0][0] if targets else (source.whatsapp_chat_id or "-")
    first_name = targets[0][1] if targets else (source.whatsapp_chat_name or "-")

    copy = WhatsAppSchedule(
        house_id=source.house_id,
        schedule_type=source.schedule_type,
        schedule_time=source.schedule_time,
        interval_minutes=source.interval_minutes,
        start_time=getattr(source, "start_time", None),
        end_time=getattr(source, "end_time", None),
        channel=getattr(source, "channel", "whatsapp") or "whatsapp",
        report_type=getattr(source, "report_type", "ga_live") or "ga_live",
        report_params=getattr(source, "report_params", None),
        orientation=getattr(source, "orientation", "portrait") or "portrait",
        whatsapp_chat_id=first_id,
        whatsapp_chat_name=first_name,
        target_ids=source.target_ids,
        target_names=source.target_names,
        caption=source.caption,
        starts_on=source.starts_on,
        ends_on=source.ends_on,
        timezone_name=source.timezone_name,
        is_active=True,
        created_by=current_user.id,
        updated_by=current_user.id,
    )
    db.add(copy)
    await db.commit()
    await db.refresh(copy)

    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="live_activations",
        action="schedule.duplicate",
        record_id=copy.id,
        record_identifier=f"{copy.whatsapp_chat_name} (from {source.id})",
        new_values={"source_id": source.id, "schedule_type": copy.schedule_type},
        request=request,
    )
    return {"success": True, "data": {"id": copy.id}}


@router.post("/whatsapp-schedules/{schedule_id}/send-now")
async def send_now(
    schedule_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_any_permission(SCHEDULE_PERMISSIONS)),
):
    schedule = await _get_owned_schedule(db, current_user, schedule_id)

    try:
        ok = await send_schedule_report(db, schedule, triggered_by="manual")
    except WhatsAppServiceError as e:
        raise HTTPException(status_code=503, detail=f"{e.code}: {e.message}")

    if not ok:
        raise HTTPException(status_code=502, detail=f"Send failed: {schedule.last_error or 'unknown error'}")

    return {
        "success": True,
        "data": {
            "id": schedule.id,
            "status": "success",
        },
    }


@router.post("/whatsapp-schedules/send-direct")
async def send_direct(
    data: DirectSendPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_any_permission(SCHEDULE_PERMISSIONS)),
    house_context: int = Depends(require_house_context),
):
    """Send a report image immediately to one or more chats without creating a schedule."""
    await _verify_house_access(current_user, house_context)

    if data.channel == "whatsapp":
        has_any = bool(
            (data.whatsapp_chat_id or "").strip()
            or any((i or "").strip() for i in (data.whatsapp_chat_ids or []))
        )
        if not has_any:
            raise HTTPException(status_code=400, detail="Select at least one WhatsApp group or contact")

    try:
        report_params = _validate_report_params(data.report_type, data.report_params)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        ok, error = await send_direct_report(
            db,
            user_id=current_user.id,
            user_name=current_user.name,
            house_id=house_context,
            report_type=data.report_type,
            report_params=report_params,
            channel=data.channel,
            whatsapp_chat_id=data.whatsapp_chat_id,
            whatsapp_chat_name=data.whatsapp_chat_name,
            whatsapp_chat_ids=data.whatsapp_chat_ids,
            whatsapp_chat_names=data.whatsapp_chat_names,
            caption=data.caption,
            send_as=data.send_as,
            orientation=data.orientation,
        )
    except WhatsAppServiceError as e:
        raise HTTPException(status_code=503, detail=f"{e.code}: {e.message}")

    if not ok:
        raise HTTPException(status_code=502, detail=f"Send failed: {error}")

    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="live_activations",
        action="report.direct_send",
        record_identifier=f"{data.report_type} → {', '.join(data.whatsapp_chat_names or []) or (data.whatsapp_chat_name or 'Telegram')}",
        new_values={
            "house_id": house_context,
            "report_type": data.report_type,
            "channel": data.channel,
            "mode": "direct",
        },
        request=request,
        status_code=200,
    )

    return {"success": True, "data": {"sent": True}}


@router.get("/whatsapp-schedules/preview")
async def whatsapp_report_preview(
    report_type: str = Query("ga_live"),
    orientation: str = Query("portrait"),
    report_params: Optional[str] = Query(None),  # JSON object for filtered report types
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_any_permission(SCHEDULE_PERMISSIONS)),
    house_context: int = Depends(require_house_context),
):
    """Render the current report image for the active house without sending it."""
    try:
        _validate_report_type_value(report_type)
        _validate_orientation_value(orientation)
        params = _validate_report_params(report_type, _decode_report_params(report_params))
    except ValueError as e:
        # A bad report_type/orientation/report_params is client input, not a server fault.
        raise HTTPException(status_code=400, detail=str(e))
    await _verify_house_access(current_user, house_context)

    try:
        # Reports whose builder accepts a scale render their preview lighter
        # (~1s, far smaller PNG) since it is only displayed on screen.
        # Scheduled/direct sends keep the full-resolution image. Both are cached
        # for 60s so repeat previews and preview→send are instant.
        image_bytes = await get_report_image(
            db, report_type, house_context,
            scale=PREVIEW_SCALE,
            orientation=orientation,
            report_params=params,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Report preview build failed ({report_type}): {e}")
        raise HTTPException(status_code=500, detail=f"Report generation failed: {str(e)}")

    # Paginated reports return a list of A4 page PNGs; stack them so the preview
    # shows the whole report (a single-PNG report passes through unchanged).
    preview_bytes = compose_report_png(image_bytes)
    return Response(content=preview_bytes, media_type="image/png",
                    headers={"Content-Disposition": f'inline; filename="{report_type}_preview.png"'})


# ── Delivery history ────────────────────────────────────────────────


@router.get("/whatsapp-schedules/history")
async def list_delivery_history(
    house_id: Optional[int] = Query(None),
    report_type: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_any_permission(SCHEDULE_PERMISSIONS)),
):
    if house_id:
        await _verify_house_access(current_user, house_id)
    else:
        if is_admin_user(current_user):
            house_id = None
        else:
            user_house_ids = [h.id for h in current_user.houses]
            if len(user_house_ids) == 1:
                house_id = user_house_ids[0]
            else:
                raise HTTPException(status_code=400, detail="house_id is required when user has multiple houses")

    query = select(WhatsAppDeliveryLog).where(
        WhatsAppDeliveryLog.is_deleted == False,  # noqa: E712
    )
    if house_id:
        query = query.where(WhatsAppDeliveryLog.house_id == house_id)
    if report_type:
        query = query.where(WhatsAppDeliveryLog.report_type == report_type)
    query = query.order_by(WhatsAppDeliveryLog.created_at.desc(), WhatsAppDeliveryLog.id.desc()).limit(limit)

    result = await db.execute(query)
    logs = result.scalars().all()
    return {"success": True, "data": [_serialize_log(l) for l in logs]}


@router.get("/whatsapp-schedules/{schedule_id}/history")
async def schedule_delivery_history(
    schedule_id: int,
    limit: int = Query(30, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_any_permission(SCHEDULE_PERMISSIONS)),
):
    schedule = await _get_owned_schedule(db, current_user, schedule_id)
    query = (
        select(WhatsAppDeliveryLog)
        .where(
            WhatsAppDeliveryLog.schedule_id == schedule.id,
            WhatsAppDeliveryLog.is_deleted == False,  # noqa: E712
        )
        .order_by(WhatsAppDeliveryLog.created_at.desc(), WhatsAppDeliveryLog.id.desc())
        .limit(limit)
    )
    result = await db.execute(query)
    logs = result.scalars().all()
    return {"success": True, "data": [_serialize_log(l) for l in logs]}


# ── WhatsApp service status / discovery ─────────────────────────────


@router.get("/whatsapp/status")
async def whatsapp_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_any_permission(SCHEDULE_PERMISSIONS)),
    house_context: Optional[int] = Depends(get_house_context),
):
    if not house_context:
        return {
            "success": False,
            "enabled": False,
            "connected": False,
            "state": "no_house",
            "error": "Select a house first",
            "qr": None,
        }
    result = await db.execute(select(House).where(House.id == house_context))
    house = result.scalar_one_or_none()
    if not house:
        return {
            "success": False,
            "enabled": False,
            "connected": False,
            "state": "not_configured",
            "error": "House not found",
            "qr": None,
        }
    wa_target = await resolve_house_wa_target(db, house)
    if not wa_target or not wa_target.jwt_token:
        return {
            "success": False,
            "enabled": False,
            "connected": False,
            "state": "not_configured",
            "error": "WhatsApp not configured for this house",
            "qr": None,
        }
    try:
        status = await whatsapp_service_client.get_device_status(wa_target.jwt_token)
        status = dict(status)
        phone = status.get("phone_number") or status.get("phone") or getattr(wa_target.holder, "wa_phone_number", None)
        last_at = status.get("last_connected_at") or getattr(wa_target.holder, "wa_last_connected_at", None)
        if hasattr(last_at, "isoformat"):
            last_at = last_at.isoformat()
        status["phone_number"] = phone or None
        status["last_connected_at"] = last_at or None
        status["connection"] = wa_target.label
        return {"success": True, "enabled": True, **status}
    except WhatsAppServiceError as e:
        return {
            "success": False,
            "enabled": False,
            "connected": False,
            "state": "unreachable",
            "error": e.message,
            "qr": None,
        }


@router.get("/whatsapp/groups")
async def whatsapp_groups(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_any_permission(SCHEDULE_PERMISSIONS)),
    house_context: Optional[int] = Depends(get_house_context),
):
    if not house_context:
        return {"success": True, "data": []}
    result = await db.execute(select(House).where(House.id == house_context))
    house = result.scalar_one_or_none()
    if not house:
        return {"success": True, "data": []}
    wa_target = await resolve_house_wa_target(db, house)
    if not wa_target or not wa_target.jwt_token:
        return {"success": True, "data": []}
    try:
        groups = await whatsapp_service_client.get_groups(wa_target.jwt_token)
        return {"success": True, "data": groups}
    except WhatsAppServiceError as e:
        raise HTTPException(status_code=503, detail=f"{e.code}: {e.message}")