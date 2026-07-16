from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import date, datetime


class SerialRangeItem(BaseModel):
    starting_serial: str
    ending_serial: str


class SimInventoryCreate(BaseModel):
    sim_type: str = Field(..., min_length=1, max_length=50)
    starting_serial: Optional[str] = Field(None, max_length=100)
    ending_serial: Optional[str] = Field(None, max_length=100)
    serial_ranges: List[SerialRangeItem] = Field(default_factory=list)
    quantity: int = Field(..., ge=1)
    available_quantity: Optional[int] = None
    supplier: Optional[str] = Field(None, max_length=200)
    batch_number: Optional[str] = Field(None, max_length=100)
    purchase_date: Optional[date] = None
    product_id: Optional[int] = Field(None, ge=1)
    exit_order_no: Optional[str] = Field(None, max_length=100)
    house_id: Optional[int] = Field(None, ge=1)
    notes: Optional[str] = None


class SimInventoryUpdate(BaseModel):
    sim_type: Optional[str] = Field(None, min_length=1, max_length=50)
    starting_serial: Optional[str] = Field(None, min_length=1, max_length=100)
    ending_serial: Optional[str] = Field(None, min_length=1, max_length=100)
    serial_ranges: Optional[List[SerialRangeItem]] = None
    quantity: Optional[int] = Field(None, ge=0)
    available_quantity: Optional[int] = Field(None, ge=0)
    supplier: Optional[str] = Field(None, max_length=200)
    batch_number: Optional[str] = Field(None, max_length=100)
    purchase_date: Optional[date] = None
    product_id: Optional[int] = Field(None, ge=1)
    exit_order_no: Optional[str] = Field(None, max_length=100)
    status: Optional[str] = Field(None, pattern=r"^(active|exhausted|expired)$")
    notes: Optional[str] = None


class SimInventorySchema(BaseModel):
    id: int
    house_id: int
    product_id: Optional[int] = None
    sim_type: str
    starting_serial: str
    ending_serial: str
    serial_ranges: Optional[str] = None
    quantity: int
    available_quantity: int
    supplier: Optional[str] = None
    batch_number: Optional[str] = None
    purchase_date: Optional[date] = None
    status: str
    exit_order_no: Optional[str] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
