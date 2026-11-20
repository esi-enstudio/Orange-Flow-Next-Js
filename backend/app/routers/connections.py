"""Connections hub API.

Read-only aggregator that tells the frontend which external apps the active
house has connected. Connect/disconnect actions stay on each provider's own
endpoint and permission (``whatsapp.connect``, ``telegram.connect``,
``gmail.connect``).
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.house import House
from app.models.user import User
from app.routers.deps import get_db, has_permission, require_house_context
from app.services.connection_providers import collect_house_connections

router = APIRouter(prefix="/api/connections", tags=["Connections"])


@router.get("")
async def list_connections(
    house_id: int = Depends(require_house_context),
    current_user: User = Depends(has_permission("connections.view")),
    db: AsyncSession = Depends(get_db),
):
    house = await db.scalar(select(House).where(House.id == house_id))
    if house is None:
        raise HTTPException(status_code=404, detail="House not found")

    states = await collect_house_connections(db, house)
    return {"success": True, "data": [state.as_dict() for state in states]}
