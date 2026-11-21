"""Tests for the house-scoped Connections hub.

Covers the read-only aggregator, the Telegram link/unlink endpoints it drives,
and the Gmail OAuth return-path guard.
"""

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select

from app.models.activity_log import ActivityLog
from app.models.house import House
from app.models.live_c2c_automation import LiveC2CAutomationConfig
from app.models.role import Permission, Role
from app.models.telegram_bot import TelegramBot
from app.models.user import User
from app.models.whatsapp_connection import WhatsappConnection
from app.routers import (
    live_c2c_automation,
    telegram_bots,
    whatsapp_connections,
    whatsapp_gateway,
)
from app.routers.connections import router as connections_router
from app.routers.deps import get_current_user, get_db
from app.services import telegram_service
from app.services.whatsapp_service_client import (
    WhatsAppServiceError,
    whatsapp_service_client,
)
from config.settings import settings


@pytest_asyncio.fixture
async def api_client(db):
    app = FastAPI()
    app.include_router(connections_router)
    app.include_router(telegram_bots.router)
    app.include_router(whatsapp_connections.router)
    app.include_router(whatsapp_gateway.router)
    app.include_router(live_c2c_automation.router)

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


_operator_seq = 0


async def _user_with_permissions(db, permissions, houses=()):
    global _operator_seq
    _operator_seq += 1
    suffix = _operator_seq
    role = Role(name=f"Connections operator {suffix}")
    role.permissions = []
    for name in permissions:
        permission = await db.scalar(select(Permission).where(Permission.name == name))
        if permission is None:
            permission = Permission(name=name)
            db.add(permission)
            await db.flush()
        role.permissions.append(permission)

    user = User(
        username=f"connections-user-{suffix}",
        hashed_password="x",
        name="Connections operator",
        status="Active",
    )
    user.roles.append(role)
    for house in houses:
        user.houses.append(house)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest.mark.asyncio
async def test_requires_house_context(api_client, db):
    user = await _user_with_permissions(db, ["connections.view"])

    response = await api_client.get("/api/connections")
    await api_client.make_user_override(user)
    response = await api_client.get("/api/connections")

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_requires_view_permission(api_client, db, house):
    user = await _user_with_permissions(db, [], [house])
    await api_client.make_user_override(user)

    response = await api_client.get(
        "/api/connections", headers={"X-House-ID": str(house.id)}
    )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_returns_every_provider_for_the_active_house(
    api_client, db, house, monkeypatch
):
    house.wa_jwt_token = "wa-jwt"
    house.wa_phone_number = "01700000000"
    house.telegram_chat_id = "-100123"
    house.telegram_chat_name = "Reports"
    bot = TelegramBot(name="House bot", bot_token="x" * 40, bot_username="house_bot")
    bot.houses.append(house)
    db.add(bot)
    config = LiveC2CAutomationConfig(
        house_id=house.id,
        source_type="gmail",
        gmail_status="connected",
        gmail_address="house@example.com",
        gmail_refresh_token_encrypted="encrypted",
        created_by=0,
        updated_by=0,
    )
    db.add(config)
    await db.commit()

    async def fake_device_status(token):
        assert token == "wa-jwt"
        return {"status": True, "connected": True, "phone_number": "01700000000"}

    async def fake_get_me(token):
        return {"username": "house_bot"}

    monkeypatch.setattr(
        whatsapp_service_client, "get_device_status", fake_device_status
    )
    monkeypatch.setattr(telegram_service, "get_me", fake_get_me)
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "client-id")

    user = await _user_with_permissions(db, ["connections.view"], [house])
    await api_client.make_user_override(user)

    response = await api_client.get(
        "/api/connections", headers={"X-House-ID": str(house.id)}
    )

    assert response.status_code == 200
    data = {item["provider"]: item for item in response.json()["data"]}
    assert set(data) == {"whatsapp", "telegram", "gmail"}
    assert data["whatsapp"]["connected"] is True
    assert data["whatsapp"]["account"] == "01700000000"
    assert data["telegram"]["connected"] is True
    assert data["telegram"]["account"] == "@house_bot"
    assert data["gmail"]["connected"] is True
    assert data["gmail"]["account"] == "house@example.com"


