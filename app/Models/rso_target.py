from sqlalchemy import Column, Integer, String, Float, DateTime, func, UniqueConstraint, ForeignKey
from sqlalchemy.orm import relationship
from app.Models.base import Base

class RSOTarget(Base):
    __tablename__ = "rso_targets"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey('houses.id'), nullable=False)
    field_force_id = Column(Integer, ForeignKey('field_forces.id'), nullable=False)

    supervisor_name = Column(String)
    supervisor_msisdn = Column(String)

    manager_name = Column(String)
    manager_contact = Column(String)

    ev_secondary = Column(Float, default=0.0)
    sc_secondary = Column(Float, default=0.0)
    total_recharge = Column(Float, default=0.0)
    ga_rso = Column(Integer, default=0)
    asso = Column(Integer, default=0)
    also = Column(Integer, default=0)
    bso = Column(Integer, default=0)
    ddso = Column(Integer, default=0)

    market_type = Column(String) # Main House/OSDO/Residential RSO
    thana_name = Column(String)

    ga_target_app = Column(Integer, default=0)
    recharge_target_app = Column(Float, default=0.0)
    active_lso_target_app = Column(Integer, default=0)
    sso_target_app = Column(Integer, default=0)
    bso_target_app = Column(Integer, default=0)
    daily_dso_target_app = Column(Integer, default=0)

    month = Column(Integer, nullable=False)
    year = Column(Integer, nullable=False)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    # Relationships
    house = relationship("House")
    field_force = relationship("FieldForce")

    __table_args__ = (
        UniqueConstraint('field_force_id', 'month', 'year', name='_rso_month_year_uc'),
    )