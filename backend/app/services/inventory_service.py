"""Serial-tracked inventory business logic (P1).

Rules enforced here (never only in the UI):

* a serial can only exist once per house/product;
* a serial can only be issued when it is ``available`` in house stock;
* a return request never increases house stock — only a verified return does;
* every movement appends to :class:`InventoryLedger` (no update/delete);
* all reads are scoped to the caller's house.
"""

import re
from datetime import date
from decimal import Decimal
from typing import Iterable, List, Optional, Sequence, Tuple

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.employee import Employee
from app.models.product import Product
from app.models.stock import (
    InventoryLedger,
    ProductBatch,
    SerialUnit,
    StockDocument,
    StockDocumentLine,
    StockLocation,
    StockSerialLine,
)
from app.utils.timezone import now_naive

SERIAL_RE = re.compile(r"^[A-Z0-9][A-Z0-9._/\-]{2,63}$")
SERIAL_TRACKED_CATEGORIES = {"SIM", "Scratch Card"}
DOC_PREFIX = {"receipt": "GRN", "issue": "ISS", "return": "RET", "adjustment": "ADJ"}
SERIAL_STATUS_PENDING_RETURN = "returned"


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _error(status_code: int, code: str, message: str, fields: Optional[dict] = None):
    detail = {"code": code, "message": message}
    if fields:
        detail["fields"] = fields
    raise HTTPException(status_code=status_code, detail=detail)


def normalize_serial(raw: str) -> str:
    """Serials are compared/stored without spaces, uppercased."""
    return re.sub(r"\s+", "", str(raw or "")).upper()


def clean_serials(raw_serials: Sequence[str]) -> List[str]:
    """Normalise, reject invalid formats and duplicates inside one payload."""
    cleaned: List[str] = []
    seen: set = set()
    duplicates: List[str] = []
    invalid: List[str] = []

    for raw in raw_serials or []:
        serial = normalize_serial(raw)
        if not serial:
            continue
        if not SERIAL_RE.match(serial):
            invalid.append(serial)
        elif serial in seen:
            duplicates.append(serial)
        else:
            seen.add(serial)
            cleaned.append(serial)

    if invalid:
        _error(
            400,
            "VALIDATION_ERROR",
            "One or more serial numbers are invalid",
            {"serials": f"Invalid serial format: {', '.join(sorted(set(invalid))[:10])}"},
        )
    if duplicates:
        _error(
            400,
            "VALIDATION_ERROR",
            "Duplicate serial numbers in this batch",
            {"serials": f"Duplicate in batch: {', '.join(sorted(set(duplicates))[:10])}"},
        )
    if not cleaned:
        _error(400, "VALIDATION_ERROR", "At least one serial is required", {"serials": "Add at least one serial"})
    return cleaned


def employee_scope_id(user) -> Optional[int]:
    """RSO/BP users only ever see their own stock; managers see the house."""
    profile = getattr(user, "employee_profile", None)
    if profile is None:
        return None
    if (profile.employee_type or "").lower() in {"rso", "bp"}:
        return profile.id
    return None


def resolve_business_date(value: Optional[date]) -> date:
    today = now_naive().date()
    business = value or today
    if business > today:
        _error(
            400,
            "VALIDATION_ERROR",
            "Business date cannot be in the future",
            {"business_date": "Business date cannot be in the future"},
        )
    return business


async def get_serial_product(db: AsyncSession, product_id: int) -> Product:
    product = await db.get(Product, product_id)
    if not product:
        _error(404, "NOT_FOUND", "Product not found", {"product_id": "Product not found"})
    if product.category not in SERIAL_TRACKED_CATEGORIES:
        _error(
            400,
            "PRODUCT_NOT_SERIAL_TRACKED",
            "Only SIM and Scratch Card products are serial-tracked",
            {"product_id": "This product is tracked by quantity, not serial"},
        )
    if (product.status or "").lower() != "active":
        _error(
            400,
            "PRODUCT_INACTIVE",
            "Product is inactive",
            {"product_id": "This product is inactive"},
        )
    return product


async def get_active_employee(db: AsyncSession, house_id: int, employee_id: int) -> Employee:
    employee = await db.get(Employee, employee_id)
    if not employee or employee.house_id != house_id:
        _error(404, "NOT_FOUND", "Employee not found in this house", {"employee_id": "Employee not found in this house"})
    if (employee.status or "").lower() != "active":
        _error(
            400,
            "EMPLOYEE_INACTIVE",
            "Stock can only be moved for an active employee",
            {"employee_id": "Employee is not active"},
        )
    return employee


