from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey
from app.models.base import Base
from app.utils.timezone import now_naive


class GaReportTarget(Base):
    """A slab-based target assigned to an entity (RSO / BP / Retailer) for a GA report event.

    Achievements come from activation counts; each slab only holds a target value.
    For retailer targets `retailer_code` is the lookup key (uploaded via Excel),
    for RSO/BP targets `entity_id` is the employee id.
    """
    __tablename__ = "ga_report_targets"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    event_id = Column(Integer, ForeignKey("ga_report_events.id"), nullable=False, index=True)
    target_type = Column(String(20), nullable=False, index=True)  # rso | bp | retailer
    entity_id = Column(Integer, nullable=True, index=True)        # employee id for rso/bp, retailer id for retailer
    retailer_code = Column(String(50), nullable=True, index=True) # lookup key for retailer targets
    slab = Column(Integer, nullable=False, default=1)
    target_value = Column(Float, nullable=False, default=0)

    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)
