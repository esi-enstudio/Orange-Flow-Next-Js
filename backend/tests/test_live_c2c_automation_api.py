import base64
import hashlib
import hmac
import json
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import func, select

from app.models.activity_log import ActivityLog
from app.models.house import House
from app.models.live_c2c_automation import (
    LiveC2CAutomationConfig,
    LiveC2CInboundFile,
)
from app.models.role import Permission, Role
from app.models.user import User
from app.routers import live_c2c_automation
from app.routers import whatsapp_gateway
from app.routers import whatsapp_schedules
from app.routers.live_c2c_automation import (
    configure_live_c2c_whatsapp_webhook_url,
    router,
)
from app.routers.deps import get_current_user, get_db
from app.services.live_c2c_automation_service import encrypt_secret
from app.services.whatsapp_service_client import WhatsAppServiceClient, WhatsAppServiceError
import app.services.whatsapp_service_client as whatsapp_client_module
from config.settings import settings


@pytest_asyncio.fixture
async def api_client(db):
    app = FastAPI()
    app.include_router(router)
    app.include_router(whatsapp_schedules.router)
    app.include_router(whatsapp_gateway.router)
    previous_overrides = app.dependency_overrides.copy()

    async def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db

    async def make_user_override(user):
        async def override_user():
            return user

        app.dependency_overrides[get_current_user] = override_user

    client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
    )
    client.make_user_override = make_user_override
    try:
        yield client
    finally:
        await client.aclose()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous_overrides)


async def _user_with_permissions(db, house, permissions):
    role = Role(name="Live C2C API operator")
    role.permissions = []
    for name in permissions:
        permission = Permission(name=name)
        db.add(permission)
        await db.flush()
        role.permissions.append(permission)

    user = User(
        username=f"live-c2c-api-{house.id}",
        hashed_password="x",
        name="Live C2C API operator",
        status="Active",
    )
    user.roles.append(role)
    user.houses.append(house)
    db.add(user)
    await db.commit()
    return user


def _signed_payload(payload, secret):
    body = json.dumps(payload, separators=(",", ":")).encode()
    signature = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return body, f"sha256={signature}"


def _set_webhook_url(monkeypatch):
    if hasattr(settings, "LIVE_C2C_WHATSAPP_WEBHOOK_URL"):
        monkeypatch.setattr(
            settings,
            "LIVE_C2C_WHATSAPP_WEBHOOK_URL",
            "https://api.example.test/webhook",
        )


def test_configure_whatsapp_webhook_url_uses_public_tunnel_when_unset(monkeypatch):
    monkeypatch.setattr(settings, "LIVE_C2C_WHATSAPP_WEBHOOK_URL", None)

    callback_url = configure_live_c2c_whatsapp_webhook_url("https://example.test/")

    assert callback_url == (
        "https://example.test/api/v1/live-c2c-automation/whatsapp/webhook"
    )
    assert settings.LIVE_C2C_WHATSAPP_WEBHOOK_URL == callback_url


def test_configure_whatsapp_webhook_url_preserves_explicit_setting(monkeypatch):
    configured_url = "https://callback.example.test/receive"
    monkeypatch.setattr(settings, "LIVE_C2C_WHATSAPP_WEBHOOK_URL", configured_url)

    assert (
        configure_live_c2c_whatsapp_webhook_url("https://tunnel.example.test")
        == configured_url
    )


@pytest.mark.asyncio
async def test_get_requires_automation_view_permission(api_client, db, house):
    user = await _user_with_permissions(db, house, [])
    await api_client.make_user_override(user)

    response = await api_client.get(
        "/api/v1/live-c2c-automation",
        headers={"X-House-ID": str(house.id)},
    )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_manage_permission_can_read_automation_config(api_client, db, house):
    user = await _user_with_permissions(
        db,
        house,
        ["live_c2c.automation_manage"],
    )
    await api_client.make_user_override(user)

    response = await api_client.get(
        "/api/v1/live-c2c-automation",
        headers={"X-House-ID": str(house.id)},
    )

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_manage_permission_can_load_whatsapp_groups_for_automation(
    api_client,
    db,
    house,
    monkeypatch,
):
    user = await _user_with_permissions(
        db,
        house,
        ["live_c2c.automation_manage"],
    )
    await api_client.make_user_override(user)
    house.wa_device_id = "device-1"
    house.wa_jwt_token = "device-token"

    async def get_groups(token):
        assert token == "device-token"
        return [{"id": "source@g.us", "name": "Source group"}]

    monkeypatch.setattr(whatsapp_schedules.whatsapp_service_client, "get_groups", get_groups)
    monkeypatch.setattr(whatsapp_gateway.whatsapp_service_client, "get_groups", get_groups)
    await db.commit()
    response = await api_client.get(
        "/api/whatsapp/groups",
        headers={"X-House-ID": str(house.id)},
    )

    assert response.status_code == 200
    assert response.json()["data"] == [{"id": "source@g.us", "name": "Source group"}]


