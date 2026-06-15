from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base


class BpRetailerCode(Base):
    __tablename__ = "bp_retailer_codes"

    id = Column(Integer, primary_key=True)

    bp_employee_id = Column(
        Integer, ForeignKey("employees.id", ondelete="CASCADE"), nullable=False
    )
    retailer_code = Column(String, nullable=False, index=True)
    house_id = Column(
        Integer, ForeignKey("houses.id", ondelete="CASCADE"), nullable=False
    )

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    __table_args__ = (
        UniqueConstraint(
            "bp_employee_id",
            "retailer_code",
            name="uq_bp_employee_retailer_code",
        ),
    )

    bp_employee = relationship("Employee", backref="bp_retailer_codes", foreign_keys=[bp_employee_id])
    house = relationship("House", backref="bp_retailer_codes")
