from datetime import date
from decimal import Decimal
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

PaymentStatus = Literal["cash", "due", "partial", "other"]


def _clean_serials(value: List[str]) -> List[str]:
    cleaned = [item.strip() for item in value if item and item.strip()]
    if not cleaned:
        raise ValueError("At least one serial is required")
    return cleaned


class SaleItem(BaseModel):
    product_id: int
    serials: List[str] = Field(..., min_length=1, max_length=5000)
    unit_price: Decimal = Field(default=Decimal("0"), ge=0)
    notes: Optional[str] = Field(None, max_length=500)

    @field_validator("serials")
    @classmethod
    def _serials_not_blank(cls, value: List[str]) -> List[str]:
        return _clean_serials(value)


class SaleCreate(BaseModel):
    employee_id: Optional[int] = None
    retailer_id: Optional[int] = None
    route: Optional[str] = Field(None, max_length=120)
    business_date: Optional[date] = None
    payment_status: PaymentStatus = "cash"
    paid_amount: Optional[Decimal] = Field(None, ge=0)
    items: List[SaleItem] = Field(..., min_length=1, max_length=50)
    notes: Optional[str] = Field(None, max_length=2000)
    idempotency_key: Optional[str] = Field(None, max_length=120)
    submit: bool = False


class SaleUpdate(BaseModel):
    employee_id: Optional[int] = None
    retailer_id: Optional[int] = None
    route: Optional[str] = Field(None, max_length=120)
    business_date: Optional[date] = None
    payment_status: Optional[PaymentStatus] = None
    paid_amount: Optional[Decimal] = Field(None, ge=0)
    items: Optional[List[SaleItem]] = Field(None, min_length=1, max_length=50)
    notes: Optional[str] = Field(None, max_length=2000)
    submit: bool = False


class SaleReject(BaseModel):
    reason: str = Field(..., min_length=3, max_length=500)
