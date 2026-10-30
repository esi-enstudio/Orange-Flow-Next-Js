from datetime import date
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, Field

ExpenseSource = Literal["route", "house"]
PaymentMethod = Literal["cash", "bank", "mobile", "other"]
CashDirection = Literal["in", "out"]
TopupEntryType = Literal["usage", "return", "adjustment"]


class ExpenseCreate(BaseModel):
    category_id: Optional[int] = None
    employee_id: Optional[int] = None
    source: ExpenseSource = "house"
    business_date: Optional[date] = None
    description: str = Field(..., min_length=3, max_length=500)
    amount: Decimal = Field(..., gt=0)
    notes: Optional[str] = Field(None, max_length=2000)


class ExpenseReject(BaseModel):
    reason: str = Field(..., min_length=3, max_length=500)


class ExpensePay(BaseModel):
    account_id: Optional[int] = None
    reference: Optional[str] = Field(None, max_length=120)


class ReceiptCreate(BaseModel):
    business_date: Optional[date] = None
    receipt_type: str = Field(..., min_length=2, max_length=60)
    source_name: Optional[str] = Field(None, max_length=200)
    related_party: Optional[str] = Field(None, max_length=200)
    related_due_reference: Optional[str] = Field(None, max_length=120)
    amount: Decimal = Field(..., gt=0)
    payment_method: PaymentMethod = "cash"
    reference: Optional[str] = Field(None, max_length=120)
    notes: Optional[str] = Field(None, max_length=2000)


class CashEntryCreate(BaseModel):
    account_id: Optional[int] = None
    business_date: Optional[date] = None
    direction: CashDirection
    amount: Decimal = Field(..., gt=0)
    reference: Optional[str] = Field(None, max_length=120)
    description: Optional[str] = Field(None, max_length=500)


class CashReversal(BaseModel):
    reason: Optional[str] = Field(None, max_length=500)


class ClosingSubmit(BaseModel):
    business_date: Optional[date] = None
    counted_cash: Decimal = Field(..., ge=0)
    notes: Optional[str] = Field(None, max_length=2000)


class ClosingReopen(BaseModel):
    reason: str = Field(..., min_length=3, max_length=500)


class TopupEntryCreate(BaseModel):
    employee_id: Optional[int] = None
    business_date: Optional[date] = None
    entry_type: TopupEntryType = "usage"
    amount: Decimal = Field(..., gt=0)
    reference: Optional[str] = Field(None, max_length=120)
    report_source: Literal["manual", "dms_report"] = "manual"
    notes: Optional[str] = Field(None, max_length=2000)


class TopupVerify(BaseModel):
    verified_amount: Decimal = Field(..., ge=0)
    notes: Optional[str] = Field(None, max_length=2000)


class TopupTransferCreate(BaseModel):
    from_employee_id: Optional[int] = None
    to_employee_id: Optional[int] = None
    amount: Decimal = Field(..., gt=0)
    movement: Literal["morning", "evening", "other"] = "other"
    notes: Optional[str] = Field(None, max_length=255)
