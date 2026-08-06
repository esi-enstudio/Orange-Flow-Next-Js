from sqlalchemy import Column, Integer, String, Numeric, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base


class ITopUpBalance(Base):
    """Current iTopUp money balance held by a house mother SIM (employee_id NULL) or an RSO."""

    __tablename__ = "itopup_balances"
    __table_args__ = (
        UniqueConstraint("house_id", "employee_id", name="uq_itopup_balance_holder"),
    )

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True, index=True)  # NULL = mother SIM
    balance = Column(Numeric(14, 2), nullable=False, default=0.0)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    house = relationship("House")
    employee = relationship("Employee")


class ITopUpBalanceLedger(Base):
    """Append-only ledger of every iTopUp balance movement."""

    __tablename__ = "itopup_balance_ledger"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True, index=True)
    movement_type = Column(String(30), nullable=False, index=True)  # lifting_in | transfer_in | transfer_out | adjustment
    amount = Column(Numeric(14, 2), nullable=False)  # signed
    balance_after = Column(Numeric(14, 2), nullable=False)
    reference_type = Column(String(30), nullable=True)
    reference_id = Column(Integer, nullable=True)
    reason = Column(String(255), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), index=True)

    house = relationship("House")
    employee = relationship("Employee")
    creator = relationship("User", foreign_keys=[created_by])


class ITopUpTransfer(Base):
    """Transfer record between mother SIM and RSO (or RSO to RSO)."""

    __tablename__ = "itopup_transfers"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    from_employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True, index=True)
    to_employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True, index=True)
    amount = Column(Numeric(14, 2), nullable=False)
    movement = Column(String(20), nullable=False, default="other")  # morning | evening | other
    notes = Column(String(255), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), index=True)

    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    house = relationship("House")
    from_employee = relationship("Employee", foreign_keys=[from_employee_id])
    to_employee = relationship("Employee", foreign_keys=[to_employee_id])
    creator = relationship("User", foreign_keys=[created_by])
