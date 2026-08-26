from sqlalchemy import Column, Integer, Date, DateTime, ForeignKey, UniqueConstraint, func
from app.models.base import Base


class ActiveSsoConfig(Base):
    """Per-house, per-month thresholds defining an "Active SSO" retailer.

    A retailer counts as Active SSO in a month when it has at least
    `activations_threshold` SIM activations. Falls back to
    DEFAULT_ACTIVATIONS (see active_sso_report_service) when no row exists.
    """
    __tablename__ = "active_sso_configs"

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    target_month = Column(Date, nullable=False, index=True)

    activations_threshold = Column(Integer, nullable=False, default=2)

    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("house_id", "target_month", name="_active_sso_config_house_month_uc"),
    )
