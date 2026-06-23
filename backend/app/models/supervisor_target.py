from sqlalchemy import Column, Integer, String, Float, Date, DateTime, func, UniqueConstraint, ForeignKey, JSON
from sqlalchemy.orm import relationship
from app.models.base import Base

class SupervisorTarget(Base):
    __tablename__ = "supervisor_targets"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey('houses.id'), nullable=True) # House link
    employee_id = Column(Integer, ForeignKey('employees.id'), nullable=True) # Supervisor link
    
    # Fixed Columns
    ev_secondary = Column(Float, default=0.0)
    sc_secondary = Column(Float, default=0.0)
    total_recharge = Column(Float, default=0.0)
    total_ga = Column(Integer, default=0)
    bp_ga = Column(Integer, default=0)
    rso_ga = Column(Integer, default=0)
    sso = Column(Integer, default=0)
    lso = Column(Integer, default=0)
    bso = Column(Integer, default=0)
    ddso = Column(Integer, default=0)
    
    # Dynamic JSONB Column for any other targets
    extra_targets = Column(JSON, default={})
    
    target_date = Column(Date, nullable=False, index=True) # Always 1st of the month
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    # Relationships
    house = relationship("House")
    employee = relationship("Employee")

    __table_args__ = (
        UniqueConstraint('employee_id', 'target_date', name='_supervisor_target_date_uc'),
    )
