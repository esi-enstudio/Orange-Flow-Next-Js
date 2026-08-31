from sqlalchemy import Column, Integer, String, DateTime, Numeric, JSON, ForeignKey, Index
from sqlalchemy.orm import relationship
from app.models.base import Base
from app.utils.timezone import now_naive


class SubscriptionChangeLog(Base):
    """Immutable audit trail of every subscription state transition."""

    __tablename__ = "subscription_change_logs"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    subscription_id = Column(Integer, ForeignKey("house_subscriptions.id"), nullable=False, index=True)

    # created | activated | upgraded | downgraded | renewed | cancelled | reactivated |
    # paused | resumed | expired | status_changed | plan_changed | auto_renew_changed
    change_type = Column(String(32), nullable=False, index=True)

    from_plan_id = Column(Integer, ForeignKey("subscription_packages.id"), nullable=True)
    to_plan_id = Column(Integer, ForeignKey("subscription_packages.id"), nullable=True)

    from_status = Column(String(20), nullable=True)
    to_status = Column(String(20), nullable=True)

    from_period_end = Column(DateTime, nullable=True)
    to_period_end = Column(DateTime, nullable=True)

    amount = Column(Numeric(12, 2), nullable=True)
    reason = Column(String(255), nullable=True)
    note = Column(String(500), nullable=True)

    # api | webhook | scheduler | admin | system
    changed_via = Column(String(20), nullable=True, default="api")
    changed_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    old_values = Column(JSON, nullable=True)
    new_values = Column(JSON, nullable=True)

    created_at = Column(DateTime, default=now_naive)

    house = relationship("House", lazy="joined")
    from_plan = relationship("SubscriptionPackage", foreign_keys=[from_plan_id], lazy="joined")
    to_plan = relationship("SubscriptionPackage", foreign_keys=[to_plan_id], lazy="joined")

    __table_args__ = (
        Index("ix_sub_change_logs_house_created", "house_id", "created_at"),
    )