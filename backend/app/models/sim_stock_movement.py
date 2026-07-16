from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base


class SimStockMovement(Base):
    __tablename__ = "sim_stock_movements"

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    sim_inventory_id = Column(Integer, ForeignKey("sim_inventory.id"), nullable=True)
    request_id = Column(Integer, ForeignKey("sim_replacement_requests.id"), nullable=True)
    movement_type = Column(String(50), nullable=False)
    quantity = Column(Integer, nullable=False)
    reference_number = Column(String(100))
    notes = Column(Text)
    performed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    house = relationship("House")
    sim_inventory = relationship("SimInventory")
    request = relationship("SimReplacementRequest")
    performer = relationship("User", foreign_keys=[performed_by])
