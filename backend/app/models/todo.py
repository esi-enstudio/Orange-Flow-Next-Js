from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import enum

from app.models.base import Base


class PriorityEnum(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class StatusEnum(str, enum.Enum):
    PENDING = "pending"
    COMPLETED = "completed"


class Todo(Base):
    __tablename__ = "todos"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(SAEnum(StatusEnum), default=StatusEnum.PENDING, nullable=False)
    priority = Column(SAEnum(PriorityEnum), default=PriorityEnum.MEDIUM, nullable=False)
    due_date = Column(DateTime(timezone=True), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="todos")
