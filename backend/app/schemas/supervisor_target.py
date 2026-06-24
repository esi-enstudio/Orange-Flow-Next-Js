from pydantic import BaseModel
from typing import Optional, Any
from datetime import date, datetime

class SupervisorTargetCreate(BaseModel):
    house_id: Optional[int] = None
    employee_id: int
    target_date: str
    ev_secondary: float = 0.0
    sc_secondary: float = 0.0
    total_recharge: Optional[float] = None
    total_ga: int = 0
    bp_ga: int = 0
    rso_ga: int = 0
    sso: int = 0
    lso: int = 0
    bso: int = 0
    ddso: int = 0
    extra_targets: Optional[dict] = {}

class SupervisorTargetUpdate(BaseModel):
    ev_secondary: Optional[float] = None
    sc_secondary: Optional[float] = None
    total_recharge: Optional[float] = None
    total_ga: Optional[int] = None
    bp_ga: Optional[int] = None
    rso_ga: Optional[int] = None
    sso: Optional[int] = None
    lso: Optional[int] = None
    bso: Optional[int] = None
    ddso: Optional[int] = None
    extra_targets: Optional[dict] = None

class SupervisorTargetResponse(BaseModel):
    id: int
    employee_id: int
    house_id: Optional[int] = None
    ev_secondary: float
    sc_secondary: float
    total_recharge: float
    total_ga: int
    bp_ga: int
    rso_ga: int
    sso: int
    lso: int
    bso: int
    ddso: int
    extra_targets: Any
    target_date: date
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    house: Optional[Any] = None
    employee: Optional[Any] = None

    class Config: from_attributes = True
