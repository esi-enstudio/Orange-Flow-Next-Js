from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Boolean

from app.models.base import Base
from app.utils.timezone import now_naive


class DatabaseBackup(Base):
    __tablename__ = "database_backups"

    id = Column(Integer, primary_key=True, index=True)
    file_name = Column(String(255), nullable=False, unique=True)
    file_path = Column(String(500), nullable=False)
    file_size = Column(Integer, nullable=False, default=0)  # bytes (0 while still being created)
    db_name = Column(String(100), nullable=False)
    pg_version = Column(String(50), nullable=True)  # pg dump client/server version used
    status = Column(String(20), nullable=False, default="running")  # running | success | failed
    error_message = Column(String(1000), nullable=True)
    created_at = Column(DateTime, default=now_naive, index=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)