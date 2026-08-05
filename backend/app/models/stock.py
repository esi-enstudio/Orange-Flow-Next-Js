from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey, DateTime, Date, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base


class StockItem(Base):
    """Current stock balance for a product at a location (warehouse or RSO)."""

    __tablename__ = "stock_items"
    __table_args__ = (
        UniqueConstraint("house_id", "product_id", "location_type", "employee_id", name="uq_stock_item_location"),
    )

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    location_type = Column(String(20), nullable=False, index=True)  # warehouse | rso
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True, index=True)
    quantity = Column(Integer, nullable=False, default=0)

    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())

    house = relationship("House")
    product = relationship("Product")
    employee = relationship("Employee")


class StockLedger(Base):
    """Append-only ledger of every stock movement (opening, transfer, sale, adjustment)."""

    __tablename__ = "stock_ledger"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    location_type = Column(String(20), nullable=False, index=True)  # warehouse | rso
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True, index=True)
    movement_type = Column(String(30), nullable=False, index=True)  # opening | transfer_in | transfer_out | sale | return | adjustment
    quantity = Column(Integer, nullable=False)  # signed: positive in, negative out
    balance_after = Column(Integer, nullable=False)
    reference_type = Column(String(30), nullable=True)  # transfer | sale | adjustment
    reference_id = Column(Integer, nullable=True)
    reason = Column(String(255), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), index=True)

    house = relationship("House")
    product = relationship("Product")
    employee = relationship("Employee")
    creator = relationship("User", foreign_keys=[created_by])


class StockTransfer(Base):
    """Record of a stock transfer between warehouse and RSO (or RSO to RSO)."""

    __tablename__ = "stock_transfer_orders"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    from_type = Column(String(20), nullable=False)  # warehouse | rso
    from_employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True, index=True)
    to_type = Column(String(20), nullable=False)  # warehouse | rso
    to_employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True, index=True)
    quantity = Column(Integer, nullable=False)
    notes = Column(String(255), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), index=True)

    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    house = relationship("House")
    product = relationship("Product")
    from_employee = relationship("Employee", foreign_keys=[from_employee_id])
    to_employee = relationship("Employee", foreign_keys=[to_employee_id])
    creator = relationship("User", foreign_keys=[created_by])


class StockAdjustment(Base):
    """Stock adjustment to record losses, damages or corrections with a reason."""

    __tablename__ = "stock_adjustments"

    id = Column(Integer, primary_key=True, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    location_type = Column(String(20), nullable=False, index=True)  # warehouse | rso
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True, index=True)
    adjustment_type = Column(String(20), nullable=False)  # loss | damage | correction
    direction = Column(String(10), nullable=False)  # decrease | increase
    quantity = Column(Integer, nullable=False)
    reason = Column(String(255), nullable=False)
    notes = Column(String(500), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), index=True)

    is_deleted = Column(Boolean, default=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    house = relationship("House")
    product = relationship("Product")
    employee = relationship("Employee")
    creator = relationship("User", foreign_keys=[created_by])


class DailyStockSnapshot(Base):
    """Historical daily stock snapshot (quantity + value) per product per location."""

    __tablename__ = "daily_stock_snapshots"
    __table_args__ = (
        UniqueConstraint(
            "snapshot_date", "house_id", "product_id", "location_type", "employee_id",
            name="uq_daily_stock_snapshot_row",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    snapshot_date = Column(Date, nullable=False, index=True)
    house_id = Column(Integer, ForeignKey("houses.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    location_type = Column(String(20), nullable=False, index=True)  # warehouse | rso
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True, index=True)
    quantity = Column(Integer, nullable=False, default=0)
    unit_value = Column(Float, nullable=False, default=0.0)
    total_value = Column(Float, nullable=False, default=0.0)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    house = relationship("House")
    product = relationship("Product")
    employee = relationship("Employee")
