from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, JSON, String

from app.models.base import Base
from app.utils.timezone import now_naive


class Notification(Base):
    """In-app notification for a single user.

    Rows are per recipient, so every user only ever reads their own feed — no
    cross-house filtering is needed and a notification can never leak another
    tenant's data. ``payload`` carries structured data (house, invoice, amount)
    so the UI can render the text in the active language; ``title``/``message``
    are the English fallback for API consumers.
    """

    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    type = Column(String(50), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    message = Column(String(500), nullable=True)
    link = Column(String(300), nullable=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=True, index=True)
    record_id = Column(Integer, nullable=True)
    payload = Column(JSON, nullable=True)
    is_read = Column(Boolean, nullable=False, default=False, index=True)
    read_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=now_naive, index=True)
