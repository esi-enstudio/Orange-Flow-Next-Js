from datetime import date
from decimal import Decimal
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

SERIAL_LIST_FIELD = Field(..., min_length=1, max_length=5000)


class ReceiptLineCreate(BaseModel):
    """One product (with its serials) inside a multi-product receiving."""

    product_id: int
    serials: List[str] = Field(..., min_length=1)
    expected_quantity: Optional[int] = Field(None, ge=0, le=100000)
    unit_cost: Optional[Decimal] = Field(None, ge=0)
    face_value: Optional[Decimal] = Field(None, ge=0)
    notes: Optional[str] = Field(None, max_length=500)

    @field_validator("serials")
    @classmethod
    def _serials_not_blank(cls, value: List[str]) -> List[str]:
        cleaned = [item.strip() for item in value if item and item.strip()]
        if not cleaned:
            raise ValueError("At least one serial is required")
        return cleaned


class ReceiptCreate(BaseModel):
    # Legacy single-product payload. Kept for old clients; new clients should
    # send `lines` so one voucher can receive several products at once.
    # `batch_number` is no longer accepted: the server generates it from the
    # unique receiving document number.
    product_id: Optional[int] = None
    supplier: Optional[str] = Field(None, max_length=200)
    purchase_reference: Optional[str] = Field(None, max_length=100)
    invoice_number: Optional[str] = Field(None, max_length=100)
    business_date: Optional[date] = None
    expected_quantity: Optional[int] = Field(None, ge=0, le=100000)
    unit_cost: Decimal = Field(default=Decimal("0"), ge=0)
    face_value: Decimal = Field(default=Decimal("0"), ge=0)
    serials: Optional[List[str]] = Field(None, min_length=1)
    lines: Optional[List[ReceiptLineCreate]] = Field(None, min_length=1, max_length=100)
    notes: Optional[str] = Field(None, max_length=2000)
    idempotency_key: Optional[str] = Field(None, max_length=120)

    @field_validator("serials")
    @classmethod
    def _serials_not_blank(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        if value is None:
            return value
        cleaned = [item.strip() for item in value if item and item.strip()]
        if not cleaned:
            raise ValueError("At least one serial is required")
        return cleaned

    @model_validator(mode="after")
    def _require_product_lines(self):
        if self.lines:
            return self
        if self.product_id and self.serials:
            return self
        raise ValueError("Send either `lines` or `product_id` with `serials`")


class IssueCreate(BaseModel):
    employee_id: int
    product_id: int
    business_date: Optional[date] = None
    serials: List[str] = SERIAL_LIST_FIELD
    notes: Optional[str] = Field(None, max_length=2000)
    idempotency_key: Optional[str] = Field(None, max_length=120)

    @field_validator("serials")
    @classmethod
    def _serials_not_blank(cls, value: List[str]) -> List[str]:
        cleaned = [item.strip() for item in value if item and item.strip()]
        if not cleaned:
            raise ValueError("At least one serial is required")
        return cleaned


class ReturnCreate(BaseModel):
    employee_id: int
    product_id: int
    business_date: Optional[date] = None
    serials: List[str] = SERIAL_LIST_FIELD
    reason: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = Field(None, max_length=2000)
    idempotency_key: Optional[str] = Field(None, max_length=120)

    @field_validator("serials")
    @classmethod
    def _serials_not_blank(cls, value: List[str]) -> List[str]:
        cleaned = [item.strip() for item in value if item and item.strip()]
        if not cleaned:
            raise ValueError("At least one serial is required")
        return cleaned


class ReturnDecision(BaseModel):
    serial_number: str = Field(..., min_length=3, max_length=100)
    decision: Literal["accept", "damaged", "reject"]
    note: Optional[str] = Field(None, max_length=500)


class ReturnVerifyRequest(BaseModel):
    decisions: List[ReturnDecision] = Field(..., min_length=1, max_length=5000)
    notes: Optional[str] = Field(None, max_length=2000)
