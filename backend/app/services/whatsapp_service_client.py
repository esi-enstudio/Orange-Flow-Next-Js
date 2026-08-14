import asyncio
import logging
from typing import Optional

import httpx

from config.settings import settings

logger = logging.getLogger(__name__)


class WhatsAppServiceClient:
    def __init__(self, base_url: Optional[str] = None, enabled: Optional[bool] = None):
        self.base_url = (base_url or settings.WHATSAPP_SERVICE_URL).rstrip("/")
        self.enabled = settings.WHATSAPP_SERVICE_ENABLED if enabled is None else enabled

    def _check_enabled(self) -> None:
        if not self.enabled:
            raise WhatsAppServiceError(
                code="WA_SERVICE_DISABLED",
                message="WhatsApp service is disabled. Set WHATSAPP_SERVICE_ENABLED=True.",
            )

    async def get_status(self) -> dict:
        self._check_enabled()
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(f"{self.base_url}/api/status")
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPError as e:
            logger.error(f"WhatsApp status fetch failed: {e}")
            raise WhatsAppServiceError(code="WA_SERVICE_UNREACHABLE", message=str(e)) from e

    async def get_groups(self) -> list[dict]:
        self._check_enabled()
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.get(f"{self.base_url}/api/groups")
                resp.raise_for_status()
                data = resp.json()
                if not data.get("success"):
                    raise WhatsAppServiceError(
                        code=data.get("error", {}).get("code", "WA_ERROR"),
                        message=data.get("error", {}).get("message", "Unknown error"),
                    )
                return data.get("data", [])
        except httpx.HTTPError as e:
            logger.error(f"WhatsApp groups fetch failed: {e}")
            raise WhatsAppServiceError(code="WA_SERVICE_UNREACHABLE", message=str(e)) from e

    async def send_file(
        self,
        chat_id: str,
        filename: str,
        file_bytes: bytes,
        caption: str = "",
        mimetype: str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        retries: int = 2,
    ) -> dict:
        self._check_enabled()
        files = {"file": (filename, file_bytes, mimetype)}
        data = {"chatId": chat_id, "caption": caption}
        last_err: Optional[WhatsAppServiceError] = None
        for attempt in range(1 + retries):
            try:
                async with httpx.AsyncClient(timeout=60) as client:
                    resp = await client.post(f"{self.base_url}/api/send-file", files=files, data=data)
                    resp.raise_for_status()
                    body = resp.json()
                    if not body.get("success"):
                        raise WhatsAppServiceError(
                            code=body.get("error", {}).get("code", "WA_SEND_FAILED"),
                            message=body.get("error", {}).get("message", "Unknown error"),
                        )
                    return body
            except httpx.HTTPError as e:
                detail = str(e) or f"{type(e).__name__} (no detail)"
                logger.warning(f"WhatsApp file send attempt {attempt + 1} failed to {chat_id}: {detail}")
                last_err = WhatsAppServiceError(code="WA_SERVICE_UNREACHABLE", message=detail)
                if attempt < retries:
                    await asyncio.sleep(3 * (attempt + 1))
        assert last_err is not None
        raise last_err

    async def send_text(self, chat_id: str, text: str, retries: int = 2) -> dict:
        self._check_enabled()
        last_err: Optional[WhatsAppServiceError] = None
        for attempt in range(1 + retries):
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.post(
                        f"{self.base_url}/api/send-text",
                        json={"chatId": chat_id, "text": text},
                    )
                    resp.raise_for_status()
                    body = resp.json()
                    if not body.get("success"):
                        raise WhatsAppServiceError(
                            code=body.get("error", {}).get("code", "WA_SEND_FAILED"),
                            message=body.get("error", {}).get("message", "Unknown error"),
                        )
                    return body
            except httpx.HTTPError as e:
                detail = str(e) or f"{type(e).__name__} (no detail)"
                logger.warning(f"WhatsApp text send attempt {attempt + 1} failed to {chat_id}: {detail}")
                last_err = WhatsAppServiceError(code="WA_SERVICE_UNREACHABLE", message=detail)
                if attempt < retries:
                    await asyncio.sleep(3 * (attempt + 1))
        assert last_err is not None
        raise last_err


class WhatsAppServiceError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


whatsapp_service_client = WhatsAppServiceClient()
