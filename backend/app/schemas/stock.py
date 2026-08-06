from typing import Optional
from datetime import date, datetime
from pydantic import BaseModel, Field, field_validator


class StockItemSchema(BaseModel):
    id: int
    house_id: int
    product_id: int
    location_type: str
    employee_id: Optional[int] = None
    quantity: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    product_code: Optional[str] = None
    product_name: Optional[str] = None
    product_category: Optional[str] = None
    unit_price: Optional[float] = 0.0
    total_value: Optional[float] = 0.0

    employee_name: Optional[str] = None
    employee_dms_code: Optional[str] = None
    house_name: Optional[str] = None

    class Config:
        from_attributes = True


class StockItemCreate(BaseModel):
    product_id: int
    location_type: str
    employee_id: Optional[int] = None
    quantity: int = Field(..., gt=0)

    @field_validator("location_type")
    @classmethod
    def validate_location_type(cls, v):
        if v not in ("warehouse", "rso"):
            raise ValueError("location_type must be one of: warehouse, rso")
        return v


class StockBulkItem(BaseModel):
    product_id: int
    location_type: str
    employee_id: Optional[int] = None
    quantity: int = Field(..., gt=0)

    @field_validator("location_type")
    @classmethod
    def validate_location_type(cls, v):
        if v not in ("warehouse", "rso"):
            raise ValueError("location_type must be one of: warehouse, rso")
        return v


class StockBulkCreate(BaseModel):
    items: list[StockBulkItem] = Field(..., min_length=1)


class StockTransferCreate(BaseModel):
    product_id: int
    from_type: str
    from_employee_id: Optional[int] = None
    to_type: str
    to_employee_id: Optional[int] = None
    quantity: int = Field(..., gt=0)
    notes: Optional[str] = None

    @field_validator("from_type", "to_type")
    @classmethod
    def validate_type(cls, v):
        if v not in ("warehouse", "rso"):
            raise ValueError("type must be one of: warehouse, rso")
        return v


class StockTransferSchema(BaseModel):
    id: int
    house_id: int
    product_id: int
    from_type: str
    from_employee_id: Optional[int] = None
    to_type: str
    to_employee_id: Optional[int] = None
    quantity: int
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    created_by: Optional[int] = None

    product_code: Optional[str] = None
    product_name: Optional[str] = None
    from_employee_name: Optional[str] = None
    from_employee_dms_code: Optional[str] = None
    to_employee_name: Optional[str] = None
    to_employee_dms_code: Optional[str] = None
    created_by_name: Optional[str] = None

    class Config:
        from_attributes = True


class StockAdjustmentCreate(BaseModel):
    product_id: int
    location_type: str
    employee_id: Optional[int] = None
    adjustment_type: str
    direction: str
    quantity: int = Field(..., gt=0)
    reason: str = Field(..., min_length=3, max_length=255)
    notes: Optional[str] = None

    @field_validator("location_type")
    @classmethod
    def validate_location_type(cls, v):
        if v not in ("warehouse", "rso"):
            raise ValueError("location_type must be one of: warehouse, rso")
        return v

    @field_validator("adjustment_type")
    @classmethod
    def validate_adjustment_type(cls, v):
        if v not in ("loss", "damage", "correction"):
            raise ValueError("adjustment_type must be one of: loss, damage, correction")
        return v

    @field_validator("direction")
    @classmethod
    def validate_direction(cls, v):
        if v not in ("decrease", "increase"):
            raise ValueError("direction must be one of: decrease, increase")
        return v


class StockAdjustmentSchema(BaseModel):
    id: int
    house_id: int
    product_id: int
    location_type: str
    employee_id: Optional[int] = None
    adjustment_type: str
    direction: str
    quantity: int
    reason: str
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    created_by: Optional[int] = None

    product_code: Optional[str] = None
    product_name: Optional[str] = None
    employee_name: Optional[str] = None
    employee_dms_code: Optional[str] = None
    created_by_name: Optional[str] = None

    class Config:
        from_attributes = True


class StockLedgerSchema(BaseModel):
    id: int
    house_id: int
    product_id: int
    location_type: str
    employee_id: Optional[int] = None
    movement_type: str
    quantity: int
    balance_after: int
    reference_type: Optional[str] = None
    reference_id: Optional[int] = None
    reason: Optional[str] = None
    created_at: Optional[datetime] = None
    created_by: Optional[int] = None

    product_code: Optional[str] = None
    product_name: Optional[str] = None
    employee_name: Optional[str] = None
    created_by_name: Optional[str] = None

    class Config:
        from_attributes = True


class DailyStockSnapshotSchema(BaseModel):
    id: int
    snapshot_date: date
    house_id: int
    product_id: int
    location_type: str
    employee_id: Optional[int] = None
    quantity: int
    unit_value: float
    total_value: float
    created_at: Optional[datetime] = None

    product_code: Optional[str] = None
    product_name: Optional[str] = None
    employee_name: Optional[str] = None
    house_name: Optional[str] = None

    class Config:
        from_attributes = True


class StockSummaryItem(BaseModel):
    product_id: int
    product_code: str
    product_name: str
    category: Optional[str] = None
    unit_price: float = 0.0
    warehouse_quantity: int = 0
    rso_quantity: int = 0
    total_quantity: int = 0
    warehouse_value: float = 0.0
    rso_value: float = 0.0
    total_value: float = 0.0
