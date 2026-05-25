from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.Models.base import Base

class GAProductFilter(Base):
    """জিএ রিপোর্ট থেকে যে প্রোডাক্ট কোডগুলো বাদ যাবে (উদা: SIMSWAP)"""
    __tablename__ = "ga_product_filters"

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey('houses.id'), nullable=False)
    product_code = Column(String, nullable=False) # উদা: ESIMSWAP
    
    created_at = Column(DateTime, server_default=func.now())
    house = relationship("House")

class FilterTag(Base):
    """ফিল্টারের জন্য ক্যাটাগরি বা ট্যাগ (উদা: DRC, BP, Staff)"""
    __tablename__ = "filter_tags"
    __table_args__ = (UniqueConstraint('house_id', 'name', name='uix_house_tag_name'),)

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey('houses.id'), nullable=False)
    name = Column(String, nullable=False)
    
    created_at = Column(DateTime, server_default=func.now())
    house = relationship("House")

class RetailerFilter(Base):
    """রিপোর্ট থেকে যে রিটেইলারগুলো বাদ যাবে"""
    __tablename__ = "retailer_filters"
    __table_args__ = (UniqueConstraint('house_id', 'retailer_id', name='uix_house_retailer_filter'),)

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey('houses.id'), nullable=False)
    retailer_id = Column(Integer, ForeignKey('retailers.id', ondelete='CASCADE'), nullable=False)
    tag = Column(String, nullable=True) # ফিল্টার ক্যাটাগরি (DRC, BP, ইত্যাদি)
    
    created_at = Column(DateTime, server_default=func.now())
    house = relationship("House")
    retailer = relationship("Retailer")