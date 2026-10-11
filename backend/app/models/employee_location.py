"""Employee live-location tracking models.

Two tables work together:

* ``employee_live_locations`` — one row per employee holding the **latest**
  known position (upserted on every device ping). Cheap to read, powers the
  live map + dashboard.
* ``employee_locations`` — append-only **history** of every ping, used for the
  movement trail. Rows older than the retention window are pruned by the
  scheduler.

Data is captured by a mobile automation macro (MacroDroid) which POSTs to
``/api/v1/location/update`` every few minutes with the employee identifier,
battery level and GPS coordinates.
"""

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy.sql import func

from app.models.base import Base


class EmployeeLiveLocation(Base):
    """Latest known location per employee (upsert target)."""

    __tablename__ = "employee_live_locations"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(
        Integer,
        ForeignKey("employees.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    house_id = Column(Integer, ForeignKey("houses.id", ondelete="SET NULL"), nullable=True, index=True)

    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    battery_percent = Column(Integer, nullable=True)
    is_charging = Column(Boolean, nullable=True)
    accuracy = Column(Float, nullable=True)
    speed = Column(Float, nullable=True)
    provider = Column(String(50), nullable=True)
    device_name = Column(String(150), nullable=True)
    source = Column(String(30), nullable=False, default="macro")
    last_ip = Column(String(64), nullable=True)

    ping_count = Column(Integer, nullable=False, default=1)
    first_seen_at = Column(DateTime, nullable=True)
    last_seen_at = Column(DateTime, nullable=False, index=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())


class EmployeeLocation(Base):
    """Append-only history of every location ping."""

    __tablename__ = "employee_locations"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(
        Integer,
        ForeignKey("employees.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    house_id = Column(Integer, ForeignKey("houses.id", ondelete="SET NULL"), nullable=True, index=True)

    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    battery_percent = Column(Integer, nullable=True)
    is_charging = Column(Boolean, nullable=True)
    accuracy = Column(Float, nullable=True)
    speed = Column(Float, nullable=True)
    provider = Column(String(50), nullable=True)
    device_name = Column(String(150), nullable=True)
    source = Column(String(30), nullable=False, default="macro")
    ip_address = Column(String(64), nullable=True)

    recorded_at = Column(DateTime, nullable=False, index=True)
    created_at = Column(DateTime, server_default=func.now(), index=True)

    __table_args__ = (
        Index("ix_employee_locations_emp_recorded", "employee_id", "recorded_at"),
    )
