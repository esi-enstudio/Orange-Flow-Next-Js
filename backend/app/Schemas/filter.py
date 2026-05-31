from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime

class FilterTagSchema(BaseModel):
    id: int
    house_id: int
    name: str
    created_at: Optional[datetime] = None
    class Config: from_attributes = True

class FilterTagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    house_id: Optional[int] = None

class RetailerFilterSchema(BaseModel):
    id: int
    house_id: int
    retailer_id: int
    tag: Optional[str] = None
    created_at: Optional[datetime] = None
    retailer: Optional[dict] = None
    class Config: from_attributes = True

class RetailerFilterCreate(BaseModel):
    retailer_id: int
    tag: Optional[str] = None

class RetailerFilterBulkCreate(BaseModel):
    retailer_ids: List[int]
    tag: Optional[str] = None

class ExcludedProductSchema(BaseModel):
    id: int
    product_code: str
    created_at: Optional[datetime] = None
    class Config: from_attributes = True

class ExcludedProductCreate(BaseModel):
    product_code: str = Field(min_length=1, max_length=50)
