from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from app.models.base import Base
from app.utils.timezone import now_naive


class RestorePoint(Base):
    """A restorable snapshot of the whole running system.

    A restore point captures three things at one moment in time:
      1. code    — the git commit SHA (+ branch / subject / dirty-file count)
      2. data    — a PostgreSQL dump (`database.dump` inside the snapshot dir)
      3. config  — the git-ignored `.env` files, which `git reset` can never bring back

    The heavy artifacts live on disk under
    `backend/backups/restore_points/<snapshot_id>/` (a host bind mount that the
    deploy-service also sees). This table is the *registry*: permissions, who
    created it, and the audit trail.

    NOTE: `pg_restore --clean` replaces the whole database, so rolling back to a
    restore point also rewinds this table to the moment the snapshot was taken.
    The registry is therefore treated as a cache that can always be rebuilt from
    the on-disk `manifest.json` files (see `restore_point_service.list_restore_points`).
    """

    __tablename__ = "restore_points"

    __table_args__ = (
        Index("idx_restore_points_snapshot_id", "snapshot_id", unique=True),
        Index("idx_restore_points_git_sha", "git_sha"),
    )

    id = Column(Integer, primary_key=True, index=True)
    # Directory name on disk — the join key between the registry and the artifacts.
    snapshot_id = Column(String(64), nullable=False)
    label = Column(String(200), nullable=True)

    # ---- 1. code state ----
    git_sha = Column(String(64), nullable=True)
    git_short_sha = Column(String(16), nullable=True)
    git_branch = Column(String(120), nullable=True)
    git_subject = Column(String(400), nullable=True)
    git_dirty_files = Column(Integer, nullable=False, default=0)

    # ---- 2. database state ----
    has_database_dump = Column(Boolean, nullable=False, default=False)
    database_size = Column(Integer, nullable=False, default=0)  # bytes

    # ---- 3. config state ----
    config_files = Column(Text, nullable=True)  # comma-separated relative paths captured

    # ---- lifecycle ----
    status = Column(String(20), nullable=False, default="running")  # running | success | failed
    trigger_source = Column(String(20), nullable=False, default="manual")  # manual | auto_deploy
    error_message = Column(String(1000), nullable=True)

    # ---- rollout bookkeeping ----
    restored_at = Column(DateTime, nullable=True)
    restored_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    total_size = Column(Integer, nullable=False, default=0)  # bytes (all artifacts)

    created_at = Column(DateTime, default=now_naive, index=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    creator = relationship("User", foreign_keys=[created_by])
    restorer = relationship("User", foreign_keys=[restored_by])

    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)
