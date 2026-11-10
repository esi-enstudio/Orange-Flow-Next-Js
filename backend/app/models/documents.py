"""Document Automation models (templates, letterheads, generated documents).

Eight tables cover the whole flow:

``document_types``             what kind of paper this is (NOC, RELEASE, ...)
``document_templates``         template metadata, global (house_id NULL) or house-scoped
``document_template_versions`` immutable AST + variable schema, append-only
``document_letterheads``       organisation branding, global or house-scoped
``document_signatories``       signature blocks, global or house-scoped
``generated_documents``        the document record (number, data, status)
``document_versions``          immutable rendered PDF + HTML + data snapshot
``document_number_sequences``  transactional per house/type/year counter

Design notes
------------
* Primary keys are ``Integer`` like every other table in this project - the
  existing schema is not UUID based.
* A row with ``house_id IS NULL`` is *global*; a row with a house id belongs to
  that house and takes precedence when resolving a template/letterhead.
* Template and document versions are append-only. Editing a template or
  regenerating a PDF creates a new version, so an old PDF is never overwritten.
* Raw HTML is never stored. Template bodies are a structured Document AST
  (``content_json``, ``schema_version`` in the root) rendered by
  ``app/services/document_render.py``; letterheads are structured fields too.
"""

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB

from app.models.base import Base
from app.utils.timezone import now_naive

TEMPLATE_MODES = ("PREDEFINED", "VISUAL")
DOCUMENT_STATUSES = ("DRAFT", "GENERATED", "VOID")


class DocumentType(Base):
    """A kind of document the house can issue (NOC, RESIGNATION, ...)."""

    __tablename__ = "document_types"

    id = Column(Integer, primary_key=True)
    code = Column(String(50), nullable=False, unique=True, comment="Stable code, e.g. NOC")
    name = Column(String(150), nullable=False)
    name_bn = Column(String(150), nullable=True)
    number_prefix = Column(String(20), nullable=False, default="DOC", comment="Used in NOC-2026-0001")
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, index=True)

    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)
    is_deleted = Column(Boolean, nullable=False, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)


class DocumentTemplate(Base):
    """Template metadata. ``house_id IS NULL`` means it is the global template."""

    __tablename__ = "document_templates"

    id = Column(Integer, primary_key=True)
    document_type_id = Column(
        Integer, ForeignKey("document_types.id"), nullable=False, index=True
    )
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=True, index=True)
    name = Column(String(200), nullable=False)
    template_mode = Column(String(20), nullable=False, default="PREDEFINED")
    description = Column(Text, nullable=True)
    is_default = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True, index=True)

    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)
    is_deleted = Column(Boolean, nullable=False, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "template_mode IN ('PREDEFINED', 'VISUAL')",
            name="ck_document_templates_mode",
        ),
        # Unique per scope is enforced by partial indexes in the startup
        # migration (PostgreSQL treats NULL house_id values as distinct, so a
        # plain unique constraint cannot cover the global scope) and by the
        # service layer for every dialect.
        Index(
            "ix_document_templates_scope",
            "house_id",
            "document_type_id",
            "is_active",
        ),
    )


class DocumentTemplateVersion(Base):
    """Immutable snapshot of a template body (Document AST) and its variables."""

    __tablename__ = "document_template_versions"

    id = Column(Integer, primary_key=True)
    template_id = Column(
        Integer, ForeignKey("document_templates.id"), nullable=False, index=True
    )
    version_number = Column(Integer, nullable=False)
    content_json = Column(JSONB, nullable=False, comment="Document AST (schema_version in root)")
    variables_schema = Column(JSONB, nullable=False, default=lambda: {"fields": []})
    version_notes = Column(Text, nullable=True)

    # A saved version is a draft until published; only published versions are
    # resolved for generation. Publishing is a status transition, never an
    # edit of the stored body.
    is_published = Column(Boolean, nullable=False, default=False, index=True)
    published_at = Column(DateTime, nullable=True)

    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=now_naive)

    __table_args__ = (
        UniqueConstraint(
            "template_id", "version_number", name="uq_document_template_version"
        ),
    )


