from sqlalchemy import Column, Integer, String, Float, DateTime, func, UniqueConstraint
from app.Models.base import Base

class HouseTarget(Base):
    __tablename__ = "house_targets"

    id = Column(Integer, primary_key=True, index=True)
    cluster = Column(String)
    region = Column(String)
    house_code = Column(String, index=True)
    house_name = Column(String)
    
    ev_c2c_target = Column(Float, default=0.0)
    sc_primary_target = Column(Float, default=0.0)
    total_recharge_target = Column(Float, default=0.0)
    total_ga_target = Column(Integer, default=0)
    bp_ga = Column(Integer, default=0)
    rso_ga = Column(Integer, default=0)
    m2_survival = Column(Integer, default=0)
    ev_scr = Column(Float, default=0.0)
    device_target = Column(Integer, default=0)
    fwa_target = Column(Integer, default=0)
    sso = Column(Integer, default=0)
    also = Column(Integer, default=0)
    bso = Column(Integer, default=0)
    ddso = Column(Integer, default=0)
    ga_productivity = Column(Float, default=0.0)
    
    month = Column(Integer, nullable=False)
    year = Column(Integer, nullable=False)
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('house_code', 'month', 'year', name='_house_month_year_uc'),
    )