@pytest.mark.asyncio
async def test_get_rejects_foreign_house_context(api_client, db, house):
    other_house = House(code="H002", name="Other House", email="other@example.com")
    db.add(other_house)
    await db.commit()
    user = await _user_with_permissions(
        db,
        house,
        ["live_c2c.automation_view"],
    )
    await api_client.make_user_override(user)

    response = await api_client.get(
        "/api/v1/live-c2c-automation",
        headers={"X-House-ID": str(other_house.id)},
    )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_get_redacts_gmail_and_webhook_secrets(api_client, db, house):
    user = await _user_with_permissions(
        db,
        house,
        ["live_c2c.automation_view"],
    )
    config = LiveC2CAutomationConfig(
        house_id=house.id,
        source_type="whatsapp",
        is_enabled=True,
        gmail_address=house.email,
        gmail_access_token_encrypted=encrypt_secret("gmail-access-secret"),
        gmail_refresh_token_encrypted=encrypt_secret("gmail-refresh-secret"),
        wa_device_id="device-1",
        wa_webhook_id=71,
        wa_webhook_secret_encrypted=encrypt_secret("webhook-secret"),
        source_group_jid="source@g.us",
        source_group_name="Inbound",
        destination_group_jid="destination@g.us",
        destination_group_name="Reports",
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(config)
    await db.commit()
    db.add(
        LiveC2CInboundFile(
            house_id=house.id,
            config_id=config.id,
            source_type="whatsapp",
            source_event_id="message-secret-test",
            filename="Live C2C.xlsx",
            sha256="a" * 64,
            last_error="oauth token gmail-access-secret",
            created_by=user.id,
            updated_by=user.id,
        )
    )
    await db.commit()
    await api_client.make_user_override(user)

    response = await api_client.get(
        "/api/v1/live-c2c-automation",
        headers={"X-House-ID": str(house.id)},
    )

    assert response.status_code == 200
    assert "gmail-access-secret" not in response.text
    assert "gmail-refresh-secret" not in response.text
    assert "webhook-secret" not in response.text
    assert "oauth token" not in response.text
    assert "gmail_access_token_encrypted" not in response.text
    assert "wa_webhook_secret_encrypted" not in response.text
    recent_files = response.json()["recent_files"]
    assert len(recent_files) == 1
    assert recent_files[0]["filename"] == "Live C2C.xlsx"
    assert recent_files[0]["import_status"] == "queued"
    assert recent_files[0]["delivery_status"] == "pending"
    assert recent_files[0]["last_error"] == "live_c2c_processing_failed"
    assert "content" not in recent_files[0]


@pytest.mark.asyncio
async def test_put_rejects_gmail_source_without_house_email(api_client, db, house):
    house.email = ""
    await db.commit()
    user = await _user_with_permissions(
        db,
        house,
        ["live_c2c.automation_manage"],
    )
    await api_client.make_user_override(user)

    response = await api_client.put(
        "/api/v1/live-c2c-automation",
        headers={"X-House-ID": str(house.id)},
        json={
            "source_type": "gmail",
            "is_enabled": True,
            "destination_group_jid": "destination@g.us",
        },
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_put_rejects_unavailable_whatsapp_source_group(
    api_client,
    db,
    house,
    monkeypatch,
):
    house.wa_device_id = "device-1"
    house.wa_jwt_token = "device-token"
    house.wa_device_secret = "device-secret"
    await db.commit()
    user = await _user_with_permissions(
        db,
        house,
        ["live_c2c.automation_manage"],
    )
    await api_client.make_user_override(user)

    async def get_groups(_self, _token):
        return [
            {"id": "source@g.us", "name": "Inbound"},
            {"id": "destination@g.us", "name": "Reports"},
        ]

    monkeypatch.setattr(WhatsAppServiceClient, "get_groups", get_groups)
    _set_webhook_url(monkeypatch)

    response = await api_client.put(
        "/api/v1/live-c2c-automation",
        headers={"X-House-ID": str(house.id)},
        json={
            "source_type": "whatsapp",
            "is_enabled": True,
            "source_group_jid": "unknown@g.us",
            "destination_group_jid": "destination@g.us",
        },
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_put_rejects_same_whatsapp_source_and_destination_group(
    api_client,
    db,
    house,
    monkeypatch,
):
    house.wa_device_id = "device-1"
    house.wa_jwt_token = "device-token"
    house.wa_device_secret = "device-secret"
    await db.commit()
    user = await _user_with_permissions(
        db,
        house,
        ["live_c2c.automation_manage"],
    )
    await api_client.make_user_override(user)
    webhook_calls = []

    async def get_groups(_self, _token):
        return [{"id": "same@g.us", "name": "Same group"}]

    async def create_webhook(_self, _token, url, events):
        webhook_calls.append((url, events))
        return {"webhook_id": 81, "secret": "webhook-secret"}

    monkeypatch.setattr(WhatsAppServiceClient, "get_groups", get_groups)
    monkeypatch.setattr(WhatsAppServiceClient, "create_webhook", create_webhook)
    _set_webhook_url(monkeypatch)

    response = await api_client.put(
        "/api/v1/live-c2c-automation",
        headers={"X-House-ID": str(house.id)},
        json={
            "source_type": "whatsapp",
            "is_enabled": True,
            "source_group_jid": "same@g.us",
            "destination_group_jid": "same@g.us",
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "live_c2c_source_destination_same_group"
    assert webhook_calls == []
    config_count = await db.scalar(
        select(func.count()).select_from(LiveC2CAutomationConfig).where(
            LiveC2CAutomationConfig.house_id == house.id
        )
    )
    assert config_count == 0


@pytest.mark.asyncio
async def test_put_rejects_duplicate_whatsapp_source_mapping(
    api_client,
    db,
    house,
    monkeypatch,
):
    house.wa_device_id = "device-1"
    house.wa_jwt_token = "device-token"
    house.wa_device_secret = "device-secret"
    other_house = House(
        code="H002",
        name="Other House",
        email="other@example.com",
        wa_device_id="device-1",
        wa_jwt_token="device-token",
        wa_device_secret="device-secret",
    )
    db.add(other_house)
    await db.flush()
    user = await _user_with_permissions(
        db,
        house,
        ["live_c2c.automation_manage"],
    )
    db.add(
        LiveC2CAutomationConfig(
            house_id=other_house.id,
            source_type="whatsapp",
            is_enabled=True,
            wa_device_id="device-1",
            source_group_jid="source@g.us",
            destination_group_jid="destination@g.us",
            created_by=user.id,
            updated_by=user.id,
        )
    )
    await db.commit()
    await api_client.make_user_override(user)

    async def get_groups(_self, _token):
        return [
            {"id": "source@g.us", "name": "Inbound"},
            {"id": "destination@g.us", "name": "Reports"},
        ]

    monkeypatch.setattr(WhatsAppServiceClient, "get_groups", get_groups)
    _set_webhook_url(monkeypatch)

    response = await api_client.put(
        "/api/v1/live-c2c-automation",
        headers={"X-House-ID": str(house.id)},
        json={
            "source_type": "whatsapp",
            "is_enabled": True,
            "source_group_jid": "source@g.us",
            "destination_group_jid": "destination@g.us",
        },
    )

    assert response.status_code == 409
    own_config_count = await db.scalar(
        select(func.count()).select_from(LiveC2CAutomationConfig).where(
            LiveC2CAutomationConfig.house_id == house.id
        )
    )
    assert own_config_count == 0


@pytest.mark.asyncio
async def test_put_rejects_duplicate_case_insensitive_gmail_mapping(
    api_client,
    db,
    house,
    monkeypatch,
):
    house.wa_device_id = "device-1"
    house.wa_jwt_token = "device-token"
    house.wa_device_secret = "device-secret"
    other_house = House(code="H002", name="Other House", email="HOUSE@example.com")
    db.add(other_house)
    await db.flush()
    user = await _user_with_permissions(
        db,
        house,
        ["live_c2c.automation_manage"],
    )
    db.add(
        LiveC2CAutomationConfig(
            house_id=other_house.id,
            source_type="gmail",
            is_enabled=True,
            gmail_address="house@example.com",
            created_by=user.id,
            updated_by=user.id,
        )
    )
    await db.commit()
    await api_client.make_user_override(user)

    async def get_groups(_self, _token):
        return [{"id": "destination@g.us", "name": "Reports"}]

    monkeypatch.setattr(WhatsAppServiceClient, "get_groups", get_groups)

    response = await api_client.put(
        "/api/v1/live-c2c-automation",
        headers={"X-House-ID": str(house.id)},
        json={
            "source_type": "gmail",
            "is_enabled": True,
            "destination_group_jid": "destination@g.us",
        },
    )

    assert response.status_code == 409
    own_config_count = await db.scalar(
        select(func.count()).select_from(LiveC2CAutomationConfig).where(
            LiveC2CAutomationConfig.house_id == house.id
        )
    )
    assert own_config_count == 0


@pytest.mark.asyncio
async def test_put_refuses_whatsapp_input_without_public_webhook_url(
    api_client,
    db,
    house,
    monkeypatch,
):
    house.wa_device_id = "device-1"
    house.wa_jwt_token = "device-token"
    house.wa_device_secret = "device-secret"
    await db.commit()
    user = await _user_with_permissions(
        db,
        house,
        ["live_c2c.automation_manage"],
    )
    await api_client.make_user_override(user)

    async def get_groups(_self, _token):
        return [
            {"id": "source@g.us", "name": "Inbound"},
            {"id": "destination@g.us", "name": "Reports"},
        ]

    monkeypatch.setattr(WhatsAppServiceClient, "get_groups", get_groups)
    monkeypatch.setattr(settings, "LIVE_C2C_WHATSAPP_WEBHOOK_URL", None)

    response = await api_client.put(
        "/api/v1/live-c2c-automation",
        headers={"X-House-ID": str(house.id)},
        json={
            "source_type": "whatsapp",
            "is_enabled": True,
            "source_group_jid": "source@g.us",
            "destination_group_jid": "destination@g.us",
        },
    )

    assert response.status_code == 503
    config_count = await db.scalar(
        select(func.count()).select_from(LiveC2CAutomationConfig).where(
            LiveC2CAutomationConfig.house_id == house.id
        )
    )
    assert config_count == 0


@pytest.mark.asyncio
async def test_gmail_oauth_state_is_hashed_one_time_and_permission_rechecked(
    api_client,
    db,
    house,
    monkeypatch,
):
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "client-id")
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_SECRET", "client-secret")
    monkeypatch.setattr(
        settings,
        "GOOGLE_OAUTH_REDIRECT_URI",
        "https://api.example.test/api/v1/live-c2c-automation/gmail/callback",
    )
    user = await _user_with_permissions(
        db,
        house,
        ["live_c2c.automation_manage"],
    )
    await api_client.make_user_override(user)

    authorize = await api_client.post(
        "/api/v1/live-c2c-automation/gmail/authorize",
        headers={"X-House-ID": str(house.id)},
    )

    assert authorize.status_code == 200
    authorization_url = authorize.json()["authorization_url"]
    state = parse_qs(urlparse(authorization_url).query)["state"][0]
    audit = await db.scalar(
        select(ActivityLog).where(
            ActivityLog.action == "automation.gmail_authorization_started"
        )
    )
    assert audit.endpoint == "/api/v1/live-c2c-automation/gmail/authorize"
    assert audit.method == "POST"
    config = await db.scalar(
        select(LiveC2CAutomationConfig).where(
            LiveC2CAutomationConfig.house_id == house.id
        )
    )
    assert config.oauth_state_hash == hashlib.sha256(state.encode()).hexdigest()
    assert state not in config.oauth_state_hash

    role = user.roles[0]
    role.permissions.clear()
    await db.commit()
    callback = await api_client.get(
        "/api/v1/live-c2c-automation/gmail/callback",
        params={"state": state, "error": "access_denied"},
        follow_redirects=False,
    )
    assert callback.status_code == 303
    assert config.oauth_state_hash is None

    replay = await api_client.get(
        "/api/v1/live-c2c-automation/gmail/callback",
        params={"state": state, "error": "access_denied"},
        follow_redirects=False,
    )
    assert replay.status_code == 303
    assert config.oauth_state_hash is None


@pytest.mark.asyncio
async def test_gmail_authorize_rejects_incomplete_oauth_configuration(
    api_client, db, house, monkeypatch
):
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "client-id")
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_SECRET", None)
    monkeypatch.setattr(
        settings,
        "GOOGLE_OAUTH_REDIRECT_URI",
        "https://api.example.test/api/v1/live-c2c-automation/gmail/callback",
    )
    user = await _user_with_permissions(db, house, ["gmail.connect"])
    await api_client.make_user_override(user)
    house_id = house.id

    response = await api_client.post(
        "/api/v1/live-c2c-automation/gmail/authorize",
        headers={"X-House-ID": str(house_id)},
    )

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "gmail_oauth_not_configured"
    config_count = await db.scalar(
        select(func.count()).select_from(LiveC2CAutomationConfig).where(
            LiveC2CAutomationConfig.house_id == house_id
        )
    )
    assert config_count == 0


@pytest.mark.asyncio
async def test_gmail_oauth_callback_rejects_removed_house_access(
    api_client,
    db,
    house,
    monkeypatch,
):
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "client-id")
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_SECRET", "client-secret")
    monkeypatch.setattr(
        settings,
        "GOOGLE_OAUTH_REDIRECT_URI",
        "https://api.example.test/api/v1/live-c2c-automation/gmail/callback",
    )
    user = await _user_with_permissions(
        db,
        house,
        ["live_c2c.automation_manage"],
    )
    await api_client.make_user_override(user)
    authorize = await api_client.post(
        "/api/v1/live-c2c-automation/gmail/authorize",
        headers={"X-House-ID": str(house.id)},
    )
    state = parse_qs(urlparse(authorize.json()["authorization_url"]).query)["state"][0]

    user.houses.clear()
    await db.commit()
    callback = await api_client.get(
        "/api/v1/live-c2c-automation/gmail/callback",
        params={"state": state, "error": "access_denied"},
        follow_redirects=False,
    )

    assert callback.status_code == 303
    assert "automation=gmail_error" in callback.headers["location"]


@pytest.mark.asyncio
async def test_put_registers_and_encrypts_whatsapp_webhook(
    api_client,
    db,
    house,
    monkeypatch,
):
    house.wa_device_id = "device-1"
    house.wa_jwt_token = "device-token"
    house.wa_device_secret = "device-secret"
    await db.commit()
    user = await _user_with_permissions(
        db,
        house,
        ["live_c2c.automation_manage"],
    )
    await api_client.make_user_override(user)

    async def get_groups(_self, _token):
        return [
            {"id": "source@g.us", "name": "Inbound"},
            {"id": "destination@g.us", "name": "Reports"},
        ]

    async def create_webhook(_self, _token, url, events):
        assert url == "https://api.example.test/webhook"
        assert events == ["media.received"]
        return {"webhook_id": 72, "secret": "returned-signing-secret"}

    monkeypatch.setattr(WhatsAppServiceClient, "get_groups", get_groups)
    monkeypatch.setattr(WhatsAppServiceClient, "create_webhook", create_webhook)
    _set_webhook_url(monkeypatch)
    house_id = house.id

    response = await api_client.put(
        "/api/v1/live-c2c-automation",
        headers={"X-House-ID": str(house_id)},
        json={
            "source_type": "whatsapp",
            "is_enabled": True,
            "source_group_jid": "source@g.us",
            "destination_group_jid": "destination@g.us",
        },
    )

    config = await db.scalar(
        select(LiveC2CAutomationConfig).where(
            LiveC2CAutomationConfig.house_id == house.id
        )
    )
    assert response.status_code == 200
    assert config.wa_webhook_id == 72
    assert config.wa_webhook_secret_encrypted != "returned-signing-secret"
    assert "returned-signing-secret" not in response.text
    assert config.source_group_name == "Inbound"
    assert config.destination_group_name == "Reports"


@pytest.mark.asyncio
async def test_switching_from_gmail_revokes_existing_credentials(
    api_client,
    db,
    house,
    monkeypatch,
):
    house.wa_device_id = "device-1"
    house.wa_jwt_token = "device-token"
    house.wa_device_secret = "device-secret"
    await db.commit()
    user = await _user_with_permissions(
        db,
        house,
        ["live_c2c.automation_manage"],
    )
    config = LiveC2CAutomationConfig(
        house_id=house.id,
        source_type="gmail",
        is_enabled=True,
        gmail_address=house.email,
        gmail_access_token_encrypted=encrypt_secret("gmail-access"),
        gmail_refresh_token_encrypted=encrypt_secret("gmail-refresh"),
        gmail_status="connected",
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(config)
    await db.commit()
    await api_client.make_user_override(user)
    revoked = []

    async def revoke(_config):
        revoked.append(True)

    async def get_groups(_self, _token):
        return [
            {"id": "source@g.us", "name": "Inbound"},
            {"id": "destination@g.us", "name": "Reports"},
        ]

    async def create_webhook(_self, _token, _url, _events):
        return {"webhook_id": 73, "secret": "whatsapp-secret"}

    monkeypatch.setattr(live_c2c_automation, "revoke_gmail_credentials", revoke)
    monkeypatch.setattr(WhatsAppServiceClient, "get_groups", get_groups)
    monkeypatch.setattr(WhatsAppServiceClient, "create_webhook", create_webhook)
    _set_webhook_url(monkeypatch)

    response = await api_client.put(
        "/api/v1/live-c2c-automation",
        headers={"X-House-ID": str(house.id)},
        json={
            "source_type": "whatsapp",
            "is_enabled": True,
            "source_group_jid": "source@g.us",
            "destination_group_jid": "destination@g.us",
        },
    )

    assert response.status_code == 200
    assert revoked == [True]
    assert config.gmail_access_token_encrypted is None
    assert config.gmail_refresh_token_encrypted is None
    assert config.wa_webhook_id == 73


@pytest.mark.asyncio
async def test_failed_gmail_revocation_rolls_back_source_switch(
    api_client,
    db,
    house,
    monkeypatch,
):
    house.wa_device_id = "device-1"
    house.wa_jwt_token = "device-token"
    house.wa_device_secret = "device-secret"
    await db.commit()
    user = await _user_with_permissions(
        db,
        house,
        ["live_c2c.automation_manage"],
    )
    config = LiveC2CAutomationConfig(
        house_id=house.id,
        source_type="gmail",
        is_enabled=True,
        gmail_address=house.email,
        gmail_refresh_token_encrypted=encrypt_secret("gmail-refresh"),
        gmail_status="connected",
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(config)
    await db.commit()
    await api_client.make_user_override(user)
    deleted = []

    async def revoke(_config):
        raise live_c2c_automation.LiveC2CGmailError("gmail_revoke_failed")

    async def get_groups(_self, _token):
        return [
            {"id": "source@g.us", "name": "Inbound"},
            {"id": "destination@g.us", "name": "Reports"},
        ]

    async def create_webhook(_self, _token, _url, _events):
        return {"webhook_id": 74, "secret": "whatsapp-secret"}

    async def delete_webhook(_self, _token, webhook_id):
        deleted.append(webhook_id)
        return {}

    monkeypatch.setattr(live_c2c_automation, "revoke_gmail_credentials", revoke)
    monkeypatch.setattr(WhatsAppServiceClient, "get_groups", get_groups)
    monkeypatch.setattr(WhatsAppServiceClient, "create_webhook", create_webhook)
    monkeypatch.setattr(WhatsAppServiceClient, "delete_webhook", delete_webhook)
    _set_webhook_url(monkeypatch)
    house_id = house.id

    response = await api_client.put(
        "/api/v1/live-c2c-automation",
        headers={"X-House-ID": str(house_id)},
        json={
            "source_type": "whatsapp",
            "is_enabled": True,
            "source_group_jid": "source@g.us",
            "destination_group_jid": "destination@g.us",
        },
    )

    saved_config = await db.scalar(
        select(LiveC2CAutomationConfig).where(
            LiveC2CAutomationConfig.house_id == house_id
        )
    )
    assert response.status_code == 502
    assert deleted == [74]
    assert saved_config.source_type == "gmail"
    assert saved_config.gmail_refresh_token_encrypted is not None
    assert saved_config.gmail_status == "connected"


@pytest.mark.asyncio
async def test_failed_gmail_revocation_keeps_existing_webhook(
    api_client,
    db,
    house,
    monkeypatch,
):
    house.wa_device_id = "device-1"
    house.wa_jwt_token = "device-token"
    house.wa_device_secret = "device-secret"
    await db.commit()
    user = await _user_with_permissions(
        db,
        house,
        ["live_c2c.automation_manage"],
    )
    config = LiveC2CAutomationConfig(
        house_id=house.id,
        source_type="whatsapp",
        is_enabled=True,
        gmail_address="old@example.com",
        gmail_refresh_token_encrypted=encrypt_secret("gmail-refresh"),
        gmail_status="connected",
        wa_device_id="device-1",
        wa_webhook_id=73,
        wa_webhook_secret_encrypted=encrypt_secret("webhook-secret"),
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(config)
    await db.commit()
    await api_client.make_user_override(user)
    deleted = []

    async def revoke(_config):
        raise live_c2c_automation.LiveC2CGmailError("gmail_revoke_failed")

    async def delete_webhook(_self, _token, webhook_id):
        deleted.append(webhook_id)
        return {}

    monkeypatch.setattr(live_c2c_automation, "revoke_gmail_credentials", revoke)
    monkeypatch.setattr(WhatsAppServiceClient, "delete_webhook", delete_webhook)
    house_id = house.id

    response = await api_client.put(
        "/api/v1/live-c2c-automation",
        headers={"X-House-ID": str(house_id)},
        json={
            "source_type": None,
            "is_enabled": False,
            "source_group_jid": None,
            "destination_group_jid": None,
        },
    )

    saved_config = await db.scalar(
        select(LiveC2CAutomationConfig).where(
            LiveC2CAutomationConfig.house_id == house_id
        )
    )
    assert response.status_code == 502
    assert deleted == []
    assert saved_config.source_type == "whatsapp"
    assert saved_config.wa_webhook_id == 73
    assert saved_config.gmail_refresh_token_encrypted is not None


@pytest.mark.asyncio
async def test_failed_webhook_cleanup_keeps_saved_settings_and_retry_id(
    api_client,
    db,
    house,
    monkeypatch,
):
    house.wa_device_id = "device-1"
    house.wa_jwt_token = "device-token"
    house.wa_device_secret = "device-secret"
    await db.commit()
    user = await _user_with_permissions(
        db,
        house,
        ["live_c2c.automation_manage"],
    )
    config = LiveC2CAutomationConfig(
        house_id=house.id,
        source_type="whatsapp",
        is_enabled=True,
        wa_device_id="device-1",
        wa_webhook_id=74,
        wa_webhook_secret_encrypted=encrypt_secret("webhook-secret"),
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(config)
    await db.commit()
    await api_client.make_user_override(user)

    async def delete_webhook(_self, _token, _webhook_id):
        raise WhatsAppServiceError(
            code="WA_SERVICE_UNREACHABLE",
            message="WhatsApp gateway unavailable",
        )

    monkeypatch.setattr(WhatsAppServiceClient, "delete_webhook", delete_webhook)
    house_id = house.id

    response = await api_client.put(
        "/api/v1/live-c2c-automation",
        headers={"X-House-ID": str(house_id)},
        json={
            "source_type": None,
            "is_enabled": False,
            "source_group_jid": None,
            "destination_group_jid": None,
        },
    )

    saved_config = await db.scalar(
        select(LiveC2CAutomationConfig).where(
            LiveC2CAutomationConfig.house_id == house_id
        )
    )
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "live_c2c_whatsapp_webhook_cleanup_failed"
    assert saved_config.is_enabled is False
    assert saved_config.wa_webhook_id == 74


@pytest.mark.asyncio
async def test_failed_webhook_registration_does_not_save_partial_config(
    api_client,
    db,
    house,
    monkeypatch,
):
    house.wa_device_id = "device-1"
    house.wa_jwt_token = "device-token"
    house.wa_device_secret = "device-secret"
    await db.commit()
    user = await _user_with_permissions(
        db,
        house,
        ["live_c2c.automation_manage"],
    )
    await api_client.make_user_override(user)
    calls = []

    async def get_groups(_self, _token):
        return [
            {"id": "source@g.us", "name": "Inbound"},
            {"id": "destination@g.us", "name": "Reports"},
        ]

    async def create_webhook(_self, _token, _url, _events):
        calls.append(True)
        if len(calls) == 1:
            raise WhatsAppServiceError("WA_TOKEN_EXPIRED", "expired")
        raise WhatsAppServiceError("WA_GATEWAY_ERROR", "registration failed")

    monkeypatch.setattr(WhatsAppServiceClient, "get_groups", get_groups)
    monkeypatch.setattr(WhatsAppServiceClient, "create_webhook", create_webhook)
    _set_webhook_url(monkeypatch)
    house_id = house.id

    response = await api_client.put(
        "/api/v1/live-c2c-automation",
        headers={"X-House-ID": str(house_id)},
        json={
            "source_type": "whatsapp",
            "is_enabled": True,
            "source_group_jid": "source@g.us",
            "destination_group_jid": "destination@g.us",
        },
    )

    config_count = await db.scalar(
        select(func.count()).select_from(LiveC2CAutomationConfig).where(
            LiveC2CAutomationConfig.house_id == house_id
        )
    )
    assert response.status_code == 503
    assert calls == [True]
    assert config_count == 0


@pytest.mark.asyncio
async def test_disabling_whatsapp_removes_registered_gateway_webhook(
    api_client,
    db,
    house,
    monkeypatch,
):
    house.wa_device_id = "device-1"
    house.wa_jwt_token = "device-token"
    house.wa_device_secret = "device-secret"
    await db.commit()
    user = await _user_with_permissions(
        db,
        house,
        ["live_c2c.automation_manage"],
    )
    config = LiveC2CAutomationConfig(
        house_id=house.id,
        source_type="whatsapp",
        is_enabled=True,
        wa_device_id="device-1",
        wa_webhook_id=71,
        wa_webhook_secret_encrypted=encrypt_secret("webhook-secret"),
        source_group_jid="source@g.us",
        destination_group_jid="destination@g.us",
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(config)
    await db.commit()
    await api_client.make_user_override(user)
    removed = []

    async def delete_webhook(_self, _token, webhook_id):
        removed.append(webhook_id)
        return {}

    monkeypatch.setattr(WhatsAppServiceClient, "delete_webhook", delete_webhook)

    response = await api_client.put(
        "/api/v1/live-c2c-automation",
        headers={"X-House-ID": str(house.id)},
        json={
            "source_type": "whatsapp",
            "is_enabled": False,
            "source_group_jid": "source@g.us",
            "destination_group_jid": "destination@g.us",
        },
    )

    assert response.status_code == 200
    assert removed == [71]
    assert config.wa_webhook_id is None
    assert config.wa_webhook_secret_encrypted is not None
    assert config.is_enabled is False


@pytest.mark.asyncio
async def test_gmail_disconnect_clears_encrypted_credentials_and_audits(
    api_client,
    db,
    house,
    monkeypatch,
):
    user = await _user_with_permissions(
        db,
        house,
        ["live_c2c.automation_manage"],
    )
    config = LiveC2CAutomationConfig(
        house_id=house.id,
        source_type="gmail",
        is_enabled=True,
        gmail_address=house.email,
        gmail_access_token_encrypted=encrypt_secret("gmail-access"),
        gmail_refresh_token_encrypted=encrypt_secret("gmail-refresh"),
        gmail_history_id="history-1",
        gmail_status="connected",
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(config)
    await db.commit()
    await api_client.make_user_override(user)
    revoked = []

    async def revoke(_config):
        revoked.append(True)

    monkeypatch.setattr(live_c2c_automation, "revoke_gmail_credentials", revoke)

    response = await api_client.post(
        "/api/v1/live-c2c-automation/gmail/disconnect",
        headers={"X-House-ID": str(house.id)},
    )

    audit_count = await db.scalar(
        select(func.count()).select_from(ActivityLog).where(
            ActivityLog.action == "automation.gmail_disconnected"
        )
    )
    assert response.status_code == 200
    assert revoked == [True]
    assert config.gmail_access_token_encrypted is None
    assert config.gmail_refresh_token_encrypted is None
    assert config.gmail_history_id is None
    assert config.gmail_status == "disconnected"
    assert audit_count == 1


@pytest.mark.asyncio
async def test_webhook_valid_hmac_enqueues_only_matching_group(
    api_client,
    db,
    house,
):
    user = await _user_with_permissions(db, house, [])
    config = LiveC2CAutomationConfig(
        house_id=house.id,
        source_type="whatsapp",
        is_enabled=True,
        wa_device_id="device-1",
        wa_webhook_id=71,
        wa_webhook_secret_encrypted=encrypt_secret("webhook-secret"),
        source_group_jid="source@g.us",
        destination_group_jid="destination@g.us",
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(config)
    await db.commit()
    payload = {
        "event_type": "media.received",
        "device_id": "device-1",
        "timestamp": "2026-11-19T10:00:00Z",
        "data": {
            "chat": "source@g.us",
            "message_id": "message-1",
            "filename": "Live C2C report.xlsx",
            "mimetype": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "file_content": base64.b64encode(b"workbook").decode(),
        },
    }
    body, signature = _signed_payload(payload, "webhook-secret")

    response = await api_client.post(
        "/api/v1/live-c2c-automation/whatsapp/webhook",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Webhook-Signature": signature,
        },
    )
    duplicate_response = await api_client.post(
        "/api/v1/live-c2c-automation/whatsapp/webhook",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Webhook-Signature": signature,
        },
    )

    assert response.status_code == 200
    assert duplicate_response.status_code == 200
    record_count = await db.scalar(select(func.count()).select_from(LiveC2CInboundFile))
    assert record_count == 1
    audit_count = await db.scalar(
        select(func.count()).select_from(ActivityLog).where(
            ActivityLog.action == "automation.file_received"
        )
    )
    assert audit_count == 1


@pytest.mark.asyncio
async def test_webhook_rejects_invalid_hmac_and_wrong_device_or_group(
    api_client,
    db,
    house,
):
    user = await _user_with_permissions(db, house, [])
    db.add(
        LiveC2CAutomationConfig(
            house_id=house.id,
            source_type="whatsapp",
            is_enabled=True,
            wa_device_id="device-1",
            wa_webhook_id=71,
            wa_webhook_secret_encrypted=encrypt_secret("webhook-secret"),
            source_group_jid="source@g.us",
            destination_group_jid="destination@g.us",
            created_by=user.id,
            updated_by=user.id,
        )
    )
    await db.commit()
    payload = {
        "event_type": "media.received",
        "device_id": "device-1",
        "timestamp": "2026-11-19T10:00:00Z",
        "data": {
            "chat": "other@g.us",
            "message_id": "message-2",
            "filename": "Live C2C report.xlsx",
            "mimetype": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "file_content": base64.b64encode(b"workbook").decode(),
        },
    }
    body, signature = _signed_payload(payload, "webhook-secret")

    invalid = await api_client.post(
        "/api/v1/live-c2c-automation/whatsapp/webhook",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Webhook-Signature": "sha256=invalid",
        },
    )
    assert invalid.status_code == 401

    wrong_group = await api_client.post(
        "/api/v1/live-c2c-automation/whatsapp/webhook",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Webhook-Signature": signature,
        },
    )
    assert wrong_group.status_code == 200
    assert wrong_group.json()["status"] == "ignored"

    wrong_device_payload = {**payload, "device_id": "device-2"}
    wrong_device_body, wrong_device_signature = _signed_payload(
        wrong_device_payload,
        "webhook-secret",
    )
    wrong_device = await api_client.post(
        "/api/v1/live-c2c-automation/whatsapp/webhook",
        content=wrong_device_body,
        headers={
            "Content-Type": "application/json",
            "X-Webhook-Signature": wrong_device_signature,
        },
    )
    assert wrong_device.status_code == 401
    record_count = await db.scalar(select(func.count()).select_from(LiveC2CInboundFile))
    assert record_count == 0


@pytest.mark.asyncio
async def test_webhook_enforces_body_size_limit(api_client):
    response = await api_client.post(
        "/api/v1/live-c2c-automation/whatsapp/webhook",
        content=b"x",
        headers={"Content-Length": str(15 * 1024 * 1024 + 1)},
    )

    assert response.status_code == 413


@pytest.mark.asyncio
async def test_whatsapp_webhook_client_uses_device_authenticated_gateway_routes(
    monkeypatch,
):
    requests = []

    def handler(request):
        requests.append(request)
        assert request.headers["authorization"] == "Bearer device-token"
        if request.method == "POST":
            assert request.url.path == "/webhooks"
            assert json.loads(request.content) == {
                "url": "https://api.example.test/webhook",
                "events": ["media.received"],
            }
            return httpx.Response(
                200,
                json={
                    "status": True,
                    "data": {"webhook_id": 88, "secret": "gateway-secret"},
                },
            )
        assert request.method == "DELETE"
        assert request.url.path == "/webhooks/88"
        return httpx.Response(200, json={"status": True})

    real_async_client = httpx.AsyncClient

    def mock_async_client(**kwargs):
        return real_async_client(
            transport=httpx.MockTransport(handler),
            **kwargs,
        )

    monkeypatch.setattr(
        whatsapp_client_module.httpx,
        "AsyncClient",
        mock_async_client,
    )
    monkeypatch.setattr(settings, "WA_GATEWAY_URL", "https://gateway.example.test")
    client = WhatsAppServiceClient()

    created = await client.create_webhook(
        "device-token",
        "https://api.example.test/webhook",
        ["media.received"],
    )
    deleted = await client.delete_webhook("device-token", 88)

    assert created == {"webhook_id": 88, "secret": "gateway-secret"}
    assert deleted == {"status": True}
    assert [request.method for request in requests] == ["POST", "DELETE"]