async def get_location(db: AsyncSession, house_id: int, location_type: str, employee_id: Optional[int] = None) -> StockLocation:
    key = f"employee:{employee_id}" if location_type == "employee" else location_type
    result = await db.execute(
        select(StockLocation).where(
            StockLocation.house_id == house_id, StockLocation.location_key == key
        )
    )
    location = result.scalar_one_or_none()
    if location:
        return location

    location = StockLocation(
        house_id=house_id,
        location_type=location_type,
        location_key=key,
        employee_id=employee_id,
        name=None,
    )
    db.add(location)
    try:
        await db.flush()
    except IntegrityError:
        # Two concurrent requests created it first; use the existing row.
        await db.rollback()
        result = await db.execute(
            select(StockLocation).where(
                StockLocation.house_id == house_id, StockLocation.location_key == key
            )
        )
        location = result.scalar_one()
    return location


async def _idempotent_document(db: AsyncSession, house_id: int, doc_type: str, key: Optional[str]):
    if not key:
        return None
    result = await db.execute(
        select(StockDocument)
        .options(
            selectinload(StockDocument.employee),
            selectinload(StockDocument.lines).selectinload(StockDocumentLine.product),
            selectinload(StockDocument.serial_lines),
        )
        .where(
            StockDocument.house_id == house_id,
            StockDocument.document_type == doc_type,
            StockDocument.idempotency_key == key,
        )
    )
    return result.scalar_one_or_none()


async def _finalize_document_no(db: AsyncSession, doc: StockDocument) -> None:
    """Number after flush so the primary key guarantees uniqueness under load."""
    year = (doc.business_date or now_naive().date()).year
    doc.document_no = f"{DOC_PREFIX.get(doc.document_type, 'DOC')}-{year}-{doc.id:06d}"
    await db.flush()


async def _get_document(
    db: AsyncSession,
    house_id: int,
    doc_id: int,
    *,
    doc_type: Optional[str] = None,
    for_update: bool = False,
) -> StockDocument:
    query = (
        select(StockDocument)
        .options(
            selectinload(StockDocument.employee),
            selectinload(StockDocument.lines).selectinload(StockDocumentLine.product),
            selectinload(StockDocument.serial_lines),
        )
        .where(
            StockDocument.id == doc_id,
            StockDocument.house_id == house_id,
            StockDocument.is_deleted.is_(False),
        )
    )
    if for_update:
        query = query.with_for_update()
    doc = (await db.execute(query)).scalar_one_or_none()
    if not doc:
        _error(404, "NOT_FOUND", "Document not found")
    if doc_type and doc.document_type != doc_type:
        _error(404, "NOT_FOUND", "Document not found")
    return doc


async def _document_units(db: AsyncSession, doc_id: int, *, for_update: bool = False) -> List[StockSerialLine]:
    query = select(StockSerialLine).where(StockSerialLine.document_id == doc_id)
    if for_update:
        query = query.with_for_update()
    return list((await db.execute(query)).scalars().all())


def _ledger_entry(
    *,
    house_id: int,
    product_id: int,
    unit: SerialUnit,
    doc: StockDocument,
    movement_type: str,
    quantity: int,
    location_id: Optional[int],
    employee_id: Optional[int],
    status_before: Optional[str],
    status_after: Optional[str],
    user_id: Optional[int],
    note: Optional[str] = None,
) -> InventoryLedger:
    return InventoryLedger(
        house_id=house_id,
        product_id=product_id,
        serial_unit_id=unit.id,
        serial_number=unit.serial_number,
        document_id=doc.id,
        document_no=doc.document_no,
        movement_type=movement_type,
        quantity=quantity,
        location_id=location_id,
        employee_id=employee_id,
        status_before=status_before,
        status_after=status_after,
        note=note,
        created_by=user_id,
        created_at=now_naive(),
    )


def _serial_line(
    *,
    doc: StockDocument,
    line: StockDocumentLine,
    unit: SerialUnit,
    action: str,
    status_before: Optional[str],
    status_after: Optional[str],
    location_before_id: Optional[int],
    location_after_id: Optional[int],
    employee_before_id: Optional[int],
    employee_after_id: Optional[int],
    user_id: Optional[int],
    note: Optional[str] = None,
) -> StockSerialLine:
    return StockSerialLine(
        document_id=doc.id,
        line_id=line.id,
        serial_unit_id=unit.id,
        serial_number=unit.serial_number,
        product_id=unit.product_id,
        action=action,
        status_before=status_before,
        status_after=status_after,
        location_before_id=location_before_id,
        location_after_id=location_after_id,
        employee_before_id=employee_before_id,
        employee_after_id=employee_after_id,
        note=note,
        created_by=user_id,
    )


