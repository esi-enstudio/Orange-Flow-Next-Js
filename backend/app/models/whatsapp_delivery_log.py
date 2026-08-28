from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from app.models.base import Base
from app.utils.timezone import now_naive


class WhatsAppDeliveryLog(Base):
    """Append-only record of every report delivery attempted by the system.

    Gives admins a delivery history (success/failure) without touching the
    system-wide activity_logs table. Entries are created by the scheduler and
    the send-now / send-direct APIs.
    """

    __tablename__ = "whatsapp_delivery_logs"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    schedule_id = Column(Integer, ForeignKey("whatsapp_schedules.id"), nullable=True, index=True)

    report_type = Column(String(50), nullable=False, default="ga_live")
    channel = Column(String(16), nullable=False, default="whatsapp")  # whatsapp | telegram
    triggered_by = Column(String(20), nullable=False, default="schedule")  # schedule | manual

    target_count = Column(Integer, nullable=False, default=1)
    delivered_count = Column(Integer, nullable=False, default=0)
    status = Column(String(20), nullable=False, default="failed")  # success | partial | failed
    error = Column(Text, nullable=True)
    chat_names = Column(Text, nullable=True)  # JSON array of recipient display names

    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=now_naive, index=True)

    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)