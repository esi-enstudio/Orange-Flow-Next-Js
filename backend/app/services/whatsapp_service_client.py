import logging
from typing import Optional

import httpx

from config.settings import settings

logger = logging.getLogger(__name__)


class WhatsAppServiceClient:
    """Client for go-whatsapp-multi-session-rest-api (per-device JWT auth).

    Each house gets its own device/session. The client uses JWT tokens
    for device-scoped authentication.
    """

    def __init__(self):
        self.base_url = settings.WA_GATEWAY_URL.rstrip("/")
        self.admin_key = settings.WA_GATEWAY_ADMIN_KEY
        self.enabled = settings.WA_GATEWAY_ENABLED

    def _check_enabled(self) -> None:
        if not self.enabled:
            raise WhatsAppServiceError(
                code="WA_SERVICE_DISABLED",
                message="WhatsApp gateway is disabled. Set WA_GATEWAY_ENABLED=True.",
            )

    @staticmethod
    def _raise(resp: httpx.Response) -> None:
        """Raise structured errors; 401 on a device JWT => WA_TOKEN_EXPIRED."""
        if resp.status_code == 401:
            raise WhatsAppServiceError(
                code="WA_TOKEN_EXPIRED",
                message="Device token has been revoked or expired",
            )
        resp.raise_for_status()

    # ── Admin APIs (one-time setup) ──────────────────────────────────

    async def create_api_key(
        self,
        customer_name: str,
        customer_email: str = "",
        customer_phone: str = "",
        max_devices: int = 10,
    ) -> str:
        """Create an API key for a customer/house. Returns api_key string.

        Gateway requires: customer_name, customer_email, customer_phone,
        max_devices > 0 and rate_limit_per_hour > 0.
        """
        self._check_enabled()
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    f"{self.base_url}/admin/api-keys",
                    headers={"X-Admin-Secret": self.admin_key, "Content-Type": "application/json"},
                    json={
                        "customer_name": customer_name,
                        "customer_email": customer_email,
                        "customer_phone": customer_phone,
                        "max_devices": max_devices,
                        "rate_limit_per_hour": 1000,
                    },
                )
                resp.raise_for_status()
                body = resp.json()
                if not body.get("status"):
                    raise WhatsAppServiceError(
                        code="WA_API_KEY_CREATE_FAILED",
                        message=body.get("message", "Failed to create API key"),
                    )
                return body["data"]["api_key"]
        except httpx.HTTPError as e:
            logger.error(f"WA gateway create API key failed: {e}")
            raise WhatsAppServiceError(code="WA_SERVICE_UNREACHABLE", message=str(e)) from e

    async def create_device(self, api_key: str, device_name: str) -> dict:
        """Create a device for a house. Returns {device_id, device_secret, token}."""
        self._check_enabled()
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    f"{self.base_url}/devices",
                    headers={"X-API-Key": api_key, "Content-Type": "application/json"},
                    json={"device_name": device_name},
                )
                resp.raise_for_status()
                body = resp.json()
                if not body.get("status"):
                    raise WhatsAppServiceError(
                        code="WA_DEVICE_CREATE_FAILED",
                        message=body.get("message", "Failed to create device"),
                    )
                return body["data"]
        except httpx.HTTPError as e:
            logger.error(f"WA gateway create device failed: {e}")
            raise WhatsAppServiceError(code="WA_SERVICE_UNREACHABLE", message=str(e)) from e

    async def regenerate_token(self, device_id: str, device_secret: str) -> str:
        """Regenerate JWT token for a device. Returns new token."""
        self._check_enabled()
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    f"{self.base_url}/devices/token",
                    headers={"Content-Type": "application/json"},
                    json={"device_id": device_id, "device_secret": device_secret},
                )
                resp.raise_for_status()
                body = resp.json()
                if not body.get("status"):
                    raise WhatsAppServiceError(
                        code="WA_TOKEN_REGEN_FAILED",
                        message=body.get("message", "Failed to regenerate token"),
                    )
                return body["data"]["token"]
        except httpx.HTTPError as e:
            logger.error(f"WA gateway regenerate token failed: {e}")
            raise WhatsAppServiceError(code="WA_SERVICE_UNREACHABLE", message=str(e)) from e

    async def delete_device(self, device_id: str) -> dict:
        """Delete a device (admin only)."""
        self._check_enabled()
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.delete(
                    f"{self.base_url}/admin/devices/{device_id}",
                    headers={"X-Admin-Secret": self.admin_key},
                )
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPError as e:
            logger.error(f"WA gateway delete device failed: {e}")
            raise WhatsAppServiceError(code="WA_SERVICE_UNREACHABLE", message=str(e)) from e

    # ── Device APIs (per-house, JWT auth) ────────────────────────────

    async def get_device_status(self, jwt_token: str) -> dict:
        """Get connection status for a device."""
        self._check_enabled()
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{self.base_url}/devices/me/status",
                    headers={"Authorization": f"Bearer {jwt_token}"},
                )
                self._raise(resp)
                body = resp.json()
                if not body.get("status"):
                    raise WhatsAppServiceError(
                        code="WA_STATUS_FAILED",
                        message=body.get("message", "Failed to get device status"),
                    )
                return body.get("data", body)
        except httpx.HTTPError as e:
            logger.error(f"WA gateway device status failed: {e}")
            raise WhatsAppServiceError(code="WA_SERVICE_UNREACHABLE", message=str(e)) from e

    async def login_qr(self, jwt_token: str) -> dict:
        """Generate QR code for device login. Returns {qr_data_url, ...}."""
        self._check_enabled()
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f"{self.base_url}/devices/me/login",
                    headers={"Authorization": f"Bearer {jwt_token}"},
                    data={"output": "json"},
                )
                self._raise(resp)
                body = resp.json()
                if not body.get("status"):
                    raise WhatsAppServiceError(
                        code="WA_QR_FAILED",
                        message=body.get("message", "Failed to generate QR code"),
                    )
                return body.get("data", body)
        except httpx.HTTPError as e:
            logger.error(f"WA gateway login QR failed: {e}")
            raise WhatsAppServiceError(code="WA_SERVICE_UNREACHABLE", message=str(e)) from e

    async def login_pairing_code(self, jwt_token: str, phone_number: str) -> dict:
        """Login with pairing code (alternative to QR)."""
        self._check_enabled()
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f"{self.base_url}/devices/me/login-code",
                    headers={"Authorization": f"Bearer {jwt_token}"},
                    json={"phone_number": phone_number},
                )
                self._raise(resp)
                body = resp.json()
                if not body.get("status"):
                    raise WhatsAppServiceError(
                        code="WA_PAIRING_FAILED",
                        message=body.get("message", "Failed to generate pairing code"),
                    )
                return body.get("data", body)
        except httpx.HTTPError as e:
            logger.error(f"WA gateway pairing code failed: {e}")
            raise WhatsAppServiceError(code="WA_SERVICE_UNREACHABLE", message=str(e)) from e

    async def reconnect_device(self, jwt_token: str) -> dict:
        """Reconnect a disconnected device."""
        self._check_enabled()
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    f"{self.base_url}/devices/me/reconnect",
                    headers={"Authorization": f"Bearer {jwt_token}"},
                )
                self._raise(resp)
                body = resp.json()
                return body.get("data", body)
        except httpx.HTTPError as e:
            logger.error(f"WA gateway reconnect failed: {e}")
            raise WhatsAppServiceError(code="WA_SERVICE_UNREACHABLE", message=str(e)) from e

    async def disconnect_device(self, jwt_token: str) -> dict:
        """Logout/disconnect device."""
        self._check_enabled()
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.delete(
                    f"{self.base_url}/devices/me/session",
                    headers={"Authorization": f"Bearer {jwt_token}"},
                )
                self._raise(resp)
                body = resp.json()
                return body.get("data", body)
        except httpx.HTTPError as e:
            logger.error(f"WA gateway disconnect failed: {e}")
            raise WhatsAppServiceError(code="WA_SERVICE_UNREACHABLE", message=str(e)) from e

    async def get_groups(self, jwt_token: str) -> list[dict]:
        """Get all WhatsApp groups for this device."""
        self._check_enabled()
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.get(
                    f"{self.base_url}/groups",
                    headers={"Authorization": f"Bearer {jwt_token}"},
                )
                self._raise(resp)
                body = resp.json()
                if not body.get("status"):
                    raise WhatsAppServiceError(
                        code="WA_GROUPS_FAILED",
                        message=body.get("message", "Failed to fetch groups"),
                    )
                raw_groups = body.get("data", [])
                # Gateway returns capitalized keys (EnhancedGroupInfo: JID/Name),
                # older builds may return lowercase jid/id/name/subject.
                def _pick(d: dict, *keys: str) -> str:
                    for k in keys:
                        v = d.get(k)
                        if v:
                            return str(v)
                    return ""

                return [
                    {
                        "id": _pick(g, "JID", "jid", "id"),
                        "name": _pick(g, "Name", "name", "subject") or "Unnamed Group",
                    }
                    for g in raw_groups
                    if isinstance(g, dict)
                ]
        except httpx.HTTPError as e:
            logger.error(f"WA gateway groups fetch failed: {e}")
            raise WhatsAppServiceError(code="WA_SERVICE_UNREACHABLE", message=str(e)) from e

    async def get_contacts(self, jwt_token: str) -> list[dict]:
        """Get all WhatsApp contacts for this device."""
        self._check_enabled()
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    f"{self.base_url}/users/me/contacts",
                    headers={"Authorization": f"Bearer {jwt_token}"},
                )
                self._raise(resp)
                body = resp.json()
                if not body.get("status"):
                    raise WhatsAppServiceError(
                        code="WA_CONTACTS_FAILED",
                        message=body.get("message", "Failed to fetch contacts"),
                    )
                raw_contacts = body.get("data", [])

                def _pick(d: dict, *keys: str) -> str:
                    for k in keys:
                        v = d.get(k)
                        if v:
                            return str(v)
                    return ""

                return [
                    {
                        "jid": _pick(c, "jid", "JID", "id"),
                        "push_name": _pick(c, "push_name", "PushName", "pushName"),
                        "full_name": _pick(c, "full_name", "FullName", "fullName"),
                        "first_name": _pick(c, "first_name", "FirstName", "firstName"),
                        "business_name": _pick(c, "business_name", "BusinessName", "businessName"),
                    }
                    for c in raw_contacts
                    if isinstance(c, dict) and c.get("jid") or c.get("JID") or c.get("id")
                ]
        except httpx.HTTPError as e:
            logger.error(f"WA gateway contacts fetch failed: {e}")
            raise WhatsAppServiceError(code="WA_SERVICE_UNREACHABLE", message=str(e)) from e

    async def send_text(self, jwt_token: str, chat_jid: str, text: str, retries: int = 2) -> dict:
        """Send text message to a chat_jid (e.g. 120363...@g.us)."""
        self._check_enabled()
        last_err: Optional[WhatsAppServiceError] = None
        for attempt in range(1 + retries):
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.post(
                        f"{self.base_url}/chats/{chat_jid}/messages",
                        headers={"Authorization": f"Bearer {jwt_token}", "Content-Type": "application/json"},
                        json={"text": text},
                    )
                    self._raise(resp)
                    body = resp.json()
                    if not body.get("status"):
                        raise WhatsAppServiceError(
                            code="WA_SEND_FAILED",
                            message=body.get("message", "Failed to send message"),
                        )
                    return body
            except httpx.HTTPError as e:
                detail = str(e)
                logger.warning(f"WA text send attempt {attempt + 1} failed to {chat_jid}: {detail}")
                last_err = WhatsAppServiceError(code="WA_SERVICE_UNREACHABLE", message=detail)
                if attempt < retries:
                    import asyncio
                    await asyncio.sleep(3 * (attempt + 1))
        assert last_err is not None
        raise last_err

    async def send_file(
        self,
        jwt_token: str,
        chat_jid: str,
        filename: str,
        file_bytes: bytes,
        caption: str = "",
        mimetype: str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        retries: int = 2,
    ) -> dict:
        """Send file/document to a chat."""
        self._check_enabled()
        last_err: Optional[WhatsAppServiceError] = None
        for attempt in range(1 + retries):
            try:
                async with httpx.AsyncClient(timeout=60) as client:
                    resp = await client.post(
                        f"{self.base_url}/chats/{chat_jid}/documents",
                        headers={"Authorization": f"Bearer {jwt_token}"},
                        files={"file": (filename, file_bytes, mimetype)},
                        data={"filename": filename, "caption": caption},
                    )
                    self._raise(resp)
                    body = resp.json()
                    if not body.get("status"):
                        raise WhatsAppServiceError(
                            code="WA_SEND_FAILED",
                            message=body.get("message", "Failed to send file"),
                        )
                    return body
            except httpx.HTTPError as e:
                detail = str(e)
                logger.warning(f"WA file send attempt {attempt + 1} failed to {chat_jid}: {detail}")
                last_err = WhatsAppServiceError(code="WA_SERVICE_UNREACHABLE", message=detail)
                if attempt < retries:
                    import asyncio
                    await asyncio.sleep(3 * (attempt + 1))
        assert last_err is not None
        raise last_err

    async def send_image(
        self,
        jwt_token: str,
        chat_jid: str,
        filename: str,
        image_bytes: bytes,
        caption: str = "",
        retries: int = 2,
    ) -> dict:
        """Send image to a chat."""
        self._check_enabled()
        last_err: Optional[WhatsAppServiceError] = None
        for attempt in range(1 + retries):
            try:
                async with httpx.AsyncClient(timeout=60) as client:
                    resp = await client.post(
                        f"{self.base_url}/chats/{chat_jid}/images",
                        headers={"Authorization": f"Bearer {jwt_token}"},
                        files={"file": (filename, image_bytes, "image/png")},
                        data={"caption": caption},
                    )
                    self._raise(resp)
                    body = resp.json()
                    if not body.get("status"):
                        raise WhatsAppServiceError(
                            code="WA_SEND_FAILED",
                            message=body.get("message", "Failed to send image"),
                        )
                    return body
            except httpx.HTTPError as e:
                detail = str(e)
                logger.warning(f"WA image send attempt {attempt + 1} failed to {chat_jid}: {detail}")
                last_err = WhatsAppServiceError(code="WA_SERVICE_UNREACHABLE", message=detail)
                if attempt < retries:
                    import asyncio
                    await asyncio.sleep(3 * (attempt + 1))
        assert last_err is not None
        raise last_err


class WhatsAppServiceError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


whatsapp_service_client = WhatsAppServiceClient()
