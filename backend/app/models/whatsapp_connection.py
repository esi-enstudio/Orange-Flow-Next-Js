from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, Table, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base
from app.utils.timezone import now_naive


# Association: one shared WhatsApp connection can serve many houses
whatsapp_connection_houses = Table(
    "whatsapp_connection_houses",
    Base.metadata,
    Column(
        "connection_id",
        Integer,
        ForeignKey("whatsapp_connections.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "house_id",
        Integer,
        ForeignKey("houses.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class WhatsappConnection(Base):
    """Shared WhatsApp gateway device.

    A distributor (or DMS operator) links ONE WhatsApp device and assigns it
    to multiple houses. Houses assigned to a connection send their reports
    through it instead of having a dedicated per-house device.
    """

    __tablename__ = "whatsapp_connections"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)

    # Gateway credentials (go-whatsapp-multi-session-rest-api)
    wa_api_key = Column(String(200), nullable=True)
    wa_device_id = Column(String(100), nullable=True)
    wa_device_secret = Column(String(200), nullable=True)
    wa_jwt_token = Column(String(500), nullable=True)
    wa_phone_number = Column(String(20), nullable=True)
    wa_status = Column(String(20), default="disconnected")  # disconnected|connecting|connected|error
    wa_last_error = Column(String(500), nullable=True)
    wa_last_connected_at = Column(DateTime, nullable=True)

    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)

    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    houses = relationship(
        "House",
        secondary=whatsapp_connection_houses,
        lazy="selectin",
    )

    @property
    def house_ids(self) -> list[int]:
        return [h.id for h in self.houses]
