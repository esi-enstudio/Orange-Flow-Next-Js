from sqlalchemy import Column, DateTime, Integer, String, Text
from app.models.base import Base

class AppSetting(Base):
    __tablename__ = "app_settings"

    id = Column(Integer, primary_key=True, default=1)
    app_name = Column(String(100), default="OrangeFlow")
    logo = Column(String(255), nullable=True)
    favicon = Column(String(255), nullable=True)
    is_daily_sync_enabled = Column(Integer, default=1)  # 1=enabled, 0=disabled
    is_live_sync_enabled = Column(Integer, default=1)  # 1=enabled, 0=disabled
    sim_serial_length = Column(Integer, default=18)  # expected SIM serial digit length
    # Maintenance mode: 0=off, 1=on. When on, phase (grace/enforced) is derived
    # from maintenance_enabled_at + settings.MAINTENANCE_GRACE_MINUTES (BST naive).
    maintenance_enabled = Column(Integer, default=0, nullable=False)
    maintenance_enabled_at = Column(DateTime, nullable=True)
    maintenance_message = Column(Text, nullable=True)
    maintenance_updated_at = Column(DateTime, nullable=True)
    maintenance_updated_by = Column(Integer, nullable=True)
