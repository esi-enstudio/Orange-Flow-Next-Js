"""Shared WhatsApp connections API.

A distributor (or DMS operator) links ONE WhatsApp device and assigns it to
multiple houses. Houses bound to a connection send reports through it;
houses without a binding keep using their own legacy per-house device.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.deps import get_db, has_permission
from app.models.house import House
from app.models.user import User
from app.models.whatsapp_connection import WhatsappConnection, whatsapp_connection_houses
from app.services.whatsapp_service_client import (
    whatsapp_service_client,
    WhatsAppServiceError,
)
from app.services.whatsapp_token import WaTarget, with_target_token
from app.utils.activity_logger import log_activity
from app.utils.access_control import is_admin_user
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["WhatsApp Connections"])


# ── Helpers ────────────────────────────────────────────────────────


async def _user_house_ids(current_user: User) -> set[int]:
    return {h.id for h in current_user.houses}


async def _accessible_connection(
    db: AsyncSession,
    connection_id: int,
    current_user: User,
) -> WhatsappConnection:
    """Load a non-deleted connection and verify the user may see/manage it."""
    res = await db.execute(
        select(WhatsappConnection).where(
            WhatsappConnection.id == connection_id,
            WhatsappConnection.is_deleted == False,  # noqa: E712
        )
    )
    conn = res.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="WhatsApp connection not found")

    if is_admin_user(current_user):
        return conn

    user_hids = await _user_house_ids(current_user)
    if not user_hids.intersection(conn.house_ids):
        raise HTTPException(status_code=403, detail="You do not have access to this connection")
    return conn


async def _validate_assignment_houses(
    db: AsyncSession,
    house_ids: list[int],
    current_user: User,
) -> list[House]:
    """All requested houses must exist and be within the user's scope."""
    unique_ids = list(dict.fromkeys(house_ids))
    res = await db.execute(select(House).where(House.id.in_(unique_ids)))
    found = {h.id: h for h in res.scalars().all()}
    missing = [hid for hid in unique_ids if hid not in found]
    if missing:
        raise HTTPException(status_code=404, detail=f"Houses not found: {missing}")

    if not is_admin_user(current_user):
        allowed = await _user_house_ids(current_user)
        forbidden = [hid for hid in unique_ids if hid not in allowed]
        if forbidden:
            raise HTTPException(
                status_code=403,
                detail=f"You do not have access to houses: {forbidden}",
            )
    return [found[hid] for hid in unique_ids]


async def _reject_double_binding(db: AsyncSession, house_ids: list[int], exclude_connection_id: Optional[int]):
    """A house can be bound to at most one shared connection."""
    if not house_ids:
        return
    res = await db.execute(
        select(whatsapp_connection_houses.c.house_id, WhatsappConnection.id, WhatsappConnection.name)
        .join(
            WhatsappConnection,
            WhatsappConnection.id == whatsapp_connection_houses.c.connection_id,
        )
        .where(
            whatsapp_connection_houses.c.house_id.in_(house_ids),
            WhatsappConnection.is_deleted == False,  # noqa: E712
            WhatsappConnection.id != (exclude_connection_id or -1),
        )
    )
    clash = res.first()
    if clash:
        raise HTTPException(
            status_code=409,
            detail=(
                f"House id {clash[0]} is already assigned to connection "
                f"'{clash[2]}'. Remove it there first."
            ),
        )


def _serialize(conn: WhatsappConnection) -> dict:
    return {
        "id": conn.id,
        "name": conn.name,
        "phone_number": conn.wa_phone_number,
        "status": conn.wa_status,
        "last_error": conn.wa_last_error,
        "last_connected_at": (
            conn.wa_last_connected_at.isoformat() if conn.wa_last_connected_at else None
        ),
        "created_at": conn.created_at.isoformat() if conn.created_at else None,
        "houses": [
            {"id": h.id, "name": h.name, "code": h.code} for h in conn.houses
        ],
    }


# ── Schemas ────────────────────────────────────────────────────────


class ConnectionCreatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    house_ids: list[int] = Field(min_length=1)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        return v

    @field_validator("house_ids")
    @classmethod
    def _unique_houses(cls, v: list[int]) -> list[int]:
        if not v:
            raise ValueError("at least one house is required")
        return v


class ConnectionRenamePayload(BaseModel):
    name: str = Field(min_length=1, max_length=200)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        return v


class ConnectionHousesPayload(BaseModel):
    house_ids: list[int] = Field(min_length=0)


class ConnectionPairingPayload(BaseModel):
    phone_number: str = Field(min_length=6, max_length=20)


# ── CRUD ───────────────────────────────────────────────────────────


