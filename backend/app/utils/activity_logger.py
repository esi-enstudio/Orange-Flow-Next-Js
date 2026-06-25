import time
from typing import Optional
from fastapi import Request
from fastapi.encoders import jsonable_encoder
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity_log import ActivityLog


async def log_activity(
    db: AsyncSession,
    user_id: int,
    user_name: Optional[str],
    module: str,
    action: str,
    record_id: Optional[int] = None,
    record_identifier: Optional[str] = None,
    old_values: Optional[dict] = None,
    new_values: Optional[dict] = None,
    request: Optional[Request] = None,
    status_code: int = 200,
    duration_ms: Optional[int] = None,
):
    log = ActivityLog(
        user_id=user_id,
        user_name=user_name,
        module=module,
        action=action,
        record_id=record_id,
        record_identifier=record_identifier,
        old_values=jsonable_encoder(old_values) if old_values else None,
        new_values=jsonable_encoder(new_values) if new_values else None,
        endpoint=str(request.url.path) if request else None,
        method=request.method if request else None,
        status_code=status_code,
        ip_address=request.client.host if request and request.client else None,
        user_agent=request.headers.get("user-agent") if request else None,
        duration_ms=duration_ms,
    )
    db.add(log)
    await db.commit()
