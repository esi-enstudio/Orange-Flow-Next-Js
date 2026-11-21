import base64
import binascii
from datetime import timedelta
from typing import Any
from urllib.parse import urlencode

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.live_c2c_automation import LiveC2CAutomationConfig
from app.services.live_c2c_automation_service import (
    decrypt_secret,
    encrypt_secret,
    enqueue_live_c2c_file,
    matches_live_c2c_filename,
    validate_live_c2c_attachment,
)
from app.services.live_c2c_service import LiveC2CImportError
from app.utils.timezone import now_naive
from config.settings import settings

GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_API_URL = "https://gmail.googleapis.com/gmail/v1/users/me"
GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
REQUEST_TIMEOUT_SECONDS = 20


class LiveC2CGmailError(RuntimeError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


class _GoogleHTTPError(LiveC2CGmailError):
    def __init__(self, code: str, status_code: int):
        self.status_code = status_code
        super().__init__(code)


async def revoke_gmail_credentials(
    config: LiveC2CAutomationConfig,
) -> None:
    token_ciphertext = (
        config.gmail_refresh_token_encrypted
        or config.gmail_access_token_encrypted
    )
    if not token_ciphertext:
        return
    token = decrypt_secret(token_ciphertext)
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            response = await client.post(
                GOOGLE_REVOKE_URL,
                data={"token": token},
            )
    except httpx.HTTPError as exc:
        raise LiveC2CGmailError("gmail_revoke_failed") from exc
    if response.is_error:
        raise LiveC2CGmailError("gmail_revoke_failed")


def _oauth_config(*, include_secret: bool = False) -> tuple[str, str, str | None]:
    client_id = settings.GOOGLE_OAUTH_CLIENT_ID
    redirect_uri = settings.GOOGLE_OAUTH_REDIRECT_URI
    client_secret = settings.GOOGLE_OAUTH_CLIENT_SECRET
    if not client_id or not redirect_uri or (include_secret and not client_secret):
        raise LiveC2CGmailError("gmail_oauth_not_configured")
    return client_id, redirect_uri, client_secret


def build_gmail_authorization_url(
    config: LiveC2CAutomationConfig,
    state: str,
) -> str:
    client_id, redirect_uri, _ = _oauth_config(include_secret=True)
    if not state:
        raise LiveC2CGmailError("gmail_oauth_state_missing")
    if not config.gmail_address:
        raise LiveC2CGmailError("gmail_house_email_missing")

    query = urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": GMAIL_READONLY_SCOPE,
            "access_type": "offline",
            "prompt": "consent",
            "include_granted_scopes": "true",
            "login_hint": config.gmail_address,
            "state": state,
        }
    )
    return f"{GOOGLE_AUTHORIZATION_URL}?{query}"


