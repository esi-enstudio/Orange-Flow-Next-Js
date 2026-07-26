from datetime import datetime, date
from typing import Optional, List
from pydantic import BaseModel, Field


class DailyStockEntry(BaseModel):
    product_id: int
    product_name: str
    product_code: str
    category: Optional[str] = None
    subcategory: Optional[str] = None
    opening_qty: int = 0
    quantity_in: int = 0
    quantity_out: int = 0
    closing_qty: int = 0


class DailyStockResponse(BaseModel):
    date: str
    mode: str
    entries: List[DailyStockEntry]


class SubcategoryStock(BaseModel):
    subcategory: str
    quantity: int
    amount: float
    product_count: int


class CategoryStockSummary(BaseModel):
    category: str
    total_quantity: int
    total_amount: float
    subcategories: List[SubcategoryStock]


class EmployeeStockListItem(BaseModel):
    employee_id: int
    employee_name: str
    dms_code: Optional[str] = None
    employee_type: str
    itop_number: Optional[str] = None
    pool_number: Optional[str] = None
    product_count: int
    total_quantity: int


class ProductStockEntry(BaseModel):
    record_id: int
    product_id: int
    product_name: str
    product_code: str
    category: str
    subcategory: Optional[str] = None
    quantity: int
    amount: float

    class Config:
        from_attributes = True


class EmployeeStockDetail(BaseModel):
    employee_id: int
    employee_name: str
    employee_type: str
    itop_number: Optional[str] = None
    pool_number: Optional[str] = None
    products: List[ProductStockEntry]


class StockDashboardSummary(BaseModel):
    categories: List[CategoryStockSummary]
    employee_count: int = 0


class EmployeeStockCreate(BaseModel):
    employee_id: int
    product_id: int
    quantity: int = Field(ge=0)


class EmployeeStockUpdate(BaseModel):
    quantity: int = Field(ge=0)


class EmployeeStockResponse(BaseModel):
    id: int
    house_id: int
    employee_id: int
    product_id: int
    quantity: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    employee_name: Optional[str] = None
    employee_type: Optional[str] = None
    product_name: Optional[str] = None
    product_code: Optional[str] = None

    class Config:
        from_attributes = True


class HouseStockCreate(BaseModel):
    product_id: int
    quantity: int = Field(ge=0)


class HouseStockBulkCreate(BaseModel):
    items: List[HouseStockCreate] = Field(..., min_length=1)


class HouseStockUpdate(BaseModel):
    quantity: int = Field(ge=0)


class HouseStockResponse(BaseModel):
    id: int
    house_id: int
    product_id: int
    quantity: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    product_name: Optional[str] = None
    product_code: Optional[str] = None
    category: Optional[str] = None
    house_name: Optional[str] = None
    house_code: Optional[str] = None

    class Config:
        from_attributes = True


class StockTransferCreate(BaseModel):
    from_type: str = Field(..., pattern="^(house|employee)$")
    from_id: int
    to_type: str = Field(..., pattern="^(house|employee)$")
    to_id: int
    product_id: int
    quantity: int = Field(gt=0)
    note: Optional[str] = None


class StockTransferResponse(BaseModel):
    id: int
    house_id: int
    from_type: str
    from_id: int
    to_type: str
    to_id: int
    product_id: int
    quantity: int
    note: Optional[str] = None
    created_by: int
    created_at: Optional[datetime] = None
    from_identifier: Optional[str] = None
    to_identifier: Optional[str] = None
    product_name: Optional[str] = None

    class Config:
        from_attributes = True