# --------------------------------------------------------------------------- #
# receipts
# --------------------------------------------------------------------------- #
async def _ensure_not_existing_serials(
    db: AsyncSession, house_id: int, product_id: int, serials: Sequence[str]
) -> None:
    result = await db.execute(
        select(SerialUnit.serial_number).where(
            SerialUnit.house_id == house_id,
            SerialUnit.product_id == product_id,
            SerialUnit.serial_number.in_(list(serials)),
        )
    )
    existing = sorted({row[0] for row in result.all()})
    if existing:
        _error(
            409,
            "DUPLICATE_SERIAL",
            "Some serial numbers already exist in this house",
            {
                "serials": "Already received: " + ", ".join(existing[:10]),
                "existing_serials": existing,
            },
        )


async def create_receipt(db: AsyncSession, *, house_id: int, user_id: Optional[int], data) -> StockDocument:
    existing = await _idempotent_document(db, house_id, "receipt", data.idempotency_key)
    if existing:
        return existing

    raw_lines = _receipt_input_lines(data)

    # One entry per product, preserving the order the caller sent. A product
    # repeated in the payload is merged instead of rejected, so a split paste
    # (e.g. two ranges for the same SIM) still becomes one document line.
    products: dict = {}
    serials_by_product: dict = {}
    meta_by_product: dict = {}
    product_order: list = []
    seen_serials: set = set()
    cross_duplicates: list = []

    for raw in raw_lines:
        product_id = int(raw["product_id"])
        product = products.get(product_id)
        if product is None:
            product = await get_serial_product(db, product_id)
            products[product_id] = product
            serials_by_product[product_id] = []
            product_order.append(product_id)
            meta_by_product[product_id] = {
                "expected_quantity": None,
                "unit_cost": None,
                "face_value": None,
                "notes": None,
            }

        cleaned = clean_serials(raw["serials"])
        for serial in cleaned:
            if serial in seen_serials:
                cross_duplicates.append(serial)
            seen_serials.add(serial)
        serials_by_product[product_id].extend(cleaned)

        meta = meta_by_product[product_id]
        for key in ("expected_quantity", "unit_cost", "face_value", "notes"):
            if meta[key] is None and raw.get(key) is not None:
                meta[key] = raw[key]

    if cross_duplicates:
        repeated = sorted(set(cross_duplicates))
        _error(
            400,
            "VALIDATION_ERROR",
            "Duplicate serial numbers in this receiving",
            {"serials": "Duplicate in batch: " + ", ".join(repeated[:10])},
        )

    for product_id in product_order:
        await _ensure_not_existing_serials(
            db, house_id, product_id, serials_by_product[product_id]
        )

    total_serials = sum(len(serials) for serials in serials_by_product.values())
    house_location = await get_location(db, house_id, "house")
    doc = StockDocument(
        house_id=house_id,
        document_type="receipt",
        status="draft",
        supplier=(data.supplier or "").strip() or None,
        purchase_reference=(data.purchase_reference or "").strip() or None,
        invoice_number=(data.invoice_number or "").strip() or None,
        business_date=resolve_business_date(data.business_date),
        expected_quantity=(
            data.expected_quantity if data.expected_quantity is not None else total_serials
        ),
        total_quantity=total_serials,
        unit_cost=Decimal(str(data.unit_cost or 0)),
        face_value=Decimal(str(data.face_value or 0)),
        notes=data.notes,
        idempotency_key=data.idempotency_key,
        created_by=user_id,
    )
    db.add(doc)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        _error(409, "DUPLICATE_DOCUMENT", "This receiving entry already exists")

    await _finalize_document_no(db, doc)

    # Batch numbers are server-generated from the unique document number, so a
    # receiving can never share a batch number with another voucher and the UI
    # never has to ask for one.
    doc.batch_number = doc.document_no
    await db.flush()

    for product_id in product_order:
        serials = serials_by_product[product_id]
        meta = meta_by_product[product_id]
        line = StockDocumentLine(
            document_id=doc.id,
            product_id=product_id,
            quantity=len(serials),
            unit_cost=(
                Decimal(str(meta["unit_cost"])) if meta["unit_cost"] is not None else doc.unit_cost
            ),
            face_value=(
                Decimal(str(meta["face_value"])) if meta["face_value"] is not None else doc.face_value
            ),
            notes=meta["notes"] or data.notes,
        )
        db.add(line)
        await db.flush()

        units = [
            SerialUnit(
                house_id=house_id,
                product_id=product_id,
                serial_number=serial,
                status="received",
                current_location_id=house_location.id,
                unit_cost=line.unit_cost,
                face_value=line.face_value,
                notes=line.notes,
                status_updated_at=now_naive(),
            )
            for serial in serials
        ]
        db.add_all(units)
        try:
            await db.flush()
        except IntegrityError:
            await db.rollback()
            _error(
                409,
                "DUPLICATE_SERIAL",
                "Some serial numbers already exist in this house",
                {"serials": "Duplicate serial detected. Re-check the serial list."},
            )

        for unit in units:
            db.add(
                _serial_line(
                    doc=doc,
                    line=line,
                    unit=unit,
                    action="receive",
                    status_before=None,
                    status_after="received",
                    location_before_id=None,
                    location_after_id=house_location.id,
                    employee_before_id=None,
                    employee_after_id=None,
                    user_id=user_id,
                )
            )

    await db.flush()
    return await _get_document(db, house_id, doc.id)


