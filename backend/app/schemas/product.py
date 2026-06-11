from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class ProductBase(BaseModel):
    product_code: str = Field(..., min_length=1, max_length=50)
    category: str = Field(..., pattern="^(SIM|Scratch Card|Device|Other)$")
    subcategory: Optional[str] = None
    product_name: str = Field(..., min_length=1, max_length=200)
    mrp: float = Field(default=0.0, ge=0)
    dd_lifting_price: float = Field(default=0.0, ge=0)
    ret_lifting_price: float = Field(default=0.0, ge=0)
    status: str = Field(default="Active", pattern="^(Active|Inactive)$")


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    product_code: Optional[str] = Field(None, min_length=1, max_length=50)
    category: Optional[str] = Field(None, pattern="^(SIM|Scratch Card|Device|Other)$")
    subcategory: Optional[str] = None
    product_name: Optional[str] = Field(None, min_length=1, max_length=200)
    mrp: Optional[float] = Field(None, ge=0)
    dd_lifting_price: Optional[float] = Field(None, ge=0)
    ret_lifting_price: Optional[float] = Field(None, ge=0)
    status: Optional[str] = Field(None, pattern="^(Active|Inactive)$")


class ProductSchema(ProductBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ProductWithCategorySchema(ProductSchema):
    pass