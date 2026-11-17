from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    func,
)

from app.models.base import Base


class LiveC2CRow(Base):
    __tablename__ = "live_c2c"
    __table_args__ = (
        CheckConstraint("on_route IN ('Y', 'N')", name="ck_live_c2c_on_route"),
    )

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    from_msisdn = Column(Integer, ForeignKey("employees.id"), nullable=False)
    to_msisdn = Column(Integer, ForeignKey("retailers.id"), nullable=False)
    on_route = Column(String(1), nullable=False, default="N")
    modified_on = Column(String(100), nullable=True)
    transfer_mrp = Column(Numeric(18, 2), nullable=False)
    source_filename = Column(String(255), nullable=False)
    source_sheet = Column(String(255), nullable=False)

    is_deleted = Column(Boolean, nullable=False, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, nullable=True, onupdate=func.now())
