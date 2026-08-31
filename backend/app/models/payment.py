from sqlalchemy import Column, Integer, String, DateTime, Numeric, Boolean, JSON, ForeignKey, UniqueConstraint, Index
from sqlalchemy.orm import relationship
from app.models.base import Base
from app.utils.timezone import now_naive


PAYMENT_STATUS_SUCCEEDED = "succeeded"
PAYMENT_STATUS_PENDING = "pending"
PAYMENT_STATUS_FAILED = "failed"
PAYMENT_STATUS_REFUNDED = "refunded"
PAYMENT_STATUS_PARTIALLY_REFUNDED = "partially_refunded"


class Payment(Base):
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False, index=True)
    subscription_id = Column(Integer, ForeignKey("house_subscriptions.id"), nullable=True, index=True)
    payment_method_id = Column(Integer, ForeignKey("payment_methods.id"), nullable=True, index=True)

    amount = Column(Numeric(12, 2), nullable=False)
    currency = Column(String(3), nullable=False, default="BDT")
    gateway_fee = Column(Numeric(12, 2), nullable=True)

    # succeeded | pending | failed | refunded | partially_refunded
    status = Column(String(20), nullable=False, default="succeeded", index=True)

    gateway = Column(String(32), nullable=False, default="sslcommerz")
    gateway_tran_id = Column(String(64), nullable=True)
    gateway_val_id = Column(String(64), nullable=True)
    gateway_bank_tran_id = Column(String(64), nullable=True)
    card_type = Column(String(64), nullable=True)

    paid_at = Column(DateTime, nullable=True)
    payment_meta = Column(JSON, nullable=True)  # sanitized gateway metadata (risk_level, store_amount only)

    # Soft delete
    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)

    invoice = relationship("Invoice", back_populates="payments", lazy="joined")
    payment_method = relationship("PaymentMethod", lazy="joined")
    refunds = relationship("Refund", back_populates="payment", lazy="selectin")
    house = relationship("House", lazy="joined")

    __table_args__ = (
        UniqueConstraint("gateway", "gateway_tran_id", name="uq_payment_gateway_tran_id"),
        Index("ix_payments_house_created", "house_id", "created_at"),
    )


PAYMENT_ATTEMPT_STATUS_INITIATED = "initiated"
PAYMENT_ATTEMPT_STATUS_SUCCESS = "success"
PAYMENT_ATTEMPT_STATUS_FAILED = "failed"
PAYMENT_ATTEMPT_STATUS_CANCELLED = "cancelled"
PAYMENT_ATTEMPT_STATUS_EXPIRED = "expired"
PAYMENT_ATTEMPT_STATUS_UNATTEMPTED = "unattempted"


class PaymentAttempt(Base):
    """One checkout attempt against the payment gateway for an invoice."""

    __tablename__ = "payment_attempts"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False, index=True)
    subscription_id = Column(Integer, ForeignKey("house_subscriptions.id"), nullable=True, index=True)
    payment_id = Column(Integer, ForeignKey("payments.id"), nullable=True)

    amount = Column(Numeric(12, 2), nullable=False)
    currency = Column(String(3), nullable=False, default="BDT")

    gateway = Column(String(32), nullable=False, default="sslcommerz")
    gateway_tran_id = Column(String(64), nullable=False, index=True)  # tran_id sent to gateway (unique per attempt)
    session_key = Column(String(64), nullable=True)

    # initiated | success | failed | cancelled | expired | unattempted
    status = Column(String(20), nullable=False, default="initiated", index=True)
    error_reason = Column(String(255), nullable=True)

    attempted_at = Column(DateTime, default=now_naive)
    completed_at = Column(DateTime, nullable=True)
    response_meta = Column(JSON, nullable=True)  # sanitized gateway response (safe fields only)

    # Soft delete
    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_at = Column(DateTime, default=now_naive)

    invoice = relationship("Invoice", back_populates="attempts", lazy="joined")

    __table_args__ = (
        UniqueConstraint("gateway", "gateway_tran_id", name="uq_payment_attempt_gateway_tran_id"),
        Index("ix_payment_attempts_invoice_status", "invoice_id", "status"),
    )


REFUND_STATUS_PROCESSING = "processing"
REFUND_STATUS_SUCCEEDED = "succeeded"
REFUND_STATUS_FAILED = "failed"


class Refund(Base):
    __tablename__ = "refunds"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    payment_id = Column(Integer, ForeignKey("payments.id"), nullable=False, index=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=True)

    amount = Column(Numeric(12, 2), nullable=False)
    currency = Column(String(3), nullable=False, default="BDT")
    reason = Column(String(255), nullable=True)

    # processing | succeeded | failed
    status = Column(String(20), nullable=False, default="processing", index=True)
    gateway_refund_id = Column(String(64), nullable=True)
    refunded_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    refunded_at = Column(DateTime, nullable=True)

    # Soft delete
    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)

    payment = relationship("Payment", back_populates="refunds")