from pydantic import BaseModel
from typing import Optional, Any
from datetime import date, datetime

class HouseTargetCreate(BaseModel):
    house_id: int
    target_date: str
    ev_c2c_target: float
    sc_primary_target: float
    total_recharge_target: Optional[float] = None
    total_ga_target: int
    bp_ga: int
    rso_ga: int
    ev_scr: float
    sso: int
    lso: int
    bso: int
    ddso: int
    extra_targets: Optional[dict] = {}

class HouseTargetUpdate(BaseModel):
    ev_c2c_target: Optional[float] = None
    sc_primary_target: Optional[float] = None
    total_recharge_target: Optional[float] = None
    total_ga_target: Optional[int] = None
    bp_ga: Optional[int] = None
    rso_ga: Optional[int] = None
    ev_scr: Optional[float] = None
    sso: Optional[int] = None
    lso: Optional[int] = None
    bso: Optional[int] = None
    ddso: Optional[int] = None
    extra_targets: Optional[dict] = None

class HouseTargetResponse(BaseModel):
    id: int
    house_id: int
    ev_c2c_target: float
    sc_primary_target: float
    total_recharge_target: float
    total_ga_target: int
    bp_ga: int
    rso_ga: int
    ev_scr: float
    sso: int
    lso: int
    bso: int
    ddso: int
    extra_targets: Any
    target_date: date
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    house: Optional[Any] = None

    class Config: from_attributes = True
