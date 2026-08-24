from datetime import datetime
from sqlalchemy import Column, Integer, String, Date, Boolean, DateTime, ForeignKey, Text
from app.models.base import Base
from app.utils.timezone import now_naive


class WhatsAppSchedule(Base):
    __tablename__ = "whatsapp_schedules"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)

    schedule_type = Column(String(20), nullable=False, default="daily")  # daily | interval
    schedule_time = Column(String(5), nullable=False)  # "HH:MM" in Asia/Dhaka (daily mode)
    interval_minutes = Column(Integer, nullable=True)  # repeat every N minutes (interval mode)
    channel = Column(String(16), nullable=False, default="whatsapp", server_default="whatsapp")  # whatsapp | telegram
    whatsapp_chat_id = Column(String(64), nullable=False)  # serialized chat id (e.g. ...@g.us); telegram chat id for channel=telegram
    whatsapp_chat_name = Column(String(200), nullable=False)
    caption = Column(Text, nullable=True)

    is_active = Column(Boolean, default=True, nullable=False)
    last_run_date = Column(Date, nullable=True)
    last_status = Column(String(50), nullable=True)  # success | failed
    last_error = Column(Text, nullable=True)
    last_run_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)
