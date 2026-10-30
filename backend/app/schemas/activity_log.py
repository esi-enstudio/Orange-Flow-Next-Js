from datetime import date
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel


class ActivityLogOut(BaseModel):
    id: int
    user_id: int
    user_name: Optional[str] = None
    module: str
    action: str
    record_id: Optional[int] = None
    record_identifier: Optional[str] = None
    old_values: Optional[dict] = None
    new_values: Optional[dict] = None
    endpoint: Optional[str] = None
    method: Optional[str] = None
    status_code: Optional[int] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    duration_ms: Optional[int] = None
    created_at: Optional[str] = None

    class Config:
        from_attributes = True


class ActivityLogListOut(BaseModel):
    success: bool
    data: list[ActivityLogOut]
    pagination: dict

    class Config:
        from_attributes = True