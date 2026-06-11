from sqlalchemy import Column, Integer, String, DateTime, Boolean, Enum, Numeric, Text, ForeignKey, BigInteger
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base
import enum

class SubscriptionTier(enum.Enum):
    BASIC = "basic"
    STANDARD = "standard"
    PREMIUM = "premium"

class SubscriptionPackage(Base):
    __tablename__ = "subscription_packages"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)  # Name (Bangla)
    tier = Column(Enum(SubscriptionTier), nullable=False, unique=True)  # basic/standard/premium
    duration_days = Column(Integer, nullable=False)  # Package duration (days)
    price = Column(Numeric(10, 2), nullable=False)  # Price
    description = Column(Text, nullable=True)  # Description
    features = Column(Text, nullable=True)  # Features (JSON string)

    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    subscriptions = relationship("HouseSubscription", back_populates="package")

class HouseSubscription(Base):
    __tablename__ = "house_subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False)

    package_id = Column(Integer, ForeignKey("subscription_packages.id"), nullable=True)
    package = relationship("SubscriptionPackage", back_populates="subscriptions")

    start_date = Column(DateTime, nullable=False)
    end_date = Column(DateTime, nullable=False)
    is_active = Column(Boolean, default=True)

    auto_renew = Column(Boolean, default=False)  # Auto-renew enabled

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    house = relationship("House", back_populates="subscriptions")
    renewals = relationship("SubscriptionRenewal", back_populates="subscription")

class SubscriptionRenewal(Base):
    __tablename__ = "subscription_renewals"

    id = Column(Integer, primary_key=True, index=True)
    subscription_id = Column(Integer, ForeignKey("house_subscriptions.id"), nullable=True)
    subscription = relationship("HouseSubscription", back_populates="renewals")

    old_end_date = Column(DateTime, nullable=True)  # Previous expiry
    new_start_date = Column(DateTime, nullable=False)  # New start
    new_end_date = Column(DateTime, nullable=False)  # New end

    days_added = Column(Integer, nullable=False)  # Days added
    package_id = Column(Integer, nullable=True)  # Renewed package (None = manual)

    renewed_by = Column(BigInteger, nullable=False)  # Renewed by (Telegram ID)
    renewed_at = Column(DateTime, server_default=func.now())

    notes = Column(Text, nullable=True)  # Notes