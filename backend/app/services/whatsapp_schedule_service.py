import logging
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.whatsapp_schedule import WhatsAppSchedule
from app.models.user import User
from app.models.house import House
from app.services.whatsapp_service_client import (
    whatsapp_service_client,
    WhatsAppServiceError,
)
from app.services.ga_live_whatsapp_image import build_ga_live_report_image
from app.services.whatsapp_token import with_house_token
from app.utils.activity_logger import log_activity
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)


def _today_bst() -> datetime:
    return now_naive()


async def _log_schedule_action(
    db: AsyncSession,
    schedule: WhatsAppSchedule,
    action: str,
    new_values: dict | None = None,
    old_values: dict | None = None,
    status_code: int = 200,
    error: str | None = None,
):
    user_id = schedule.created_by
    user_name = None
    if user_id:
        res = await db.execute(select(User.id, User.name).where(User.id == user_id))
        row = res.first()
        if row:
            user_name = row.name
    await log_activity(
        db,
        user_id=user_id or 0,
        user_name=user_name or "System",
        module="live_activations",
        action=action,
        record_id=schedule.id,
        record_identifier=f"{schedule.whatsapp_chat_name} ({schedule.schedule_time})",
        old_values=old_values,
        new_values=new_values,
        status_code=status_code,
        duration_ms=None,
    )
    if error:
        logger.error(f"WhatsApp schedule {schedule.id} action '{action}' failed: {error}")


async def send_schedule_report(db: AsyncSession, schedule: WhatsAppSchedule) -> bool:
    """Generate the house's live report and post it as a PNG image to the WhatsApp chat."""
    try:
        image_bytes = await build_ga_live_report_image(db, schedule.house_id)
    except Exception as e:
        schedule.last_status = "failed"
        schedule.last_error = f"Report build failed: {str(e)}"
        await db.commit()
        await _log_schedule_action(db, schedule, "whatsapp_send_failed", status_code=500, error=str(e))
        return False

    caption = schedule.caption or f"GA Live Report - {_today_bst().strftime('%d %B %Y')}"

    # Resolve per-house JWT token
    house_res = await db.execute(select(House).where(House.id == schedule.house_id))
    house = house_res.scalar_one_or_none()
    if not house or not house.wa_jwt_token:
        schedule.last_status = "failed"
        schedule.last_error = "WhatsApp not configured for this house"
        await db.commit()
        await _log_schedule_action(db, schedule, "whatsapp_send_failed", status_code=500,
                                   error="WhatsApp not configured")
        return False

    try:
        await with_house_token(
            db,
            house,
            lambda token: whatsapp_service_client.send_image(
                jwt_token=token,
                chat_jid=schedule.whatsapp_chat_id,
                filename="ga_live_report.png",
                image_bytes=image_bytes,
                caption=caption,
            ),
        )
    except WhatsAppServiceError as e:
        schedule.last_status = "failed"
        schedule.last_error = f"{e.code}: {e.message}"
        await db.commit()
        await _log_schedule_action(
            db, schedule, "whatsapp_send_failed", status_code=500,
            new_values={"error": schedule.last_error}, error=str(e),
        )
        return False

    now = _today_bst()
    schedule.last_run_date = now.date()
    schedule.last_run_at = now
    schedule.last_status = "success"
    schedule.last_error = None
    await db.commit()
    await _log_schedule_action(
        db,
        schedule,
        "whatsapp_send",
        new_values={
            "house_id": schedule.house_id,
            "chat": schedule.whatsapp_chat_name,
            "schedule_time": schedule.schedule_time,
            "messages": 1,
            "format": "image",
        },
    )
    logger.info(
        f"WhatsApp report sent: house={schedule.house_id} chat={schedule.whatsapp_chat_name} "
        f"schedule={schedule.schedule_time} format=image"
    )
    return True


async def _is_due(schedule: WhatsAppSchedule, now: datetime) -> bool:
    """Decide whether a schedule should fire right now based on its type."""
    if schedule.schedule_type == "interval":
        minutes = schedule.interval_minutes or 1
        if schedule.last_run_at is None:
            return True
        elapsed = (now - schedule.last_run_at).total_seconds() / 60
        return elapsed >= minutes
    # daily mode
    if schedule.last_run_date == now.date():
        return False
    return schedule.schedule_time <= now.strftime("%H:%M")


async def check_and_run_due_schedules(db: AsyncSession) -> int:
    """Find active schedules that are due and deliver their report."""
    now = _today_bst()

    result = await db.execute(
        select(WhatsAppSchedule).where(
            WhatsAppSchedule.is_active == True,  # noqa: E712
            WhatsAppSchedule.is_deleted == False,  # noqa: E712
        )
    )
    schedules = result.scalars().all()

    ran = 0
    for s in schedules:
        if not await _is_due(s, now):
            continue
        ran += 1
        await send_schedule_report(db, s)
    return ran
