from sqlalchemy import Column, Integer, Float, DateTime, func, UniqueConstraint, ForeignKey, JSON
from sqlalchemy.orm import relationship
from app.models.base import Base

class BpTarget(Base):
    __tablename__ = "bp_targets"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey('houses.id'), nullable=False)
    employee_id = Column(Integer, ForeignKey('employees.id'), nullable=False)

    ga_target = Column(Integer, default=0)
    ev_secondary = Column(Float, default=0.0)
    sc_secondary = Column(Float, default=0.0)
    total_recharge = Column(Float, default=0.0)
    extra_targets = Column(JSON, default={})

    target_date = Column(DateTime, nullable=False, index=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    house = relationship("House")
    employee = relationship("Employee")

    __table_args__ = (
        UniqueConstraint('employee_id', 'target_date', name='_bp_target_date_uc'),
    )
