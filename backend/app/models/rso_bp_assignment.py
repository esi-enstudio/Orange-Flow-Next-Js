from sqlalchemy import Column, Integer, ForeignKey, DateTime, UniqueConstraint
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.models.base import Base


class RSOBPAssignment(Base):
    """Pivot linking one or more BP employees under an RSO employee.

    One BP can be linked to at most one RSO. This is an organizational link
    (which RSO a BP's territory reports to); GA counting is NOT affected —
    a linked BP's activations stay in the BP section and are never rolled
    into the RSO's total.
    """

    __tablename__ = "rso_bp_assignments"
    __table_args__ = (
        UniqueConstraint("bp_employee_id", name="uq_rso_bp_bp_employee"),
    )

    id = Column(Integer, primary_key=True)
    rso_employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False, index=True)
    bp_employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    assigned_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    rso = relationship("Employee", foreign_keys=[rso_employee_id], backref="linked_bp_links")
    bp = relationship("Employee", foreign_keys=[bp_employee_id], backref="rso_link")
    house = relationship("House")