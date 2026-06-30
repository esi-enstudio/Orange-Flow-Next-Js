from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, BigInteger, UniqueConstraint, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base


class ScratchCardSerial(Base):
    __tablename__ = "scratch_card_serials"

    id = Column(BigInteger, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    serial_number = Column(String(100), nullable=False, index=True)

    status = Column(String(20), nullable=False, default="available", index=True,
                    comment="available, used, allocated")
    batch_id = Column(String(50), nullable=True, index=True,
                      comment="Group identifier for bulk imports")
    notes = Column(String(500), nullable=True)

    used_at = Column(DateTime, nullable=True)
    used_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("house_id", "product_id", "serial_number",
                         name="uq_house_product_serial"),
        UniqueConstraint("serial_number", name="uq_serial_number"),
        Index("ix_scratch_card_serials_house_status_product",
              "house_id", "status", "product_id"),
    )

    house = relationship("House", lazy="joined")
    product = relationship("Product", lazy="joined")
    used_by_user = relationship("User", lazy="joined")

    @property
    def product_name(self):
        return self.product.product_name if self.product else None

    @property
    def product_code(self):
        return self.product.product_code if self.product else None