def _receipt_input_lines(data) -> List[dict]:
    """Normalise the multi-line payload and the legacy single-product payload."""
    lines = getattr(data, "lines", None)
    if lines:
        return [
            {
                "product_id": line.product_id,
                "serials": list(line.serials),
                "expected_quantity": line.expected_quantity,
                "unit_cost": line.unit_cost,
                "face_value": line.face_value,
                "notes": line.notes,
            }
            for line in lines
        ]
    return [
        {
            "product_id": data.product_id,
            "serials": list(data.serials or []),
            "expected_quantity": None,
            "unit_cost": None,
            "face_value": None,
            "notes": None,
        }
    ]


async def post_receipt(db: AsyncSession, *, house_id: int, doc_id: int, user_id: Optional[int]) -> StockDocument:
    doc = await _get_document(db, house_id, doc_id, doc_type="receipt", for_update=True)
    if doc.status != "draft":
        _error(400, "INVALID_STATUS", "Only a draft receiving can be posted")
    if not doc.serial_lines:
        _error(400, "VALIDATION_ERROR", "This receiving has no serials to post")

    unit_ids = [line.serial_unit_id for line in doc.serial_lines]
    units = list(
        (
            await db.execute(
                select(SerialUnit).where(SerialUnit.id.in_(unit_ids)).with_for_update()
            )
        )
        .scalars()
        .all()
    )
    units_by_id = {unit.id: unit for unit in units}

    house_location = await get_location(db, house_id, "house")
    # Fresh receipts already carry an auto batch number; this keeps drafts made
    # before auto-generation consistent once they are posted.
    doc.batch_number = doc.batch_number or doc.document_no
    batch_number = doc.batch_number
    now = now_naive()

    # One batch per product line: a multi-product receiving must never put SIM
    # and Scratch Card serials into the same batch row.
    lines_by_id = {line.id: line for line in doc.lines}
    line_by_product = {line.product_id: line for line in doc.lines}
    quantities_by_line: dict = {}
    for serial_line in doc.serial_lines:
        line_id = serial_line.line_id or getattr(
            line_by_product.get(serial_line.product_id), "id", None
        )
        if line_id is not None:
            quantities_by_line[line_id] = quantities_by_line.get(line_id, 0) + 1

    batches_by_line: dict = {}
    for line in doc.lines:
        batch = (
            await db.execute(
                select(ProductBatch).where(
                    ProductBatch.house_id == house_id,
                    ProductBatch.product_id == line.product_id,
                    ProductBatch.batch_number == batch_number,
                )
            )
        ).scalar_one_or_none()
        quantity = quantities_by_line.get(line.id, 0)
        if batch:
            batch.quantity = (batch.quantity or 0) + quantity
        else:
            batch = ProductBatch(
                house_id=house_id,
                product_id=line.product_id,
                batch_number=batch_number,
                supplier=doc.supplier,
                purchase_reference=doc.purchase_reference,
                invoice_number=doc.invoice_number,
                received_date=doc.business_date,
                quantity=quantity,
                unit_cost=line.unit_cost,
                face_value=line.face_value,
                notes=doc.notes,
                created_by=user_id,
            )
            db.add(batch)
            await db.flush()
        line.batch_id = batch.id
        batches_by_line[line.id] = batch

    for serial_line in doc.serial_lines:
        unit = units_by_id.get(serial_line.serial_unit_id)
        if not unit or unit.status != "received":
            _error(409, "SERIAL_STATE_CONFLICT", "A serial in this receiving is no longer in received state")
        line = lines_by_id.get(serial_line.line_id) or line_by_product.get(serial_line.product_id)
        before = unit.status
        unit.status = "available"
        unit.batch_id = batches_by_line[line.id].id if line else None
        unit.current_location_id = house_location.id
        unit.current_employee_id = None
        unit.received_at = now
        unit.status_updated_at = now
        serial_line.status_after = "available"
        db.add(
            _ledger_entry(
                house_id=house_id,
                product_id=unit.product_id,
                unit=unit,
                doc=doc,
                movement_type="receipt",
                quantity=1,
                location_id=house_location.id,
                employee_id=None,
                status_before=before,
                status_after="available",
                user_id=user_id,
            )
        )

    doc.status = "posted"
    doc.total_quantity = len(units)
    doc.posted_by = user_id
    doc.posted_at = now
    await db.flush()
    return doc


