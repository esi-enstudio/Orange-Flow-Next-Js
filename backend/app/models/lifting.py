from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Date, ForeignKey, Enum as SAEnum, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base
import enum


class LiftingStatus(str, enum.Enum):
    DRAFT = "Draft"
    CONFIRMED = "Confirmed"
    APPROVED = "Approved"
    CANCELLED = "Cancelled"


class PaymentMethod(str, enum.Enum):
    CASH = "Cash"
    CREDIT = "Credit"


class LiftingRecord(Base):
    __tablename__ = "lifting_records"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id", ondelete="CASCADE"), nullable=False)
    lifting_date = Column(Date, nullable=False)
    payment_method = Column(SAEnum(PaymentMethod), nullable=False, default=PaymentMethod.CASH)
    total_bank_deposit = Column(Float, default=0.0)
    total_lifting_amount = Column(Float, default=0.0)
    remaining_amount = Column(Float, default=0.0)
    itopup_amount = Column(Float, default=0.0)
    status = Column(SAEnum(LiftingStatus), default=LiftingStatus.DRAFT, nullable=False)
    notes = Column(Text, nullable=True)

    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    stock_added = Column(Boolean, default=False, index=True)
    stock_added_at = Column(DateTime, nullable=True)
    stock_added_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    house = relationship("House", backref="lifting_records")
    products = relationship("LiftingProduct", back_populates="lifting_record", cascade="all, delete-orphan")


class LiftingProduct(Base):
    __tablename__ = "lifting_products"

    id = Column(Integer, primary_key=True, index=True)
    lifting_record_id = Column(Integer, ForeignKey("lifting_records.id", ondelete="CASCADE"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    product_code = Column(String, nullable=False)
    product_name = Column(String, nullable=False)
    quantity = Column(Integer, default=0)
    unit_price = Column(Float, default=0.0)
    total_price = Column(Float, default=0.0)

    lifting_record = relationship("LiftingRecord", back_populates="products")
    product = relationship("Product", backref="lifting_products")