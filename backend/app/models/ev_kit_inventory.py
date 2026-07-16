from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base


class EvKitInventory(Base):
    __tablename__ = "ev_kit_inventory"

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    kit_serial = Column(String(100), unique=True, nullable=False)
    kit_type = Column(String(50), nullable=False)
    status = Column(String(50), default="available")
    allocated_to = Column(Integer, ForeignKey("sim_replacement_requests.id"), nullable=True)
    allocated_at = Column(DateTime, nullable=True)
    allocated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    notes = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    is_deleted = Column(Boolean, default=False)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    house = relationship("House")
    request = relationship("SimReplacementRequest", foreign_keys=[allocated_to])
    allocator = relationship("User", foreign_keys=[allocated_by])