# --------------------------------------------------------------------------- #
# issues
# --------------------------------------------------------------------------- #
async def issue_stock(db: AsyncSession, *, house_id: int, user_id: Optional[int], data) -> StockDocument:
    existing = await _idempotent_document(db, house_id, "issue", data.idempotency_key)
    if existing:
        return existing

    product = await get_serial_product(db, data.product_id)
    employee = await get_active_employee(db, house_id, data.employee_id)
    serials = clean_serials(data.serials)

    result = await db.execute(
        select(SerialUnit)
        .where(
            SerialUnit.house_id == house_id,
            SerialUnit.product_id == product.id,
            SerialUnit.serial_number.in_(serials),
        )
        .with_for_update()
    )
    units = list(result.scalars().all())
    found = {unit.serial_number: unit for unit in units}

    missing = [serial for serial in serials if serial not in found]
    if missing:
        _error(
            404,
            "SERIAL_NOT_FOUND",
            "Some serial numbers were not found in this house stock",
            {"serials": "Not found: " + ", ".join(missing[:10]), "missing_serials": missing},
        )

    blocked = [
        f"{serial} ({found[serial].status})"
        for serial in serials
        if found[serial].status != "available"
    ]
    if blocked:
        _error(
            409,
            "SERIAL_NOT_AVAILABLE",
            "Some serials are not available in house stock",
            {"serials": "Not available: " + ", ".join(blocked[:10])},
        )

    house_location = await get_location(db, house_id, "house")
    employee_location = await get_location(db, house_id, "employee", employee.id)
    business_date = resolve_business_date(data.business_date)

    doc = StockDocument(
        house_id=house_id,
        document_type="issue",
        status="posted",
        employee_id=employee.id,
        business_date=business_date,
        total_quantity=len(serials),
        notes=data.notes,
        idempotency_key=data.idempotency_key,
        created_by=user_id,
        posted_by=user_id,
        posted_at=now_naive(),
    )
    db.add(doc)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        _error(409, "DUPLICATE_DOCUMENT", "This issue voucher already exists")
    await _finalize_document_no(db, doc)

    line = StockDocumentLine(document_id=doc.id, product_id=product.id, quantity=len(serials))
    db.add(line)
    await db.flush()

    now = now_naive()
    for serial in serials:
        unit = found[serial]
        before = unit.status
        unit.status = "assigned"
        unit.current_employee_id = employee.id
        unit.current_location_id = employee_location.id
        unit.status_updated_at = now
        db.add(
            _serial_line(
                doc=doc,
                line=line,
                unit=unit,
                action="issue",
                status_before=before,
                status_after="assigned",
                location_before_id=house_location.id,
                location_after_id=employee_location.id,
                employee_before_id=None,
                employee_after_id=employee.id,
                user_id=user_id,
            )
        )
        db.add(
            _ledger_entry(
                house_id=house_id,
                product_id=unit.product_id,
                unit=unit,
                doc=doc,
                movement_type="issue_out",
                quantity=-1,
                location_id=house_location.id,
                employee_id=None,
                status_before=before,
                status_after="assigned",
                user_id=user_id,
            )
        )
        db.add(
            _ledger_entry(
                house_id=house_id,
                product_id=unit.product_id,
                unit=unit,
                doc=doc,
                movement_type="issue_in",
                quantity=1,
                location_id=employee_location.id,
                employee_id=employee.id,
                status_before=before,
                status_after="assigned",
                user_id=user_id,
            )
        )

    await db.flush()
    return await _get_document(db, house_id, doc.id)


