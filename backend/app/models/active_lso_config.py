from sqlalchemy import Column, Integer, Float, Date, DateTime, ForeignKey, UniqueConstraint, func
from app.models.base import Base


class ActiveLsoConfig(Base):
    """Per-house, per-month thresholds defining an "Active LSO" retailer.

    A retailer counts as Active LSO in a month when it has at least
    `days_threshold` distinct C2S report dates and a cumulative C2S amount of
    at least `amount_threshold`. Falls back to DEFAULT_DAYS/DEFAULT_AMOUNT
    (see active_lso_report_service) when no row exists for the month.
    """
    __tablename__ = "active_lso_configs"

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    target_month = Column(Date, nullable=False, index=True)  # always 1st of month

    days_threshold = Column(Integer, nullable=False, default=7)
    amount_threshold = Column(Float, nullable=False, default=500.0)

    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("house_id", "target_month", name="_active_lso_config_house_month_uc"),
    )
