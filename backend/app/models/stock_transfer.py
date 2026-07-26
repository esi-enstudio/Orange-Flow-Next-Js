from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base


class StockTransfer(Base):
    __tablename__ = "stock_transfers"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    from_type = Column(String(20), nullable=False)  # 'house' or 'employee'
    from_id = Column(Integer, nullable=False)
    to_type = Column(String(20), nullable=False)    # 'house' or 'employee'
    to_id = Column(Integer, nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    quantity = Column(Integer, nullable=False)
    note = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    house = relationship("House")
    product = relationship("Product")
    creator = relationship("User")
