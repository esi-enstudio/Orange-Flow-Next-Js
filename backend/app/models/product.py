from sqlalchemy import Column, Integer, String, Float, DateTime
from sqlalchemy.sql import func
from app.models.base import Base
import enum


class ProductStatus(str, enum.Enum):
    ACTIVE = "Active"
    INACTIVE = "Inactive"


class ProductCategory(str, enum.Enum):
    SIM = "SIM"
    SCRATCH_CARD = "Scratch Card"
    DEVICE = "Device"
    OTHER = "Other"


class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True)
    product_code = Column(String, unique=True, index=True, nullable=False)
    category = Column(String, nullable=False, default="Other")
    subcategory = Column(String, nullable=True)
    product_name = Column(String, nullable=False)
    mrp = Column(Float, default=0.0)
    dd_lifting_price = Column(Float, default=0.0)
    ret_lifting_price = Column(Float, default=0.0)
    status = Column(String, default="Active", nullable=False)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())