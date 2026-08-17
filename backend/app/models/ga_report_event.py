from datetime import date

from sqlalchemy import Column, Integer, String, Date, Boolean, DateTime, ForeignKey, Text, JSON
from sqlalchemy.orm import relationship

from app.models.base import Base
from app.utils.timezone import now_naive


class GaReportEvent(Base):
    """A named date-range used by the GA Report Builder.

    Activations on the event's start..end window are sourced from the
    `activations` table for past days and `live_activations` for today.

    The `config` JSON holds the full report configuration (columns, retailer
    codes, RSO ids, filters, sort) captured when the event was created, so the
    report for an event persists across page reloads until the event is deleted.
    """
    __tablename__ = "ga_report_events"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    description = Column(Text, nullable=True)
    config = Column(JSON, nullable=True, default=dict)

    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    house = relationship("House")
