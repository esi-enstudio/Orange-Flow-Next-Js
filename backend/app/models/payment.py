from sqlalchemy import Column, Integer, String, DateTime, Numeric, Boolean, JSON, ForeignKey, UniqueConstraint, Index, text
from sqlalchemy.orm import relationship
from app.models.base import Base
from app.utils.timezone import now_naive


PAYMENT_STATUS_SUCCEEDED = "succeeded"
PAYMENT_STATUS_PENDING = "pending"
PAYMENT_STATUS_NEEDS_INFO = "needs_info"
PAYMENT_STATUS_FAILED = "failed"
PAYMENT_STATUS_REFUNDED = "refunded"
PAYMENT_STATUS_PARTIALLY_REFUNDED = "partially_refunded"


class Payment(Base):
    """A payment actually received for an invoice.

    Payments are recorded manually by an authorised admin (cash / bank /
    mobile banking). ``gateway`` is kept as the *channel* of the payment
    ("cash", "manual", "bank", ...) and ``gateway_tran_id`` as the
    deterministic reference that makes recording idempotent.
    """

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

    # Payment channel: cash | manual | bank | bkash | nagad | ...
    gateway = Column(String(32), nullable=False, default="cash")
    gateway_tran_id = Column(String(64), nullable=True)

    # Transaction reference claimed by the payer (bKash TrxID, bank reference).
    # ``transaction_reference_normalized`` is the dedupe key: uppercase with all
    # whitespace removed, so "bk 123" and "BK123" collide as they should.
    transaction_reference = Column(String(120), nullable=True)
    transaction_reference_normalized = Column(String(120), nullable=True, index=True)

    paid_at = Column(DateTime, nullable=True)
    payment_meta = Column(JSON, nullable=True)  # recorded_by, reference, note

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
        # One real transaction reference may only ever back one payment. Soft
        # deleted rows are excluded so a removed record does not block reuse.
        Index(
            "uq_payment_transaction_reference",
            "transaction_reference_normalized",
            unique=True,
            postgresql_where=text(
                "transaction_reference_normalized IS NOT NULL "
                "AND is_deleted = false AND status <> 'failed'"
            ),
            sqlite_where=text(
                "transaction_reference_normalized IS NOT NULL "
                "AND is_deleted = false AND status <> 'failed'"
            ),
        ),
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
    refunded_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    refunded_at = Column(DateTime, nullable=True)

    # Soft delete
    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)

    payment = relationship("Payment", back_populates="refunds")
