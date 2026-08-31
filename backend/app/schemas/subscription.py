from typing import Optional, List, Dict, Any
from pydantic import BaseModel
from datetime import datetime
from decimal import Decimal


class PlanSchema(BaseModel):
    id: int
    name: str
    slug: Optional[str] = None
    tier: Optional[str] = None
    duration_days: Optional[int] = None
    price: Optional[Decimal] = None
    currency: str = "BDT"
    billing_interval: str = "monthly"
    price_monthly: Decimal = Decimal("0")
    price_yearly: Decimal = Decimal("0")
    trial_days: int = 0
    description: Optional[str] = None
    features: Optional[str] = None
    feature_flags: Optional[List[str]] = None
    limits: Optional[Dict[str, Any]] = None
    is_active: bool = True
    sort_order: int = 0

    class Config:
        from_attributes = True


class PlanUpsert(BaseModel):
    name: str
    slug: Optional[str] = None
    tier: Optional[str] = None
    duration_days: Optional[int] = 30
    currency: str = "BDT"
    billing_interval: str = "monthly"
    price_monthly: Decimal = Decimal("0")
    price_yearly: Decimal = Decimal("0")
    trial_days: int = 0
    description: Optional[str] = None
    features: Optional[str] = None
    feature_flags: Optional[List[str]] = None
    limits: Optional[Dict[str, Any]] = None
    is_active: bool = True
    sort_order: int = 0


class SubscriptionSchema(BaseModel):
    id: int
    house_id: int
    package_id: Optional[int] = None
    status: str
    effective_status: Optional[str] = None
    start_date: datetime
    end_date: datetime
    current_period_start: Optional[datetime] = None
    current_period_end: Optional[datetime] = None
    trial_start: Optional[datetime] = None
    trial_end: Optional[datetime] = None
    grace_period_end: Optional[datetime] = None
    cancel_at_period_end: bool = False
    cancelled_at: Optional[datetime] = None
    paused_at: Optional[datetime] = None
    resume_at: Optional[datetime] = None
    auto_renew: bool = False
    gateway: Optional[str] = None
    billing_interval: str = "monthly"
    currency: str = "BDT"
    package: Optional[PlanSchema] = None

    class Config:
        from_attributes = True


class EntitlementsSchema(BaseModel):
    house_id: int
    subscribed: bool
    status: Optional[str] = None
    feature_gated: bool = False  # True when a plan is enforcing features (not legacy)
    features_enabled: Optional[List[str]] = None
    limits: Optional[Dict[str, Any]] = None
    plan: Optional[PlanSchema] = None
    trial_end: Optional[datetime] = None
    grace_period_end: Optional[datetime] = None
    next_billing_date: Optional[datetime] = None


class BillingError(BaseModel):
    success: bool = False
    error: Dict[str, Any]