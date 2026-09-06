from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    Boolean,
    DateTime,
    ForeignKey,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import relationship

from app.models.base import Base


class RetailerMarking(Base):
    """Global marking/classification shared across houses (e.g., BSP, RBSP, DRC,
    BL Retailer, BL WIFI).

    Like roles/permissions, markings are house-agnostic configuration. House-level
    isolation is enforced through the retailers an assignment points to
    (retailers.house_id).
    """

    __tablename__ = "retailer_markings"
    __table_args__ = (
        UniqueConstraint("name", name="uq_retailer_marking_name"),
        UniqueConstraint("code", name="uq_retailer_marking_code"),
    )

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)  # human readable, e.g. "BL Retailer"
    code = Column(String(50), nullable=False, index=True)  # short code, e.g. "BLR"
    description = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="active", index=True)  # active | inactive

    # Audit
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    # Soft delete
    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    assignments = relationship(
        "RetailerMarkingAssignment",
        back_populates="marking",
        cascade="all, delete-orphan",
    )


class RetailerMarkingAssignment(Base):
    """Append-only assignment history linking a retailer to a marking.

    House scope is derived from the retailer (retailers.house_id). Assignment rows
    are never edited or hard-deleted; removing a marking from a retailer flips the
    active row to status='inactive' and records removed_by/removed_at/effective_to.
    """

    __tablename__ = "retailer_marking_assignments"
    __table_args__ = (
        UniqueConstraint(
            "retailer_id",
            "marking_id",
            "status",
            name="uq_retailer_marking_active",
        ),
    )

    id = Column(Integer, primary_key=True)
    retailer_id = Column(
        Integer, ForeignKey("retailers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    marking_id = Column(
        Integer, ForeignKey("retailer_markings.id", ondelete="CASCADE"), nullable=False, index=True
    )

    status = Column(String(20), nullable=False, default="active", index=True)  # active | inactive
    effective_from = Column(DateTime, nullable=False, server_default=func.now())
    effective_to = Column(DateTime, nullable=True)

    assigned_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    removed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    assigned_at = Column(DateTime, nullable=False, server_default=func.now())
    removed_at = Column(DateTime, nullable=True)
    remarks = Column(Text, nullable=True)

    created_at = Column(DateTime, server_default=func.now())

    retailer = relationship("Retailer")
    marking = relationship("RetailerMarking", back_populates="assignments")