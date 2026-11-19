import base64
import hashlib
import os
import re
from pathlib import PurePath

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.live_c2c_automation import (
    LiveC2CAutomationConfig,
    LiveC2CInboundFile,
)
from app.services.live_c2c_service import (
    MAX_LIVE_C2C_FILE_SIZE,
    LiveC2CImportError,
)
from app.utils.activity_logger import log_activity
from config.settings import settings
from app.utils.timezone import now_naive

_SUPPORTED_EXTENSIONS = {".xlsx", ".xlsb"}
_ENCRYPTION_PREFIX = "v1."
_ENCRYPTION_ASSOCIATED_DATA = b"live-c2c-automation:v1"


class LiveC2CSourceMismatch(ValueError):
    pass


def _secret_key() -> bytes:
    return hashlib.sha256(
        b"live-c2c-automation:v1:" + settings.SECRET_KEY.encode("utf-8")
    ).digest()


def encrypt_secret(secret: str) -> str:
    if not secret:
        raise ValueError("Secret must not be empty")
    nonce = os.urandom(12)
    ciphertext = AESGCM(_secret_key()).encrypt(
        nonce,
        secret.encode("utf-8"),
        _ENCRYPTION_ASSOCIATED_DATA,
    )
    encoded = base64.urlsafe_b64encode(nonce + ciphertext).decode("ascii").rstrip("=")
    return f"{_ENCRYPTION_PREFIX}{encoded}"


def decrypt_secret(ciphertext: str) -> str:
    if not ciphertext.startswith(_ENCRYPTION_PREFIX):
        raise ValueError("Unsupported encrypted secret format")
    encoded = ciphertext[len(_ENCRYPTION_PREFIX):]
    padded = encoded + "=" * (-len(encoded) % 4)
    payload = base64.urlsafe_b64decode(padded.encode("ascii"))
    if len(payload) <= 12:
        raise ValueError("Encrypted secret payload is invalid")
    plaintext = AESGCM(_secret_key()).decrypt(
        payload[:12],
        payload[12:],
        _ENCRYPTION_ASSOCIATED_DATA,
    )
    return plaintext.decode("utf-8")


def _safe_basename(filename: str | None) -> str:
    if not filename or "\x00" in filename:
        return ""
    basename = filename.replace("\\", "/").rsplit("/", 1)[-1].strip()
    return PurePath(basename).name[:255]


def matches_live_c2c_filename(filename: str | None) -> bool:
    basename = _safe_basename(filename)
    extension = PurePath(basename).suffix.casefold()
    if extension not in _SUPPORTED_EXTENSIONS:
        return False
    stem = basename[: -len(extension)]
    words = set(re.findall(r"[a-z0-9]+", stem.casefold()))
    return {"live", "c2c"}.issubset(words)


def validate_live_c2c_attachment(filename: str, size: int) -> str:
    basename = _safe_basename(filename)
    if not basename:
        raise LiveC2CImportError("live_c2c_invalid_filename")
    if PurePath(basename).suffix.casefold() not in _SUPPORTED_EXTENSIONS:
        raise LiveC2CImportError("live_c2c_invalid_file_type")
    if not matches_live_c2c_filename(basename):
        raise LiveC2CImportError("live_c2c_invalid_filename")
    if size <= 0:
        raise LiveC2CImportError("live_c2c_empty_file")
    if size > MAX_LIVE_C2C_FILE_SIZE:
        raise LiveC2CImportError("live_c2c_file_too_large")
    return basename


def _assert_source_matches(
    config: LiveC2CAutomationConfig,
    *,
    source_device_id: str | None,
    source_group_jid: str | None,
) -> None:
    if config.is_deleted or not config.is_enabled:
        raise LiveC2CSourceMismatch("Automation source is disabled")
    if config.source_type == "gmail":
        if source_device_id is not None or source_group_jid is not None:
            raise LiveC2CSourceMismatch("WhatsApp event cannot match a Gmail source")
        return
    if config.source_type != "whatsapp":
        raise LiveC2CSourceMismatch("Automation source is not configured")
    if (
        not source_device_id
        or not source_group_jid
        or source_device_id != config.wa_device_id
        or source_group_jid != config.source_group_jid
    ):
        raise LiveC2CSourceMismatch("WhatsApp device or group does not match")


async def enqueue_live_c2c_file(
    db: AsyncSession,
    *,
    config: LiveC2CAutomationConfig,
    source_event_id: str,
    filename: str,
    content: bytes,
    source_device_id: str | None = None,
    source_group_jid: str | None = None,
) -> LiveC2CInboundFile:
    _assert_source_matches(
        config,
        source_device_id=source_device_id,
        source_group_jid=source_group_jid,
    )
    safe_filename = validate_live_c2c_attachment(filename, len(content))
    if not source_event_id or len(source_event_id) > 300:
        raise LiveC2CImportError("live_c2c_invalid_source_event")

    actor_id = config.updated_by or config.created_by
    if actor_id is None:
        raise ValueError("Automation config must have an audit user")

    values = {
        "house_id": config.house_id,
        "config_id": config.id,
        "source_type": config.source_type,
        "source_event_id": source_event_id,
        "source_device_id": source_device_id,
        "source_group_jid": source_group_jid,
        "filename": safe_filename,
        "sha256": hashlib.sha256(content).hexdigest(),
        "content": content,
        "import_status": "queued",
        "delivery_status": "pending",
        "received_at": now_naive(),
        "created_by": actor_id,
        "updated_by": actor_id,
        "is_deleted": False,
    }

    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        statement = postgresql_insert(LiveC2CInboundFile).values(**values)
    elif dialect == "sqlite":
        statement = sqlite_insert(LiveC2CInboundFile).values(**values)
    else:
        raise RuntimeError(f"Unsupported database dialect for inbound file enqueue: {dialect}")
    statement = statement.on_conflict_do_nothing(
        index_elements=["house_id", "source_type", "source_event_id"]
    )
    inserted_id = (
        await db.execute(statement.returning(LiveC2CInboundFile.id))
    ).scalar_one_or_none()

    record = await db.scalar(
        select(LiveC2CInboundFile).where(
            LiveC2CInboundFile.house_id == config.house_id,
            LiveC2CInboundFile.source_type == config.source_type,
            LiveC2CInboundFile.source_event_id == source_event_id,
        )
    )
    if record is None:
        raise RuntimeError("Inbound file enqueue did not produce or find a record")
    if inserted_id is not None:
        await log_activity(
            db,
            user_id=actor_id,
            user_name=None,
            module="live_c2c",
            action="automation.file_received",
            record_id=record.id,
            record_identifier=f"house:{config.house_id}/inbound:{record.id}",
            new_values={
                "source_type": config.source_type,
                "source_event_id": source_event_id,
                "filename": safe_filename,
            },
            request=None,
            status_code=200,
            commit=False,
        )
    return record
