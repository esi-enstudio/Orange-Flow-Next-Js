from pydantic import BaseModel
from typing import Optional, Any
from datetime import date, datetime

class RSOTargetCreate(BaseModel):
    house_id: Optional[int] = None
    employee_id: int
    supervisor_id: Optional[int] = None
    target_date: str
    ev_secondary: float = 0.0
    sc_secondary: float = 0.0
    total_recharge: Optional[float] = None
    ga: int = 0
    sso: int = 0
    lso: int = 0
    bso: int = 0
    ddso: int = 0
    service_route: Optional[str] = None
    market_type: Optional[str] = None
    thana_name: Optional[str] = None
    ga_target_modified: int = 0
    ev_secondary_modified: float = 0.0
    sc_secondary_modified: float = 0.0
    recharge_target_modified: float = 0.0
    lso_target_modified: int = 0
    sso_target_modified: int = 0
    bso_target_modified: int = 0
    daily_dso_target_modified: int = 0
    extra_targets: Optional[dict] = {}

class RSOTargetUpdate(BaseModel):
    supervisor_id: Optional[int] = None
    ev_secondary: Optional[float] = None
    sc_secondary: Optional[float] = None
    total_recharge: Optional[float] = None
    ga: Optional[int] = None
    sso: Optional[int] = None
    lso: Optional[int] = None
    bso: Optional[int] = None
    ddso: Optional[int] = None
    service_route: Optional[str] = None
    market_type: Optional[str] = None
    thana_name: Optional[str] = None
    ga_target_modified: Optional[int] = None
    ev_secondary_modified: Optional[float] = None
    sc_secondary_modified: Optional[float] = None
    recharge_target_modified: Optional[float] = None
    lso_target_modified: Optional[int] = None
    sso_target_modified: Optional[int] = None
    bso_target_modified: Optional[int] = None
    daily_dso_target_modified: Optional[int] = None
    extra_targets: Optional[dict] = None

class RSOTargetResponse(BaseModel):
    id: int
    house_id: int
    employee_id: int
    supervisor_id: Optional[int] = None
    ev_secondary: float
    sc_secondary: float
    total_recharge: float
    ga: int
    sso: int
    lso: int
    bso: int
    ddso: int
    service_route: Optional[str] = None
    market_type: Optional[str] = None
    thana_name: Optional[str] = None
    ga_target_modified: int
    ev_secondary_modified: float
    sc_secondary_modified: float
    recharge_target_modified: float
    lso_target_modified: int
    sso_target_modified: int
    bso_target_modified: int
    daily_dso_target_modified: int
    extra_targets: Any
    target_date: date
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    house: Optional[Any] = None
    employee: Optional[Any] = None
    supervisor: Optional[Any] = None

    class Config: from_attributes = True
