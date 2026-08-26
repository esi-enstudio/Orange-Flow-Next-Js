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
from app.services import telegram_service
from app.services.telegram_service import TelegramError
from app.services.report_builders import get_report_builder, get_report_title
from app.services.whatsapp_token import resolve_house_wa_target, with_target_token
from app.utils.activity_logger import log_activity
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)


def _today_bst() -> datetime:
    return now_naive()


def _build_caption(report_type: str, custom_caption: str | None) -> str:
    """Build the final caption for a report image.

    - No custom caption: "<Report Title> - <date>, <time>"
    - Custom caption:    "<custom caption> - <date>, <time>"
    """
    title = get_report_title(report_type)
    timestamp = _today_bst().strftime("%d %B %Y, %I:%M %p")
    base = custom_caption.strip() if custom_caption and custom_caption.strip() else title
    return f"{base} - {timestamp}"


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
    """Generate the house's live report and post it to the configured channel."""
    if (getattr(schedule, "channel", None) or "whatsapp") == "telegram":
        return await _send_telegram_report(db, schedule)
    return await _send_whatsapp_report(db, schedule)


async def send_direct_report(
    db: AsyncSession,
    *,
    user_id: int,
    user_name: str,
    house_id: int,
    report_type: str,
    channel: str = "whatsapp",
    whatsapp_chat_id: str | None = None,
    whatsapp_chat_name: str | None = None,
    caption: str | None = None,
) -> tuple[bool, str | None]:
    """Send a report image immediately without creating a schedule.

    Returns (success, error_message).
    """
    title = get_report_title(report_type)

    # 1. Build the report image
    try:
        builder = get_report_builder(report_type)
        image_bytes = await builder(db, house_id)
    except ValueError as e:
        return False, f"Unknown report type: {report_type}"
    except Exception as e:
        logger.error(f"Direct report build failed: {e}")
        return False, f"Report build failed: {str(e)}"

    final_caption = _build_caption(report_type, caption)

    # 2. Resolve the house
    house_res = await db.execute(select(House).where(House.id == house_id))
    house = house_res.scalar_one_or_none()
    if not house:
        return False, "House not found"

    # 3. Send via the requested channel
    if channel == "telegram":
        if not house.telegram_chat_id:
            return False, "No Telegram group linked for this house"
        bot = await telegram_service.resolve_house_tg_bot(db, house)
        if not bot:
            return False, "No Telegram bot assigned to this house"
        try:
            await telegram_service.send_photo(
                token=bot.bot_token,
                chat_id=house.telegram_chat_id,
                image_bytes=image_bytes,
                caption=final_caption,
            )
        except TelegramError as e:
            await log_activity(
                db,
                user_id=user_id,
                user_name=user_name,
                module="live_activations",
                action="report.direct_send_failed",
                record_identifier=f"{title} → {house.telegram_chat_name or house.telegram_chat_id}",
                new_values={"error": e.description, "channel": "telegram"},
                status_code=502,
            )
            return False, e.description
        sent_to = house.telegram_chat_name or house.telegram_chat_id
        log_channel = "telegram_send"
    else:
        if not whatsapp_chat_id or not whatsapp_chat_id.strip():
            return False, "WhatsApp chat is required"
        target = await resolve_house_wa_target(db, house)
        if not target or not target.jwt_token:
            return False, "WhatsApp not configured for this house"
        try:
            await with_target_token(
                db,
                target,
                lambda token: whatsapp_service_client.send_image(
                    jwt_token=token,
                    chat_jid=whatsapp_chat_id.strip(),
                    filename=f"{report_type}_report.png",
                    image_bytes=image_bytes,
                    caption=final_caption,
                ),
            )
        except WhatsAppServiceError as e:
            await log_activity(
                db,
                user_id=user_id,
                user_name=user_name,
                module="live_activations",
                action="report.direct_send_failed",
                record_identifier=f"{title} → {whatsapp_chat_name or whatsapp_chat_id}",
                new_values={"error": f"{e.code}: {e.message}", "channel": "whatsapp"},
                status_code=502,
            )
            return False, f"{e.code}: {e.message}"
        sent_to = whatsapp_chat_name or whatsapp_chat_id
        log_channel = "whatsapp_send"

    # 4. Log success
    await log_activity(
        db,
        user_id=user_id,
        user_name=user_name,
        module="live_activations",
        action=log_channel,
        record_identifier=f"{title} → {sent_to}",
        new_values={
            "house_id": house_id,
            "report_type": report_type,
            "chat": sent_to,
            "mode": "direct",
            "format": "image",
        },
        status_code=200,
    )
    logger.info(f"Direct report sent: house={house_id} type={report_type} to={sent_to}")
    return True, None


