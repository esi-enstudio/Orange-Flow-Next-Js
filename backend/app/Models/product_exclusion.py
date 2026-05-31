from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.sql import func
from app.Models.base import Base

class ExcludedProductCode(Base):
    __tablename__ = "excluded_product_codes"

    id = Column(Integer, primary_key=True)
    product_code = Column(String, unique=True, nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.now())
