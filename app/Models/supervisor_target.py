from sqlalchemy import Column, Integer, String, Float, DateTime, func, UniqueConstraint
from app.Models.base import Base

class SupervisorTarget(Base):
    __tablename__ = "supervisor_targets"

    id = Column(Integer, primary_key=True, index=True)
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

    __table_args__ = (
        UniqueConstraint('supervisor_msisdn', 'month', 'year', name='_supervisor_month_year_uc'),
    )