# --------------------------------------------------------------------------- #
# returns
# --------------------------------------------------------------------------- #
async def create_return(db: AsyncSession, *, house_id: int, user_id: Optional[int], data) -> StockDocument:
    existing = await _idempotent_document(db, house_id, "return", data.idempotency_key)
    if existing:
        return existing

    product = await get_serial_product(db, data.product_id)
    employee = await get_active_employee(db, house_id, data.employee_id)
    serials = clean_serials(data.serials)

    result = await db.execute(
        select(SerialUnit)
        .where(
            SerialUnit.house_id == house_id,
            SerialUnit.product_id == product.id,
            SerialUnit.serial_number.in_(serials),
        )
        .with_for_update()
    )
    found = {unit.serial_number: unit for unit in result.scalars().all()}

    missing = [serial for serial in serials if serial not in found]
    if missing:
        _error(
            404,
            "SERIAL_NOT_FOUND",
            "Some serial numbers were not found",
            {"serials": "Not found: " + ", ".join(missing[:10])},
        )

    foreign = [serial for serial in serials if found[serial].current_employee_id != employee.id]
    if foreign:
        _error(
            409,
            "SERIAL_NOT_ASSIGNED_TO_EMPLOYEE",
            "Some serials are not assigned to this employee",
            {"serials": "Not assigned to this employee: " + ", ".join(foreign[:10])},
        )

    not_assigned = [serial for serial in serials if found[serial].status != "assigned"]
    if not_assigned:
        _error(
            409,
            "SERIAL_NOT_AVAILABLE",
            "Some serials are not in assigned state",
            {"serials": "Cannot return: " + ", ".join(not_assigned[:10])},
        )

    employee_location = await get_location(db, house_id, "employee", employee.id)
    business_date = resolve_business_date(data.business_date)

    doc = StockDocument(
        house_id=house_id,
        document_type="return",
        status="submitted",
        employee_id=employee.id,
        business_date=business_date,
        total_quantity=len(serials),
        notes=data.notes,
        reason=data.reason,
        idempotency_key=data.idempotency_key,
        created_by=user_id,
    )
    db.add(doc)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        _error(409, "DUPLICATE_DOCUMENT", "This return voucher already exists")
    await _finalize_document_no(db, doc)

    line = StockDocumentLine(document_id=doc.id, product_id=product.id, quantity=len(serials))
    db.add(line)
    await db.flush()

    now = now_naive()
    for serial in serials:
        unit = found[serial]
        before = unit.status
        # Returned is a *pending verification* state: the unit stays with the
        # employee and house stock is NOT increased yet.
        unit.status = SERIAL_STATUS_PENDING_RETURN
        unit.status_updated_at = now
        db.add(
            _serial_line(
                doc=doc,
                line=line,
                unit=unit,
                action="return_request",
                status_before=before,
                status_after=SERIAL_STATUS_PENDING_RETURN,
                location_before_id=employee_location.id,
                location_after_id=employee_location.id,
                employee_before_id=employee.id,
                employee_after_id=employee.id,
                user_id=user_id,
            )
        )
        db.add(
            _ledger_entry(
                house_id=house_id,
                product_id=unit.product_id,
                unit=unit,
                doc=doc,
                movement_type="return_request",
                quantity=-1,
                location_id=employee_location.id,
                employee_id=employee.id,
                status_before=before,
                status_after=SERIAL_STATUS_PENDING_RETURN,
                user_id=user_id,
                note="Pending cashier verification",
            )
        )

    await db.flush()
    return await _get_document(db, house_id, doc.id)


