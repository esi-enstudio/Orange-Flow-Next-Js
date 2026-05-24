from sqlalchemy import Column, Integer, String, Float, DateTime
from sqlalchemy.sql import func
from app.Models.base import Base

class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True)
    product_code = Column(String, unique=True, index=True, nullable=False)
    product_type = Column(String, nullable=True)
    mrp = Column(Float, default=0.0)
    dd_lifting_price = Column(Float, default=0.0)
    ret_lifting_price = Column(Float, default=0.0)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
