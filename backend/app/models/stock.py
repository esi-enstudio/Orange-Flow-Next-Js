"""Serial-tracked inventory foundation (P1).

Every serial unit has exactly one current location/status, and every movement is
appended to :class:`InventoryLedger`. Posted documents are never deleted or
edited: corrections are made with a new document so the ledger stays auditable.
"""

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.models.base import Base
from app.utils.timezone import now_naive


# Serial lifecycle. `received` is a draft-only state; `available` means the unit
# is sellable from house stock; `assigned` means an employee holds it.
SERIAL_STATUSES = (
    "received",
    "available",
    "assigned",
    "sold",
    "returned",
    "damaged",
    "quarantine",
    "adjusted",
)

DOCUMENT_TYPES = ("receipt", "issue", "return", "adjustment")

DOCUMENT_STATUSES = ("draft", "posted", "submitted", "verified", "rejected", "cancelled")

LOCATION_TYPES = ("house", "employee", "quarantine")


class ProductBatch(Base):
    """A received batch of a product (supplier invoice / purchase reference)."""

    __tablename__ = "product_batches"
    __table_args__ = (
        UniqueConstraint(
            "house_id", "product_id", "batch_number",
            name="uq_product_batch_number",
        ),
        Index("ix_product_batches_house_product", "house_id", "product_id"),
    )

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    batch_number = Column(String(100), nullable=False)
    supplier = Column(String(200), nullable=True)
    purchase_reference = Column(String(100), nullable=True)
    invoice_number = Column(String(100), nullable=True)
    received_date = Column(Date, nullable=True)
    quantity = Column(Integer, nullable=False, default=0)
    unit_cost = Column(Numeric(14, 2), nullable=False, default=0)
    face_value = Column(Numeric(14, 2), nullable=False, default=0)
    notes = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)

    house = relationship("House")
    product = relationship("Product")


class StockLocation(Base):
    """A place stock can sit: house mother stock, an employee, or quarantine."""

    __tablename__ = "stock_locations"
    __table_args__ = (
        UniqueConstraint("house_id", "location_key", name="uq_stock_location_key"),
        Index("ix_stock_locations_house_type", "house_id", "location_type"),
    )

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    location_type = Column(String(20), nullable=False)
    # Stable per-house key: "house", "quarantine", "employee:<id>".
    location_key = Column(String(80), nullable=False)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True, index=True)
    name = Column(String(200), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=now_naive)

    house = relationship("House")
    employee = relationship("Employee")


class SerialUnit(Base):
    """One physical serial (SIM ICCID, scratch card serial, ...)."""

    __tablename__ = "serial_units"
    __table_args__ = (
        UniqueConstraint(
            "house_id", "product_id", "serial_number",
            name="uq_serial_unit_house_product_serial",
        ),
        Index("ix_serial_units_house_status", "house_id", "status"),
        Index("ix_serial_units_house_employee", "house_id", "current_employee_id"),
    )

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    batch_id = Column(Integer, ForeignKey("product_batches.id"), nullable=True, index=True)
    serial_number = Column(String(100), nullable=False, index=True)
    status = Column(String(20), nullable=False, default="received", index=True)
    current_location_id = Column(Integer, ForeignKey("stock_locations.id"), nullable=True, index=True)
    current_employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True, index=True)
    unit_cost = Column(Numeric(14, 2), nullable=False, default=0)
    face_value = Column(Numeric(14, 2), nullable=False, default=0)
    received_at = Column(DateTime, nullable=True)
    status_updated_at = Column(DateTime, default=now_naive)
    notes = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)

    house = relationship("House")
    product = relationship("Product", lazy="joined")
    batch = relationship("ProductBatch")
    location = relationship("StockLocation")
    employee = relationship("Employee")


