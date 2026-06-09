from sqlalchemy import Column, Integer, String, Float, DateTime, func, UniqueConstraint, ForeignKey, JSON
from sqlalchemy.orm import relationship
from app.models.base import Base

class HouseTarget(Base):
    __tablename__ = "house_targets"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey('houses.id'), nullable=False)

    # Fixed Columns
    ev_c2c_target = Column(Float, default=0.0)
    sc_primary_target = Column(Float, default=0.0)
    total_recharge_target = Column(Float, default=0.0)
    total_ga_target = Column(Integer, default=0)
    bp_ga = Column(Integer, default=0)
    rso_ga = Column(Integer, default=0)
    ev_scr = Column(Float, default=0.0)
    sso = Column(Integer, default=0)
    lso = Column(Integer, default=0)
    bso = Column(Integer, default=0)
    ddso = Column(Integer, default=0)

    # Dynamic JSONB Column for any other targets
    extra_targets = Column(JSON, default={})

    target_date = Column(DateTime, nullable=False, index=True) # Always 1st of the month

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    # Relationship
    house = relationship("House")

    __table_args__ = (
        UniqueConstraint('house_id', 'target_date', name='_house_target_date_uc'),
    )