async def _send_telegram_report(db: AsyncSession, schedule: WhatsAppSchedule) -> bool:
    """Post the report image to the house's linked Telegram group."""
    report_type = getattr(schedule, "report_type", None) or "ga_live"
    try:
        builder = get_report_builder(report_type)
        image_bytes = await builder(db, schedule.house_id)
    except ValueError as e:
        schedule.last_status = "failed"
        schedule.last_error = f"Unknown report type: {report_type}"
        await db.commit()
        await _log_schedule_action(db, schedule, "telegram_send_failed", status_code=500, error=str(e))
        return False
    except Exception as e:
        schedule.last_status = "failed"
        schedule.last_error = f"Report build failed: {str(e)}"
        await db.commit()
        await _log_schedule_action(db, schedule, "telegram_send_failed", status_code=500, error=str(e))
        return False

    caption = _build_caption(report_type, schedule.caption)

    house_res = await db.execute(select(House).where(House.id == schedule.house_id))
    house = house_res.scalar_one_or_none()
    if not house:
        schedule.last_status = "failed"
        schedule.last_error = "House not found for this schedule"
        await db.commit()
        await _log_schedule_action(db, schedule, "telegram_send_failed", status_code=500,
                                   error="House not found")
        return False

    if not house.telegram_chat_id:
        schedule.last_status = "failed"
        schedule.last_error = "No Telegram group linked for this house"
        await db.commit()
        await _log_schedule_action(db, schedule, "telegram_send_failed", status_code=400,
                                   error=schedule.last_error)
        return False

    bot = await telegram_service.resolve_house_tg_bot(db, house)
    if not bot:
        schedule.last_status = "failed"
        schedule.last_error = "No Telegram bot assigned to this house"
        await db.commit()
        await _log_schedule_action(db, schedule, "telegram_send_failed", status_code=400,
                                   error=schedule.last_error)
        return False

    try:
        await telegram_service.send_photo(
            token=bot.bot_token,
            chat_id=house.telegram_chat_id,
            image_bytes=image_bytes,
            caption=caption,
        )
    except TelegramError as e:
        schedule.last_status = "failed"
        schedule.last_error = e.description
        await db.commit()
        await _log_schedule_action(
            db, schedule, "telegram_send_failed", status_code=502,
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
        "telegram_send",
        new_values={
            "house_id": schedule.house_id,
            "chat": house.telegram_chat_name or house.telegram_chat_id,
            "bot": bot.name,
            "schedule_time": schedule.schedule_time,
            "messages": 1,
            "format": "image",
        },
    )
    logger.info(
        f"Telegram report sent: house={schedule.house_id} chat={house.telegram_chat_id} "
        f"bot={bot.name} schedule={schedule.schedule_time} format=image"
    )
    return True


async def _send_whatsapp_report(db: AsyncSession, schedule: WhatsAppSchedule) -> bool:
    """Generate the report image and post it to the WhatsApp chat."""
    report_type = getattr(schedule, "report_type", None) or "ga_live"
    try:
        builder = get_report_builder(report_type)
        image_bytes = await builder(db, schedule.house_id)
    except ValueError as e:
        schedule.last_status = "failed"
        schedule.last_error = f"Unknown report type: {report_type}"
        await db.commit()
        await _log_schedule_action(db, schedule, "whatsapp_send_failed", status_code=500, error=str(e))
        return False
    except Exception as e:
        schedule.last_status = "failed"
        schedule.last_error = f"Report build failed: {str(e)}"
        await db.commit()
        await _log_schedule_action(db, schedule, "whatsapp_send_failed", status_code=500, error=str(e))
        return False

    caption = _build_caption(report_type, schedule.caption)

    # Resolve WhatsApp credentials: shared connection first, then own device
    house_res = await db.execute(select(House).where(House.id == schedule.house_id))
    house = house_res.scalar_one_or_none()
    if not house:
        schedule.last_status = "failed"
        schedule.last_error = "House not found for this schedule"
        await db.commit()
        await _log_schedule_action(db, schedule, "whatsapp_send_failed", status_code=500,
                                   error="House not found")
        return False

    target = await resolve_house_wa_target(db, house)
    if not target or not target.jwt_token:
        schedule.last_status = "failed"
        schedule.last_error = "WhatsApp not configured for this house"
        await db.commit()
        await _log_schedule_action(db, schedule, "whatsapp_send_failed", status_code=500,
                                   error="WhatsApp not configured")
        return False

    try:
        await with_target_token(
            db,
            target,
            lambda token: whatsapp_service_client.send_image(
                jwt_token=token,
                chat_jid=schedule.whatsapp_chat_id,
                filename=f"{report_type}_report.png",
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
