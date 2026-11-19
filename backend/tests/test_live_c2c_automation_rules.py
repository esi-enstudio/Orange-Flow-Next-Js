import importlib
from hashlib import sha256

import pytest
from sqlalchemy import select

from conftest import make_house
from app.models.user import User


SERVICE_MODULE = "app.services.live_c2c_automation_service"
MODELS_MODULE = "app.models.live_c2c_automation"
MAX_FILE_SIZE = 10 * 1024 * 1024

try:
    AUTOMATION_SERVICE = importlib.import_module(SERVICE_MODULE)
except ModuleNotFoundError:
    AUTOMATION_SERVICE = None

try:
    AUTOMATION_MODELS = importlib.import_module(MODELS_MODULE)
except ModuleNotFoundError:
    AUTOMATION_MODELS = None


def _service():
    assert AUTOMATION_SERVICE is not None, "Live C2C automation service has not been implemented"
    return AUTOMATION_SERVICE


def _models():
    assert AUTOMATION_MODELS is not None, "Live C2C automation models have not been implemented"
    return AUTOMATION_MODELS


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("Live C2C 2026.xlsx", True),
        ("daily_live-c2c_report.XLSB", True),
        ("liveC2C.xlsx", False),
        ("Live report.xlsx", False),
        ("C2C report.xlsb", False),
        ("Live C2C report.csv", False),
        ("unrelated.xlsx", False),
        (None, False),
    ],
)
def test_filename_requires_live_and_c2c_words(filename, expected):
    service = _service()

    assert service.matches_live_c2c_filename(filename) is expected


def test_attachment_validation_sanitizes_path_and_enforces_size():
    service = _service()

    assert service.validate_live_c2c_attachment(
        r"reports\Live C2C report.xlsx",
        MAX_FILE_SIZE,
    ) == "Live C2C report.xlsx"

    with pytest.raises(service.LiveC2CImportError) as too_large:
        service.validate_live_c2c_attachment("Live C2C report.xlsx", MAX_FILE_SIZE + 1)
    assert too_large.value.code == "live_c2c_file_too_large"

    with pytest.raises(service.LiveC2CImportError):
        service.validate_live_c2c_attachment("", 1)
    with pytest.raises(service.LiveC2CImportError):
        service.validate_live_c2c_attachment("Live C2C report.csv", 1)
    with pytest.raises(service.LiveC2CImportError):
        service.validate_live_c2c_attachment("Live C2C report.xlsx", 0)


def test_encrypted_secret_round_trips_without_storing_plaintext():
    service = _service()
    token = "refresh-token-value"

    ciphertext = service.encrypt_secret(token)

    assert ciphertext != token
    assert service.decrypt_secret(ciphertext) == token


@pytest.mark.asyncio
async def test_enqueue_deduplicates_source_event_without_replacing_file(db):
    service = _service()
    models = _models()
    house = await make_house(db)
    owner = User(name="Automation Owner", email="owner@example.com", status="Active")
    db.add(owner)
    await db.commit()
    await db.refresh(owner)

    config = models.LiveC2CAutomationConfig(
        house_id=house.id,
        source_type="gmail",
        is_enabled=True,
        gmail_address=house.email,
        created_by=owner.id,
        updated_by=owner.id,
    )
    db.add(config)
    await db.commit()

    first = await service.enqueue_live_c2c_file(
        db,
        config=config,
        source_event_id="gmail:message-1:attachment-1",
        filename="Live C2C report.xlsx",
        content=b"original",
    )
    await db.commit()
    duplicate = await service.enqueue_live_c2c_file(
        db,
        config=config,
        source_event_id="gmail:message-1:attachment-1",
        filename="Live C2C report.xlsx",
        content=b"replacement",
    )
    await db.commit()

    assert duplicate.id == first.id
    assert duplicate.content == b"original"
    assert duplicate.sha256 == sha256(b"original").hexdigest()


@pytest.mark.asyncio
async def test_enqueue_rejects_disabled_or_mismatched_whatsapp_source(db):
    service = _service()
    models = _models()
    house = await make_house(db)
    owner = User(name="Automation Owner", email="owner@example.com", status="Active")
    db.add(owner)
    await db.commit()
    await db.refresh(owner)

    disabled = models.LiveC2CAutomationConfig(
        house_id=house.id,
        source_type="whatsapp",
        is_enabled=False,
        source_group_jid="120000000000@g.us",
        wa_device_id="device-a",
        created_by=owner.id,
        updated_by=owner.id,
    )
    db.add(disabled)
    await db.commit()

    with pytest.raises(service.LiveC2CSourceMismatch):
        await service.enqueue_live_c2c_file(
            db,
            config=disabled,
            source_event_id="wa:message-1",
            filename="Live C2C report.xlsx",
            content=b"document",
            source_device_id="device-a",
            source_group_jid="120000000000@g.us",
        )

    disabled.is_enabled = True
    await db.commit()

    with pytest.raises(service.LiveC2CSourceMismatch):
        await service.enqueue_live_c2c_file(
            db,
            config=disabled,
            source_event_id="wa:message-2",
            filename="Live C2C report.xlsx",
            content=b"document",
            source_device_id="device-b",
            source_group_jid="120000000000@g.us",
        )

    assert await db.scalar(select(models.LiveC2CInboundFile.id)) is None
