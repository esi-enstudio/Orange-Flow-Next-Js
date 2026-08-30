import json
import logging
from datetime import datetime, date, time, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.whatsapp_schedule import WhatsAppSchedule
from app.models.whatsapp_delivery_log import WhatsAppDeliveryLog
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


def _parse_schedule_time(value: str | None) -> time | None:
    """Parse an HH:MM string into a time, or None when absent/invalid."""
    if not value:
        return None
    try:
        hh, mm = value.split(":")
        return time(int(hh), int(mm))
    except (ValueError, AttributeError):
        return None


def _build_caption(report_type: str, custom_caption: str | None) -> str:
    """Build the final caption for a report image.

    - No custom caption: "<Report Title> - <date>, <time>"
    - Custom caption:    "<custom caption> - <date>, <time>"
    """
    title = get_report_title(report_type)
    timestamp = _today_bst().strftime("%d %B %Y, %I:%M %p")
    base = custom_caption.strip() if custom_caption and custom_caption.strip() else title
    return f"{base} - {timestamp}"


def _parse_json_array(value) -> list[str]:
    if not value:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    try:
        parsed = json.loads(value)
        if isinstance(parsed, list):
            return [str(v).strip() for v in parsed if str(v).strip()]
    except (ValueError, TypeError):
        pass
    return []


def _first_run_at(schedule: WhatsAppSchedule, now: datetime) -> datetime | None:
    """The schedule's configured first-run moment (BST), or None when no
    first-run time is set (i.e. \"00:00\" -> deliver as soon as the window
    opens). Ignores the missing first-run day by falling back to today."""
    first = _parse_schedule_time(schedule.schedule_time)
    if first is None:
        return None
    return datetime.combine(schedule.starts_on or now.date(), first)


def _window_bounds(schedule: WhatsAppSchedule) -> tuple[time, time]:
    """Return the interval schedule's daily delivery window (start, end).

    Invalid/missing values degrade to a full-day window (00:00 - 23:59) so
    misconfigured rows never silently stop delivering.
    """
    st = _parse_schedule_time(getattr(schedule, "start_time", None) or "00:00")
    en = _parse_schedule_time(getattr(schedule, "end_time", None) or "23:59")
    st = st or time(0, 0)
    en = en or time(23, 59)
    if st > en:
        # Cross-midnight / invalid window -> treat as unrestricted.
        return time(0, 0), time(23, 59)
    return st, en


def _in_window(schedule: WhatsAppSchedule, moment: datetime) -> bool:
    """Whether a delivery moment falls inside the interval daily window.

    Only interval schedules are windowed; daily schedules fire once at their
    own fixed time and are never restricted.
    """
    if schedule.schedule_type != "interval":
        return True
    st, en = _window_bounds(schedule)
    return st <= moment.time() <= en


def _clamp_to_window(schedule: WhatsAppSchedule, candidate: datetime, now: datetime) -> datetime:
    """Push an interval candidate run into the next valid window moment."""
    if schedule.schedule_type != "interval":
        return candidate
    st, en = _window_bounds(schedule)

    if not (st <= candidate.time() <= en):
        if candidate.time() > en:
            candidate = datetime.combine(candidate.date() + timedelta(days=1), st)
        else:
            candidate = datetime.combine(candidate.date(), st)

    # A candidate in the past is due right now when we're already inside the
    # window (the runner will fire it on the next tick), otherwise wait for the
    # next window to open.
    if candidate < now:
        if st <= now.time() <= en:
            candidate = now
        else:
            candidate = datetime.combine(now.date() + timedelta(days=1), st)
    return candidate


