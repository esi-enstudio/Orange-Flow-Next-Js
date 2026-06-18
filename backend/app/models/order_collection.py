from sqlalchemy import Column, Integer, String, Float, Text, Date, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base

class OrderCollection(Base):
    __tablename__ = "order_collections"

    id = Column(Integer, primary_key=True, index=True)
    retailer_id = Column(Integer, ForeignKey('retailers.id'), nullable=False)
    employee_id = Column(Integer, ForeignKey('employees.id'), nullable=True)
    order_date = Column(Date, nullable=False, index=True)
    items = Column(JSON, default=[])
    total_amount = Column(Float, default=0.0)
    status = Column(String(20), default="pending")
    notes = Column(Text)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    retailer = relationship("Retailer")
    employee = relationship("Employee")
