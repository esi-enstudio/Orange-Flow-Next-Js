from pydantic import BaseModel, Field, field_validator
from typing import Optional, Any, List
from datetime import datetime

REPORT_TYPE_CHOICES = [
    "dashboard",
    "ga_live",
    "activations",
    "itopup",
    "live_activations",
    "scratch_card",
    "sim_issues",
]

class ReportRuleBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    rule_type: str = Field(min_length=1, max_length=50)
    config: Optional[Any] = None
    report_types: Optional[List[str]] = None
    is_active: bool = True
    valid_from: datetime
    valid_to: Optional[datetime] = None
    house_id: Optional[int] = None

    @field_validator("valid_from", "valid_to", mode="before")
    @classmethod
    def coerce_naive(cls, v):
        if v is None:
            return v
        if isinstance(v, str) and v.endswith("Z"):
            return v[:-1]
        if isinstance(v, datetime) and v.tzinfo is not None:
            return v.replace(tzinfo=None)
        return v

class ReportRuleCreate(ReportRuleBase):
    pass

class ReportRuleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    rule_type: Optional[str] = None
    config: Optional[Any] = None
    report_types: Optional[List[str]] = None
    is_active: Optional[bool] = None
    valid_from: Optional[datetime] = None
    valid_to: Optional[datetime] = None

    @field_validator("valid_from", "valid_to", mode="before")
    @classmethod
    def coerce_naive(cls, v):
        if v is None:
            return v
        if isinstance(v, str) and v.endswith("Z"):
            return v[:-1]
        if isinstance(v, datetime) and v.tzinfo is not None:
            return v.replace(tzinfo=None)
        return v

class ReportRuleSchema(ReportRuleBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    class Config: from_attributes = True
