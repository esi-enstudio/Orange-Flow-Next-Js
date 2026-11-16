"""Route master and assignment history.

A route is house-scoped reference data (code like ``MYMVAI01_ROUTE0066``).
Retailers may sit on several routes, and an RSO may own several routes. Both
links keep effective-dated history (``status`` + ``effective_from/to``) so a
resignation, transfer or re-import never rewrites what a past report showed.
"""
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import relationship

from app.models.base import Base


class Route(Base):
    __tablename__ = "routes"
    __table_args__ = (
        UniqueConstraint("house_id", "code", name="uq_route_house_code"),
        Index("ix_routes_house_active", "house_id", "is_active"),
    )

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    code = Column(String(50), nullable=False, index=True)
    name = Column(String(120), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, index=True)

    # DMS route-list attributes (description, beat length, weekly visit plan)
    description = Column(Text, nullable=True)
    route_length = Column(Float, nullable=True)
    # Weekday codes the route is served on: saturday ... friday
    visit_days = Column(JSON, nullable=True)

    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    house = relationship("House")
    retailer_links = relationship("RetailerRoute", back_populates="route")
    employee_links = relationship("EmployeeRoute", back_populates="route")


class RetailerRoute(Base):
    """Effective-dated retailer ↔ route link (append-only history)."""

    __tablename__ = "retailer_routes"
    __table_args__ = (
        Index(
            "uq_retailer_route_active",
            "retailer_id",
            "route_id",
            unique=True,
            postgresql_where=text("status = 'active'"),
            sqlite_where=text("status = 'active'"),
        ),
        Index("ix_retailer_routes_retailer", "retailer_id", "status"),
        Index("ix_retailer_routes_route", "route_id", "status"),
    )

    id = Column(Integer, primary_key=True)
    retailer_id = Column(
        Integer, ForeignKey("retailers.id", ondelete="CASCADE"), nullable=False
    )
    route_id = Column(Integer, ForeignKey("routes.id", ondelete="CASCADE"), nullable=False)
    # Excel order decides the primary route (first code), used for attribution.
    is_primary = Column(Boolean, nullable=False, default=False)

    status = Column(String(20), nullable=False, default="active", index=True)
    effective_from = Column(DateTime, nullable=False, server_default=func.now())
    effective_to = Column(DateTime, nullable=True)
    assigned_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    removed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    assigned_at = Column(DateTime, nullable=False, server_default=func.now())
    removed_at = Column(DateTime, nullable=True)

    retailer = relationship("Retailer", back_populates="route_links")
    route = relationship("Route", back_populates="retailer_links")


class EmployeeRoute(Base):
    """Effective-dated route ownership (one active RSO per route)."""

    __tablename__ = "employee_routes"
    __table_args__ = (
        Index(
            "uq_employee_route_active",
            "route_id",
            unique=True,
            postgresql_where=text("status = 'active'"),
            sqlite_where=text("status = 'active'"),
        ),
        Index("ix_employee_routes_employee", "employee_id", "status"),
        Index("ix_employee_routes_route", "route_id", "status"),
    )

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    route_id = Column(Integer, ForeignKey("routes.id", ondelete="CASCADE"), nullable=False)

    status = Column(String(20), nullable=False, default="active", index=True)
    effective_from = Column(DateTime, nullable=False, server_default=func.now())
    effective_to = Column(DateTime, nullable=True)
    assigned_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    removed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    assigned_at = Column(DateTime, nullable=False, server_default=func.now())
    removed_at = Column(DateTime, nullable=True)
    reason = Column(Text, nullable=True)  # manual | resign | transfer

    employee = relationship("Employee", foreign_keys=[employee_id])
    route = relationship("Route", back_populates="employee_links")
