from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import date


class BulkAllocationItem(BaseModel):
    event_type_id: int
    thana: str
    count: int = 0
    budget_per_unit: float = 0.0


class BulkAllocationCreate(BaseModel):
    house_id: int
    month: date
    allocations: List[BulkAllocationItem]


class ZoomInEventTypeSchema(BaseModel):
    id: int
    name: str
    name_bn: Optional[str] = None
    is_active: bool = True

    class Config:
        from_attributes = True


class ZoomInEventTypeCreate(BaseModel):
    name: str
    name_bn: Optional[str] = None


class ZoomInEventTypeUpdate(BaseModel):
    name: Optional[str] = None
    name_bn: Optional[str] = None
    is_active: Optional[bool] = None


class ZoomInActivitySchema(BaseModel):
    id: int
    name: str
    name_bn: Optional[str] = None
    is_active: bool = True

    class Config:
        from_attributes = True


class ZoomInActivityCreate(BaseModel):
    name: str
    name_bn: Optional[str] = None


class ZoomInActivityUpdate(BaseModel):
    name: Optional[str] = None
    name_bn: Optional[str] = None
    is_active: Optional[bool] = None


class ZoomInAllocationCreate(BaseModel):
    house_id: int
    month: date
    event_type_id: int
    thana: str = ""
    count: int = 0
    budget_per_unit: float = 0.0


class ZoomInAllocationUpdate(BaseModel):
    count: int = 0
    budget_per_unit: float = 0.0


class ZoomInAllocationResponse(BaseModel):
    id: int
    house_id: int
    month: date
    event_type_id: int
    count: int
    budget_per_unit: float
    total_budget: float
    house_name: Optional[str] = None
    event_type_name: Optional[str] = None

    class Config:
        from_attributes = True


class ZoomInEventCreate(BaseModel):
    house_id: int
    date: date
    event_type_id: int
    activity_id: int
    thana: str
    bts_ids: List[int] = []
    rso_ids: List[int] = []
    bp_ids: List[int] = []
    retailer_codes: List[str] = []


class ZoomInEventUpdate(BaseModel):
    house_id: Optional[int] = None
    date: Optional[date] = None
    event_type_id: Optional[int] = None
    activity_id: Optional[int] = None
    thana: Optional[str] = None
    bts_ids: Optional[List[int]] = None
    rso_ids: Optional[List[int]] = None
    bp_ids: Optional[List[int]] = None
    retailer_codes: Optional[List[str]] = None

    @field_validator("date", mode="plain")
    @classmethod
    def coerce_date(cls, v):
        if v is None:
            return None
        if isinstance(v, date):
            return v
        if isinstance(v, str):
            try:
                return date.fromisoformat(v)
            except ValueError:
                return None
        return None


class ZoomInEventResponse(BaseModel):
    id: int
    house_id: int
    date: date
    event_type_id: int
    activity_id: int
    thana: str
    house_name: Optional[str] = None
    event_type_name: Optional[str] = None
    activity_name: Optional[str] = None
    bts_ids: List[int] = []
    rso_ids: List[int] = []
    bp_ids: List[int] = []
    retailer_codes: List[str] = []
    created_at: Optional[str] = None

    class Config:
        from_attributes = True


class CurrentMonthSummary(BaseModel):
    total_budget: float = 0
    event_type_summaries: List[dict] = []