def _mark_run_status(
    schedule: WhatsAppSchedule,
    triggered_by: str,
    status: str,
    error: str | None = None,
    *,
    run_at: datetime | None = None,
) -> None:
    """Update schedule-level run tracking.

    Only schedule-triggered runs mutate ``last_run_*``. A manual \"Send Now\"
    (test send) must never touch these fields — otherwise a pre-start test
    send makes a future-dated interval schedule look \"already running\", so
    the elapsed-time check fires it immediately instead of waiting for its
    configured first-run time (regression: report delivered from 08:49 AM
    instead of the set 11:00 AM).
    """
    if triggered_by != "schedule":
        # Manual "Send Now" must not move the schedule's run timeline, but a
        # failure reason is still worth persisting for troubleshooting.
        if status == "failed" and error:
            schedule.last_error = error
        return
    schedule.last_status = status
    schedule.last_error = error
    if run_at is not None:
        # Advance the run timeline even on (partial) failure so a persistent
        # gateway error doesn't turn into a tight retry loop every 30s.
        schedule.last_run_date = run_at.date()
        schedule.last_run_at = run_at


def get_schedule_targets(schedule: WhatsAppSchedule) -> list[tuple[str, str]]:
    """Return [(chat_id, chat_name)] for a schedule.

    Multi-recipient schedules store a JSON array; older rows fall back to the
    single whatsapp_chat_id/whatsapp_chat_name columns.
    """
    ids = _parse_json_array(schedule.target_ids)
    names = _parse_json_array(schedule.target_names)
    if ids:
        return [
            (cid, names[i] if i < len(names) else cid)
            for i, cid in enumerate(ids)
        ]
    return [(schedule.whatsapp_chat_id, schedule.whatsapp_chat_name)]


def get_schedule_target_names(schedule: WhatsAppSchedule) -> list[str]:
    return [name for _, name in get_schedule_targets(schedule)]


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


async def _record_delivery(
    db: AsyncSession,
    *,
    house_id: int,
    schedule: WhatsAppSchedule | None,
    report_type: str,
    channel: str,
    triggered_by: str,
    target_count: int,
    delivered_count: int,
    status: str,
    error: str | None = None,
    chat_names: list[str] | None = None,
    user_id: int | None = None,
):
    """Append an immutable delivery-history row for a delivery attempt."""
    if status == "failed" and delivered_count == target_count:
        status = "success"
    elif status == "success" and delivered_count < target_count:
        status = "partial"
    entry = WhatsAppDeliveryLog(
        house_id=house_id,
        schedule_id=schedule.id if schedule else None,
        report_type=report_type,
        channel=channel,
        triggered_by=triggered_by,
        target_count=target_count,
        delivered_count=delivered_count,
        status=status,
        error=error,
        chat_names=json.dumps(chat_names or []),
        created_by=user_id or (schedule.created_by if schedule else None),
    )
    db.add(entry)
    await db.commit()
    logger.info(
        f"Delivery log house={house_id} type={report_type} channel={channel} "
        f"status={status} delivered={delivered_count}/{target_count} error={error or '-'}"
    )


