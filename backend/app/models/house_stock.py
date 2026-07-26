from sqlalchemy import Column, Integer, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from app.models.base import Base
from app.utils.timezone import now_naive


class HouseStock(Base):
    __tablename__ = "house_stock"
    __table_args__ = (
        UniqueConstraint("house_id", "product_id", name="uq_house_stock_house_product"),
    )

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    quantity = Column(Integer, default=0, nullable=False)

    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, onupdate=now_naive)

    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    house = relationship("House")
    product = relationship("Product")
