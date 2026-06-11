from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, date
from decimal import Decimal


class LiftingProductItem(BaseModel):
    product_id: int
    quantity: int = Field(..., ge=1)
    unit_price: float = Field(..., ge=0)


class LiftingProductCreate(BaseModel):
    product_id: int
    quantity: int = Field(..., ge=1)


class LiftingProductSchema(BaseModel):
    id: int
    lifting_record_id: int
    product_id: int
    quantity: int
    unit_price: float
    total_price: float
    product: Optional["ProductSchema"] = None

    class Config:
        from_attributes = True


class LiftingRecordBase(BaseModel):
    house_id: int
    lifting_date: date
    payment_method: str = Field(..., pattern="^(Cash|Credit)$")
    total_bank_deposit: float = Field(..., ge=0)
    notes: Optional[str] = None


class LiftingRecordCreate(LiftingRecordBase):
    products: List[LiftingProductCreate] = Field(default_factory=list)


class LiftingRecordUpdate(BaseModel):
    house_id: Optional[int] = None
    lifting_date: Optional[date] = None
    payment_method: Optional[str] = Field(None, pattern="^(Cash|Credit)$")
    total_bank_deposit: Optional[float] = Field(None, ge=0)
    notes: Optional[str] = None
    status: Optional[str] = Field(None, pattern="^(Draft|Confirmed|Approved|Cancelled)$")


class LiftingRecordSchema(LiftingRecordBase):
    id: int
    total_lifting_amount: float
    remaining_amount: float
    itopup_amount: float
    status: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    house: Optional["HouseSchema"] = None
    products: List[LiftingProductSchema] = []

    class Config:
        from_attributes = True


class LiftingPreviewResponse(BaseModel):
    total_lifting_amount: float
    remaining_amount: float
    itopup_amount: float
    products: List[dict]


class HouseSchema(BaseModel):
    id: int
    name: str
    code: str

    class Config:
        from_attributes = True


class ProductSchema(BaseModel):
    id: int
    product_code: str
    category: str
    subcategory: Optional[str] = None
    product_name: str
    mrp: float
    dd_lifting_price: float
    ret_lifting_price: float
    status: str

    class Config:
        from_attributes = True


LiftingProductSchema.model_rebuild()
LiftingRecordSchema.model_rebuild()