@pytest.mark.asyncio
async def test_whatsapp_connection_state_includes_shared_connection_id(
    api_client, db, house, monkeypatch
):
    connection = WhatsappConnection(
        name="Shared reports",
        wa_jwt_token="shared-jwt",
        wa_status="connected",
    )
    connection.houses.append(house)
    db.add(connection)
    await db.commit()
    await db.refresh(connection)

    async def fake_device_status(token):
        assert token == "shared-jwt"
        return {"connected": True}

    monkeypatch.setattr(
        whatsapp_service_client, "get_device_status", fake_device_status
    )
    user = await _user_with_permissions(db, ["connections.view"], [house])
    await api_client.make_user_override(user)

    response = await api_client.get(
        "/api/connections", headers={"X-House-ID": str(house.id)}
    )

    assert response.status_code == 200
    whatsapp = next(
        item for item in response.json()["data"] if item["provider"] == "whatsapp"
    )
    assert whatsapp["reference"] == str(connection.id)


@pytest.mark.asyncio
async def test_whatsapp_status_accepts_connections_view_permission(
    api_client, db, house, monkeypatch
):
    house.wa_jwt_token = "house-jwt"
    await db.commit()

    async def fake_device_status(token):
        assert token == "house-jwt"
        return {"connected": True}

    monkeypatch.setattr(
        whatsapp_service_client, "get_device_status", fake_device_status
    )
    user = await _user_with_permissions(db, ["connections.view"], [house])
    await api_client.make_user_override(user)

    response = await api_client.get(
        "/api/whatsapp/status", headers={"X-House-ID": str(house.id)}
    )

    assert response.status_code == 200
    assert response.json()["connected"] is True


@pytest.mark.asyncio
async def test_shared_whatsapp_status_accepts_connections_view_permission(
    api_client, db, house, monkeypatch
):
    connection = WhatsappConnection(
        name="Shared reports",
        wa_jwt_token="shared-jwt",
        wa_status="connected",
    )
    connection.houses.append(house)
    db.add(connection)
    await db.commit()
    await db.refresh(connection)

    async def fake_device_status(token):
        assert token == "shared-jwt"
        return {"connected": True}

    monkeypatch.setattr(
        whatsapp_service_client, "get_device_status", fake_device_status
    )
    user = await _user_with_permissions(db, ["connections.view"], [house])
    await api_client.make_user_override(user)

    response = await api_client.get(
        f"/api/whatsapp/connections/{connection.id}/status"
    )

    assert response.status_code == 200
    assert response.json()["connected"] is True


@pytest.mark.asyncio
async def test_house_whatsapp_reconnect_rejects_shared_binding(
    api_client, db, house
):
    house.wa_jwt_token = "house-jwt"
    connection = WhatsappConnection(
        name="Shared reports",
        wa_jwt_token="shared-jwt",
        wa_status="disconnected",
    )
    connection.houses.append(house)
    db.add(connection)
    await db.commit()

    user = await _user_with_permissions(db, ["whatsapp.connect"], [house])
    await api_client.make_user_override(user)

    response = await api_client.post(
        "/api/whatsapp/reconnect",
        headers={"X-House-ID": str(house.id)},
    )

    assert response.status_code == 409


@pytest.mark.asyncio
async def test_reset_shared_whatsapp_connection_recreates_device_and_logs(
    api_client, db, house, monkeypatch
):
    connection = WhatsappConnection(
        name="Shared reports",
        wa_api_key="api-key",
        wa_device_id="device-id",
        wa_device_secret="device-secret",
        wa_jwt_token="shared-jwt",
        wa_phone_number="01700000000",
        wa_status="connected",
    )
    connection.houses.append(house)
    db.add(connection)
    await db.commit()
    await db.refresh(connection)

    deleted_devices = []

    async def fake_create_api_key(**kwargs):
        assert kwargs["customer_name"] == "Shared reports"
        return "new-api-key"

    async def fake_create_device(api_key, device_name):
        assert api_key == "new-api-key"
        assert device_name == "Shared reports"
        return {
            "device_id": "new-device-id",
            "device_secret": "new-device-secret",
            "token": "new-jwt",
        }

    async def fake_delete_device(device_id):
        deleted_devices.append(device_id)

    monkeypatch.setattr(
        whatsapp_service_client, "create_api_key", fake_create_api_key
    )
    monkeypatch.setattr(
        whatsapp_service_client, "create_device", fake_create_device
    )
    monkeypatch.setattr(
        whatsapp_service_client, "delete_device", fake_delete_device
    )
    user = await _user_with_permissions(db, ["whatsapp.setup"], [house])
    await api_client.make_user_override(user)

    response = await api_client.post(
        f"/api/whatsapp/connections/{connection.id}/reset"
    )

    assert response.status_code == 200
    assert deleted_devices == ["device-id"]
    await db.refresh(connection)
    assert connection.wa_api_key == "new-api-key"
    assert connection.wa_device_id == "new-device-id"
    assert connection.wa_device_secret == "new-device-secret"
    assert connection.wa_jwt_token == "new-jwt"
    assert connection.wa_status == "disconnected"
    log = await db.scalar(
        select(ActivityLog).where(ActivityLog.action == "connection.reset")
    )
    assert log is not None
    assert log.module == "whatsapp"