async def send_schedule_report(
    db: AsyncSession,
    schedule: WhatsAppSchedule,
    triggered_by: str = "schedule",
) -> bool:
    """Generate the house's live report and post it to the configured channel."""
    if (getattr(schedule, "channel", None) or "whatsapp") == "telegram":
        return await _send_telegram_report(db, schedule, triggered_by)
    return await _send_whatsapp_report(db, schedule, triggered_by)


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
    whatsapp_chat_ids: list[str] | None = None,
    whatsapp_chat_names: list[str] | None = None,
    caption: str | None = None,
) -> tuple[bool, str | None]:
    """Send a report image immediately without creating a schedule.

    Accepts a single recipient (whatsapp_chat_id/whatsapp_chat_name) or a list
    of recipients (whatsapp_chat_ids/whatsapp_chat_names). Returns
    (success, error_message); success is True only when every recipient got it.
    """
    title = get_report_title(report_type)

    # Resolve recipient list for the WhatsApp channel
    targets: list[tuple[str, str]] = []
    if channel == "whatsapp":
        if whatsapp_chat_ids:
            names = whatsapp_chat_names or []
            targets = [
                (cid, names[i] if i < len(names) else cid)
                for i, cid in enumerate(whatsapp_chat_ids)
                if cid and cid.strip()
            ]
        elif whatsapp_chat_id and whatsapp_chat_id.strip():
            targets = [(whatsapp_chat_id.strip(), whatsapp_chat_name or whatsapp_chat_id.strip())]
        if not targets:
            return False, "WhatsApp chat is required"

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
    delivered = 0
    error: str | None = None
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
            error = e.description
            await log_activity(
                db,
                user_id=user_id,
                user_name=user_name,
                module="live_activations",
                action="report.direct_send_failed",
                record_identifier=f"{title} → {house.telegram_chat_name or house.telegram_chat_id}",
                new_values={"error": error, "channel": "telegram"},
                status_code=502,
            )
        else:
            delivered = 1
        sent_to = house.telegram_chat_name or house.telegram_chat_id
        log_channel = "telegram_send"
        chat_names = [sent_to]
    else:
        target = await resolve_house_wa_target(db, house)
        if not target or not target.jwt_token:
            error = "WhatsApp not configured for this house"
            await _record_delivery(
                db, house_id=house_id, schedule=None, report_type=report_type,
                channel="whatsapp", triggered_by="manual",
                target_count=len(targets), delivered_count=0, status="failed",
                error=error, chat_names=[n for _, n in targets], user_id=user_id,
            )
            return False, error
        for chat_id, chat_name in targets:
            try:
                await with_target_token(
                    db,
                    target,
                    lambda token, jid=chat_id: whatsapp_service_client.send_image(
                        jwt_token=token,
                        chat_jid=jid,
                        filename=f"{report_type}_report.png",
                        image_bytes=image_bytes,
                        caption=final_caption,
                    ),
                )
                delivered += 1
            except WhatsAppServiceError as e:
                error = f"{e.code}: {e.message} (in {chat_name})"
        sent_to = ", ".join(n for _, n in targets)
        log_channel = "whatsapp_send"
        chat_names = [n for _, n in targets]

    # 3b. Delivery history entry
    ok_all = delivered == (len(targets) if channel == "whatsapp" else 1)
    await _record_delivery(
        db, house_id=house_id, schedule=None, report_type=report_type,
        channel=channel, triggered_by="manual",
        target_count=len(targets) if channel == "whatsapp" else 1,
        delivered_count=delivered,
        status="success" if ok_all else "failed",
        error=error if not ok_all else None,
        chat_names=chat_names,
        user_id=user_id,
    )

    if not ok_all:
        await log_activity(
            db,
            user_id=user_id,
            user_name=user_name,
            module="live_activations",
            action="report.direct_send_failed",
            record_identifier=f"{title} → {sent_to}",
            new_values={"error": error, "channel": channel, "delivered": delivered},
            status_code=502,
        )
        return False, error

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
            "channel": channel,
            "chat": sent_to,
            "mode": "direct",
            "format": "image",
        },
        status_code=200,
    )
    logger.info(f"Direct report sent: house={house_id} type={report_type} to={sent_to}")
    return True, None