async def verify_return(
    db: AsyncSession,
    *,
    house_id: int,
    doc_id: int,
    user_id: Optional[int],
    decisions: Sequence,
    notes: Optional[str] = None,
) -> StockDocument:
    doc = await _get_document(db, house_id, doc_id, doc_type="return", for_update=True)
    if doc.status != "submitted":
        _error(400, "INVALID_STATUS", "This return has already been verified")
    if not doc.serial_lines:
        _error(400, "VALIDATION_ERROR", "No serials to verify")

    units = list(
        (
            await db.execute(
                select(SerialUnit)
                .where(SerialUnit.id.in_([line.serial_unit_id for line in doc.serial_lines]))
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    units_by_id = {unit.id: unit for unit in units}
    lines_by_serial = {line.serial_number: line for line in doc.serial_lines}

    house_location = await get_location(db, house_id, "house")
    quarantine_location = await get_location(db, house_id, "quarantine")
    employee_location = await get_location(db, house_id, "employee", doc.employee_id) if doc.employee_id else None

    now = now_naive()
    decided: set = set()
    for decision in decisions:
        serial = normalize_serial(decision.serial_number)
        serial_line = lines_by_serial.get(serial)
        if not serial_line:
            _error(400, "VALIDATION_ERROR", f"Serial {serial} does not belong to this return")
        unit = units_by_id.get(serial_line.serial_unit_id)
        if not unit or unit.status != SERIAL_STATUS_PENDING_RETURN:
            _error(409, "SERIAL_STATE_CONFLICT", f"Serial {serial} is not pending verification")

        before = unit.status
        action = decision.decision
        if action == "accept":
            unit.status = "available"
            unit.current_location_id = house_location.id
            unit.current_employee_id = None
            serial_line.status_after = "available"
            db.add(
                _ledger_entry(
                    house_id=house_id, product_id=unit.product_id, unit=unit, doc=doc,
                    movement_type="return_accept", quantity=1,
                    location_id=house_location.id, employee_id=None,
                    status_before=before, status_after="available", user_id=user_id,
                    note=decision.note,
                )
            )
        elif action == "damaged":
            unit.status = "damaged"
            unit.current_location_id = quarantine_location.id
            unit.current_employee_id = None
            serial_line.status_after = "damaged"
            db.add(
                _ledger_entry(
                    house_id=house_id, product_id=unit.product_id, unit=unit, doc=doc,
                    movement_type="return_damaged", quantity=1,
                    location_id=quarantine_location.id, employee_id=None,
                    status_before=before, status_after="damaged", user_id=user_id,
                    note=decision.note,
                )
            )
        elif action == "reject":
            unit.status = "assigned"
            unit.current_location_id = employee_location.id if employee_location else None
            unit.current_employee_id = doc.employee_id
            serial_line.status_after = "assigned"
            db.add(
                _ledger_entry(
                    house_id=house_id, product_id=unit.product_id, unit=unit, doc=doc,
                    movement_type="return_reject", quantity=1,
                    location_id=employee_location.id if employee_location else None,
                    employee_id=doc.employee_id,
                    status_before=before, status_after="assigned", user_id=user_id,
                    note=decision.note,
                )
            )
        else:
            _error(400, "VALIDATION_ERROR", f"Unknown decision for serial {serial}")

        unit.status_updated_at = now
        decided.add(serial_line.id)

    remaining = (
        await db.execute(
            select(func.count(SerialUnit.id))
            .join(StockSerialLine, StockSerialLine.serial_unit_id == SerialUnit.id)
            .where(
                StockSerialLine.document_id == doc.id,
                SerialUnit.status == SERIAL_STATUS_PENDING_RETURN,
            )
        )
    ).scalar() or 0

    doc.notes = notes or doc.notes
    if remaining == 0:
        doc.status = "verified"
        doc.verified_by = user_id
        doc.verified_at = now
    await db.flush()
    return doc


# --------------------------------------------------------------------------- #
# reads
# --------------------------------------------------------------------------- #
async def serial_history(db: AsyncSession, *, house_id: int, serial_id: int) -> dict:
    unit = (
        await db.execute(
            select(SerialUnit)
            .options(selectinload(SerialUnit.employee), selectinload(SerialUnit.product))
            .where(SerialUnit.id == serial_id, SerialUnit.house_id == house_id)
        )
    ).scalar_one_or_none()
    if not unit:
        _error(404, "NOT_FOUND", "Serial not found")

    serial_lines = list(
        (
            await db.execute(
                select(StockSerialLine)
                .where(StockSerialLine.serial_unit_id == unit.id)
                .order_by(StockSerialLine.created_at.asc(), StockSerialLine.id.asc())
            )
        )
        .scalars()
        .all()
    )
    ledger = list(
        (
            await db.execute(
                select(InventoryLedger)
                .where(InventoryLedger.serial_unit_id == unit.id)
                .order_by(InventoryLedger.created_at.asc(), InventoryLedger.id.asc())
            )
        )
        .scalars()
        .all()
    )
    return {"serial": unit, "movements": serial_lines, "ledger": ledger}


async def stock_summary(
    db: AsyncSession, *, house_id: int, product_id: Optional[int] = None, employee_id: Optional[int] = None
) -> dict:
    filters = [SerialUnit.house_id == house_id]
    if product_id:
        filters.append(SerialUnit.product_id == product_id)
    if employee_id:
        filters.append(SerialUnit.current_employee_id == employee_id)

    rows = (
        await db.execute(
            select(SerialUnit.product_id, SerialUnit.status, func.count(SerialUnit.id))
            .where(*filters)
            .group_by(SerialUnit.product_id, SerialUnit.status)
        )
    ).all()

    product_ids = {row[0] for row in rows}
    products = {}
    if product_ids:
        products = {
            product.id: product
            for product in (
                await db.execute(select(Product).where(Product.id.in_(product_ids)))
            )
            .scalars()
            .all()
        }

    by_status: dict = {}
    by_product: dict = {}
    for pid, status, count in rows:
        by_status[status] = by_status.get(status, 0) + count
        entry = by_product.setdefault(
            pid,
            {
                "product_id": pid,
                "product_name": products[pid].product_name if pid in products else None,
                "product_code": products[pid].product_code if pid in products else None,
                "category": products[pid].category if pid in products else None,
                "available": 0,
                "assigned": 0,
                "returned": 0,
                "damaged": 0,
                "sold": 0,
                "total": 0,
            },
        )
        if status in entry:
            entry[status] = count
        entry["total"] += count

    employee_rows = (
        await db.execute(
            select(
                SerialUnit.current_employee_id,
                SerialUnit.status,
                func.count(SerialUnit.id),
            )
            .where(
                SerialUnit.house_id == house_id,
                SerialUnit.current_employee_id.isnot(None),
                SerialUnit.status.in_(["assigned", "returned"]),
            )
            .group_by(SerialUnit.current_employee_id, SerialUnit.status)
        )
    ).all()

    employees: dict = {}
    employee_ids = {row[0] for row in employee_rows}
    employee_map = {}
    if employee_ids:
        employee_map = {
            employee.id: employee
            for employee in (
                await db.execute(select(Employee).where(Employee.id.in_(employee_ids)))
            )
            .scalars()
            .all()
        }
    for emp_id, status, count in employee_rows:
        employee = employee_map.get(emp_id)
        entry = employees.setdefault(
            emp_id,
            {
                "employee_id": emp_id,
                "employee_name": getattr(employee, "employee_name", None) if employee else None,
                "dms_code": getattr(employee, "dms_code", None) if employee else None,
                "employee_type": getattr(employee, "employee_type", None) if employee else None,
                "assigned": 0,
                "returned": 0,
            },
        )
        entry[status] = count

    return {
        "house": {
            "available": by_status.get("available", 0),
            "received": by_status.get("received", 0),
            "assigned": by_status.get("assigned", 0),
            "returned": by_status.get("returned", 0),
            "damaged": by_status.get("damaged", 0),
            "quarantine": by_status.get("quarantine", 0),
            "sold": by_status.get("sold", 0),
            "total": sum(by_status.values()),
        },
        "by_status": by_status,
        "by_product": sorted(by_product.values(), key=lambda item: item["product_id"]),
        "by_employee": sorted(employees.values(), key=lambda item: item["employee_id"]),
    }


async def list_serial_units(
    db: AsyncSession,
    *,
    house_id: int,
    page: int,
    per_page: int,
    search: Optional[str] = None,
    status: Optional[str] = None,
    product_id: Optional[int] = None,
    employee_id: Optional[int] = None,
    sort_by: str = "id",
    sort_order: str = "desc",
    scope_employee_id: Optional[int] = None,
) -> Tuple[List[SerialUnit], int]:
    filters = [SerialUnit.house_id == house_id]
    if search:
        filters.append(SerialUnit.serial_number.ilike(f"%{search.strip()}%"))
    if status:
        filters.append(SerialUnit.status == status)
    if product_id:
        filters.append(SerialUnit.product_id == product_id)
    effective_employee = scope_employee_id or employee_id
    if effective_employee:
        filters.append(SerialUnit.current_employee_id == effective_employee)

    total = (
        await db.execute(select(func.count(SerialUnit.id)).where(*filters))
    ).scalar() or 0

    sort_column = {
        "id": SerialUnit.id,
        "serial_number": SerialUnit.serial_number,
        "status": SerialUnit.status,
        "created_at": SerialUnit.created_at,
        "updated_at": SerialUnit.updated_at,
    }.get(sort_by, SerialUnit.id)
    ordering = sort_column.asc() if (sort_order or "desc").lower() == "asc" else sort_column.desc()

    rows = list(
        (
            await db.execute(
                select(SerialUnit)
                .options(selectinload(SerialUnit.product), selectinload(SerialUnit.employee))
                .where(*filters)
                .order_by(ordering)
                .offset((page - 1) * per_page)
                .limit(per_page)
            )
        )
        .scalars()
        .all()
    )
    return rows, total


async def list_documents(
    db: AsyncSession,
    *,
    house_id: int,
    document_type: str,
    page: int,
    per_page: int,
    search: Optional[str] = None,
    status: Optional[str] = None,
    employee_id: Optional[int] = None,
    product_id: Optional[int] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    sort_order: str = "desc",
    scope_employee_id: Optional[int] = None,
) -> Tuple[List[StockDocument], int]:
    filters = [
        StockDocument.house_id == house_id,
        StockDocument.document_type == document_type,
        StockDocument.is_deleted.is_(False),
    ]
    if search:
        pattern = f"%{search.strip()}%"
        filters.append(
            or_(
                StockDocument.document_no.ilike(pattern),
                StockDocument.invoice_number.ilike(pattern),
                StockDocument.supplier.ilike(pattern),
            )
        )
    if status:
        filters.append(StockDocument.status == status)
    effective_employee = scope_employee_id or employee_id
    if effective_employee:
        filters.append(StockDocument.employee_id == effective_employee)
    if product_id:
        filters.append(
            StockDocument.id.in_(
                select(StockDocumentLine.document_id).where(StockDocumentLine.product_id == product_id)
            )
        )
    if date_from:
        filters.append(StockDocument.business_date >= date_from)
    if date_to:
        filters.append(StockDocument.business_date <= date_to)

    total = (
        await db.execute(select(func.count(StockDocument.id)).where(*filters))
    ).scalar() or 0

    ordering = (
        StockDocument.id.asc() if (sort_order or "desc").lower() == "asc" else StockDocument.id.desc()
    )
    rows = list(
        (
            await db.execute(
                select(StockDocument)
                .options(
                    selectinload(StockDocument.employee),
                    selectinload(StockDocument.lines).selectinload(StockDocumentLine.product),
                )
                .where(*filters)
                .order_by(ordering)
                .offset((page - 1) * per_page)
                .limit(per_page)
            )
        )
        .scalars()
        .all()
    )
    return rows, total


async def document_detail(db: AsyncSession, *, house_id: int, doc_id: int) -> StockDocument:
    return await _get_document(db, house_id, doc_id)
