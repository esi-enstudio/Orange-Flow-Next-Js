from sqlalchemy import Column, Integer, Float, Boolean, String, Date, DateTime, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base


class DailySales(Base):
    __tablename__ = "daily_sales"
    __table_args__ = (
        UniqueConstraint("house_id", "product_id", "date", name="uq_sales_house_product_date"),
    )

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)

    sold_quantity = Column(Integer, default=0, nullable=False)
    unit_price = Column(Float, default=0.0, nullable=False)
    total_sales_amount = Column(Float, default=0.0, nullable=False)

    notes = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    house = relationship("House")
    product = relationship("Product")
    creator = relationship("User", foreign_keys=[created_by])
    updater = relationship("User", foreign_keys=[updated_by])
