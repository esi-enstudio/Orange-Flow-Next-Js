from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.Models.base import Base

class ReportRule(Base):
    __tablename__ = "report_rules"

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey('houses.id'), nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    rule_type = Column(String, nullable=False)
    config = Column(Text, nullable=True)
    report_types = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    valid_from = Column(DateTime, nullable=False)
    valid_to = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    house = relationship("House")
