from sqlalchemy import Column, Integer, String, Text, Date, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base

class RetailerVisit(Base):
    __tablename__ = "retailer_visits"

    id = Column(Integer, primary_key=True, index=True)
    retailer_id = Column(Integer, ForeignKey('retailers.id'), nullable=False)
    employee_id = Column(Integer, ForeignKey('employees.id'), nullable=False)
    visit_date = Column(Date, nullable=False, index=True)
    purpose = Column(String(200))
    notes = Column(Text)
    order_collected = Column(String(10), default="No")
    next_visit_date = Column(Date, nullable=True)
    status = Column(String(20), default="completed")

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    retailer = relationship("Retailer")
    employee = relationship("Employee")
