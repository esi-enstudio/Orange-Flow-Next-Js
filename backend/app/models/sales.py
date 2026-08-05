from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey, DateTime, Date, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base


class SalesRecord(Base):
    """A sales record. Creating a sale automatically decreases the source stock."""

    __tablename__ = "sales_records"
    __table_args__ = (
        Index("ix_sales_house_date", "house_id", "sale_date"),
    )

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    source_type = Column(String(20), nullable=False, index=True)  # warehouse | rso
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True, index=True)
    quantity = Column(Integer, nullable=False)
    unit_price = Column(Float, nullable=False, default=0.0)
    total_amount = Column(Float, nullable=False, default=0.0)
    sale_date = Column(Date, nullable=False, index=True)
    notes = Column(String(500), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    house = relationship("House")
    product = relationship("Product")
    employee = relationship("Employee")
    creator = relationship("User", foreign_keys=[created_by])
