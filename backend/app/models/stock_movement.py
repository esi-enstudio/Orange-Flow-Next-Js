from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.models.base import Base
from app.utils.timezone import now_naive


class StockMovement(Base):
    __tablename__ = "stock_movements"

    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True, index=True)
    quantity_change = Column(Integer, nullable=False)
    before_qty = Column(Integer, nullable=False, default=0)
    after_qty = Column(Integer, nullable=False, default=0)
    movement_type = Column(String(50), nullable=False)
    reference_id = Column(Integer, nullable=True)
    note = Column(String(500), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=now_naive)

    product = relationship("Product")
    house = relationship("House")
    employee = relationship("Employee")
    creator = relationship("User", foreign_keys=[created_by])
