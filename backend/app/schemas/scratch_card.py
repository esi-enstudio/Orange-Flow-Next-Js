from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, date
from decimal import Decimal


class ScratchCardIssueBase(BaseModel):
    house_id: Optional[int] = None
    issue_date: Optional[date] = None
    distributor_code: Optional[str] = None
    distributor_name: Optional[str] = None
    retailer_code: Optional[str] = None
    retailer_name: Optional[str] = None
    product_code: Optional[str] = None
    product_name: Optional[str] = None
    start_sc_no: Optional[str] = None
    end_sc_no: Optional[str] = None
    quantity: Optional[int] = Field(None, ge=0)
    value: Optional[float] = Field(None, ge=0)
    rso_code: Optional[str] = None
    route_code: Optional[str] = None


class ScratchCardIssueCreate(ScratchCardIssueBase):
    pass


class ScratchCardIssueUpdate(BaseModel):
    issue_date: Optional[date] = None
    distributor_code: Optional[str] = None
    distributor_name: Optional[str] = None
    retailer_code: Optional[str] = None
    retailer_name: Optional[str] = None
    product_code: Optional[str] = None
    product_name: Optional[str] = None
    start_sc_no: Optional[str] = None
    end_sc_no: Optional[str] = None
    quantity: Optional[int] = Field(None, ge=0)
    value: Optional[float] = Field(None, ge=0)
    rso_code: Optional[str] = None
    route_code: Optional[str] = None


class ScratchCardIssueSchema(ScratchCardIssueBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SlotInfoSchema(BaseModel):
    type: str
    start: int
    end: int
    count: int
    status_col: int
    rows: List[int]


class StockInfoSchema(BaseModel):
    amount: int
    quantity: int
    value: int


class AllocationReportSchema(BaseModel):
    slots: List[SlotInfoSchema] = []
    remaining_amount: int = 0
    fulfilled_amount: int = 0
    current_stock: List[StockInfoSchema] = []
    future_stock: List[StockInfoSchema] = []


class BatchSerialsCreate(BaseModel):
    house_code: str
    amount: int = Field(..., ge=1)
    serials: List[str] = Field(..., min_length=1)


class SlotAllocateRequest(BaseModel):
    house_code: str
    request_amount: int = Field(..., ge=1)


class SlotMarkUsedRequest(BaseModel):
    house_code: str
    slots: List[SlotInfoSchema]


class HouseSheetInfo(BaseModel):
    house_code: str
    existing_amounts: List[str] = []


class ImportFilterParams(BaseModel):
    search: Optional[str] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    distributor_code: Optional[str] = None
    retailer_code: Optional[str] = None
    product_code: Optional[str] = None
