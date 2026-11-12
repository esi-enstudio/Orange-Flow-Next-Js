from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import relationship

from app.models.base import Base
from app.utils.timezone import now_naive

# Document types accepted for house attachments.
# Keep in sync with the frontend list in
# frontend/src/app/houses/_components/HouseDocumentsModal.tsx
HOUSE_DOCUMENT_TYPES = (
    "trade_license",
    "tin_certificate",
    "vat_certificate",
    "drug_license",
    "bank_document",
    "proprietor_nid",
    "agreement",
    "other",
)


class HouseDocument(Base):
    """A scanned document (trade licence, NID, bank paper, ...) of a house.

    The letterhead page image and the proprietor signature live on their own
    `houses` columns because the letterhead renderer needs them synchronously
    (see `app/services/house_letterhead.py` and `app/services/house_documents.py`).

    Files are stored inside a private directory and are only reachable through
    the permission-guarded download endpoint - never through the public
    /uploads mount.
    """

    __tablename__ = "house_documents"

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)

    doc_type = Column(String(40), nullable=False, default="other",
                      comment="trade_license, tin_certificate, ...")
    title = Column(String(200), nullable=True)
    file_name = Column(String(255), nullable=False, comment="Original file name, for display/download")
    storage_path = Column(String(500), nullable=False, comment="Relative path inside the private storage root")
    file_size = Column(Integer, nullable=False, default=0)
    mime_type = Column(String(120), nullable=True)

    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)

    is_deleted = Column(Boolean, default=False, nullable=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    __table_args__ = (
        Index("ix_house_documents_house_active", "house_id", "is_deleted"),
    )

    house = relationship("House", back_populates="documents")
