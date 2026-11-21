from datetime import timedelta
from io import BytesIO

import pytest
from openpyxl import Workbook
from sqlalchemy import func, select

from conftest import make_house
from app.models.activity_log import ActivityLog
from app.models.employee import Employee
from app.models.live_c2c import LiveC2CRow
from app.models.live_c2c_automation import (
    LiveC2CAutomationConfig,
    LiveC2CInboundFile,
)
from app.models.retailer import Retailer
from app.models.user import User
from app.utils.timezone import now_naive

try:
    from app.services import live_c2c_inbound_service as inbound_service
except ImportError:
    inbound_service = None


def _processor():
    assert inbound_service is not None, "Live C2C inbound processor has not been implemented"
    return inbound_service


def _workbook_bytes(sheets):
    workbook = Workbook()
    for index, (name, headers, rows) in enumerate(sheets):
        sheet = workbook.active if index == 0 else workbook.create_sheet()
        sheet.title = name
        sheet.append(headers)
        for row in rows:
            sheet.append(row)
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


async def _house_data(db, house, *, suffix="1"):
    employee = Employee(
        house_id=house.id,
        employee_type="rso",
        status="Active",
        employee_name=f"RSO {suffix}",
        itop_number=f"0170000000{suffix}",
        dms_code=f"RSO-{house.id}-{suffix}",
    )
    retailer = Retailer(
        house_id=house.id,
        retailer_code=f"RET-{house.id}-{suffix}",
        name=f"Retailer {suffix}",
        enabled="Yes",
        itop_number=f"0180000000{suffix}",
    )
    db.add_all([employee, retailer])
    await db.flush()
    return employee, retailer


