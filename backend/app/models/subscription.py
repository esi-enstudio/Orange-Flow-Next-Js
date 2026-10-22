from sqlalchemy import Column, Integer, String, DateTime, Boolean, Enum, Numeric, Text, JSON, ForeignKey, BigInteger, Index, text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base
from app.utils.timezone import now_naive
import enum

class SubscriptionTier(enum.Enum):
    BASIC = "basic"
    STANDARD = "standard"
    PREMIUM = "premium"

# Canonical subscription statuses (values stored in house_subscriptions.status)
SUBSCRIPTION_STATUS_TRALING = "trialing"
SUBSCRIPTION_STATUS_ACTIVE = "active"
SUBSCRIPTION_STATUS_PAST_DUE = "past_due"
SUBSCRIPTION_STATUS_CANCELLED = "cancelled"
SUBSCRIPTION_STATUS_EXPIRED = "expired"
SUBSCRIPTION_STATUS_PAUSED = "paused"

# Billing intervals
BILLING_INTERVAL_MONTHLY = "monthly"
BILLING_INTERVAL_YEARLY = "yearly"

class SubscriptionPackage(Base):
    __tablename__ = "subscription_packages"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)  # Name (display)
    # Uniqueness applies to live rows only: soft-deleted plans must not reserve
    # a slug/tier forever, otherwise "delete then re-create" fails at the DB
    # level. See __table_args__ for the partial unique indexes.
    slug = Column(String(50), nullable=True, index=True)  # machine key: basic/standard/premium
    tier = Column(Enum(SubscriptionTier), nullable=True)  # basic/standard/premium (legacy)
    duration_days = Column(Integer, nullable=True)  # Package duration (days) (legacy, default 30)
    price = Column(Numeric(10, 2), nullable=True)  # Price (legacy alias -> price_monthly)

    # Billing
    currency = Column(String(3), nullable=False, default="BDT")
    billing_interval = Column(String(16), nullable=False, default="monthly")  # monthly | yearly
    price_monthly = Column(Numeric(12, 2), nullable=False, default=0)
    price_yearly = Column(Numeric(12, 2), nullable=False, default=0)
    trial_days = Column(Integer, nullable=False, default=0)

    description = Column(Text, nullable=True)  # Description
    features = Column(Text, nullable=True)  # Legacy free-text features description

    # Feature flags (array of feature keys, e.g. ["reports", "import", "dms_sync"])
    feature_flags = Column(JSON, nullable=True, default=list)
    # Explicit module access list (top-level module keys or page "leaf" routes).
    # NULL  = the plan intentionally grants every module (unlimited/legacy).
    # [...] = strict plan: only these entries (+ always-on base modules).
    # The column default is NULL on purpose: a plan created without an explicit
    # module list is "unlimited", never "silently empty". See config/modules.py.
    allowed_modules = Column(JSON, nullable=True, default=None)
    # Plan limits (dict, e.g. {"max_users": 10, "max_retailers": 500})
    limits = Column(JSON, nullable=True, default=dict)

    is_active = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)

    # Soft delete
    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)

    subscriptions = relationship("HouseSubscription", back_populates="package")

    __table_args__ = (
        Index(
            "uq_subscription_packages_slug_live",
            "slug",
            unique=True,
            postgresql_where=text("is_deleted = false AND slug IS NOT NULL"),
            sqlite_where=text("is_deleted = 0 AND slug IS NOT NULL"),
        ),
        Index(
            "uq_subscription_packages_tier_live",
            "tier",
            unique=True,
            postgresql_where=text("is_deleted = false AND tier IS NOT NULL"),
            sqlite_where=text("is_deleted = 0 AND tier IS NOT NULL"),
        ),
    )

class HouseSubscription(Base):
    __tablename__ = "house_subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)

    package_id = Column(Integer, ForeignKey("subscription_packages.id"), nullable=True)
    # Always eager-load the plan: subscription objects are read all over the
    # async app (billing runner, notifications, webhook, admin), and a lazy
    # load outside a greenlet context raises MissingGreenlet.
    package = relationship("SubscriptionPackage", back_populates="subscriptions", lazy="selectin")

    # Status: trialing | active | past_due | cancelled | expired | paused
    status = Column(String(20), nullable=False, default="active", index=True)

    start_date = Column(DateTime, nullable=False)  # Subscription start
    end_date = Column(DateTime, nullable=False)  # Legacy alias -> current_period_end

    # Billing periods
    current_period_start = Column(DateTime, nullable=True)
    current_period_end = Column(DateTime, nullable=True)

    # Trial
    trial_start = Column(DateTime, nullable=True)
    trial_end = Column(DateTime, nullable=True)
    trial_reminder_sent_at = Column(DateTime, nullable=True)

    # Grace after payment failure (past_due -> expired)
    grace_period_end = Column(DateTime, nullable=True)

    # Cancellation
    cancel_at_period_end = Column(Boolean, default=False)
    cancelled_at = Column(DateTime, nullable=True)
    cancelled_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    # Pause / resume
    paused_at = Column(DateTime, nullable=True)
    resume_at = Column(DateTime, nullable=True)

    auto_renew = Column(Boolean, default=False)  # Auto-issue renewal invoice, NOT auto-charge

    billing_interval = Column(String(16), nullable=False, default="monthly")  # monthly | yearly
    currency = Column(String(3), nullable=False, default="BDT")

    # Soft delete
    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)

    house = relationship("House", back_populates="subscriptions")
    renewals = relationship("SubscriptionRenewal", back_populates="subscription")

    @property
    def current_status(self):
        return self.status

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

    renewed_by = Column(BigInteger, nullable=False)  # Renewed by (legacy: Telegram ID)
    renewed_at = Column(DateTime, default=now_naive)

    notes = Column(Text, nullable=True)  # Notes