from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime, Date, Time
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base


class Shift(Base):
    __tablename__ = "shifts"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    name_bn = Column(String, nullable=True)
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)
    grace_period_minutes = Column(Integer, default=15)
    min_work_hours = Column(Integer, default=8)
    is_active = Column(Boolean, default=True)

    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    house = relationship("House")


class EmployeeShift(Base):
    __tablename__ = "employee_shifts"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False, index=True)
    shift_id = Column(Integer, ForeignKey("shifts.id"), nullable=False)
    effective_from = Column(Date, nullable=False)
    effective_to = Column(Date, nullable=True)
    is_active = Column(Boolean, default=True)

    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    employee = relationship("Employee")
    shift = relationship("Shift")
