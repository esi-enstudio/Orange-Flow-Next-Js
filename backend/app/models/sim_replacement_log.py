from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base


class SimReplacementLog(Base):
    __tablename__ = "sim_replacement_logs"

    id = Column(Integer, primary_key=True)
    request_id = Column(Integer, ForeignKey("sim_replacement_requests.id"), nullable=False, index=True)
    action = Column(String(50), nullable=False)
    old_status = Column(String(50))
    new_status = Column(String(50))
    performed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    performed_by_name = Column(String(200))
    notes = Column(Text)
    extra_data = Column(Text)
    ip_address = Column(String(45))
    created_at = Column(DateTime, server_default=func.now())

    request = relationship("SimReplacementRequest")
    performer = relationship("User", foreign_keys=[performed_by])