async def _send_telegram_report(
    db: AsyncSession,
    schedule: WhatsAppSchedule,
    triggered_by: str = "schedule",
) -> bool:
    """Post the report image to the house's linked Telegram group."""
    report_type = getattr(schedule, "report_type", None) or "ga_live"
    try:
        builder = get_report_builder(report_type)
        image_bytes = await builder(db, schedule.house_id)
    except ValueError as e:
        _mark_run_status(schedule, triggered_by, "failed", f"Unknown report type: {report_type}")
        await db.commit()
        await _record_delivery(
            db, house_id=schedule.house_id, schedule=schedule,
            report_type=report_type, channel="telegram", triggered_by=triggered_by,
            target_count=1, delivered_count=0, status="failed", error=schedule.last_error,
        )
        await _log_schedule_action(db, schedule, "telegram_send_failed", status_code=500, error=str(e))
        return False
    except Exception as e:
        _mark_run_status(schedule, triggered_by, "failed", f"Report build failed: {str(e)}")
        await db.commit()
        await _record_delivery(
            db, house_id=schedule.house_id, schedule=schedule,
            report_type=report_type, channel="telegram", triggered_by=triggered_by,
            target_count=1, delivered_count=0, status="failed", error=schedule.last_error,
        )
        await _log_schedule_action(db, schedule, "telegram_send_failed", status_code=500, error=str(e))
        return False

    caption = _build_caption(report_type, schedule.caption)

    house_res = await db.execute(select(House).where(House.id == schedule.house_id))
    house = house_res.scalar_one_or_none()
    if not house or not house.telegram_chat_id:
        _mark_run_status(schedule, triggered_by, "failed",
                         "No Telegram group linked for this house" if house else "House not found for this schedule")
        await db.commit()
        await _record_delivery(
            db, house_id=schedule.house_id, schedule=schedule,
            report_type=report_type, channel="telegram", triggered_by=triggered_by,
            target_count=1, delivered_count=0, status="failed", error=schedule.last_error,
        )
        await _log_schedule_action(db, schedule, "telegram_send_failed", status_code=500,
                                   error=schedule.last_error)
        return False

    bot = await telegram_service.resolve_house_tg_bot(db, house)
    if not bot:
        _mark_run_status(schedule, triggered_by, "failed", "No Telegram bot assigned to this house")
        await db.commit()
        await _record_delivery(
            db, house_id=schedule.house_id, schedule=schedule,
            report_type=report_type, channel="telegram", triggered_by=triggered_by,
            target_count=1, delivered_count=0, status="failed", error=schedule.last_error,
        )
        await _log_schedule_action(db, schedule, "telegram_send_failed", status_code=400,
                                   error=schedule.last_error)
        return False

    chat_name = house.telegram_chat_name or house.telegram_chat_id
    try:
        await telegram_service.send_photo(
            token=bot.bot_token,
            chat_id=house.telegram_chat_id,
            image_bytes=image_bytes,
            caption=caption,
        )
    except TelegramError as e:
        _mark_run_status(schedule, triggered_by, "failed", e.description)
        await db.commit()
        await _record_delivery(
            db, house_id=schedule.house_id, schedule=schedule,
            report_type=report_type, channel="telegram", triggered_by=triggered_by,
            target_count=1, delivered_count=0, status="failed", error=schedule.last_error,
            chat_names=[chat_name],
        )
        await _log_schedule_action(
            db, schedule, "telegram_send_failed", status_code=502,
            new_values={"error": schedule.last_error}, error=str(e),
        )
        return False

    now = _today_bst()
    _mark_run_status(schedule, triggered_by, "success", None, run_at=now)
    await db.commit()
    await _record_delivery(
        db, house_id=schedule.house_id, schedule=schedule,
        report_type=report_type, channel="telegram", triggered_by=triggered_by,
        target_count=1, delivered_count=1, status="success", chat_names=[chat_name],
    )
    await _log_schedule_action(
        db,
        schedule,
        "telegram_send",
        new_values={
            "house_id": schedule.house_id,
            "chat": chat_name,
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


async def _send_whatsapp_report(
    db: AsyncSession,
    schedule: WhatsAppSchedule,
    triggered_by: str = "schedule",
) -> bool:
    """Generate the report image and post it to all scheduled WhatsApp chats."""
    report_type = getattr(schedule, "report_type", None) or "ga_live"
    targets = get_schedule_targets(schedule)
    total = len(targets)
    chat_names = [n for _, n in targets]

    try:
        builder = get_report_builder(report_type)
        image_bytes = await builder(db, schedule.house_id)
    except ValueError as e:
        _mark_run_status(schedule, triggered_by, "failed", f"Unknown report type: {report_type}")
        await db.commit()
        await _record_delivery(
            db, house_id=schedule.house_id, schedule=schedule,
            report_type=report_type, channel="whatsapp", triggered_by=triggered_by,
            target_count=total, delivered_count=0, status="failed",
            error=schedule.last_error, chat_names=chat_names,
        )
        await _log_schedule_action(db, schedule, "whatsapp_send_failed", status_code=500, error=str(e))
        return False
    except Exception as e:
        _mark_run_status(schedule, triggered_by, "failed", f"Report build failed: {str(e)}")
        await db.commit()
        await _record_delivery(
            db, house_id=schedule.house_id, schedule=schedule,
            report_type=report_type, channel="whatsapp", triggered_by=triggered_by,
            target_count=total, delivered_count=0, status="failed",
            error=schedule.last_error, chat_names=chat_names,
        )
        await _log_schedule_action(db, schedule, "whatsapp_send_failed", status_code=500, error=str(e))
        return False

    caption = _build_caption(report_type, schedule.caption)

    # Resolve WhatsApp credentials: shared connection first, then own device
    house_res = await db.execute(select(House).where(House.id == schedule.house_id))
    house = house_res.scalar_one_or_none()
    if not house:
        _mark_run_status(schedule, triggered_by, "failed", "House not found for this schedule")
        await db.commit()
        await _record_delivery(
            db, house_id=schedule.house_id, schedule=schedule,
            report_type=report_type, channel="whatsapp", triggered_by=triggered_by,
            target_count=total, delivered_count=0, status="failed",
            error=schedule.last_error, chat_names=chat_names,
        )
        await _log_schedule_action(db, schedule, "whatsapp_send_failed", status_code=500,
                                   error="House not found")
        return False

    target = await resolve_house_wa_target(db, house)
    if not target or not target.jwt_token:
        _mark_run_status(schedule, triggered_by, "failed", "WhatsApp not configured for this house")
        await db.commit()
        await _record_delivery(
            db, house_id=schedule.house_id, schedule=schedule,
            report_type=report_type, channel="whatsapp", triggered_by=triggered_by,
            target_count=total, delivered_count=0, status="failed",
            error=schedule.last_error, chat_names=chat_names,
        )
        await _log_schedule_action(db, schedule, "whatsapp_send_failed", status_code=500,
                                   error="WhatsApp not configured")
        return False

    delivered = 0
    first_error: str | None = None
    for chat_id, chat_name in targets:
        try:
            await with_target_token(
                db,
                target,
                lambda token, jid=chat_id: whatsapp_service_client.send_image(
                    jwt_token=token,
                    chat_jid=jid,
                    filename=f"{report_type}_report.png",
                    image_bytes=image_bytes,
                    caption=caption,
                ),
            )
            delivered += 1
        except WhatsAppServiceError as e:
            if first_error is None:
                first_error = f"{e.code}: {e.message} (in {chat_name})"
            logger.warning(f"Schedule {schedule.id}: delivery to {chat_name} failed: {e.code}: {e.message}")

    now = _today_bst()
    if delivered == total:
        _mark_run_status(schedule, triggered_by, "success", None, run_at=now)
    else:
        _mark_run_status(schedule, triggered_by, "failed", first_error or "Send failed", run_at=now)
    await db.commit()

    await _record_delivery(
        db, house_id=schedule.house_id, schedule=schedule,
        report_type=report_type, channel="whatsapp", triggered_by=triggered_by,
        target_count=total, delivered_count=delivered,
        status="success" if delivered == total else "failed",
        error=None if delivered == total else schedule.last_error,
        chat_names=chat_names,
    )
    await _log_schedule_action(
        db,
        schedule,
        "whatsapp_send",
        new_values={
            "house_id": schedule.house_id,
            "chat": ", ".join(chat_names),
            "schedule_time": schedule.schedule_time,
            "delivered": delivered,
            "targets": total,
            "format": "image",
        },
    )
    ok = delivered == total
    if not ok:
        await _log_schedule_action(
            db, schedule, "whatsapp_send_failed", status_code=502,
            new_values={"error": schedule.last_error, "delivered": delivered, "targets": total},
            error=str(first_error),
        )
    logger.info(
        f"WhatsApp report sent: house={schedule.house_id} targets={delivered}/{total} "
        f"schedule={schedule.schedule_time} format=image"
    )
    return ok


def compute_next_run(schedule: WhatsAppSchedule, now: datetime | None = None) -> datetime | None:
    """Estimate the next delivery time (naive BST), or None when it can never run."""
    now = now or _today_bst()
    today = now.date()
    if not schedule.is_active:
        return None

    def _at(d: date, t: time = time(9, 0)) -> datetime:
        return datetime.combine(d, t)

    tz_time = time(9, 0)
    if schedule.schedule_type == "daily":
        try:
            hh, mm = schedule.schedule_time.split(":")
            tz_time = time(int(hh), int(mm))
        except (ValueError, AttributeError):
            tz_time = time(9, 0)
    else:
        minutes = schedule.interval_minutes or 1
        if schedule.ends_on and today > schedule.ends_on:
            return None
        if schedule.starts_on and today < schedule.starts_on:
            candidate = _first_run_at(schedule, now) or _at(schedule.starts_on, time(0, 0))
        else:
            first = _parse_schedule_time(schedule.schedule_time)
            first_dt = None
            if first is not None:
                first_dt = _at(schedule.starts_on or today, first)
            # Fresh until the schedule's configured first-run moment has passed.
            # A last_run_at from a manual "Send Now" before starts_on must not
            # count as already started.
            fresh = schedule.last_run_at is None or (
                schedule.starts_on is not None
                and first_dt is not None
                and schedule.last_run_at < first_dt
            )
            if fresh:
                if first_dt is not None:
                    candidate = first_dt if first_dt > now else now
                else:
                    # Optional first-run time; leave empty/00:00 to start immediately.
                    candidate = now
            else:
                nxt = schedule.last_run_at + timedelta(minutes=minutes)
                candidate = nxt if nxt >= now else now
        candidate = _clamp_to_window(schedule, candidate, now)
        if schedule.ends_on and candidate.date() > schedule.ends_on:
            return None
        return candidate

    # daily mode
    if schedule.starts_on and today < schedule.starts_on:
        return _at(schedule.starts_on, tz_time)
    nxt = _at(today, tz_time)
    if nxt <= now:
        nxt = nxt + timedelta(days=1)
    if schedule.ends_on and nxt.date() > schedule.ends_on:
        return None
    return nxt


async def _is_due(schedule: WhatsAppSchedule, now: datetime) -> bool:
    """Decide whether a schedule should fire right now based on its type & window."""
    today = now.date()
    if schedule.starts_on and today < schedule.starts_on:
        return False
    if schedule.ends_on and today > schedule.ends_on:
        return False
    if schedule.schedule_type == "interval":
        minutes = schedule.interval_minutes or 1

        # Restrict deliveries to the daily window (e.g. 08:00-21:00). Without
        # this, a 30-minute cadence keeps firing through midnight/1 AM/2 AM.
        if not _in_window(schedule, now):
            return False

        first = _parse_schedule_time(schedule.schedule_time)
        first_dt = None
        if first is not None:
            first_dt = datetime.combine(schedule.starts_on or today, first)

        # Fresh until the schedule's configured first-run moment has passed.
        # A last_run_at from a manual "Send Now" before starts_on must not
        # make the schedule look already-running.
        fresh = schedule.last_run_at is None or (
            schedule.starts_on is not None
            and first_dt is not None
            and schedule.last_run_at < first_dt
        )
        if fresh:
            # Never deliver before the configured first-run moment.
            if first_dt is not None and now < first_dt:
                return False
            # Fire exactly once the first-run moment has passed (or
            # immediately when no first-run time is configured).
            return first_dt is None or now >= first_dt
        elapsed = (now - schedule.last_run_at).total_seconds() / 60
        return elapsed >= minutes
    # daily mode
    if schedule.last_run_date == today:
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
        await send_schedule_report(db, s, triggered_by="schedule")
    return ran