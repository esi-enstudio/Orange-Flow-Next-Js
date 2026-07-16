from sqlalchemy import Column, Integer, String, Date, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base


class SimInventory(Base):
    __tablename__ = "sim_inventory"

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    sim_type = Column(String(50), nullable=False)
    starting_serial = Column(String(100), nullable=False)
    ending_serial = Column(String(100), nullable=False)
    quantity = Column(Integer, default=0)
    available_quantity = Column(Integer, default=0)
    supplier = Column(String(200))
    batch_number = Column(String(100))
    purchase_date = Column(Date)
    exit_order_no = Column(String(100))
    serial_ranges = Column(Text)
    status = Column(String(50), default="active")
    notes = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    is_deleted = Column(Boolean, default=False)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    house = relationship("House")
    product = relationship("Product")