@router.get("/whatsapp/connections")
async def list_connections(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("whatsapp.view")),
):
    """List shared connections visible to the user."""
    query = (
        select(WhatsappConnection)
        .where(WhatsappConnection.is_deleted == False)  # noqa: E712
        .order_by(WhatsappConnection.id)
    )
    res = await db.execute(query)
    conns = res.scalars().all()

    if not is_admin_user(current_user):
        user_hids = await _user_house_ids(current_user)
        conns = [c for c in conns if user_hids.intersection(c.house_ids)]

    return {"success": True, "data": [_serialize(c) for c in conns]}


@router.post("/whatsapp/connections")
async def create_connection(
    payload: ConnectionCreatePayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("whatsapp.manage")),
):
    """Create a shared WhatsApp device and assign houses to it."""
    houses = await _validate_assignment_houses(db, payload.house_ids, current_user)
    await _reject_double_binding(db, [h.id for h in houses], None)

    try:
        first_house = houses[0]
        api_key = await whatsapp_service_client.create_api_key(
            customer_name=payload.name,
            customer_email=(first_house.email or "").strip() or "shared@orange-flow.local",
            customer_phone=(first_house.poc_mobile or "").strip() or "N/A",
            max_devices=1,
        )
        device_data = await whatsapp_service_client.create_device(
            api_key=api_key,
            device_name=payload.name,
        )
    except WhatsAppServiceError as e:
        raise HTTPException(status_code=502, detail=f"{e.code}: {e.message}")

    conn = WhatsappConnection(
        name=payload.name,
        wa_api_key=api_key,
        wa_device_id=device_data["device_id"],
        wa_device_secret=device_data["device_secret"],
        wa_jwt_token=device_data["token"],
        wa_status="disconnected",
        created_by=current_user.id,
    )
    conn.houses = houses
    db.add(conn)
    await db.commit()
    await db.refresh(conn)

    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="whatsapp",
        action="connection.create",
        record_id=conn.id,
        record_identifier=conn.name,
        new_values={
            "name": conn.name,
            "device_id": conn.wa_device_id,
            "house_ids": [h.id for h in houses],
        },
        request=request,
        status_code=200,
    )

    return {"success": True, "data": _serialize(conn)}


@router.patch("/whatsapp/connections/{connection_id}")
async def rename_connection(
    connection_id: int,
    payload: ConnectionRenamePayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("whatsapp.manage")),
):
    conn = await _accessible_connection(db, connection_id, current_user)
    old_name = conn.name
    conn.name = payload.name
    await db.commit()

    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="whatsapp",
        action="connection.rename",
        record_id=conn.id,
        record_identifier=conn.name,
        old_values={"name": old_name},
        new_values={"name": conn.name},
        request=request,
    )
    return {"success": True, "data": _serialize(conn)}


@router.put("/whatsapp/connections/{connection_id}/houses")
async def assign_houses(
    connection_id: int,
    payload: ConnectionHousesPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("whatsapp.manage")),
):
    """Replace the house assignment list of a connection."""
    conn = await _accessible_connection(db, connection_id, current_user)

    houses = await _validate_assignment_houses(db, payload.house_ids, current_user)
    await _reject_double_binding(db, [h.id for h in houses], conn.id)

    old_ids = sorted(conn.house_ids)
    new_ids = sorted(h.id for h in houses)
    conn.houses = houses
    await db.commit()

    if old_ids != new_ids:
        await log_activity(
            db,
            user_id=current_user.id,
            user_name=current_user.name,
            module="whatsapp",
            action="connection.assign_houses",
            record_id=conn.id,
            record_identifier=conn.name,
            old_values={"house_ids": old_ids},
            new_values={"house_ids": new_ids},
            request=request,
        )

    return {"success": True, "data": _serialize(conn)}


@router.delete("/whatsapp/connections/{connection_id}")
async def delete_connection(
    connection_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("whatsapp.manage")),
):
    """Soft-delete a shared connection and remove its gateway device."""
    conn = await _accessible_connection(db, connection_id, current_user)

    if conn.wa_device_id:
        try:
            await whatsapp_service_client.delete_device(conn.wa_device_id)
        except WhatsAppServiceError as e:
            logger.warning(f"Gateway device delete failed for connection {conn.id}: {e}")

    conn.is_deleted = True
    conn.deleted_at = now_naive()
    conn.deleted_by = current_user.id
    conn.houses = []
    await db.commit()

    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="whatsapp",
        action="connection.delete",
        record_id=conn.id,
        record_identifier=conn.name,
        old_values={"name": conn.name},
        request=request,
    )
    return {"success": True, "data": {"status": "deleted"}}


# ── Lifecycle ──────────────────────────────────────────────────────


