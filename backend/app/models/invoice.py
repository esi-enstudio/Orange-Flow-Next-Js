from sqlalchemy import Column, Integer, String, DateTime, Numeric, Boolean, Text, JSON, ForeignKey, Index
from sqlalchemy.orm import relationship
from app.models.base import Base
from app.utils.timezone import now_naive


INVOICE_STATUS_DRAFT = "draft"
INVOICE_STATUS_ISSUED = "issued"
INVOICE_STATUS_UNPAID = "unpaid"
INVOICE_STATUS_PAID = "paid"
INVOICE_STATUS_PARTIALLY_PAID = "partially_paid"
INVOICE_STATUS_VOID = "void"


class Invoice(Base):
    __tablename__ = "invoices"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    subscription_id = Column(Integer, ForeignKey("house_subscriptions.id"), nullable=True, index=True)
    invoice_no = Column(String(50), nullable=False, unique=True, index=True)

    billing_period_start = Column(DateTime, nullable=True)
    billing_period_end = Column(DateTime, nullable=True)
    due_date = Column(DateTime, nullable=True, index=True)

    amount = Column(Numeric(12, 2), nullable=False, default=0)
    tax = Column(Numeric(12, 2), nullable=False, default=0)
    total = Column(Numeric(12, 2), nullable=False, default=0)
    currency = Column(String(3), nullable=False, default="BDT")

    # draft | issued | unpaid | paid | partially_paid | void
    status = Column(String(20), nullable=False, default="issued", index=True)

    paid_at = Column(DateTime, nullable=True)
    description = Column(String(255), nullable=True)
    gateway_tran_id = Column(String(64), nullable=True)
    notes = Column(Text, nullable=True)

    # Soft delete
    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)

    house = relationship("House", lazy="joined")
    subscription = relationship("HouseSubscription", lazy="joined")
    payments = relationship("Payment", back_populates="invoice", lazy="selectin")
    attempts = relationship("PaymentAttempt", back_populates="invoice", lazy="selectin")

    __table_args__ = (
        Index("ix_invoices_house_status_due", "house_id", "status", "due_date"),
        Index("ix_invoices_house_created", "house_id", "created_at"),
    )