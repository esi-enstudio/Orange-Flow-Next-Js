from sqlalchemy import Column, Integer, String, Text
from app.Models.base import Base

class AppSetting(Base):
    __tablename__ = "app_settings"

    id = Column(Integer, primary_key=True, default=1)
    app_name = Column(String(100), default="OrangeFlow")
    logo = Column(String(255), nullable=True)
    is_daily_sync_enabled = Column(Integer, default=1)  # 1=enabled, 0=disabled
