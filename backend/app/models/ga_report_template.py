from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, JSON, Text
from sqlalchemy.orm import relationship

from app.models.base import Base
from app.utils.timezone import now_naive


class GaReportTemplate(Base):
    """A saved GA Report Builder configuration for reuse.

    `config` holds the full builder state as JSON:
    {
        "event_id": int | None,
        "retailer_codes": [...],
        "rso_ids": [...],
        "columns": [{"key": ..., "order": int}...],
        "filters": {"exclude_product_codes": [...], "exclude_retailer_tags": [...]},
        "sort_by": str | None,
        "sort_order": "asc" | "desc"
    }
    """
    __tablename__ = "ga_report_templates"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    event_id = Column(Integer, ForeignKey("ga_report_events.id"), nullable=True)
    config = Column(JSON, default=dict)

    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    house = relationship("House")
    event = relationship("GaReportEvent")
