from sqlalchemy import Column, Integer, ForeignKey, DateTime, UniqueConstraint, Index
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.models.base import Base


class SupervisorRSOAssignment(Base):
    """Supervisor team pivot: tags a team member (RSO or BP) under a supervisor.

    ``member_employee_id`` holds the RSO OR BP employee id — the column was
    historically named ``rso_employee_id`` but it also stores BP members.
    """

    __tablename__ = "supervisor_rso_assignments"
    __table_args__ = (
        UniqueConstraint("member_employee_id", name="uq_supervisor_rso_member_employee"),
        Index("ix_supervisor_rso_supervisor_id", "supervisor_employee_id"),
    )

    id = Column(Integer, primary_key=True)
    supervisor_employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False, index=True)
    member_employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    assigned_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    supervisor = relationship(
        "Employee",
        foreign_keys=[supervisor_employee_id],
        backref="supervised_member_links",
    )
    member = relationship(
        "Employee",
        foreign_keys=[member_employee_id],
        backref="supervisor_link",
    )
    house = relationship("House")