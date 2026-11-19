import asyncio
import logging
from datetime import timedelta
from typing import Any

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.house import House
from app.models.live_c2c_automation import (
    LiveC2CAutomationConfig,
    LiveC2CInboundFile,
)
from app.models.user import User
from app.services.live_c2c_service import (
    LiveC2CImportError,
    list_live_c2c_worksheet_names,
    parse_live_c2c_workbook,
    prepare_live_c2c_import,
    store_live_c2c_rows,
)
from app.services.whatsapp_schedule_service import send_direct_report
from app.utils.activity_logger import log_activity
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)
PROCESSING_LEASE = timedelta(minutes=5)
MAX_DELIVERY_RETRY_DELAY = timedelta(hours=1)


async def _load_context(
    db: AsyncSession,
    record: LiveC2CInboundFile,
) -> tuple[LiveC2CAutomationConfig, House, User]:
    config = await db.scalar(
        select(LiveC2CAutomationConfig).where(
            LiveC2CAutomationConfig.id == record.config_id,
            LiveC2CAutomationConfig.house_id == record.house_id,
            LiveC2CAutomationConfig.is_deleted.is_(False),
        )
    )
    house = await db.scalar(select(House).where(House.id == record.house_id))
    if config is None or house is None:
        raise LiveC2CImportError("live_c2c_automation_config_missing")
    actor = await db.scalar(select(User).where(User.id == config.updated_by))
    if actor is None:
        raise LiveC2CImportError("live_c2c_automation_actor_missing")
    return config, house, actor


async def _audit_failure(
    db: AsyncSession,
    *,
    record: LiveC2CInboundFile,
    actor: User,
    stage: str,
    error_code: str,
) -> None:
    record.last_error = error_code
    record.lease_expires_at = (
        now_naive() + _delivery_retry_delay(record.delivery_attempts)
        if stage == "delivery"
        else None
    )
    await log_activity(
        db,
        user_id=actor.id,
        user_name=actor.name,
        module="live_c2c",
        action=f"automation.{stage}_failed",
        record_identifier=f"house:{record.house_id}/inbound:{record.id}",
        new_values={
            "error": error_code,
            "source_event_id": record.source_event_id,
        },
        request=None,
        status_code=500,
        commit=False,
    )
    await db.commit()


def _delivery_retry_delay(attempts: int) -> timedelta:
    seconds = min(30 * (2 ** min(max(attempts - 1, 0), 7)), int(MAX_DELIVERY_RETRY_DELAY.total_seconds()))
    return timedelta(seconds=seconds)


async def _record_actor(db: AsyncSession, record: LiveC2CInboundFile) -> User | None:
    return await db.scalar(select(User).where(User.id == record.created_by))


def _import_error_code(error: Exception) -> str:
    code = getattr(error, "code", None)
    if isinstance(code, str) and code:
        return code
    return "live_c2c_processing_failed"


async def _matching_worksheet(
    db: AsyncSession,
    *,
    record: LiveC2CInboundFile,
    house: House,
) -> tuple[str, list[dict[str, Any]]]:
    if not record.content:
        raise LiveC2CImportError("live_c2c_file_content_missing")
    sheet_names = list_live_c2c_worksheet_names(record.content, record.filename)
    matches: list[tuple[str, list[dict[str, Any]]]] = []
    first_error: LiveC2CImportError | None = None
    for sheet_name in sheet_names:
        try:
            rows = await asyncio.to_thread(
                parse_live_c2c_workbook,
                record.content,
                sheet_name,
                record.filename,
                house_code=house.code,
                house_name=house.name,
            )
        except LiveC2CImportError as exc:
            if first_error is None:
                first_error = exc
            continue

        prepared = await prepare_live_c2c_import(
            db,
            house_id=record.house_id,
            rows=rows,
            accessible_house_ids=[record.house_id],
        )
        if prepared.house_mismatch:
            raise LiveC2CImportError("live_c2c_house_mismatch")
        if prepared.can_import:
            matches.append((sheet_name, rows))
        elif first_error is None:
            first_error = LiveC2CImportError("live_c2c_entity_mismatch")

    if len(matches) > 1:
        raise LiveC2CImportError("live_c2c_multiple_matching_sheets")
    if not matches:
        if first_error is not None:
            raise first_error
        raise LiveC2CImportError("live_c2c_no_matching_sheet")
    return matches[0]


