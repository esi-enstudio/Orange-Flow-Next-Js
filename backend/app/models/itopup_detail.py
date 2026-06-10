from sqlalchemy import Column, Integer, String, Float, Date, ForeignKey, DateTime, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base

class ITopUpDetail(Base):
    __tablename__ = "itopup_details"
    __table_args__ = (
        UniqueConstraint('house_id', 'retailer_id', 'report_type', 'report_date', name='uix_house_retailer_type_date'),
    )

    id = Column(Integer, primary_key=True)
    
    # Foreign Keys (Normalization)
    house_id = Column(Integer, ForeignKey('houses.id'), nullable=False)
    retailer_id = Column(Integer, ForeignKey('retailers.id'), nullable=True, index=True)
    
    # Report type (C2C, C2S, Balance)
    report_type = Column(String, index=True)
    
    # Date and value
    report_date = Column(Date, index=True, nullable=False)
    daily_value = Column(Float, default=0.0) 
    
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    # Relationships
    house = relationship("House")
    retailer = relationship("Retailer")
