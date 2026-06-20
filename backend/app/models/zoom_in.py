from sqlalchemy import Column, Integer, String, Float, Boolean, Date, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base


class ZoomInEventType(Base):
    __tablename__ = "zoom_in_event_types"

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False, unique=True)
    name_bn = Column(String(100))
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())


class ZoomInActivity(Base):
    __tablename__ = "zoom_in_activities"

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False, unique=True)
    name_bn = Column(String(100))
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())


class ZoomInAllocation(Base):
    __tablename__ = "zoom_in_allocations"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    month = Column(Date, nullable=False, index=True)
    event_type_id = Column(Integer, ForeignKey("zoom_in_event_types.id"), nullable=False)
    thana = Column(String(100), nullable=False, default="")
    count = Column(Integer, default=0)
    budget_per_unit = Column(Float, default=0.0)
    total_budget = Column(Float, default=0.0)

    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, onupdate=func.now())

    house = relationship("House")
    event_type = relationship("ZoomInEventType")

    __table_args__ = (
        UniqueConstraint(
            "house_id", "month", "event_type_id", "thana", "is_deleted",
            name="uq_alloc_house_month_event_thana"
        ),
    )


class ZoomInEvent(Base):
    __tablename__ = "zoom_in_events"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    event_type_id = Column(Integer, ForeignKey("zoom_in_event_types.id"), nullable=False)
    activity_id = Column(Integer, ForeignKey("zoom_in_activities.id"), nullable=False)
    thana = Column(String(100), nullable=False)

    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, onupdate=func.now())

    house = relationship("House")
    event_type = relationship("ZoomInEventType")
    activity = relationship("ZoomInActivity")
    creator = relationship("User", foreign_keys=[created_by])
    updater = relationship("User", foreign_keys=[updated_by])
    bts_list = relationship("ZoomInEventBTS", back_populates="event", cascade="all, delete-orphan")
    rsos = relationship("ZoomInEventRSO", back_populates="event", cascade="all, delete-orphan")
    bps = relationship("ZoomInEventBP", back_populates="event", cascade="all, delete-orphan")
    retailers = relationship("ZoomInEventRetailer", back_populates="event", cascade="all, delete-orphan")


class ZoomInEventBTS(Base):
    __tablename__ = "zoom_in_event_bts"
    id = Column(Integer, primary_key=True)
    zoom_in_event_id = Column(Integer, ForeignKey("zoom_in_events.id", ondelete="CASCADE"), nullable=False, index=True)
    bts_id = Column(Integer, ForeignKey("bts_list.id"), nullable=False, index=True)
    event = relationship("ZoomInEvent", back_populates="bts_list")


class ZoomInEventRSO(Base):
    __tablename__ = "zoom_in_event_rsos"
    id = Column(Integer, primary_key=True)
    zoom_in_event_id = Column(Integer, ForeignKey("zoom_in_events.id", ondelete="CASCADE"), nullable=False, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False, index=True)
    event = relationship("ZoomInEvent", back_populates="rsos")


class ZoomInEventBP(Base):
    __tablename__ = "zoom_in_event_bps"
    id = Column(Integer, primary_key=True)
    zoom_in_event_id = Column(Integer, ForeignKey("zoom_in_events.id", ondelete="CASCADE"), nullable=False, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False, index=True)
    event = relationship("ZoomInEvent", back_populates="bps")


class ZoomInEventRetailer(Base):
    __tablename__ = "zoom_in_event_retailers"
    id = Column(Integer, primary_key=True)
    zoom_in_event_id = Column(Integer, ForeignKey("zoom_in_events.id", ondelete="CASCADE"), nullable=False, index=True)
    retailer_code = Column(String(50), nullable=False, index=True)
    event = relationship("ZoomInEvent", back_populates="retailers")