class DocumentLetterhead(Base):
    """Organisation branding printed above the document body."""

    __tablename__ = "document_letterheads"

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=True, index=True)
    name = Column(String(200), nullable=False)
    logo_path = Column(String(500), nullable=True, comment="Relative path inside private_uploads")
    organization_name = Column(String(200), nullable=False)
    subtitle = Column(String(200), nullable=True, comment="e.g. Authorized Distributor of Banglalink")
    address = Column(Text, nullable=True)
    phone_numbers = Column(JSONB, nullable=False, default=list)
    email = Column(String(255), nullable=True)
    footer_text = Column(Text, nullable=True)
    style_config = Column(JSONB, nullable=False, default=dict)

    is_default = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True, index=True)

    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)
    is_deleted = Column(Boolean, nullable=False, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)


class DocumentSignatory(Base):
    """A person whose name and signature close the document."""

    __tablename__ = "document_signatories"

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=True, index=True)
    name = Column(String(200), nullable=False)
    designation = Column(String(150), nullable=False)
    phone = Column(String(30), nullable=True)
    signature_path = Column(String(500), nullable=True)
    is_default = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True, index=True)

    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)
    is_deleted = Column(Boolean, nullable=False, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)


class GeneratedDocument(Base):
    """A document record. ``status`` is DRAFT until a PDF version exists."""

    __tablename__ = "generated_documents"

    id = Column(Integer, primary_key=True)
    document_number = Column(String(100), nullable=False)
    document_type_id = Column(
        Integer, ForeignKey("document_types.id"), nullable=False, index=True
    )
    template_id = Column(Integer, ForeignKey("document_templates.id"), nullable=False)
    template_version_id = Column(
        Integer, ForeignKey("document_template_versions.id"), nullable=False
    )
    letterhead_id = Column(Integer, ForeignKey("document_letterheads.id"), nullable=True)
    signatory_id = Column(Integer, ForeignKey("document_signatories.id"), nullable=True)

    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True, index=True)
    document_title = Column(String(255), nullable=False)
    document_data = Column(JSONB, nullable=False, default=dict)

    status = Column(String(20), nullable=False, default="DRAFT")
    current_version = Column(Integer, nullable=False, default=0)

    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)

    __table_args__ = (
        CheckConstraint(
            "status IN ('DRAFT', 'GENERATED', 'VOID')",
            name="ck_generated_documents_status",
        ),
        UniqueConstraint("house_id", "document_number", name="uq_generated_document_number"),
        Index("ix_generated_documents_house_created", "house_id", "created_at"),
        Index("ix_generated_documents_type_status", "document_type_id", "status"),
    )


class DocumentVersion(Base):
    """One rendered PDF. Append-only: a regeneration adds a row, never updates."""

    __tablename__ = "document_versions"

    id = Column(Integer, primary_key=True)
    document_id = Column(
        Integer, ForeignKey("generated_documents.id"), nullable=False, index=True
    )
    version_number = Column(Integer, nullable=False)
    pdf_path = Column(Text, nullable=False, comment="Relative path inside private_uploads")
    html_snapshot = Column(Text, nullable=False)
    document_data_snapshot = Column(JSONB, nullable=False)
    template_version_id = Column(
        Integer, ForeignKey("document_template_versions.id"), nullable=False
    )
    letterhead_snapshot = Column(JSONB, nullable=True)
    signatory_snapshot = Column(JSONB, nullable=True)
    file_checksum = Column(String(64), nullable=False, comment="SHA-256 of the PDF bytes")
    file_size = Column(Integer, nullable=True)

    generated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    generated_at = Column(DateTime, default=now_naive)

    __table_args__ = (
        UniqueConstraint("document_id", "version_number", name="uq_document_version"),
    )


class DocumentNumberSequence(Base):
    """Per house / type / year counter used for collision-free document numbers."""

    __tablename__ = "document_number_sequences"

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False)
    document_type_id = Column(Integer, ForeignKey("document_types.id"), nullable=False)
    year = Column(Integer, nullable=False)
    last_number = Column(BigInteger, nullable=False, default=0)

    __table_args__ = (
        UniqueConstraint(
            "house_id", "document_type_id", "year", name="uq_document_number_sequence"
        ),
    )
