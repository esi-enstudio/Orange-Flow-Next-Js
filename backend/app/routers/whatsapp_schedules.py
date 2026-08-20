import logging
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.deps import get_db, has_permission, get_current_user, require_house_context, get_house_context
from app.models.whatsapp_schedule import WhatsAppSchedule
from app.models.user import User
from app.models.house import House
from app.services.whatsapp_service_client import (
    whatsapp_service_client,
    WhatsAppServiceError,
)
from app.services.whatsapp_schedule_service import send_schedule_report
from app.utils.activity_logger import log_activity
from app.utils.access_control import is_admin_user
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["WhatsApp Report Schedules"])

TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


class ScheduleCreate(BaseModel):
    schedule_type: str = "daily"  # daily | interval
    schedule_time: Optional[str] = None  # required when schedule_type == daily
    interval_minutes: Optional[int] = None  # required when schedule_type == interval
    whatsapp_chat_id: str
    whatsapp_chat_name: str
    caption: Optional[str] = None

    @field_validator("schedule_type")
    @classmethod
    def _validate_type(cls, v: str) -> str:
        if v not in ("daily", "interval"):
            raise ValueError("schedule_type must be 'daily' or 'interval'")
        return v

    @field_validator("schedule_time")
    @classmethod
    def _validate_time(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not TIME_RE.match(v):
            raise ValueError("schedule_time must be in HH:MM 24-hour format")
        return v

    @field_validator("interval_minutes")
    @classmethod
    def _validate_interval(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and (v < 1 or v > 1440):
            raise ValueError("interval_minutes must be between 1 and 1440")
        return v

    @field_validator("whatsapp_chat_id")
    @classmethod
    def _validate_chat(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("whatsapp_chat_id is required")
        return v.strip()


class ScheduleUpdate(BaseModel):
    schedule_type: Optional[str] = None
    schedule_time: Optional[str] = None
    interval_minutes: Optional[int] = None
    whatsapp_chat_id: Optional[str] = None
    whatsapp_chat_name: Optional[str] = None
    caption: Optional[str] = None
    is_active: Optional[bool] = None

    @field_validator("schedule_type")
    @classmethod
    def _validate_type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("daily", "interval"):
            raise ValueError("schedule_type must be 'daily' or 'interval'")
        return v

    @field_validator("schedule_time")
    @classmethod
    def _validate_time(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not TIME_RE.match(v):
            raise ValueError("schedule_time must be in HH:MM 24-hour format")
        return v

    @field_validator("interval_minutes")
    @classmethod
    def _validate_interval(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and (v < 1 or v > 1440):
            raise ValueError("interval_minutes must be between 1 and 1440")
        return v


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


@router.get("/whatsapp-schedules")
async def list_schedules(
    house_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("live_activations.schedule")),
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
    query = query.order_by(WhatsAppSchedule.schedule_time.asc())

    result = await db.execute(query)
    schedules = result.scalars().all()
    return {
        "success": True,
        "data": [
            {
                "id": s.id,
                "house_id": s.house_id,
                "schedule_type": s.schedule_type,
                "schedule_time": s.schedule_time,
                "interval_minutes": s.interval_minutes,
                "whatsapp_chat_id": s.whatsapp_chat_id,
                "whatsapp_chat_name": s.whatsapp_chat_name,
                "caption": s.caption,
                "is_active": bool(s.is_active),
                "last_run_date": s.last_run_date.isoformat() if s.last_run_date else None,
                "last_status": s.last_status,
                "last_error": s.last_error,
                "last_run_at": s.last_run_at.isoformat() if s.last_run_at else None,
                "created_by": s.created_by,
            }
            for s in schedules
        ],
    }


@router.post("/whatsapp-schedules")
async def create_schedule(
    data: ScheduleCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("live_activations.schedule")),
    house_context: int = Depends(require_house_context),
):
    await _verify_house_access(current_user, house_context)

    schedule_type = data.schedule_type or "daily"
    if schedule_type == "interval" and not data.interval_minutes:
        raise HTTPException(status_code=400, detail="interval_minutes is required for interval schedules")
    if schedule_type == "daily" and not data.schedule_time:
        raise HTTPException(status_code=400, detail="schedule_time is required for daily schedules")

    schedule = WhatsAppSchedule(
        house_id=house_context,
        schedule_type=schedule_type,
        schedule_time=data.schedule_time or "00:00",
        interval_minutes=data.interval_minutes,
        whatsapp_chat_id=data.whatsapp_chat_id,
        whatsapp_chat_name=data.whatsapp_chat_name or data.whatsapp_chat_id,
        caption=data.caption,
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
            "whatsapp_chat_name": schedule.whatsapp_chat_name,
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
    current_user: User = Depends(has_permission("live_activations.schedule")),
):
    schedule = await _get_owned_schedule(db, current_user, schedule_id)

    old_values = {
        "schedule_type": schedule.schedule_type,
        "schedule_time": schedule.schedule_time,
        "interval_minutes": schedule.interval_minutes,
        "whatsapp_chat_name": schedule.whatsapp_chat_name,
        "whatsapp_chat_id": schedule.whatsapp_chat_id,
        "caption": schedule.caption,
        "is_active": bool(schedule.is_active),
    }
    new_values = dict(old_values)

    if data.schedule_type is not None:
        schedule.schedule_type = data.schedule_type
        new_values["schedule_type"] = data.schedule_type
    if data.schedule_time is not None:
        schedule.schedule_time = data.schedule_time
        new_values["schedule_time"] = data.schedule_time
    if data.interval_minutes is not None:
        schedule.interval_minutes = data.interval_minutes
        new_values["interval_minutes"] = data.interval_minutes
    if data.whatsapp_chat_id is not None:
        schedule.whatsapp_chat_id = data.whatsapp_chat_id
        new_values["whatsapp_chat_id"] = data.whatsapp_chat_id
    if data.whatsapp_chat_name is not None:
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
    current_user: User = Depends(has_permission("live_activations.schedule")),
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


@router.post("/whatsapp-schedules/{schedule_id}/send-now")
async def send_now(
    schedule_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("live_activations.schedule")),
):
    schedule = await _get_owned_schedule(db, current_user, schedule_id)

    try:
        ok = await send_schedule_report(db, schedule)
    except WhatsAppServiceError as e:
        raise HTTPException(status_code=503, detail=f"{e.code}: {e.message}")

    if not ok:
        raise HTTPException(status_code=502, detail=f"Send failed: {schedule.last_error}")

    return {
        "success": True,
        "data": {
            "id": schedule.id,
            "last_status": schedule.last_status,
            "last_run_at": schedule.last_run_at.isoformat() if schedule.last_run_at else None,
        },
    }


@router.get("/whatsapp/status")
async def whatsapp_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("live_activations.schedule")),
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
    if not house or not house.wa_jwt_token:
        return {
            "success": False,
            "enabled": False,
            "connected": False,
            "state": "not_configured",
            "error": "WhatsApp not configured for this house",
            "qr": None,
        }
    try:
        status = await whatsapp_service_client.get_device_status(house.wa_jwt_token)
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
    current_user: User = Depends(has_permission("live_activations.schedule")),
    house_context: Optional[int] = Depends(get_house_context),
):
    if not house_context:
        return {"success": True, "data": []}
    result = await db.execute(select(House).where(House.id == house_context))
    house = result.scalar_one_or_none()
    if not house or not house.wa_jwt_token:
        return {"success": True, "data": []}
    try:
        groups = await whatsapp_service_client.get_groups(house.wa_jwt_token)
        return {"success": True, "data": groups}
    except WhatsAppServiceError as e:
        raise HTTPException(status_code=503, detail=f"{e.code}: {e.message}")
