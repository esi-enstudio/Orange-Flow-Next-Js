from sqlalchemy import Column, Integer, String, Float, DateTime, func, UniqueConstraint, ForeignKey
from sqlalchemy.orm import relationship
from app.Models.base import Base

class SupervisorTarget(Base):
    __tablename__ = "supervisor_targets"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey('houses.id'), nullable=True) # House link
    field_force_id = Column(Integer, ForeignKey('field_forces.id'), nullable=True) # Supervisor link
    
    cluster = Column(String)
    region = Column(String)
    house_code = Column(String, index=True)
    house_name = Column(String)
    
    supervisor_name = Column(String)
    supervisor_msisdn = Column(String, index=True)
    
    ev_secondary = Column(Float, default=0.0)
    sc_secondary = Column(Float, default=0.0)
    total_recharge = Column(Float, default=0.0)
    total_ga = Column(Integer, default=0)
    bp_ga = Column(Integer, default=0)
    ga_rso = Column(Integer, default=0)
    asso = Column(Integer, default=0)
    also = Column(Integer, default=0)
    bso = Column(Integer, default=0)
    ddso = Column(Integer, default=0)
    
    month = Column(Integer, nullable=False)
    year = Column(Integer, nullable=False)
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    # Relationships
    house = relationship("House")
    field_force = relationship("FieldForce")

    __table_args__ = (
        UniqueConstraint('field_force_id', 'month', 'year', name='_supervisor_target_uc'),
    )
