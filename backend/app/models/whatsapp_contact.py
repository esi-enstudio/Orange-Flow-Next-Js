from datetime import datetime
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from app.models.base import Base
from app.utils.timezone import now_naive


class WhatsAppContact(Base):
    """Manually maintained WhatsApp recipient.

    Unlike the contact list cached on the linked WhatsApp device (which can hold
    thousands of entries and is entirely out of our control), these rows are typed
    in by the user and stored per house so a report schedule can address a known
    person by name. `jid` is derived from `phone_number` at write time because the
    delivery gateway addresses individual chats as `<digits>@s.whatsapp.net`.
    """

    __tablename__ = "whatsapp_contacts"
    __table_args__ = (
        # Uniqueness applies to live rows only, so removing a contact and adding the
        # same number again is allowed while the soft-deleted history is kept.
        Index(
            "uq_whatsapp_contacts_house_phone_active",
            "house_id",
            "phone_number",
            unique=True,
            postgresql_where=text("is_deleted = false"),
        ),
        Index("idx_whatsapp_contacts_house_active", "house_id", "is_active"),
    )

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)

    name = Column(String(200), nullable=False)
    phone_number = Column(String(20), nullable=False)  # digits only, country code included
    jid = Column(String(64), nullable=False)  # "<phone_number>@s.whatsapp.net"
    note = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)
