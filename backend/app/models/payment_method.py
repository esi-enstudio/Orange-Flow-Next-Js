from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from app.models.base import Base
from app.utils.timezone import now_naive


PAYMENT_METHOD_TYPES = ("bkash", "nagad", "rocket", "card", "bank", "mobilebanking")


class PaymentMethod(Base):
    """Saved payment method reference for a house.

    Two flavors:
      - gateway token reference (card/bkash/nagad) — masked refs only
      - manual bank/mobile-banking instructions the house pays into
    Never stores raw card numbers / CVV.
    """

    __tablename__ = "payment_methods"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)

    gateway = Column(String(32), nullable=False, default="sslcommerz")
    method_type = Column(String(32), nullable=True)  # bkash | nagad | rocket | card | bank | mobilebanking
    label = Column(String(120), nullable=True)
    instructions = Column(String(500), nullable=True)
    is_active = Column(Boolean, default=True, index=True)

    # manual transfer details (bank / mobile banking)
    bank_name = Column(String(120), nullable=True)
    account_name = Column(String(120), nullable=True)
    account_number = Column(String(60), nullable=True)
    routing_number = Column(String(30), nullable=True)
    bkash_number = Column(String(30), nullable=True)
    nagad_number = Column(String(30), nullable=True)

    # gateway token reference (bkash/nagad/card) — masked fields
    brand = Column(String(64), nullable=True)  # VISA, MASTER, AMEX...
    last4 = Column(String(4), nullable=True)  # masked card digits only
    token_ref = Column(String(255), nullable=True)  # gateway token reference (if supported)
    customer_id = Column(String(128), nullable=True)  # house user ref at gateway

    is_default = Column(Boolean, default=False)
    is_email_verified = Column(Boolean, default=False)
    added_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    # Soft delete
    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)

    house = relationship("House", lazy="joined")