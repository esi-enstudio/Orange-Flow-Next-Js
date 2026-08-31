import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.routers.deps import get_db, has_permission, get_house_context
from app.models.user import User
from app.models.otp import OTP
from app.models.house import House
from app.utils.access_control import is_admin_user

router = APIRouter(prefix="/api", tags=["OTP Monitor"])

logger = logging.getLogger(__name__)


@router.get("/otp")
async def list_otps(
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("otp.view")),
    house_context: Optional[int] = Depends(get_house_context),
):
    """Return the latest OTPs, house-scoped to the current user."""
    limit = max(1, min(limit, 50))
    query = (
        select(OTP)
        .options(joinedload(OTP.house))
        .order_by(OTP.received_at.desc())
        .limit(limit)
    )

    if house_context:
        query = query.where(OTP.house_id == house_context)
    elif not is_admin_user(current_user):
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(OTP.house_id.in_(user_house_ids))
        else:
            query = query.where(OTP.id.is_(None))

    result = await db.execute(query)
    rows = result.unique().scalars().all()

    data = []
    for otp in rows:
        house_name = otp.house.name if (otp.house and otp.house.name) else otp.house_code
        house_code = otp.house.code if (otp.house and otp.house.code) else otp.house_code
        data.append({
            "id": otp.id,
            "otp_code": otp.otp_code,
            "house_id": otp.house_id,
            "house_code": house_code,
            "house_name": house_name,
            "sender": otp.sender,
            "message": otp.message,
            "received_at": otp.received_at.isoformat() if otp.received_at else None,
            "is_used": otp.is_used,
            "used_at": otp.used_at.isoformat() if otp.used_at else None,
        })

    return {"success": True, "data": data}