@pytest.mark.asyncio
async def test_own_whatsapp_disconnect_does_not_report_success_on_gateway_error(
    api_client, db, house, monkeypatch
):
    house.wa_jwt_token = "house-jwt"
    house.wa_status = "connected"
    await db.commit()

    async def fail_disconnect(token):
        raise WhatsAppServiceError("WA_SERVICE_UNREACHABLE", "gateway unavailable")

    monkeypatch.setattr(
        whatsapp_service_client, "disconnect_device", fail_disconnect
    )
    user = await _user_with_permissions(
        db, ["whatsapp.disconnect", "connections.view"], [house]
    )
    await api_client.make_user_override(user)

    response = await api_client.post(
        "/api/whatsapp/disconnect",
        headers={"X-House-ID": str(house.id)},
    )

    assert response.status_code == 502
    await db.refresh(house)
    assert house.wa_status == "connected"


@pytest.mark.asyncio
async def test_shared_whatsapp_disconnect_does_not_report_success_on_gateway_error(
    api_client, db, house, monkeypatch
):
    connection = WhatsappConnection(
        name="Shared reports",
        wa_jwt_token="shared-jwt",
        wa_status="connected",
    )
    connection.houses.append(house)
    db.add(connection)
    await db.commit()
    await db.refresh(connection)

    async def fail_disconnect(token):
        raise WhatsAppServiceError("WA_SERVICE_UNREACHABLE", "gateway unavailable")

    monkeypatch.setattr(
        whatsapp_service_client, "disconnect_device", fail_disconnect
    )
    user = await _user_with_permissions(
        db, ["whatsapp.disconnect"], [house]
    )
    await api_client.make_user_override(user)

    response = await api_client.post(
        f"/api/whatsapp/connections/{connection.id}/disconnect"
    )

    assert response.status_code == 502
    await db.refresh(connection)
    assert connection.wa_status == "connected"


