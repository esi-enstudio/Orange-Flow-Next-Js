from typing import Optional
from datetime import date, datetime
from pydantic import BaseModel, Field, field_validator


class SalesCreate(BaseModel):
    product_id: int
    source_type: str
    employee_id: Optional[int] = None
    quantity: int = Field(..., gt=0)
    unit_price: float = Field(..., ge=0)
    sale_date: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("source_type")
    @classmethod
    def validate_source_type(cls, v):
        if v not in ("warehouse", "rso"):
            raise ValueError("source_type must be one of: warehouse, rso")
        return v

    @field_validator("sale_date")
    @classmethod
    def validate_sale_date(cls, v):
        if v:
            try:
                datetime.strptime(v, "%Y-%m-%d")
            except ValueError:
                raise ValueError("Invalid sale_date format, expected YYYY-MM-DD")
        return v


class SalesUpdate(SalesCreate):
    pass


class SalesSchema(BaseModel):
    id: int
    house_id: int
    product_id: int
    source_type: str
    employee_id: Optional[int] = None
    quantity: int
    unit_price: float
    total_amount: float
    sale_date: Optional[date] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    created_by: Optional[int] = None

    product_code: Optional[str] = None
    product_name: Optional[str] = None
    employee_name: Optional[str] = None
    employee_dms_code: Optional[str] = None
    created_by_name: Optional[str] = None

    class Config:
        from_attributes = True


class SalesSummary(BaseModel):
    total_sales_count: int = 0
    total_quantity: int = 0
    total_amount: float = 0.0
    today_quantity: int = 0
    today_amount: float = 0.0
