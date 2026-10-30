"""Adjustment service (P4): stock adjustments with approval workflow.

Adjustments are append-only entries in the inventory_ledger. They cannot be
updated or deleted. An adjustment goes through: draft → submitted → approved
→ creates ledger entries. Only approved adjustments write to serial status.
"""

from datetime import date
from decimal import Decimal
from typing import List, Optional

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.stock import SerialUnit, InventoryLedger, Product
from app.models.employee import Employee
from app.models.house import House
from app.schemas.stock import AdjustmentCreate, AdjustmentDecision
from app.services.inventory_service import (
    _error,
    resolve_business_date,
    _get_document,
    _ensure_not_existing_serials,
    clean_serials,
)
from app.utils.timezone import now_naive


async def create_adjustment(
    db: AsyncSession,
    *,
    house_id: int,
    user_id: int,
    data: AdjustmentCreate,
) -> InventoryLedger:
    """Create an adjustment draft. Returns the first ledger entry (status=draft)."""
    product = await db.get(Product, data.product_id)
    if not product or product.house_id != house_id:
        _error(404, "NOT_FOUND", "Product not found in this house")

    employee = await db.get(Employee, data.employee_id)
    if not employee or employee.house_id != house_id:
        _error(404, "NOT_FOUND", "Employee not found in this house")

    serials = clean_serials(data.serials)

    # Validate serials exist and are assigned to this employee
    result = await db.execute(
        select(SerialUnit).where(
            SerialUnit.house_id == house_id,
            SerialUnit.product_id == data.product_id,
            SerialUnit.serial_number.in_(serials),
            SerialUnit.current_employee_id == employee.id,
        )
    )
    units = result.scalars().all()
    found_serials = {u.serial_number for u in units}
    missing = [s for s in serials if s not in found_serials]
    if missing:
        _error(404, "SERIAL_NOT_FOUND", "Some serials not found", {"serials": f"Missing: {', '.join(missing[:10])}"})

    # All serials must be in assigned status (not already sold/returned etc.)
    not_assigned = [s for s in serials if next(u for u in units if u.serial_number == s).status != "assigned"]
    if not_assigned:
        _error(409, "SERIAL_NOT_AVAILABLE", "Some serials not in assigned state", {"serials": f"Invalid state: {', '.join(not_assigned[:10])}")

    business_date = resolve_business_date(data.business_date)

    # Create adjustment document (draft status)
    from app.models.stock import StockDocument, StockDocumentLine, StockSerialLine

    doc = StockDocument(
        house_id=house_id,
        document_type="adjustment",
        status="draft",
        employee_id=employee.id,
        business_date=business_date,
        total_quantity=len(serials),
        notes=data.notes,
        idempotency_key=data.idempotency_key,
        created_by=user_id,
    )
    db.add(doc)
    await db.flush()

    line = StockDocumentLine(document_id=doc.id, product_id=data.product_id, quantity=len(serials))
    db.add(line)
    await db.flush()

    now = now_naive()
    for serial in serials:
        unit = next(u for u in units if u.serial_number == serial)
        # Create serial line with draft status
        serial_line = StockSerialLine(
            document_id=doc.id,
            line_id=line.id,
            serial_unit_id=unit.id,
            serial_number=unit.serial_number,
            product_id=unit.product_id,
            action="adjustment",
            status_before=unit.status,
            status_after=unit.status,  # stays the same until approved
            employee_before_id=unit.current_employee_id,
            employee_after_id=unit.current_employee_id,
            note=data.notes,
            created_by=user_id,
        )
        db.add(serial_line)

        # Create ledger entry in draft status
        ledger = InventoryLedger(
            house_id=house_id,
            product_id=data.product_id,
            serial_unit_id=unit.id,
            serial_number=unit.serial_number,
            document_id=doc.id,
            document_no=doc.document_no,
            movement_type="adjustment",
            quantity=0,  # No quantity change yet in draft
            location_id=unit.current_location_id,
            employee_id=unit.current_employee_id,
            status_before=unit.status,
            status_after=unit.status,
            note=data.notes,
            created_by=user_id,
            created_at=now,
        )
        db.add(ledger)

    await db.flush()
    return ledger


async def submit_adjustment(
    db: AsyncSession,
    *,
    house_id: int,
    user_id: int,
    adjustment_id: int,
) -> InventoryLedger:
    """Submit an adjustment draft → status=submitted."""
    from app.models.stock import StockDocument

    # Find the adjustment document
    doc = await db.execute(
        select(StockDocument).where(
            StockDocument.id == adjustment_id,
            StockDocument.house_id == house_id,
            StockDocument.document_type == "adjustment",
            StockDocument.is_deleted.is_(False),
        )
    )
    adjustment_doc = doc.scalar_one_or_none()
    if not adjustment_doc:
        _error(404, "NOT_FOUND", "Adjustment not found")

    if adjustment_doc.status != "draft":
        _error(400, "INVALID_STATUS", "Only a draft adjustment can be submitted")

    adjustment_doc.status = "submitted"
    adjustment_doc.submitted_by = user_id
    adjustment_doc.submitted_at = now_naive()
    await db.flush()
    return await _get_adjustment_ledger(db, house_id, adjustment_doc.id)


async def approve_adjustment(
    db: AsyncSession,
    *,
    house_id: int,
    user_id: int,
    adjustment_id: int,
) -> InventoryLedger:
    """Approve an adjustment → writes serial status changes + ledger entries."""
    from app.models.stock import StockDocument, StockDocumentLine, StockSerialLine

    # Find the adjustment
    doc = await db.execute(
        select(StockDocument).where(
            StockDocument.id == adjustment_id,
            StockDocument.house_id == house_id,
            StockDocument.document_type == "adjustment",
            StockDocument.status == "submitted",
            StockDocument.is_deleted.is_(False),
        )
    )
    adjustment_doc = doc.scalar_one_or_none()
    if not adjustment_doc:
        _error(404, "NOT_FOUND", "Adjustment not found or not submitted")

    # Get all serial lines and their units
    serial_lines = (
        await db.execute(
            select(StockSerialLine).where(StockSerialLine.document_id == adjustment_doc.id)
        )
    ).scalars().all()

    if not serial_lines:
        _error(400, "VALIDATION_ERROR", "This adjustment has no serial lines")

    now = now_naive()

    for serial_line in serial_lines:
        unit = await db.get(SerialUnit, serial_line.serial_unit_id)

        # Update unit status based on decision
        if serial_line.status_after != "adjusted":
            # Reject: return serial to house, keep employee assignment
            unit.status = "assigned"
            unit.current_employee_id = serial_line.employee_after_id
            unit.status_updated_at = now

        # Create ledger entry for the adjustment
        ledger = InventoryLedger(
            house_id=house_id,
            product_id=unit.product_id,
            serial_unit_id=unit.id,
            serial_number=unit.serial_number,
            document_id=adjustment_doc.id,
            document_no=adjustment_doc.document_no,
            movement_type="adjustment",
            quantity=0,  # Quantity change handled by status
            location_id=unit.current_location_id,
            employee_id=unit.current_employee_id,
            status_before=serial_line.status_before,
            status_after=serial_line.status_after,
            note=f"Adjustment {adjustment_doc.document_no}",
            created_by=user_id,
            created_at=now,
        )
        db.add(ledger)

    # Mark adjustment as approved
    adjustment_doc.status = "approved"
    adjustment_doc.approved_by = user_id
    adjustment_doc.approved_at = now_naive()
    await db.flush()

    # Return the last ledger entry created
    ledgers = (
        await db.execute(
            select(InventoryLedger).where(
                InventoryLedger.document_id == adjustment_doc.id,
                InventoryLedger.movement_type == "adjustment",
            )
        )
    ).scalars().all()
    return ledgers[-1] if ledgers else ledger


async def decide_adjustment_serial(
    db: AsyncSession,
    *,
    house_id: int,
    user_id: int,
    adjustment_id: int,
    serial_number: str,
    decision: str,  # "keep" or "return"
) -> dict:
    """Decide the fate of a specific serial in an approved adjustment.

    - "keep": serial stays with the employee, status -> "adjusted"
    - "return": serial returned to house stock, status -> "available"
    """
    from app.models.stock import StockDocument, StockSerialLine, SerialUnit

    # Find the adjustment doc
    doc = await db.execute(
        select(StockDocument).where(
            StockDocument.id == adjustment_id,
            StockDocument.house_id == house_id,
            StockDocument.document_type == "adjustment",
            StockDocument.status == "approved",
            StockDocument.is_deleted.is_(False),
        )
    )
    adjustment_doc = doc.scalar_one_or_none()
    if not adjustment_doc:
        _error(404, "NOT_FOUND", "Adjustment not found or not approved")

    # Find the serial line
    serial_line = (
        await db.execute(
            select(StockSerialLine).where(
                StockSerialLine.document_id == adjustment_doc.id,
                StockSerialLine.serial_number == serial_number,
            )
        )
    ).scalar_one_or_none()
    if not serial_line:
        _error(404, "SERIAL_NOT_FOUND", "Serial not in this adjustment")

    unit = await db.get(SerialUnit, serial_line.serial_unit_id)

    if decision == "keep":
        unit.status = "adjusted"
        unit.status_updated_at = now_naive()
        serial_line.status_after = "adjusted"
        return {
            "serial_number": serial_number,
            "status": "adjusted",
            "message": "Serial kept with employee",
        }
    elif decision == "return":
        unit.status = "available"
        unit.current_employee_id = None
        unit.status_updated_at = now_naive()
        serial_line.status_after = "available"
        return {
            "serial_number": serial_number,
            "status": "available",
            "message": "Serial returned to house stock",
        }
    else:
        _error(400, "VALIDATION_ERROR", "Invalid decision. Use 'keep' or 'return'")