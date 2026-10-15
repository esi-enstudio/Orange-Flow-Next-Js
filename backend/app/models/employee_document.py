from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import relationship

from app.models.base import Base
from app.utils.timezone import now_naive

# Document types accepted for employee attachments.
# Keep in sync with the frontend list in
# frontend/src/components/employees/EmployeeAttachmentsPanel.tsx
EMPLOYEE_DOCUMENT_TYPES = (
    "nid_front",
    "nid_back",
    "education_certificate",
    "experience_certificate",
    "driving_license",
    "bank_document",
    "appointment_letter",
    "medical_certificate",
    "other",
)


class EmployeeDocument(Base):
    """A scanned document (NID, certificate, ...) attached to an employee.

    Files are stored inside a private directory and are only reachable through
    the permission-guarded download endpoint - never through the public
    /uploads mount.
    """

    __tablename__ = "employee_documents"

    id = Column(Integer, primary_key=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)

    doc_type = Column(String(40), nullable=False, default="other",
                      comment="nid_front, nid_back, education_certificate, ...")
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
        Index("ix_employee_documents_employee_active", "employee_id", "is_deleted"),
    )

    employee = relationship("Employee", back_populates="documents")
