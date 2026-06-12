from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy.orm import relationship
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

    code_history = relationship("ProductCodeHistory", back_populates="product", order_by="ProductCodeHistory.changed_at.desc()")


class ProductCodeHistory(Base):
    __tablename__ = "product_code_history"

    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)
    old_code = Column(String, nullable=False)
    new_code = Column(String, nullable=False)
    changed_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    changed_at = Column(DateTime, server_default=func.now(), nullable=False)

    product = relationship("Product", back_populates="code_history")