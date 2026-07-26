from datetime import date, datetime
from typing import Optional, List
from pydantic import BaseModel, Field, model_validator


class SalesEntry(BaseModel):
    product_id: int
    sold_quantity: int = 0
    unit_price: float = 0.0

    @model_validator(mode="after")
    def check_values(self):
        if self.sold_quantity < 0:
            raise ValueError("sold_quantity cannot be negative")
        if self.unit_price < 0:
            raise ValueError("unit_price cannot be negative")
        return self


class BatchSalesCreate(BaseModel):
    date: date
    entries: List[SalesEntry] = Field(..., min_length=1)


class SalesCreate(BaseModel):
    product_id: int
    date: date
    sold_quantity: int = 0
    unit_price: float = 0.0
    notes: Optional[str] = None


class SalesUpdate(BaseModel):
    sold_quantity: Optional[int] = None
    unit_price: Optional[float] = None
    notes: Optional[str] = None


class ProductInfo(BaseModel):
    id: int
    product_name: str
    product_code: str
    category: str

    class Config:
        from_attributes = True


class SalesResponse(BaseModel):
    id: int
    house_id: int
    product_id: int
    date: date
    sold_quantity: int
    unit_price: float
    total_sales_amount: float
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    product: Optional[ProductInfo] = None

    class Config:
        from_attributes = True


class SalesSummary(BaseModel):
    total_sold: int = 0
    total_sales_amount: float = 0.0
    entry_count: int = 0
