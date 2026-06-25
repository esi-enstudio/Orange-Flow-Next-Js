from pydantic import BaseModel
from typing import Optional, Any
from datetime import date, datetime


class BpTargetCreate(BaseModel):
    house_id: Optional[int] = None
    employee_id: int
    target_date: str
    ga_target: int = 0
    ev_secondary: float = 0.0
    sc_secondary: float = 0.0
    total_recharge: float = 0.0
    extra_targets: Optional[dict] = {}


class BpTargetUpdate(BaseModel):
    ga_target: Optional[int] = None
    ev_secondary: Optional[float] = None
    sc_secondary: Optional[float] = None
    total_recharge: Optional[float] = None
    extra_targets: Optional[dict] = None


class BpTargetResponse(BaseModel):
    id: int
    house_id: int
    employee_id: int
    ga_target: int
    ev_secondary: float
    sc_secondary: float
    total_recharge: float
    extra_targets: Any
    target_date: date
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    house: Optional[Any] = None
    employee: Optional[Any] = None

    class Config:
        from_attributes = True
