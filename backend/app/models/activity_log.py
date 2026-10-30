from sqlalchemy import Column, Integer, String, DateTime, JSON, func, Index
from app.models.base import Base


class ActivityLog(Base):
    __tablename__ = "activity_logs"
    __table_args__ = (
        Index("ix_activity_logs_user_id", "user_id"),
        Index("ix_activity_logs_module", "module"),
        Index("ix_activity_logs_action", "action"),
        Index("ix_activity_logs_created_at", "created_at"),
        Index("ix_activity_logs_user_date", "user_id", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=False)
    user_name = Column(String, nullable=True)
    module = Column(String, nullable=False)
    action = Column(String, nullable=False)
    record_id = Column(Integer, nullable=True)
    record_identifier = Column(String, nullable=True)
    old_values = Column(JSON, nullable=True)
    new_values = Column(JSON, nullable=True)
    endpoint = Column(String, nullable=True)
    method = Column(String, nullable=True)
    status_code = Column(Integer, nullable=True)
    ip_address = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    # No house relationship - activity_logs is system-wide (append-only)
    # Per spec: activity logs are shared across all houses, no house_id column