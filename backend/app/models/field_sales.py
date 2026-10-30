"""Field sales (P2): serial-wise employee sales with cashier approval.

A sale is created as ``draft`` and never affects stock until a cashier
``approve``s it. Only approval flips the serials to ``sold`` and appends the
inventory ledger, so a rejected or pending submission can never leak stock.
"""

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.models.base import Base
from app.utils.timezone import now_naive

SALE_STATUSES = ("draft", "submitted", "approved", "rejected")
PAYMENT_STATUSES = ("cash", "due", "partial", "other")


class Sale(Base):
    __tablename__ = "sales"
    __table_args__ = (
        UniqueConstraint("house_id", "idempotency_key", name="uq_sale_idempotency"),
        Index("ix_sales_house_date", "house_id", "business_date"),
        Index("ix_sales_house_status", "house_id", "status"),
        Index("ix_sales_house_employee", "house_id", "employee_id"),
    )

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    sale_no = Column(String(40), unique=True, nullable=True, index=True)
    status = Column(String(20), nullable=False, default="draft", index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False, index=True)
    retailer_id = Column(Integer, ForeignKey("retailers.id"), nullable=True, index=True)
    route = Column(String(120), nullable=True)
    business_date = Column(Date, nullable=False)
    payment_status = Column(String(20), nullable=False, default="cash")
    total_quantity = Column(Integer, nullable=False, default=0)
    total_amount = Column(Numeric(14, 2), nullable=False, default=0)
    paid_amount = Column(Numeric(14, 2), nullable=False, default=0)
    notes = Column(Text, nullable=True)
    reject_reason = Column(String(500), nullable=True)
    idempotency_key = Column(String(120), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    submitted_at = Column(DateTime, nullable=True)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    rejected_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    rejected_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)
    is_deleted = Column(Boolean, nullable=False, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    house = relationship("House")
    employee = relationship("Employee")
    retailer = relationship("Retailer")
    lines = relationship("SaleLine", back_populates="sale", cascade="all, delete-orphan")
    serial_lines = relationship(
        "SaleSerialLine", back_populates="sale", cascade="all, delete-orphan"
    )


class SaleLine(Base):
    __tablename__ = "sale_lines"

    id = Column(Integer, primary_key=True)
    sale_id = Column(
        Integer, ForeignKey("sales.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    quantity = Column(Integer, nullable=False, default=0)
    unit_price = Column(Numeric(14, 2), nullable=False, default=0)
    total_amount = Column(Numeric(14, 2), nullable=False, default=0)
    notes = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=now_naive)

    sale = relationship("Sale", back_populates="lines")
    product = relationship("Product", lazy="joined")
    serial_lines = relationship("SaleSerialLine", back_populates="line")


class SaleSerialLine(Base):
    """Serial-level link between a sale and the unit that was sold."""

    __tablename__ = "sale_serial_lines"
    __table_args__ = (
        Index("ix_sale_serial_lines_sale", "sale_id", "serial_unit_id"),
    )

    id = Column(Integer, primary_key=True)
    sale_id = Column(
        Integer, ForeignKey("sales.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sale_line_id = Column(Integer, ForeignKey("sale_lines.id"), nullable=True, index=True)
    serial_unit_id = Column(Integer, ForeignKey("serial_units.id"), nullable=False, index=True)
    serial_number = Column(String(100), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    status_before = Column(String(20), nullable=True)
    status_after = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=now_naive)

    sale = relationship("Sale", back_populates="serial_lines")
    line = relationship("SaleLine", back_populates="serial_lines")
    serial_unit = relationship("SerialUnit")