class StockDocument(Base):
    """Receipt / issue / return voucher. One product per voucher in P1."""

    __tablename__ = "stock_documents"
    __table_args__ = (
        UniqueConstraint("house_id", "idempotency_key", name="uq_stock_document_idempotency"),
        Index("ix_stock_documents_house_type_status", "house_id", "document_type", "status"),
        Index("ix_stock_documents_house_date", "house_id", "business_date"),
    )

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    document_no = Column(String(40), unique=True, nullable=True, index=True)
    document_type = Column(String(20), nullable=False, index=True)
    status = Column(String(20), nullable=False, default="draft", index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True, index=True)
    supplier = Column(String(200), nullable=True)
    purchase_reference = Column(String(100), nullable=True)
    invoice_number = Column(String(100), nullable=True)
    batch_number = Column(String(100), nullable=True)
    business_date = Column(Date, nullable=False)
    expected_quantity = Column(Integer, nullable=False, default=0)
    total_quantity = Column(Integer, nullable=False, default=0)
    unit_cost = Column(Numeric(14, 2), nullable=False, default=0)
    face_value = Column(Numeric(14, 2), nullable=False, default=0)
    notes = Column(Text, nullable=True)
    reason = Column(String(255), nullable=True)
    idempotency_key = Column(String(120), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    posted_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    posted_at = Column(DateTime, nullable=True)
    verified_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    verified_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=now_naive)
    updated_at = Column(DateTime, default=now_naive, onupdate=now_naive)
    is_deleted = Column(Boolean, nullable=False, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    house = relationship("House")
    employee = relationship("Employee")
    lines = relationship(
        "StockDocumentLine", back_populates="document", cascade="all, delete-orphan"
    )
    serial_lines = relationship(
        "StockSerialLine", back_populates="document", cascade="all, delete-orphan"
    )

    @property
    def discrepancy(self) -> int:
        return (self.expected_quantity or 0) - (self.total_quantity or 0)


class StockDocumentLine(Base):
    __tablename__ = "stock_document_lines"

    id = Column(Integer, primary_key=True)
    document_id = Column(
        Integer, ForeignKey("stock_documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    batch_id = Column(Integer, ForeignKey("product_batches.id"), nullable=True)
    quantity = Column(Integer, nullable=False, default=0)
    unit_cost = Column(Numeric(14, 2), nullable=False, default=0)
    face_value = Column(Numeric(14, 2), nullable=False, default=0)
    notes = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=now_naive)

    document = relationship("StockDocument", back_populates="lines")
    product = relationship("Product", lazy="joined")


class StockSerialLine(Base):
    """Serial-level movement of a document (before/after state)."""

    __tablename__ = "stock_serial_lines"
    __table_args__ = (
        Index("ix_stock_serial_lines_document", "document_id", "serial_unit_id"),
    )

    id = Column(Integer, primary_key=True)
    document_id = Column(
        Integer, ForeignKey("stock_documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    line_id = Column(Integer, ForeignKey("stock_document_lines.id"), nullable=True)
    serial_unit_id = Column(Integer, ForeignKey("serial_units.id"), nullable=False, index=True)
    serial_number = Column(String(100), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    action = Column(String(30), nullable=False)
    status_before = Column(String(20), nullable=True)
    status_after = Column(String(20), nullable=True)
    location_before_id = Column(Integer, ForeignKey("stock_locations.id"), nullable=True)
    location_after_id = Column(Integer, ForeignKey("stock_locations.id"), nullable=True)
    employee_before_id = Column(Integer, ForeignKey("employees.id"), nullable=True)
    employee_after_id = Column(Integer, ForeignKey("employees.id"), nullable=True)
    note = Column(String(500), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=now_naive)

    document = relationship("StockDocument", back_populates="serial_lines")
    serial_unit = relationship("SerialUnit")
    location_before = relationship("StockLocation", foreign_keys=[location_before_id])
    location_after = relationship("StockLocation", foreign_keys=[location_after_id])


class InventoryLedger(Base):
    """Append-only stock movement history. No update/delete API exists."""

    __tablename__ = "inventory_ledger"
    __table_args__ = (
        Index("ix_inventory_ledger_house_created", "house_id", "created_at"),
        Index("ix_inventory_ledger_house_product", "house_id", "product_id"),
    )

    id = Column(Integer, primary_key=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    serial_unit_id = Column(Integer, ForeignKey("serial_units.id"), nullable=True, index=True)
    serial_number = Column(String(100), nullable=True, index=True)
    document_id = Column(Integer, ForeignKey("stock_documents.id"), nullable=True, index=True)
    document_no = Column(String(40), nullable=True)
    movement_type = Column(String(30), nullable=False, index=True)
    quantity = Column(Integer, nullable=False, default=0)
    location_id = Column(Integer, ForeignKey("stock_locations.id"), nullable=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True, index=True)
    status_before = Column(String(20), nullable=True)
    status_after = Column(String(20), nullable=True)
    note = Column(String(500), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=now_naive, index=True)

    house = relationship("House")
    product = relationship("Product", lazy="joined")
    serial_unit = relationship("SerialUnit")
    location = relationship("StockLocation")
    employee = relationship("Employee")
    document = relationship("StockDocument")
