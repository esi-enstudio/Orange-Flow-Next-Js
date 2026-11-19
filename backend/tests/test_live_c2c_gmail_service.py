import base64
import importlib
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from conftest import make_house
from sqlalchemy import select

from app.models.live_c2c_automation import (
    LiveC2CAutomationConfig,
    LiveC2CInboundFile,
)
from app.models.user import User
from app.utils.timezone import now_naive
from config.settings import Settings, settings


_REAL_ASYNC_CLIENT = httpx.AsyncClient
try:
    GMAIL_SERVICE = importlib.import_module("app.services.live_c2c_gmail_service")
except ModuleNotFoundError:
    GMAIL_SERVICE = None


def _service():
    assert GMAIL_SERVICE is not None, "Live C2C Gmail service has not been implemented"
    return GMAIL_SERVICE


def _mock_http(monkeypatch, handler):
    service = _service()

    def async_client(**kwargs):
        return _REAL_ASYNC_CLIENT(
            transport=httpx.MockTransport(handler),
            **kwargs,
        )

    monkeypatch.setattr(service.httpx, "AsyncClient", async_client)


async def _config(db, house, *, source_type="gmail", enabled=True):
    user = User(name="Gmail Automation Owner", email="owner@example.com", status="Active")
    db.add(user)
    await db.commit()
    await db.refresh(user)
    config = LiveC2CAutomationConfig(
        house_id=house.id,
        source_type=source_type,
        is_enabled=enabled,
        gmail_address=house.email,
        gmail_status="disconnected",
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(config)
    await db.commit()
    return config


def _google_response(request):
    assert False, f"Unexpected Google request: {request.method} {request.url}"


def test_gmail_authorization_url_uses_configured_account_and_one_time_state(monkeypatch):
    service = _service()
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "client-id")
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_REDIRECT_URI", "https://app.example/callback")
    config = LiveC2CAutomationConfig(gmail_address="House.Mail@example.com")

    url = service.build_gmail_authorization_url(config, "one-time-state")
    query = parse_qs(urlparse(url).query)

    assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert query["client_id"] == ["client-id"]
    assert query["redirect_uri"] == ["https://app.example/callback"]
    assert query["state"] == ["one-time-state"]
    assert query["login_hint"] == ["House.Mail@example.com"]
    assert query["scope"] == ["https://www.googleapis.com/auth/gmail.readonly"]


@pytest.mark.asyncio
async def test_gmail_exchange_rejects_wrong_mailbox_before_saving_tokens(db, monkeypatch):
    service = _service()
    house = await make_house(db)
    config = await _config(db, house)
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "client-id")
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_SECRET", "client-secret")
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_REDIRECT_URI", "https://app.example/callback")

    def handler(request):
        if request.url.path == "/token":
            return httpx.Response(
                200,
                json={
                    "access_token": "plain-access-token",
                    "refresh_token": "plain-refresh-token",
                    "expires_in": 3600,
                },
            )
        if request.url.path.endswith("/users/me/profile"):
            return httpx.Response(
                200,
                json={"emailAddress": "someone-else@example.com", "historyId": "123"},
            )
        return _google_response(request)

    _mock_http(monkeypatch, handler)

    with pytest.raises(service.LiveC2CGmailError) as error:
        await service.exchange_gmail_code(db, config, "authorization-code")

    assert error.value.code == "gmail_account_mismatch"
    assert config.gmail_access_token_encrypted is None
    assert config.gmail_refresh_token_encrypted is None


@pytest.mark.asyncio
async def test_gmail_disconnect_revokes_refresh_token(db, monkeypatch):
    service = _service()
    house = await make_house(db)
    config = await _config(db, house)
    config.gmail_refresh_token_encrypted = service.encrypt_secret("refresh-token")

    def handler(request):
        assert request.method == "POST"
        assert str(request.url) == service.GOOGLE_REVOKE_URL
        assert request.content == b"token=refresh-token"
        return httpx.Response(200)

    _mock_http(monkeypatch, handler)
    await service.revoke_gmail_credentials(config)
    assert config.gmail_history_id is None


@pytest.mark.asyncio
async def test_gmail_exchange_stores_verified_tokens_encrypted(db, monkeypatch):
    service = _service()
    automation_rules = importlib.import_module("app.services.live_c2c_automation_service")
    house = await make_house(db)
    config = await _config(db, house)
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "client-id")
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_SECRET", "client-secret")
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_REDIRECT_URI", "https://app.example/callback")

    def handler(request):
        if request.url.path == "/token":
            return httpx.Response(
                200,
                json={
                    "access_token": "plain-access-token",
                    "refresh_token": "plain-refresh-token",
                    "expires_in": 3600,
                },
            )
        if request.url.path.endswith("/users/me/profile"):
            return httpx.Response(
                200,
                json={"emailAddress": house.email, "historyId": "123"},
            )
        return _google_response(request)

    _mock_http(monkeypatch, handler)

    await service.exchange_gmail_code(db, config, "authorization-code")

    assert config.gmail_status == "connected"
    assert config.gmail_history_id == "123"
    assert config.gmail_access_token_encrypted != "plain-access-token"
    assert config.gmail_refresh_token_encrypted != "plain-refresh-token"
    assert automation_rules.decrypt_secret(config.gmail_access_token_encrypted) == "plain-access-token"
    assert automation_rules.decrypt_secret(config.gmail_refresh_token_encrypted) == "plain-refresh-token"


