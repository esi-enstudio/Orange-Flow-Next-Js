from sqlalchemy import (
    Boolean,
    Column,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)

from app.models.base import Base
from app.utils.timezone import now_naive


class LiveC2CAutomationConfig(Base):
    __tablename__ = "live_c2c_automation_configs"
    __table_args__ = (
        UniqueConstraint("house_id", name="uq_live_c2c_automation_house"),
        CheckConstraint(
            "source_type IS NULL OR source_type IN ('gmail', 'whatsapp')",
            name="ck_live_c2c_automation_source_type",
        ),
        CheckConstraint(
            "is_enabled = false OR source_type IS NOT NULL",
            name="ck_live_c2c_automation_enabled_source",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(
        Integer,
        ForeignKey("houses.id", ondelete="CASCADE"),
        nullable=False,
    )
    source_type = Column(String(16), nullable=True)
    is_enabled = Column(Boolean, nullable=False, default=False, server_default=text("false"))

    gmail_address = Column(String(320), nullable=True)
    gmail_access_token_encrypted = Column(Text, nullable=True)
    gmail_refresh_token_encrypted = Column(Text, nullable=True)
    gmail_token_expires_at = Column(DateTime, nullable=True)
    gmail_history_id = Column(String(100), nullable=True)
    gmail_last_polled_at = Column(DateTime, nullable=True)
    gmail_status = Column(String(24), nullable=False, default="disconnected", server_default="disconnected")
    gmail_error = Column(String(500), nullable=True)
    oauth_state_hash = Column(String(64), nullable=True)
    oauth_state_expires_at = Column(DateTime, nullable=True)
    oauth_state_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    source_group_jid = Column(String(128), nullable=True)
    source_group_name = Column(String(200), nullable=True)
    destination_group_jid = Column(String(128), nullable=True)
    destination_group_name = Column(String(200), nullable=True)
    wa_device_id = Column(String(100), nullable=True)
    wa_webhook_id = Column(Integer, nullable=True)
    wa_webhook_secret_encrypted = Column(Text, nullable=True)

    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, nullable=False, default=now_naive, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, default=now_naive, onupdate=now_naive, server_default=func.now())
    is_deleted = Column(Boolean, nullable=False, default=False, server_default=text("false"), index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)


Index(
    "uq_live_c2c_automation_active_gmail",
    func.lower(LiveC2CAutomationConfig.gmail_address),
    unique=True,
    postgresql_where=text(
        "source_type = 'gmail' AND is_enabled IS TRUE AND is_deleted IS FALSE "
        "AND gmail_address IS NOT NULL"
    ),
    sqlite_where=text(
        "source_type = 'gmail' AND is_enabled = 1 AND is_deleted = 0 "
        "AND gmail_address IS NOT NULL"
    ),
)
Index(
    "uq_live_c2c_automation_active_wa_source",
    LiveC2CAutomationConfig.wa_device_id,
    LiveC2CAutomationConfig.source_group_jid,
    unique=True,
    postgresql_where=text(
        "source_type = 'whatsapp' AND is_enabled IS TRUE AND is_deleted IS FALSE "
        "AND wa_device_id IS NOT NULL AND source_group_jid IS NOT NULL"
    ),
    sqlite_where=text(
        "source_type = 'whatsapp' AND is_enabled = 1 AND is_deleted = 0 "
        "AND wa_device_id IS NOT NULL AND source_group_jid IS NOT NULL"
    ),
)


class LiveC2CInboundFile(Base):
    __tablename__ = "live_c2c_inbound_files"
    __table_args__ = (
        UniqueConstraint(
            "house_id",
            "source_type",
            "source_event_id",
            name="uq_live_c2c_inbound_source_event",
        ),
        CheckConstraint(
            "source_type IN ('gmail', 'whatsapp')",
            name="ck_live_c2c_inbound_source_type",
        ),
        CheckConstraint(
            "import_status IN ('queued', 'processing', 'imported', 'failed')",
            name="ck_live_c2c_inbound_import_status",
        ),
        CheckConstraint(
            "delivery_status IN ('pending', 'sending', 'sent', 'failed')",
            name="ck_live_c2c_inbound_delivery_status",
        ),
        Index("ix_live_c2c_inbound_house_status", "house_id", "import_status", "delivery_status"),
        Index("ix_live_c2c_inbound_lease", "import_status", "lease_expires_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(
        Integer,
        ForeignKey("houses.id", ondelete="CASCADE"),
        nullable=False,
    )
    config_id = Column(
        Integer,
        ForeignKey("live_c2c_automation_configs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source_type = Column(String(16), nullable=False)
    source_event_id = Column(String(300), nullable=False)
    source_device_id = Column(String(100), nullable=True)
    source_group_jid = Column(String(128), nullable=True)
    filename = Column(String(255), nullable=False)
    sha256 = Column(String(64), nullable=False)
    content = Column(LargeBinary, nullable=True)
    import_status = Column(String(20), nullable=False, default="queued", server_default="queued")
    delivery_status = Column(String(20), nullable=False, default="pending", server_default="pending")
    import_attempts = Column(Integer, nullable=False, default=0, server_default="0")
    delivery_attempts = Column(Integer, nullable=False, default=0, server_default="0")
    last_error = Column(Text, nullable=True)
    lease_expires_at = Column(DateTime, nullable=True)
    received_at = Column(DateTime, nullable=False, default=now_naive, server_default=func.now())
    processed_at = Column(DateTime, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, nullable=False, default=now_naive, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, default=now_naive, onupdate=now_naive, server_default=func.now())
    is_deleted = Column(Boolean, nullable=False, default=False, server_default=text("false"), index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)