@pytest.mark.asyncio
async def test_connect_user_can_create_draft_connection_and_reach_qr(
    api_client, db, house, monkeypatch
):
    """The Connections hub connects first (QR) and assigns houses afterwards.

    A house-less draft must be creatable with only ``whatsapp.connect`` and the
    creator must be able to read its status and start the QR login.
    """
    created = {}

    async def fake_create_api_key(**kwargs):
        created["api_key_args"] = kwargs
        return "draft-api-key"

    async def fake_create_device(api_key, device_name):
        return {
            "device_id": "draft-device",
            "device_secret": "draft-secret",
            "token": "draft-jwt",
        }

    async def fake_device_status(token):
        assert token == "draft-jwt"
        return {"connected": False}

    async def fake_login_qr(token):
        assert token == "draft-jwt"
        return {"QRCode": "data:image/png;base64,qr"}

    monkeypatch.setattr(
        whatsapp_service_client, "create_api_key", fake_create_api_key
    )
    monkeypatch.setattr(
        whatsapp_service_client, "create_device", fake_create_device
    )
    monkeypatch.setattr(
        whatsapp_service_client, "get_device_status", fake_device_status
    )
    monkeypatch.setattr(whatsapp_service_client, "login_qr", fake_login_qr)

    user = await _user_with_permissions(
        db, ["whatsapp.connect", "connections.view"], [house]
    )
    await api_client.make_user_override(user)

    response = await api_client.post(
        "/api/whatsapp/connections",
        json={"name": "WhatsApp draft", "house_ids": []},
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["houses"] == []
    assert data["created_by"] == user.id
    # House-less drafts must not crash the gateway customer payload.
    assert created["api_key_args"]["customer_email"]

    connection_id = data["id"]
    status = await api_client.get(
        f"/api/whatsapp/connections/{connection_id}/status"
    )
    assert status.status_code == 200
    assert status.json()["connected"] is False

    qr = await api_client.post(
        f"/api/whatsapp/connections/{connection_id}/connect"
    )
    assert qr.status_code == 200
    assert qr.json()["data"]["QRCode"] == "data:image/png;base64,qr"


@pytest.mark.asyncio
async def test_connect_user_can_assign_own_houses_to_own_draft(api_client, db, house):
    user = await _user_with_permissions(db, ["whatsapp.connect"], [house])
    connection = WhatsappConnection(
        name="WhatsApp draft",
        wa_jwt_token="draft-jwt",
        wa_status="connected",
        created_by=user.id,
    )
    db.add(connection)
    await db.commit()
    await db.refresh(connection)
    await api_client.make_user_override(user)

    response = await api_client.put(
        f"/api/whatsapp/connections/{connection.id}/houses",
        json={"house_ids": [house.id]},
    )

    assert response.status_code == 200
    assert [h["id"] for h in response.json()["data"]["houses"]] == [house.id]
    await db.refresh(connection)
    assert connection.house_ids == [house.id]


@pytest.mark.asyncio
async def test_connect_user_cannot_reassign_another_creators_connection(
    api_client, db, house
):
    owner = await _user_with_permissions(db, ["whatsapp.connect"], [house])
    connection = WhatsappConnection(
        name="Someone else's WhatsApp",
        wa_jwt_token="shared-jwt",
        wa_status="connected",
        created_by=owner.id,
    )
    connection.houses.append(house)
    db.add(connection)
    await db.commit()
    await db.refresh(connection)

    intruder = await _user_with_permissions(db, ["whatsapp.connect"], [house])
    await api_client.make_user_override(intruder)

    response = await api_client.put(
        f"/api/whatsapp/connections/{connection.id}/houses",
        json={"house_ids": [house.id]},
    )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_manage_user_can_still_assign_houses(api_client, db, house):
    connection = WhatsappConnection(
        name="Admin WhatsApp",
        wa_jwt_token="shared-jwt",
        wa_status="connected",
    )
    connection.houses.append(house)
    db.add(connection)
    await db.commit()
    await db.refresh(connection)

    user = await _user_with_permissions(
        db, ["whatsapp.manage", "whatsapp.connect"], [house]
    )
    await api_client.make_user_override(user)

    response = await api_client.put(
        f"/api/whatsapp/connections/{connection.id}/houses",
        json={"house_ids": [house.id]},
    )

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_connections_list_shows_own_draft_to_connect_user(api_client, db, house):
    user = await _user_with_permissions(db, ["whatsapp.connect"], [house])
    own_draft = WhatsappConnection(
        name="My draft",
        wa_jwt_token="own-jwt",
        wa_status="disconnected",
        created_by=user.id,
    )
    other = await _user_with_permissions(db, ["whatsapp.connect"], [house])
    foreign = WhatsappConnection(
        name="Foreign",
        wa_jwt_token="foreign-jwt",
        wa_status="disconnected",
        created_by=other.id,
    )
    db.add_all([own_draft, foreign])
    await db.commit()
    await api_client.make_user_override(user)

    response = await api_client.get("/api/whatsapp/connections")

    assert response.status_code == 200
    names = [item["name"] for item in response.json()["data"]]
    assert names == ["My draft"]


@pytest.mark.asyncio
async def test_reports_disconnected_when_provider_has_no_binding(
    api_client, db, house
):
    user = await _user_with_permissions(db, ["connections.view"], [house])
    await api_client.make_user_override(user)

    response = await api_client.get(
        "/api/connections", headers={"X-House-ID": str(house.id)}
    )

    assert response.status_code == 200
    data = {item["provider"]: item for item in response.json()["data"]}
    assert data["whatsapp"]["connected"] is False
    assert data["telegram"]["connected"] is False
    assert data["gmail"]["connected"] is False


@pytest.mark.asyncio
async def test_cannot_read_another_houses_connections(api_client, db, house):
    other_house = House(
        code="H999",
        name="Other House",
        email="other@example.com",
        wa_phone_number="01999999999",
        wa_jwt_token="other-jwt",
    )
    db.add(other_house)
    await db.commit()

    user = await _user_with_permissions(db, ["connections.view"], [house])
    await api_client.make_user_override(user)

    response = await api_client.get(
        "/api/connections", headers={"X-House-ID": str(other_house.id)}
    )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_telegram_connect_links_chat_and_writes_activity_log(
    api_client, db, house, monkeypatch
):
    bot = TelegramBot(name="House bot", bot_token="x" * 40, bot_username="house_bot")
    bot.houses.append(house)
    db.add(bot)
    await db.commit()

    sent = {}

    async def fake_send_message(token, chat_id, text):
        sent["chat_id"] = chat_id
        return {"message_id": 1}

    monkeypatch.setattr(telegram_service, "send_message", fake_send_message)

    user = await _user_with_permissions(db, ["telegram.connect"], [house])
    await api_client.make_user_override(user)

    response = await api_client.post(
        "/api/telegram/connect",
        json={"house_id": house.id, "chat_id": "-100123456", "chat_name": "Reports"},
        headers={"X-House-ID": str(house.id)},
    )

    assert response.status_code == 200
    assert sent["chat_id"] == "-100123456"
    await db.refresh(house)
    assert house.telegram_chat_id == "-100123456"
    assert house.telegram_chat_name == "Reports"

    log = await db.scalar(
        select(ActivityLog).where(ActivityLog.action == "house.link_chat")
    )
    assert log is not None
    assert log.module == "telegram"


@pytest.mark.asyncio
async def test_telegram_disconnect_clears_chat_and_writes_activity_log(
    api_client, db, house
):
    house.telegram_chat_id = "-100123456"
    house.telegram_chat_name = "Reports"
    await db.commit()

    user = await _user_with_permissions(db, ["telegram.connect"], [house])
    await api_client.make_user_override(user)

    response = await api_client.delete(
        "/api/telegram/disconnect", headers={"X-House-ID": str(house.id)}
    )

    assert response.status_code == 200
    await db.refresh(house)
    assert house.telegram_chat_id is None
    assert house.telegram_chat_name is None

    log = await db.scalar(
        select(ActivityLog).where(ActivityLog.action == "house.unlink_chat")
    )
    assert log is not None
    assert log.module == "telegram"


@pytest.mark.asyncio
async def test_telegram_connect_requires_permission(api_client, db, house):
    user = await _user_with_permissions(db, ["connections.view"], [house])
    await api_client.make_user_override(user)

    response = await api_client.post(
        "/api/telegram/connect",
        json={"house_id": house.id, "chat_id": "-100123456"},
        headers={"X-House-ID": str(house.id)},
    )

    assert response.status_code == 403


def test_gmail_return_path_accepts_only_local_paths():
    assert live_c2c_automation._safe_return_path("/connections") == "/connections"
    assert live_c2c_automation._safe_return_path("https://evil.test") is None
    assert live_c2c_automation._safe_return_path("//evil.test") is None
    assert live_c2c_automation._safe_return_path(None) is None


def test_gmail_redirect_uses_safe_return_path(monkeypatch):
    monkeypatch.setattr(settings, "APP_URL", "http://localhost:3000")

    safe = live_c2c_automation._redirect_after_oauth("/connections", "gmail_connected")
    assert safe.status_code == 303
    assert safe.headers["location"] == (
        "http://localhost:3000/connections?automation=gmail_connected"
    )

    unsafe = live_c2c_automation._redirect_after_oauth(
        "https://evil.test", "gmail_connected"
    )
    assert unsafe.headers["location"] == (
        "http://localhost:3000/reports/live-c2c?automation=gmail_connected"
    )


@pytest.mark.asyncio
async def test_gmail_authorize_is_allowed_with_connect_permission(
    api_client, db, house, monkeypatch
):
    house.email = "house@example.com"
    await db.commit()

    monkeypatch.setattr(
        live_c2c_automation,
        "build_gmail_authorization_url",
        lambda config, state: "https://accounts.google.test/auth",
    )

    user = await _user_with_permissions(db, ["gmail.connect"], [house])
    await api_client.make_user_override(user)

    response = await api_client.post(
        "/api/v1/live-c2c-automation/gmail/authorize",
        params={"return_path": "/connections"},
        headers={"X-House-ID": str(house.id)},
    )

    assert response.status_code == 200
    assert response.json()["authorization_url"] == "https://accounts.google.test/auth"

    config = await db.scalar(
        select(LiveC2CAutomationConfig).where(
            LiveC2CAutomationConfig.house_id == house.id
        )
    )
    assert config is not None
    assert config.oauth_return_path == "/connections"