@pytest.mark.asyncio
async def test_gmail_poll_queues_matching_attachment_before_advancing_cursor(db, monkeypatch):
    service = _service()
    automation_rules = importlib.import_module("app.services.live_c2c_automation_service")
    house = await make_house(db)
    config = await _config(db, house, enabled=True)
    config.gmail_status = "connected"
    config.gmail_access_token_encrypted = automation_rules.encrypt_secret("access-token")
    config.gmail_refresh_token_encrypted = automation_rules.encrypt_secret("refresh-token")
    config.gmail_history_id = "10"
    config.gmail_token_expires_at = now_naive() + timedelta(hours=1)
    await db.commit()

    attachment = base64.urlsafe_b64encode(b"spreadsheet bytes").decode().rstrip("=")

    def handler(request):
        if request.url.path.endswith("/users/me/history"):
            assert request.url.params["startHistoryId"] == "10"
            return httpx.Response(
                200,
                json={
                    "historyId": "11",
                    "history": [
                        {
                            "messagesAdded": [
                                {"message": {"id": "message-1", "threadId": "thread-1"}}
                            ]
                        }
                    ],
                },
            )
        if request.url.path.endswith("/users/me/messages/message-1"):
            return httpx.Response(
                200,
                json={
                    "payload": {
                        "parts": [
                            {
                                "partId": "0",
                                "filename": "Live C2C report.xlsx",
                                "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                "body": {"attachmentId": "attachment-1", "size": len(b"spreadsheet bytes")},
                            }
                        ]
                    }
                },
            )
        if request.url.path.endswith("/attachments/attachment-1"):
            return httpx.Response(200, json={"data": attachment})
        return _google_response(request)

    _mock_http(monkeypatch, handler)

    queued = await service.poll_gmail_config(db, config)

    assert queued == 1
    assert config.gmail_history_id == "11"
    record = await db.scalar(select(LiveC2CInboundFile))
    assert record is not None
    assert record.source_event_id == "gmail:message-1:attachment-1"
    assert record.filename == "Live C2C report.xlsx"
    assert record.content == b"spreadsheet bytes"


@pytest.mark.asyncio
async def test_gmail_poll_does_not_advance_cursor_when_enqueue_fails(db, monkeypatch):
    service = _service()
    house = await make_house(db)
    config = await _config(db, house, enabled=True)
    config.gmail_status = "connected"
    config.gmail_history_id = "10"
    automation_rules = importlib.import_module("app.services.live_c2c_automation_service")
    config.gmail_access_token_encrypted = automation_rules.encrypt_secret("access-token")
    config.gmail_refresh_token_encrypted = automation_rules.encrypt_secret("refresh-token")
    config.gmail_token_expires_at = now_naive() + timedelta(hours=1)
    await db.commit()

    def handler(request):
        if request.url.path.endswith("/users/me/history"):
            return httpx.Response(
                200,
                json={
                    "historyId": "11",
                    "history": [
                        {
                            "messagesAdded": [
                                {"message": {"id": "message-1", "threadId": "thread-1"}}
                            ]
                        }
                    ],
                },
            )
        if request.url.path.endswith("/users/me/messages/message-1"):
            return httpx.Response(
                200,
                json={
                    "payload": {
                        "parts": [
                            {
                                "filename": "Live C2C report.xlsx",
                                "body": {"attachmentId": "attachment-1", "size": 1},
                            }
                        ]
                    }
                },
            )
        if request.url.path.endswith("/attachments/attachment-1"):
            return httpx.Response(
                200,
                json={"data": base64.urlsafe_b64encode(b"x").decode().rstrip("=")},
            )
        return _google_response(request)

    async def fail_enqueue(*args, **kwargs):
        raise RuntimeError("queue unavailable")

    monkeypatch.setattr(service, "enqueue_live_c2c_file", fail_enqueue)
    _mock_http(monkeypatch, handler)

    with pytest.raises(RuntimeError, match="queue unavailable"):
        await service.poll_gmail_config(db, config)
    assert config.gmail_history_id == "10"


@pytest.mark.asyncio
async def test_expired_gmail_history_cursor_requires_reconnection_without_backfill(db, monkeypatch):
    service = _service()
    automation_rules = importlib.import_module("app.services.live_c2c_automation_service")
    house = await make_house(db)
    config = await _config(db, house, enabled=True)
    config.gmail_status = "connected"
    config.gmail_history_id = "stale-cursor"
    config.gmail_access_token_encrypted = automation_rules.encrypt_secret("access-token")
    config.gmail_refresh_token_encrypted = automation_rules.encrypt_secret("refresh-token")
    config.gmail_token_expires_at = now_naive() + timedelta(hours=1)
    await db.commit()

    def handler(request):
        if request.url.path.endswith("/users/me/history"):
            return httpx.Response(404, json={"error": {"message": "History expired"}})
        return _google_response(request)

    _mock_http(monkeypatch, handler)

    assert await service.poll_gmail_config(db, config) == 0
    assert config.gmail_status == "needs_attention"
    assert config.gmail_history_id == "stale-cursor"


def test_oauth_settings_are_optional_until_connection_is_attempted(monkeypatch):
    service = _service()
    settings_without_oauth = Settings(
        DB_USER="user",
        DB_PASS="pass",
        DB_HOST="localhost",
        DB_NAME="db",
        SECRET_KEY="test-secret-key-0123456789abcdef0123456789abcdef",
    )

    assert settings_without_oauth.GOOGLE_OAUTH_CLIENT_ID is None
    assert settings_without_oauth.GOOGLE_OAUTH_CLIENT_SECRET is None
    assert settings_without_oauth.GOOGLE_OAUTH_REDIRECT_URI is None

    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_SECRET", None)
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_REDIRECT_URI", None)
    config = LiveC2CAutomationConfig(gmail_address="house@example.com")
    with pytest.raises(service.LiveC2CGmailError) as error:
        service.build_gmail_authorization_url(config, "state")
    assert error.value.code == "gmail_oauth_not_configured"