async def _process_import(
    db: AsyncSession,
    record: LiveC2CInboundFile,
) -> None:
    record.import_status = "processing"
    record.import_attempts += 1
    record.lease_expires_at = now_naive() + PROCESSING_LEASE
    await db.commit()

    try:
        config, house, actor = await _load_context(db, record)
        sheet_name, rows = await _matching_worksheet(db, record=record, house=house)
        await store_live_c2c_rows(
            db,
            house_id=record.house_id,
            user=actor,
            filename=record.filename,
            sheet_name=sheet_name,
            rows=rows,
            request=None,
        )
    except Exception as exc:
        await db.rollback()
        await db.refresh(record)
        error_code = _import_error_code(exc)
        record.import_status = "failed"
        try:
            try:
                _, _, actor = await _load_context(db, record)
            except LiveC2CImportError:
                actor = await _record_actor(db, record)
            if actor is None:
                raise LiveC2CImportError("live_c2c_automation_actor_missing")
            await _audit_failure(db, record=record, actor=actor, stage="import", error_code=error_code)
        except Exception:
            logger.exception(
                "Failed to audit Live C2C import failure for inbound record %s",
                record.id,
            )
            await db.rollback()
            await db.refresh(record)
            record.import_status = "failed"
            record.last_error = error_code
            record.lease_expires_at = None
            await db.commit()
        logger.exception("Live C2C inbound import failed for record %s", record.id, exc_info=exc)
        return

    record.import_status = "imported"
    record.delivery_status = "pending"
    record.content = None
    record.lease_expires_at = None
    record.last_error = None
    record.processed_at = now_naive()
    await db.commit()


async def _process_delivery(
    db: AsyncSession,
    record: LiveC2CInboundFile,
) -> None:
    try:
        config, _, actor = await _load_context(db, record)
    except Exception:
        record.delivery_status = "failed"
        actor = await _record_actor(db, record)
        if actor is not None:
            await _audit_failure(
                db,
                record=record,
                actor=actor,
                stage="delivery",
                error_code="live_c2c_automation_config_missing",
            )
        else:
            record.last_error = "live_c2c_automation_config_missing"
            record.lease_expires_at = None
            await db.commit()
        return

    record.delivery_status = "sending"
    record.delivery_attempts += 1
    record.lease_expires_at = now_naive() + PROCESSING_LEASE
    await db.commit()

    try:
        success, error = await send_direct_report(
            db,
            user_id=actor.id,
            user_name=actor.name,
            house_id=record.house_id,
            report_type="live_c2c",
            whatsapp_chat_id=config.destination_group_jid,
            activity_module="live_c2c",
        )
        if not success:
            raise RuntimeError(error or "live_c2c_delivery_failed")
    except Exception as exc:
        await db.rollback()
        await db.refresh(record)
        error_code = str(exc) or "live_c2c_delivery_failed"
        record.delivery_status = "failed"
        try:
            try:
                _, _, actor = await _load_context(db, record)
            except LiveC2CImportError:
                actor = await _record_actor(db, record)
            if actor is None:
                raise LiveC2CImportError("live_c2c_automation_actor_missing")
            await _audit_failure(
                db,
                record=record,
                actor=actor,
                stage="delivery",
                error_code=error_code,
            )
        except Exception:
            logger.exception(
                "Failed to audit Live C2C delivery failure for inbound record %s",
                record.id,
            )
            await db.rollback()
            await db.refresh(record)
            record.delivery_status = "failed"
            record.last_error = error_code
            record.lease_expires_at = None
            await db.commit()
        logger.exception("Live C2C report delivery failed for record %s", record.id, exc_info=exc)
        return

    record.delivery_status = "sent"
    record.lease_expires_at = None
    record.last_error = None
    await db.commit()


async def process_pending_live_c2c_files(
    db: AsyncSession,
    *,
    limit: int = 10,
) -> int:
    if limit <= 0:
        return 0
    now = now_naive()
    import_ready = or_(
        LiveC2CInboundFile.import_status == "queued",
        and_(
            LiveC2CInboundFile.import_status == "processing",
            or_(
                LiveC2CInboundFile.lease_expires_at.is_(None),
                LiveC2CInboundFile.lease_expires_at <= now,
            ),
        ),
    )
    delivery_ready = and_(
        LiveC2CInboundFile.import_status == "imported",
        or_(
            LiveC2CInboundFile.delivery_status == "pending",
            and_(
                LiveC2CInboundFile.delivery_status == "failed",
                or_(
                    LiveC2CInboundFile.lease_expires_at.is_(None),
                    LiveC2CInboundFile.lease_expires_at <= now,
                ),
            ),
            and_(
                LiveC2CInboundFile.delivery_status == "sending",
                or_(
                    LiveC2CInboundFile.lease_expires_at.is_(None),
                    LiveC2CInboundFile.lease_expires_at <= now,
                ),
            ),
        ),
    )
    statement = (
        select(LiveC2CInboundFile)
        .where(
            LiveC2CInboundFile.is_deleted.is_(False),
            or_(import_ready, delivery_ready),
        )
        .order_by(LiveC2CInboundFile.received_at, LiveC2CInboundFile.id)
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    records = list((await db.scalars(statement)).all())
    processed = 0
    for record in records:
        if record.import_status != "imported":
            await _process_import(db, record)
            await db.refresh(record)
        if record.import_status == "imported" and record.delivery_status != "sent":
            await _process_delivery(db, record)
        processed += 1
    return processed
