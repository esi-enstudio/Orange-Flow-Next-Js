from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from app.models.base import Base
from app.utils.timezone import now_naive


PAYMENT_METHOD_TYPES = ("cash", "bkash", "nagad", "rocket", "bank", "mobilebanking")


class PaymentMethod(Base):
    """Manual payment instructions a house can pay into.

    Every payment in this deployment is received offline (cash / bank /
    mobile banking) and recorded by an authorised admin — no card data or
    gateway tokens are ever stored here.
    """

    __tablename__ = "payment_methods"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)

    gateway = Column(String(32), nullable=False, default="manual")
    method_type = Column(String(32), nullable=True)  # cash | bkash | nagad | rocket | bank | mobilebanking
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

    is_default = Column(Boolean, default=False)
    added_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    # Soft delete
    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)

    house = relationship("House", lazy="joined")