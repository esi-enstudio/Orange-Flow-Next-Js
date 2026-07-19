from pydantic import BaseModel, Field, field_serializer
from typing import Optional, List
from datetime import datetime, timezone, timedelta

BST_TZ = timezone(timedelta(hours=6))


class ScratchCardSerialCreate(BaseModel):
    product_id: int = Field(..., ge=1, description="Product ID")
    serial_number: str = Field(..., min_length=1, max_length=100)
    status: str = Field("available", pattern=r"^(available|used|allocated)$")
    batch_id: Optional[str] = None
    exit_order_no: Optional[str] = Field(None, max_length=100)
    rf_no: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = None


class ScratchCardSerialUpdate(BaseModel):
    product_id: Optional[int] = Field(None, ge=1)
    serial_number: Optional[str] = Field(None, min_length=1, max_length=100)
    status: Optional[str] = Field(None, pattern=r"^(available|used|allocated)$")
    exit_order_no: Optional[str] = Field(None, max_length=100)
    rf_no: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = None


class ScratchCardSerialSchema(BaseModel):
    id: int
    house_id: int
    house_name: Optional[str] = None
    house_code: Optional[str] = None
    product_id: int
    product_name: Optional[str] = None
    product_code: Optional[str] = None
    serial_number: str
    status: str
    batch_id: Optional[str] = None
    exit_order_no: Optional[str] = None
    rf_no: Optional[str] = None
    notes: Optional[str] = None
    used_at: Optional[datetime] = None
    used_by: Optional[int] = None
    used_by_name: Optional[str] = None
    used_by_role: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @field_serializer("used_at", "created_at", "updated_at")
    def serialize_datetime(self, dt: Optional[datetime]) -> Optional[str]:
        if dt is None:
            return None
        if dt.tzinfo is None:
            return dt.isoformat() + "+06:00"
        return dt.astimezone(BST_TZ).isoformat()

    class Config:
        from_attributes = True


class BatchSerialsCreate(BaseModel):
    product_id: int = Field(..., ge=1)
    serials: List[str] = Field(..., min_length=1)
    batch_id: Optional[str] = None
    exit_order_no: Optional[str] = Field(None, max_length=100)
    rf_no: Optional[str] = Field(None, max_length=100)


class SlotAllocateRequest(BaseModel):
    request_amount: int = Field(..., ge=1, description="Total BDT amount needed")
    prefer_product_ids: Optional[List[int]] = Field(None, description="Prefer these products first")


class AllocationRangeSchema(BaseModel):
    product_id: int
    product_name: Optional[str] = None
    product_code: Optional[str] = None
    amount: int
    start_serial: str
    end_serial: str
    count: int
    total_value: int


class AllocationResultSchema(BaseModel):
    ranges: List[AllocationRangeSchema] = []
    requested_amount: int = 0
    fulfilled_amount: int = 0


class ConfirmAllocationRange(BaseModel):
    start_serial: str
    end_serial: str


class ConfirmAllocationRequest(BaseModel):
    ranges: List[ConfirmAllocationRange] = []
    serials: List[str] = []
    notes: Optional[str] = None


class SerialFilterParams(BaseModel):
    search: Optional[str] = None
    product_id: Optional[int] = None
    status: Optional[str] = Field(None, pattern=r"^(available|used|allocated)$")
    batch_id: Optional[str] = None
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None


class BulkStatusUpdate(BaseModel):
    serial_ids: List[int] = Field(..., min_length=1)
    status: str = Field(..., pattern=r"^(available|used|allocated)$")


class BatchSerialUpdate(BaseModel):
    serial_ids: List[int] = Field(..., min_length=1)
    exit_order_no: Optional[str] = None
    rf_no: Optional[str] = None
    notes: Optional[str] = None
