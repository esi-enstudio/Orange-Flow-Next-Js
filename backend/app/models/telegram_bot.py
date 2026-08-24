from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, Table
from sqlalchemy.orm import relationship
from app.models.base import Base
from app.utils.timezone import now_naive


# Association: one Telegram bot can serve many houses
telegram_bot_houses = Table(
    "telegram_bot_houses",
    Base.metadata,
    Column(
        "bot_id",
        Integer,
        ForeignKey("telegram_bots.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "house_id",
        Integer,
        ForeignKey("houses.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class TelegramBot(Base):
    """Shared Telegram bot.

    A distributor (or DMS operator) creates ONE bot (via @BotFather) and
    assigns it to multiple houses. Telegram bots are stateless HTTP clients —
    a single token can deliver reports to unlimited groups/channels, so this
    scales to hundreds of houses with no extra RAM or gateway processes.
    """

    __tablename__ = "telegram_bots"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)

    # Bot credentials (https://api.telegram.org/bot<token>)
    bot_token = Column(String(200), nullable=False)
    bot_username = Column(String(100), nullable=True)
    status = Column(String(20), default="active")  # active | invalid
    last_error = Column(String(500), nullable=True)
    last_verified_at = Column(DateTime, nullable=True)

    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)

    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    houses = relationship(
        "House",
        secondary=telegram_bot_houses,
        lazy="selectin",
    )

    @property
    def house_ids(self) -> list[int]:
        return [h.id for h in self.houses]
