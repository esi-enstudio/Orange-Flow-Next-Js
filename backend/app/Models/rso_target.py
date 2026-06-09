from sqlalchemy import Column, Integer, String, Float, DateTime, func, UniqueConstraint, ForeignKey, JSON
from sqlalchemy.orm import relationship
from app.models.base import Base

class RSOTarget(Base):
    __tablename__ = "rso_targets"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey('houses.id'), nullable=False)
    employee_id = Column(Integer, ForeignKey('employees.id'), nullable=False) # RSO ID
    supervisor_id = Column(Integer, ForeignKey('employees.id'), nullable=True) # Supervisor ID

    # Fixed Columns
    ev_secondary = Column(Float, default=0.0)
    sc_secondary = Column(Float, default=0.0)
    total_recharge = Column(Float, default=0.0)
    ga = Column(Integer, default=0)
    sso = Column(Integer, default=0)
    lso = Column(Integer, default=0)
    bso = Column(Integer, default=0)
    ddso = Column(Integer, default=0)

    service_route = Column(String) # Service Route
    market_type = Column(String) # Main House/OSDO/Residential RSO
    thana_name = Column(String)

    # Modified Targets (App Targets)
    ga_target_modified = Column(Integer, default=0)
    ev_secondary_modified = Column(Float, default=0.0)
    sc_secondary_modified = Column(Float, default=0.0)
    recharge_target_modified = Column(Float, default=0.0)
    lso_target_modified = Column(Integer, default=0)
    sso_target_modified = Column(Integer, default=0)
    bso_target_modified = Column(Integer, default=0)
    daily_dso_target_modified = Column(Integer, default=0)

    # Dynamic JSONB Column for any other targets
    extra_targets = Column(JSON, default={})

    target_date = Column(DateTime, nullable=False, index=True) # Always 1st of the month

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    # Relationships
    house = relationship("House")
    employee = relationship("Employee", foreign_keys=[employee_id])
    supervisor = relationship("Employee", foreign_keys=[supervisor_id])

    __table_args__ = (
        UniqueConstraint('employee_id', 'target_date', name='_rso_target_date_uc'),
    )