@router.get("/whatsapp/connections/{connection_id}/status")
async def connection_status(
    connection_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("whatsapp.view")),
):
    conn = await _accessible_connection(db, connection_id, current_user)

    if not conn.wa_jwt_token:
        return {
            "success": True,
            "connected": False,
            "linked": False,
            "state": "not_configured",
            "qr": None,
            "error": "WhatsApp not configured. Recreate the connection.",
        }

    try:
        status_data = await with_target_token(
            db,
            WaTarget(conn),
            lambda token: whatsapp_service_client.get_device_status(token),
        )
        connected = bool(status_data.get("connected", status_data.get("is_connected", False)))
        linked = bool(status_data.get("device_jid") or status_data.get("is_logged_in"))
        state = "connected" if connected else "disconnected"

        conn.wa_status = state
        if connected:
            conn.wa_last_connected_at = now_naive()
            conn.wa_last_error = None
        await db.commit()

        return {
            "success": True,
            "connected": connected,
            "linked": linked,
            "state": state,
            "qr": status_data.get("qr"),
            "phone_number": conn.wa_phone_number,
            "last_connected_at": (
                conn.wa_last_connected_at.isoformat() if conn.wa_last_connected_at else None
            ),
        }
    except WhatsAppServiceError as e:
        conn.wa_status = "error"
        conn.wa_last_error = e.message
        await db.commit()
        return {
            "success": False,
            "connected": False,
            "state": "error",
            "qr": None,
            "error": e.message,
        }


@router.post("/whatsapp/connections/{connection_id}/connect")
async def connect_qr(
    connection_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("whatsapp.connect")),
):
    """Start QR login flow for a shared connection."""
    conn = await _accessible_connection(db, connection_id, current_user)
    if not conn.wa_jwt_token:
        raise HTTPException(status_code=400, detail="Connection has no device. Recreate it.")

    conn.wa_status = "connecting"
    await db.commit()

    try:
        qr_data = await with_target_token(
            db,
            WaTarget(conn),
            lambda token: whatsapp_service_client.login_qr(token),
        )
        return {"success": True, "data": qr_data}
    except WhatsAppServiceError as e:
        conn.wa_status = "error"
        conn.wa_last_error = e.message
        await db.commit()
        raise HTTPException(status_code=502, detail=f"{e.code}: {e.message}")


@router.post("/whatsapp/connections/{connection_id}/connect/pairing")
async def connect_pairing(
    connection_id: int,
    payload: ConnectionPairingPayload,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("whatsapp.connect")),
):
    conn = await _accessible_connection(db, connection_id, current_user)
    if not conn.wa_jwt_token:
        raise HTTPException(status_code=400, detail="Connection has no device. Recreate it.")

    conn.wa_status = "connecting"
    await db.commit()

    try:
        result = await with_target_token(
            db,
            WaTarget(conn),
            lambda token: whatsapp_service_client.login_pairing_code(token, payload.phone_number),
        )
        return {"success": True, "data": result}
    except WhatsAppServiceError as e:
        conn.wa_status = "error"
        conn.wa_last_error = e.message
        await db.commit()
        raise HTTPException(status_code=502, detail=f"{e.code}: {e.message}")


@router.post("/whatsapp/connections/{connection_id}/reconnect")
async def reconnect(
    connection_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("whatsapp.connect")),
):
    conn = await _accessible_connection(db, connection_id, current_user)
    if not conn.wa_jwt_token:
        raise HTTPException(status_code=400, detail="Connection has no device. Recreate it.")

    async def _reconnect(token: str):
        status_data = await whatsapp_service_client.get_device_status(token)
        if not (status_data.get("device_jid") or status_data.get("is_logged_in")):
            raise HTTPException(
                status_code=400,
                detail=(
                    "This device has never been linked to WhatsApp. "
                    "Use Connect to scan the QR code first."
                ),
            )
        await whatsapp_service_client.reconnect_device(token)

    try:
        await with_target_token(db, WaTarget(conn), _reconnect)
        conn.wa_status = "connecting"
        await db.commit()
        return {"success": True, "data": {"status": "connecting"}}
    except HTTPException:
        raise
    except WhatsAppServiceError as e:
        raise HTTPException(status_code=502, detail=f"{e.code}: {e.message}")


@router.post("/whatsapp/connections/{connection_id}/disconnect")
async def disconnect(
    connection_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("whatsapp.disconnect")),
):
    conn = await _accessible_connection(db, connection_id, current_user)
    if not conn.wa_jwt_token:
        raise HTTPException(status_code=400, detail="Connection has no device. Recreate it.")

    try:
        await with_target_token(
            db,
            WaTarget(conn),
            lambda token: whatsapp_service_client.disconnect_device(token),
        )
    except WhatsAppServiceError:
        pass

    old_status = conn.wa_status
    conn.wa_status = "disconnected"
    conn.wa_last_error = None
    await db.commit()

    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="whatsapp",
        action="connection.disconnect",
        record_id=conn.id,
        record_identifier=conn.name,
        old_values={"wa_status": old_status},
        new_values={"wa_status": "disconnected"},
        request=request,
    )
    return {"success": True, "data": {"status": "disconnected"}}