async def _request_json(
    method: str,
    url: str,
    *,
    access_token: str | None = None,
    data: dict[str, str] | None = None,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {access_token}"} if access_token else None
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            response = await client.request(
                method,
                url,
                headers=headers,
                data=data,
                params=params,
            )
    except httpx.HTTPError as exc:
        raise LiveC2CGmailError("gmail_request_failed") from exc

    if response.is_error:
        code = "gmail_history_expired" if response.status_code == 404 else "gmail_request_failed"
        raise _GoogleHTTPError(code, response.status_code)
    try:
        payload = response.json()
    except ValueError as exc:
        raise LiveC2CGmailError("gmail_invalid_response") from exc
    if not isinstance(payload, dict):
        raise LiveC2CGmailError("gmail_invalid_response")
    return payload


async def exchange_gmail_code(
    db: AsyncSession,
    config: LiveC2CAutomationConfig,
    code: str,
) -> None:
    client_id, redirect_uri, client_secret = _oauth_config(include_secret=True)
    if not code:
        raise LiveC2CGmailError("gmail_authorization_code_missing")

    token_payload = await _request_json(
        "POST",
        GOOGLE_TOKEN_URL,
        data={
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret or "",
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        },
    )
    access_token = token_payload.get("access_token")
    refresh_token = token_payload.get("refresh_token") or (
        decrypt_secret(config.gmail_refresh_token_encrypted)
        if config.gmail_refresh_token_encrypted
        else None
    )
    if not isinstance(access_token, str) or not access_token:
        raise LiveC2CGmailError("gmail_access_token_missing")
    if not refresh_token:
        raise LiveC2CGmailError("gmail_refresh_token_missing")

    profile = await _request_json(
        "GET",
        f"{GMAIL_API_URL}/profile",
        access_token=access_token,
    )
    email_address = profile.get("emailAddress")
    history_id = profile.get("historyId")
    if not isinstance(email_address, str) or not isinstance(history_id, str):
        raise LiveC2CGmailError("gmail_profile_invalid")
    if email_address.casefold() != config.gmail_address.casefold():
        raise LiveC2CGmailError("gmail_account_mismatch")

    config.gmail_address = email_address
    config.gmail_access_token_encrypted = encrypt_secret(access_token)
    config.gmail_refresh_token_encrypted = encrypt_secret(refresh_token)
    config.gmail_token_expires_at = now_naive() + timedelta(
        seconds=max(int(token_payload.get("expires_in", 3600)), 0)
    )
    config.gmail_history_id = history_id
    config.gmail_status = "connected"
    config.gmail_error = None
    await db.commit()


async def _refresh_access_token(
    db: AsyncSession,
    config: LiveC2CAutomationConfig,
) -> str:
    client_id, _, client_secret = _oauth_config(include_secret=True)
    if not config.gmail_refresh_token_encrypted:
        raise LiveC2CGmailError("gmail_refresh_token_missing")
    refresh_token = decrypt_secret(config.gmail_refresh_token_encrypted)
    payload = await _request_json(
        "POST",
        GOOGLE_TOKEN_URL,
        data={
            "client_id": client_id,
            "client_secret": client_secret or "",
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
    )
    access_token = payload.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise LiveC2CGmailError("gmail_access_token_missing")
    config.gmail_access_token_encrypted = encrypt_secret(access_token)
    if payload.get("refresh_token"):
        config.gmail_refresh_token_encrypted = encrypt_secret(payload["refresh_token"])
    config.gmail_token_expires_at = now_naive() + timedelta(
        seconds=max(int(payload.get("expires_in", 3600)), 0)
    )
    await db.flush()
    return access_token


async def _get_access_token(
    db: AsyncSession,
    config: LiveC2CAutomationConfig,
) -> str:
    if not config.gmail_access_token_encrypted:
        raise LiveC2CGmailError("gmail_access_token_missing")
    if (
        config.gmail_token_expires_at is None
        or config.gmail_token_expires_at <= now_naive() + timedelta(minutes=1)
    ):
        return await _refresh_access_token(db, config)
    return decrypt_secret(config.gmail_access_token_encrypted)


def _message_ids(history: list[dict[str, Any]]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for entry in history:
        for added in entry.get("messagesAdded", []):
            message = added.get("message", {})
            message_id = message.get("id")
            if isinstance(message_id, str) and message_id not in seen:
                seen.add(message_id)
                result.append(message_id)
    return result


def _walk_parts(part: dict[str, Any]):
    yield part
    for child in part.get("parts", []):
        if isinstance(child, dict):
            yield from _walk_parts(child)


def _matching_parts(message: dict[str, Any]):
    payload = message.get("payload")
    if not isinstance(payload, dict):
        return
    for part in _walk_parts(payload):
        filename = part.get("filename")
        body = part.get("body")
        if (
            isinstance(filename, str)
            and matches_live_c2c_filename(filename)
            and isinstance(body, dict)
        ):
            yield part


def _decode_attachment_data(data: str) -> bytes:
    try:
        padded = data + "=" * (-len(data) % 4)
        return base64.urlsafe_b64decode(padded.encode("ascii"))
    except (ValueError, UnicodeEncodeError, binascii.Error) as exc:
        raise LiveC2CGmailError("gmail_attachment_invalid") from exc


async def _attachment_bytes(
    access_token: str,
    message_id: str,
    part: dict[str, Any],
) -> bytes:
    body = part["body"]
    attachment_id = body.get("attachmentId")
    if isinstance(attachment_id, str) and attachment_id:
        payload = await _request_json(
            "GET",
            f"{GMAIL_API_URL}/messages/{message_id}/attachments/{attachment_id}",
            access_token=access_token,
        )
        data = payload.get("data")
    else:
        data = body.get("data")
    if not isinstance(data, str):
        raise LiveC2CGmailError("gmail_attachment_invalid")
    return _decode_attachment_data(data)


async def poll_gmail_config(
    db: AsyncSession,
    config: LiveC2CAutomationConfig,
) -> int:
    if config.source_type != "gmail" or not config.is_enabled:
        return 0
    if config.gmail_status != "connected" or not config.gmail_history_id:
        raise LiveC2CGmailError("gmail_connection_not_ready")

    access_token = await _get_access_token(db, config)
    history: list[dict[str, Any]] = []
    next_page_token: str | None = None
    latest_history_id = config.gmail_history_id
    try:
        while True:
            params: dict[str, Any] = {
                "startHistoryId": config.gmail_history_id,
                "historyTypes": "messageAdded",
            }
            if next_page_token:
                params["pageToken"] = next_page_token
            page = await _request_json(
                "GET",
                f"{GMAIL_API_URL}/history",
                access_token=access_token,
                params=params,
            )
            history.extend(page.get("history", []))
            if isinstance(page.get("historyId"), str):
                latest_history_id = page["historyId"]
            next_page_token = page.get("nextPageToken")
            if not isinstance(next_page_token, str) or not next_page_token:
                break
    except _GoogleHTTPError as exc:
        if exc.status_code != 404:
            raise
        config.gmail_status = "needs_attention"
        config.gmail_error = "gmail_history_expired"
        await db.commit()
        return 0

    queued = 0
    for message_id in _message_ids(history):
        message = await _request_json(
            "GET",
            f"{GMAIL_API_URL}/messages/{message_id}",
            access_token=access_token,
            params={"format": "full"},
        )
        for part in _matching_parts(message):
            filename = part.get("filename")
            body = part["body"]
            size = body.get("size", 0)
            if not isinstance(size, int) or size <= 0:
                continue
            try:
                validate_live_c2c_attachment(filename, size)
            except LiveC2CImportError:
                continue

            content = await _attachment_bytes(access_token, message_id, part)
            safe_filename = validate_live_c2c_attachment(filename, len(content))
            part_id = part.get("partId")
            attachment_id = body.get("attachmentId")
            source_part_id = attachment_id or part_id
            if not isinstance(source_part_id, str) or not source_part_id:
                source_part_id = f"part-{queued}"
            await enqueue_live_c2c_file(
                db,
                config=config,
                source_event_id=f"gmail:{message_id}:{source_part_id}",
                filename=safe_filename,
                content=content,
            )
            queued += 1

    config.gmail_history_id = latest_history_id
    config.gmail_last_polled_at = now_naive()
    config.gmail_error = None
    await db.commit()
    return queued