async def _create_queue_item(
    db,
    *,
    house,
    filename="Live C2C report.xlsx",
    content,
    destination="120363000000000@g.us",
    status="queued",
    lease_expires_at=None,
):
    user = User(name="Automation Owner", email="owner@example.com", status="Active")
    db.add(user)
    await db.flush()
    config = LiveC2CAutomationConfig(
        house_id=house.id,
        source_type="gmail",
        is_enabled=True,
        gmail_address=house.email,
        destination_group_jid=destination,
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(config)
    await db.flush()
    record = LiveC2CInboundFile(
        house_id=house.id,
        config_id=config.id,
        source_type="gmail",
        source_event_id="gmail:message-1:attachment-1",
        destination_group_jid=destination,
        filename=filename,
        sha256="a" * 64,
        content=content,
        import_status=status,
        delivery_status="pending",
        import_attempts=0,
        delivery_attempts=0,
        lease_expires_at=lease_expires_at,
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(record)
    await db.commit()
    return config, record, user


def _valid_workbook(employee, retailer):
    return _workbook_bytes(
        [
            (
                "C2C Data",
                ["From Msisdn", "To Msisdn", "Modified ON", "Transfer Mrp"],
                [[employee.itop_number, retailer.itop_number, "10:30:00", "25.50"]],
            )
        ]
    )


def _matching_sheet(employee, retailer, name="C2C Data"):
    return (
        name,
        ["From Msisdn", "To Msisdn", "Modified ON", "Transfer Mrp"],
        [[employee.itop_number, retailer.itop_number, "10:30:00", "25.50"]],
    )


@pytest.mark.asyncio
async def test_malformed_workbook_fails_and_is_audited(db):
    service = _processor()
    house = await make_house(db)
    config, record, user = await _create_queue_item(db, house=house, content=b"not an xlsx")

    assert await service.process_pending_live_c2c_files(db) == 1

    await db.refresh(record)
    assert record.import_status == "failed"
    assert record.last_error == "live_c2c_invalid_workbook"
    assert record.content == b"not an xlsx"
    activity = await db.scalar(select(ActivityLog).where(ActivityLog.module == "live_c2c"))
    assert activity.user_id == user.id
    assert activity.action == "automation.import_failed"


@pytest.mark.asyncio
async def test_missing_automation_config_failure_is_audited_with_record_actor(db):
    service = _processor()
    house = await make_house(db)
    config, record, user = await _create_queue_item(db, house=house, content=b"not an xlsx")
    config.is_deleted = True
    await db.commit()

    await service.process_pending_live_c2c_files(db)

    await db.refresh(record)
    assert record.import_status == "failed"
    activity = await db.scalar(select(ActivityLog).where(ActivityLog.module == "live_c2c"))
    assert activity.user_id == user.id
    assert activity.action == "automation.import_failed"


@pytest.mark.asyncio
async def test_workbook_without_matching_worksheet_fails(db):
    service = _processor()
    house = await make_house(db)
    content = _workbook_bytes([("Summary", ["Summary"], [["not a report"]])])
    _, record, _ = await _create_queue_item(db, house=house, content=content)

    await service.process_pending_live_c2c_files(db)

    await db.refresh(record)
    assert record.import_status == "failed"
    assert record.last_error == "live_c2c_missing_columns"
    assert await db.scalar(select(func.count(LiveC2CRow.id))) == 0


@pytest.mark.asyncio
async def test_workbook_with_multiple_matching_worksheets_fails(db):
    service = _processor()
    house = await make_house(db)
    employee, retailer = await _house_data(db, house)
    content = _workbook_bytes(
        [
            _matching_sheet(employee, retailer, "C2C Data 1"),
            _matching_sheet(employee, retailer, "C2C Data 2"),
        ]
    )
    _, record, _ = await _create_queue_item(db, house=house, content=content)

    await service.process_pending_live_c2c_files(db)

    await db.refresh(record)
    assert record.import_status == "failed"
    assert record.last_error == "live_c2c_multiple_matching_sheets"
    assert await db.scalar(select(func.count(LiveC2CRow.id))) == 0


@pytest.mark.asyncio
async def test_workbook_matching_another_house_is_rejected(db):
    service = _processor()
    selected_house = await make_house(db)
    other_house = await make_house(
        db,
        code="H002",
        name="Other House",
        email="other@example.com",
    )
    other_employee, other_retailer = await _house_data(db, other_house, suffix="2")
    content = _valid_workbook(other_employee, other_retailer)
    _, record, _ = await _create_queue_item(db, house=selected_house, content=content)

    await service.process_pending_live_c2c_files(db)

    await db.refresh(record)
    assert record.import_status == "failed"
    assert record.last_error == "live_c2c_house_mismatch"
    assert await db.scalar(select(func.count(LiveC2CRow.id))) == 0


@pytest.mark.asyncio
async def test_successful_import_sends_report_to_configured_group(db, monkeypatch):
    service = _processor()
    house = await make_house(db)
    employee, retailer = await _house_data(db, house)
    content = _valid_workbook(employee, retailer)
    config, record, user = await _create_queue_item(db, house=house, content=content)
    calls = []

    async def send_report(*args, **kwargs):
        calls.append((args, kwargs))
        return True, None

    monkeypatch.setattr(service, "send_direct_report", send_report)

    assert await service.process_pending_live_c2c_files(db) == 1

    await db.refresh(record)
    assert record.import_status == "imported"
    assert record.delivery_status == "sent"
    assert record.content is None
    assert record.import_attempts == 1
    assert record.delivery_attempts == 1
    assert await db.scalar(select(func.count(LiveC2CRow.id))) == 1
    assert len(calls) == 1
    assert calls[0][1]["report_type"] == "live_c2c"
    assert calls[0][1]["whatsapp_chat_id"] == config.destination_group_jid
    assert calls[0][1]["user_id"] == user.id
    assert calls[0][1]["activity_module"] == "live_c2c"


@pytest.mark.asyncio
async def test_report_failure_retries_delivery_without_reimporting(db, monkeypatch):
    service = _processor()
    house = await make_house(db)
    employee, retailer = await _house_data(db, house)
    content = _valid_workbook(employee, retailer)
    _, record, _ = await _create_queue_item(db, house=house, content=content)
    send_attempts = 0

    async def fail_report(*args, **kwargs):
        nonlocal send_attempts
        send_attempts += 1
        return False, "temporary WhatsApp failure"

    monkeypatch.setattr(service, "send_direct_report", fail_report)

    await service.process_pending_live_c2c_files(db)
    await db.refresh(record)
    assert record.import_status == "imported"
    assert record.delivery_status == "failed"
    assert record.last_error == "temporary WhatsApp failure"
    assert record.content is None
    assert record.import_attempts == 1
    assert record.delivery_attempts == 1
    assert record.lease_expires_at > now_naive()

    record.lease_expires_at = now_naive() - timedelta(seconds=1)
    await db.commit()
    await service.process_pending_live_c2c_files(db)
    await db.refresh(record)
    assert record.import_attempts == 1
    assert record.delivery_attempts == 2
    assert send_attempts == 2
    assert await db.scalar(select(func.count(LiveC2CRow.id))) == 1


@pytest.mark.asyncio
async def test_delivery_uses_destination_captured_when_file_was_received(db, monkeypatch):
    service = _processor()
    house = await make_house(db)
    config, record, _ = await _create_queue_item(
        db,
        house=house,
        content=b"already imported",
        destination="original-destination@g.us",
        status="imported",
    )
    config.destination_group_jid = "new-destination@g.us"
    await db.commit()
    calls = []

    async def send_report(*args, **kwargs):
        calls.append(kwargs)
        return True, None

    monkeypatch.setattr(service, "send_direct_report", send_report)

    await service.process_pending_live_c2c_files(db)

    assert calls[0]["whatsapp_chat_id"] == "original-destination@g.us"


@pytest.mark.asyncio
async def test_delivery_is_not_sent_after_automation_is_disabled(db, monkeypatch):
    service = _processor()
    house = await make_house(db)
    config, record, _ = await _create_queue_item(
        db,
        house=house,
        content=b"already imported",
        status="imported",
    )
    config.is_enabled = False
    await db.commit()
    calls = []

    async def send_report(*args, **kwargs):
        calls.append(kwargs)
        return True, None

    monkeypatch.setattr(service, "send_direct_report", send_report)

    await service.process_pending_live_c2c_files(db)

    await db.refresh(record)
    assert calls == []
    assert record.delivery_status == "failed"
    assert record.last_error == "live_c2c_automation_disabled"
    assert await service.process_pending_live_c2c_files(db) == 0


@pytest.mark.asyncio
async def test_queued_file_is_not_imported_after_automation_is_disabled(db, monkeypatch):
    service = _processor()
    house = await make_house(db)
    employee, retailer = await _house_data(db, house)
    config, record, _ = await _create_queue_item(
        db,
        house=house,
        content=_valid_workbook(employee, retailer),
    )
    config.is_enabled = False
    await db.commit()
    calls = []

    async def send_report(*args, **kwargs):
        calls.append(kwargs)
        return True, None

    monkeypatch.setattr(service, "send_direct_report", send_report)

    await service.process_pending_live_c2c_files(db)

    await db.refresh(record)
    assert calls == []
    assert record.import_status == "failed"
    assert record.last_error == "live_c2c_automation_disabled"
    assert await db.scalar(select(func.count(LiveC2CRow.id))) == 0


@pytest.mark.asyncio
async def test_expired_processing_lease_recovers_queued_import(db, monkeypatch):
    service = _processor()
    house = await make_house(db)
    employee, retailer = await _house_data(db, house)
    content = _valid_workbook(employee, retailer)
    _, record, _ = await _create_queue_item(
        db,
        house=house,
        content=content,
        status="processing",
        lease_expires_at=now_naive() - timedelta(minutes=1),
    )

    async def send_report(*args, **kwargs):
        return True, None

    monkeypatch.setattr(service, "send_direct_report", send_report)

    assert await service.process_pending_live_c2c_files(db) == 1

    await db.refresh(record)
    assert record.import_status == "imported"
    assert record.delivery_status == "sent"
    assert record.import_attempts == 1
