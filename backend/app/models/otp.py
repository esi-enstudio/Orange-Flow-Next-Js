from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base


class OTP(Base):
    __tablename__ = "otps"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=True, index=True)
    house_code = Column(String(50), nullable=True, index=True)  # e.g. MYMVAI01
    otp_code = Column(String(20), nullable=False, index=True)
    sender = Column(String(100), nullable=True)
    message = Column(String(500), nullable=True)
    received_at = Column(DateTime(timezone=False), index=True, nullable=False)
    is_used = Column(Boolean, default=False, nullable=False, index=True)
    used_at = Column(DateTime(timezone=False), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    house = relationship("House")
