"""Field sales business logic (P2).

Invariants:

* a sale can only contain serials that are currently ``assigned`` to the same
  employee (never house stock, never another employee's bag);
* pending (submitted) sales reserve their serials, so two cashiers cannot sell
  the same unit twice;
* stock changes only on approval - a submitted or rejected sale leaves the
  employee's stock untouched;
* approval flips every serial to ``sold`` and appends an inventory ledger row.
"""

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Optional, Sequence, Tuple

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.employee import Employee
from app.models.field_sales import Sale, SaleLine, SaleSerialLine
from app.models.product import Product
from app.models.retailer import Retailer
from app.models.stock import InventoryLedger, SerialUnit
from app.services.inventory_service import (
    clean_serials,
    get_active_employee,
    get_location,
    get_serial_product,
    resolve_business_date,
)
from app.utils.timezone import now_naive

TWO_PLACES = Decimal("0.01")


def _error(status_code: int, code: str, message: str, fields: Optional[dict] = None):
    detail = {"code": code, "message": message}
    if fields:
        detail["fields"] = fields
    raise HTTPException(status_code=status_code, detail=detail)


def _money(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


async def get_sale(db: AsyncSession, house_id: int, sale_id: int, *, for_update: bool = False) -> Sale:
    query = (
        select(Sale)
        .options(
            selectinload(Sale.employee),
            selectinload(Sale.retailer),
            selectinload(Sale.lines).selectinload(SaleLine.product),
            selectinload(Sale.serial_lines),
        )
        .where(
            Sale.id == sale_id,
            Sale.house_id == house_id,
            Sale.is_deleted.is_(False),
        )
        # A re-read after a flush must reflect deleted/replaced lines.
        .execution_options(populate_existing=True)
    )
    if for_update:
        query = query.with_for_update()
    sale = (await db.execute(query)).scalar_one_or_none()
    if not sale:
        _error(404, "NOT_FOUND", "Sale not found")
    return sale


async def _idempotent_sale(db: AsyncSession, house_id: int, key: Optional[str]) -> Optional[Sale]:
    if not key:
        return None
    query = (
        select(Sale)
        .options(
            selectinload(Sale.employee),
            selectinload(Sale.retailer),
            selectinload(Sale.lines).selectinload(SaleLine.product),
            selectinload(Sale.serial_lines),
        )
        .where(Sale.house_id == house_id, Sale.idempotency_key == key)
    )
    return (await db.execute(query)).scalar_one_or_none()


async def _resolve_employee(
    db: AsyncSession, house_id: int, requested_id: Optional[int], scope_employee_id: Optional[int]
) -> Employee:
    if scope_employee_id:
        if requested_id and requested_id != scope_employee_id:
            _error(403, "FORBIDDEN", "You can only create sales for yourself")
        employee_id = scope_employee_id
    else:
        if not requested_id:
            _error(400, "VALIDATION_ERROR", "Employee is required", {"employee_id": "Select an employee"})
        employee_id = requested_id
    return await get_active_employee(db, house_id, employee_id)


async def _resolve_retailer(
    db: AsyncSession, house_id: int, retailer_id: Optional[int]
) -> Optional[Retailer]:
    if not retailer_id:
        return None
    retailer = (
        await db.execute(
            select(Retailer).where(Retailer.id == retailer_id, Retailer.house_id == house_id)
        )
    ).scalar_one_or_none()
    if not retailer:
        _error(404, "NOT_FOUND", "Retailer not found in this house", {"retailer_id": "Retailer not found"})
    return retailer


async def validate_sale_items(
    db: AsyncSession,
    *,
    house_id: int,
    employee_id: int,
    items: Sequence,
    exclude_sale_id: Optional[int] = None,
) -> Tuple[List[Tuple[int, List[str]]], dict]:
    """Validate serial ownership and availability, returning units by serial."""
    normalized: List[Tuple[int, List[str]]] = []
    all_serials: List[str] = []
    seen: set = set()
    duplicates: List[str] = []

    for item in items:
        serials = clean_serials(item.serials)
        for serial in serials:
            if serial in seen:
                duplicates.append(serial)
            seen.add(serial)
            all_serials.append(serial)
        normalized.append((item.product_id, serials))

    if duplicates:
        _error(
            400,
            "VALIDATION_ERROR",
            "Duplicate serial numbers in this sale",
            {"serials": "Duplicate in sale: " + ", ".join(sorted(set(duplicates))[:10])},
        )

    units = list(
        (
            await db.execute(
                select(SerialUnit)
                .where(
                    SerialUnit.house_id == house_id,
                    SerialUnit.serial_number.in_(all_serials),
                )
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    by_serial = {unit.serial_number: unit for unit in units}

    missing = [serial for serial in all_serials if serial not in by_serial]
    if missing:
        _error(
            404,
            "SERIAL_NOT_FOUND",
            "Some serial numbers were not found",
            {"serials": "Not found: " + ", ".join(missing[:10])},
        )

    for product_id, serials in normalized:
        for serial in serials:
            unit = by_serial[serial]
            if unit.product_id != product_id:
                _error(
                    400,
                    "VALIDATION_ERROR",
                    "A serial belongs to a different product",
                    {"serials": f"{serial} does not belong to the selected product"},
                )
            if unit.current_employee_id != employee_id:
                _error(
                    409,
                    "SERIAL_NOT_ASSIGNED_TO_EMPLOYEE",
                    "Some serials are not assigned to this employee",
                    {"serials": "Not assigned to this employee: " + serial},
                )
            if unit.status != "assigned":
                _error(
                    409,
                    "SERIAL_NOT_AVAILABLE",
                    "Some serials are not in assigned state",
                    {"serials": f"{serial} is {unit.status}"},
                )

    pending_query = (
        select(SaleSerialLine.serial_number)
        .join(Sale, Sale.id == SaleSerialLine.sale_id)
        .where(
            Sale.house_id == house_id,
            Sale.status == "submitted",
            Sale.is_deleted.is_(False),
            SaleSerialLine.serial_unit_id.in_([unit.id for unit in units]),
        )
    )
    if exclude_sale_id:
        pending_query = pending_query.where(Sale.id != exclude_sale_id)
    pending = sorted({row[0] for row in (await db.execute(pending_query)).all()})
    if pending:
        _error(
            409,
            "SERIAL_IN_PENDING_SALE",
            "Some serials are already in a pending sale submission",
            {"serials": "Pending in another sale: " + ", ".join(pending[:10])},
        )

    return normalized, by_serial


async def _write_lines(db: AsyncSession, sale: Sale, items: Sequence, units_by_serial: dict) -> None:
    for item in items:
        serials = clean_serials(item.serials)
        quantity = len(serials)
        unit_price = _money(item.unit_price)
        line = SaleLine(
            sale_id=sale.id,
            product_id=item.product_id,
            quantity=quantity,
            unit_price=unit_price,
            total_amount=(unit_price * quantity).quantize(TWO_PLACES),
            notes=getattr(item, "notes", None),
        )
        db.add(line)
        await db.flush()
        for serial in serials:
            unit = units_by_serial[serial]
            db.add(
                SaleSerialLine(
                    sale_id=sale.id,
                    sale_line_id=line.id,
                    serial_unit_id=unit.id,
                    serial_number=unit.serial_number,
                    product_id=unit.product_id,
                    status_before=unit.status,
                    status_after=unit.status,
                )
            )


def _totals(items: Sequence) -> Tuple[int, Decimal]:
    quantity = 0
    amount = Decimal("0")
    for item in items:
        serials = clean_serials(item.serials)
        quantity += len(serials)
        amount += _money(item.unit_price) * len(serials)
    return quantity, amount.quantize(TWO_PLACES)


async def _apply_payment(sale: Sale, payment_status: str, paid_amount) -> None:
    if paid_amount is None:
        paid = sale.total_amount if payment_status == "cash" else Decimal("0")
    else:
        paid = _money(paid_amount)
    if paid > sale.total_amount:
        _error(
            400,
            "VALIDATION_ERROR",
            "Paid amount cannot exceed the sale total",
            {"paid_amount": "Paid amount cannot exceed the sale total"},
        )
    sale.payment_status = payment_status
    sale.paid_amount = paid


async def _finalize_sale_no(db: AsyncSession, sale: Sale) -> None:
    sale.sale_no = f"SAL-{sale.business_date.year}-{sale.id:06d}"
    await db.flush()


async def create_sale(
    db: AsyncSession,
    *,
    house_id: int,
    user_id: Optional[int],
    data,
    scope_employee_id: Optional[int] = None,
) -> Sale:
    existing = await _idempotent_sale(db, house_id, data.idempotency_key)
    if existing:
        return existing

    employee = await _resolve_employee(db, house_id, data.employee_id, scope_employee_id)
    retailer = await _resolve_retailer(db, house_id, data.retailer_id)
    for item in data.items:
        await get_serial_product(db, item.product_id)

    business_date = resolve_business_date(data.business_date)
    normalized, units_by_serial = await validate_sale_items(
        db, house_id=house_id, employee_id=employee.id, items=data.items
    )

    quantity, amount = _totals(data.items)
    sale = Sale(
        house_id=house_id,
        status="draft",
        employee_id=employee.id,
        retailer_id=retailer.id if retailer else None,
        route=(data.route or (retailer.route if retailer else None) or "").strip() or None,
        business_date=business_date,
        total_quantity=quantity,
        total_amount=amount,
        notes=data.notes,
        idempotency_key=data.idempotency_key,
        created_by=user_id,
    )
    db.add(sale)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        _error(409, "DUPLICATE_DOCUMENT", "This sale already exists")

    await _finalize_sale_no(db, sale)
    await _write_lines(db, sale, data.items, units_by_serial)
    await _apply_payment(sale, data.payment_status, data.paid_amount)

    if data.submit:
        sale.status = "submitted"
        sale.submitted_at = now_naive()

    await db.flush()
    return await get_sale(db, house_id, sale.id)


async def update_sale(
    db: AsyncSession,
    *,
    house_id: int,
    sale_id: int,
    data,
    scope_employee_id: Optional[int] = None,
) -> Sale:
    sale = await get_sale(db, house_id, sale_id, for_update=True)
    if sale.status not in ("draft", "rejected"):
        _error(400, "INVALID_STATUS", "Only a draft or rejected sale can be edited")

    if data.employee_id is not None and data.employee_id != sale.employee_id:
        if scope_employee_id:
            _error(403, "FORBIDDEN", "You can only create sales for yourself")
        employee = await get_active_employee(db, house_id, data.employee_id)
        sale.employee_id = employee.id

    if "retailer_id" in getattr(data, "model_fields_set", set()):
        retailer = await _resolve_retailer(db, house_id, data.retailer_id)
        sale.retailer_id = retailer.id if retailer else None
        if not data.route:
            sale.route = (retailer.route if retailer else None) or sale.route
    if data.route is not None:
        sale.route = data.route.strip() or None
    if data.business_date is not None:
        sale.business_date = resolve_business_date(data.business_date)
    if data.notes is not None:
        sale.notes = data.notes
    if data.payment_status is not None or data.paid_amount is not None:
        await _apply_payment(
            sale,
            data.payment_status or sale.payment_status,
            data.paid_amount if data.paid_amount is not None else sale.paid_amount,
        )

    if data.items is not None:
        for line in list(sale.lines):
            await db.delete(line)
        for serial_line in list(sale.serial_lines):
            await db.delete(serial_line)
        await db.flush()

        for item in data.items:
            await get_serial_product(db, item.product_id)
        normalized, units_by_serial = await validate_sale_items(
            db, house_id=house_id, employee_id=sale.employee_id, items=data.items
        )
        await _write_lines(db, sale, data.items, units_by_serial)
        sale.total_quantity, sale.total_amount = _totals(data.items)
        if sale.paid_amount > sale.total_amount:
            sale.paid_amount = sale.total_amount

    if data.submit:
        sale.status = "submitted"
        sale.submitted_at = now_naive()

    await db.flush()
    return await get_sale(db, house_id, sale.id)


def _items_from_sale(sale: Sale) -> List[dict]:
    by_line: dict = {}
    for serial_line in sale.serial_lines:
        by_line.setdefault(serial_line.sale_line_id, []).append(serial_line.serial_number)
    items = []
    for line in sale.lines:
        items.append(
            {
                "product_id": line.product_id,
                "serials": by_line.get(line.id, []),
                "unit_price": line.unit_price,
            }
        )
    return items


class _Item:
    def __init__(self, product_id: int, serials: List[str], unit_price=0):
        self.product_id = product_id
        self.serials = serials
        self.unit_price = unit_price


async def submit_sale(
    db: AsyncSession, *, house_id: int, sale_id: int, scope_employee_id: Optional[int] = None
) -> Sale:
    sale = await get_sale(db, house_id, sale_id, for_update=True)
    if sale.status not in ("draft", "rejected"):
        _error(400, "INVALID_STATUS", "Only a draft or rejected sale can be submitted")
    if scope_employee_id and sale.employee_id != scope_employee_id:
        _error(403, "FORBIDDEN", "You can only submit your own sales")
    if not sale.lines or not sale.serial_lines:
        _error(400, "VALIDATION_ERROR", "Add at least one serial before submitting")

    raw_items = _items_from_sale(sale)
    items = [_Item(item["product_id"], item["serials"], item["unit_price"]) for item in raw_items]
    await validate_sale_items(
        db,
        house_id=house_id,
        employee_id=sale.employee_id,
        items=items,
        exclude_sale_id=sale.id,
    )

    sale.status = "submitted"
    sale.submitted_at = now_naive()
    await db.flush()
    return await get_sale(db, house_id, sale.id)


async def approve_sale(
    db: AsyncSession, *, house_id: int, sale_id: int, user_id: Optional[int]
) -> Sale:
    sale = await get_sale(db, house_id, sale_id, for_update=True)
    if sale.status != "submitted":
        _error(400, "INVALID_STATUS", "Only a submitted sale can be approved")
    if not sale.serial_lines:
        _error(400, "VALIDATION_ERROR", "This sale has no serials")

    units = list(
        (
            await db.execute(
                select(SerialUnit)
                .where(SerialUnit.id.in_([line.serial_unit_id for line in sale.serial_lines]))
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    units_by_id = {unit.id: unit for unit in units}
    employee_location = await get_location(db, house_id, "employee", sale.employee_id)
    now = now_naive()

    for serial_line in sale.serial_lines:
        unit = units_by_id.get(serial_line.serial_unit_id)
        if (
            not unit
            or unit.status != "assigned"
            or unit.current_employee_id != sale.employee_id
        ):
            _error(
                409,
                "SERIAL_STATE_CONFLICT",
                f"Serial {serial_line.serial_number} is no longer assigned to this employee",
            )
        unit.status = "sold"
        unit.current_employee_id = None
        unit.current_location_id = None
        unit.status_updated_at = now
        serial_line.status_after = "sold"
        db.add(
            InventoryLedger(
                house_id=house_id,
                product_id=unit.product_id,
                serial_unit_id=unit.id,
                serial_number=unit.serial_number,
                document_id=None,
                document_no=sale.sale_no,
                movement_type="sale",
                quantity=-1,
                location_id=employee_location.id,
                employee_id=sale.employee_id,
                status_before="assigned",
                status_after="sold",
                note=f"Sale {sale.sale_no}",
                created_by=user_id,
                created_at=now,
            )
        )

    sale.status = "approved"
    sale.approved_by = user_id
    sale.approved_at = now
    await db.flush()

    # Approved sales feed the cashbook once; the helper is idempotent per sale.
    from app.services.finance_service import record_sale_cash

    await record_sale_cash(db, house_id=house_id, sale=sale)
    await db.flush()
    return await get_sale(db, house_id, sale.id)


async def reject_sale(
    db: AsyncSession,
    *,
    house_id: int,
    sale_id: int,
    user_id: Optional[int],
    reason: str,
) -> Sale:
    sale = await get_sale(db, house_id, sale_id, for_update=True)
    if sale.status != "submitted":
        _error(400, "INVALID_STATUS", "Only a submitted sale can be rejected")
    sale.status = "rejected"
    sale.reject_reason = reason.strip()
    sale.rejected_by = user_id
    sale.rejected_at = now_naive()
    await db.flush()
    return await get_sale(db, house_id, sale.id)


async def list_sales(
    db: AsyncSession,
    *,
    house_id: int,
    page: int,
    per_page: int,
    search: Optional[str] = None,
    status: Optional[str] = None,
    employee_id: Optional[int] = None,
    retailer_id: Optional[int] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    scope_employee_id: Optional[int] = None,
) -> Tuple[List[Sale], int]:
    filters = [Sale.house_id == house_id, Sale.is_deleted.is_(False)]
    if search:
        pattern = f"%{search.strip()}%"
        filters.append(
            or_(
                Sale.sale_no.ilike(pattern),
                Sale.route.ilike(pattern),
                Sale.notes.ilike(pattern),
            )
        )
    if status:
        filters.append(Sale.status == status)
    effective_employee = scope_employee_id or employee_id
    if effective_employee:
        filters.append(Sale.employee_id == effective_employee)
    if retailer_id:
        filters.append(Sale.retailer_id == retailer_id)
    if date_from:
        filters.append(Sale.business_date >= date_from)
    if date_to:
        filters.append(Sale.business_date <= date_to)

    total = (await db.execute(select(func.count(Sale.id)).where(*filters))).scalar() or 0
    rows = list(
        (
            await db.execute(
                select(Sale)
                .options(
                    selectinload(Sale.employee),
                    selectinload(Sale.retailer),
                    selectinload(Sale.lines).selectinload(SaleLine.product),
                    selectinload(Sale.serial_lines),
                )
                .where(*filters)
                .order_by(Sale.id.desc())
                .offset((page - 1) * per_page)
                .limit(per_page)
            )
        )
        .scalars()
        .all()
    )
    return rows, total


async def sales_dashboard(
    db: AsyncSession, *, house_id: int, employee_id: Optional[int]
) -> dict:
    today = now_naive().date()
    serial_filters = [SerialUnit.house_id == house_id]
    sale_filters = [Sale.house_id == house_id, Sale.is_deleted.is_(False)]
    if employee_id:
        serial_filters.append(SerialUnit.current_employee_id == employee_id)
        sale_filters.append(Sale.employee_id == employee_id)

    status_rows = (
        await db.execute(
            select(SerialUnit.product_id, SerialUnit.status, func.count(SerialUnit.id))
            .where(*serial_filters)
            .group_by(SerialUnit.product_id, SerialUnit.status)
        )
    ).all()

    status_counts: dict = {}
    product_counts: dict = {}
    for product_id, status, count in status_rows:
        status_counts[status] = status_counts.get(status, 0) + count
        entry = product_counts.setdefault(
            product_id, {"product_id": product_id, "assigned": 0, "returned": 0, "sold": 0}
        )
        if status in entry:
            entry[status] = count

    if employee_id:
        # Approved sales are what an employee has sold; the serial itself no
        # longer belongs to them once approved (current_employee_id is cleared).
        sold_rows = (
            await db.execute(
                select(SaleSerialLine.product_id, func.count(SaleSerialLine.id))
                .join(Sale, Sale.id == SaleSerialLine.sale_id)
                .where(
                    Sale.house_id == house_id,
                    Sale.employee_id == employee_id,
                    Sale.status == "approved",
                    Sale.is_deleted.is_(False),
                )
                .group_by(SaleSerialLine.product_id)
            )
        ).all()
        for product_id, count in sold_rows:
            entry = product_counts.setdefault(
                product_id,
                {"product_id": product_id, "assigned": 0, "returned": 0, "sold": 0},
            )
            entry["sold"] = count
        status_counts["sold"] = sum(count for _, count in sold_rows)

    product_map = {}
    if product_counts:
        product_map = {
            product.id: product
            for product in (
                await db.execute(select(Product).where(Product.id.in_(product_counts.keys())))
            )
            .scalars()
            .all()
        }

    today_sales = (
        await db.execute(
            select(
                func.count(Sale.id),
                func.coalesce(func.sum(Sale.total_quantity), 0),
                func.coalesce(func.sum(Sale.total_amount), 0),
            ).where(*sale_filters, Sale.business_date == today, Sale.status == "approved")
        )
    ).one()
    pending_submissions = (
        await db.execute(
            select(func.count(Sale.id)).where(*sale_filters, Sale.status == "submitted")
        )
    ).scalar() or 0
    today_sold_units = (
        await db.execute(
            select(func.count(SaleSerialLine.id))
            .join(Sale, Sale.id == SaleSerialLine.sale_id)
            .where(*sale_filters, Sale.status == "approved", Sale.business_date == today)
        )
    ).scalar() or 0

    recent = list(
        (
            await db.execute(
                select(Sale)
                .options(
                    selectinload(Sale.employee),
                    selectinload(Sale.retailer),
                    selectinload(Sale.lines).selectinload(SaleLine.product),
                    selectinload(Sale.serial_lines),
                )
                .where(*sale_filters)
                .order_by(Sale.id.desc())
                .limit(5)
            )
        )
        .scalars()
        .all()
    )

    employee = await db.get(Employee, employee_id) if employee_id else None
    return {
        "scope": "employee" if employee_id else "house",
        "employee": (
            {
                "id": employee.id,
                "employee_name": employee.employee_name,
                "employee_id": employee.employee_id,
                "dms_code": employee.dms_code,
                "employee_type": employee.employee_type,
            }
            if employee
            else None
        ),
        "today": {
            "assigned": status_counts.get("assigned", 0),
            "returned": status_counts.get("returned", 0),
            "sold_units": int(today_sold_units),
            "pending_submissions": int(pending_submissions),
            "sales_count": int(today_sales[0] or 0),
            "sales_quantity": int(today_sales[1] or 0),
            "sales_amount": float(today_sales[2] or 0),
        },
        "stock": {
            "assigned": status_counts.get("assigned", 0),
            "returned": status_counts.get("returned", 0),
            "sold": status_counts.get("sold", 0),
            "by_product": [
                {
                    **entry,
                    "product_name": getattr(product_map.get(entry["product_id"]), "product_name", None),
                    "product_code": getattr(product_map.get(entry["product_id"]), "product_code", None),
                }
                for entry in product_counts.values()
            ],
        },
        "recent_sales": recent,
    }


async def search_retailers(
    db: AsyncSession, *, house_id: int, search: Optional[str], limit: int = 30
) -> List[Retailer]:
    filters = [Retailer.house_id == house_id]
    if search:
        pattern = f"%{search.strip()}%"
        filters.append(
            or_(
                Retailer.name.ilike(pattern),
                Retailer.retailer_code.ilike(pattern),
                Retailer.itop_number.ilike(pattern),
            )
        )
    return list(
        (
            await db.execute(
                select(Retailer).where(*filters).order_by(Retailer.name).limit(limit)
            )
        )
        .scalars()
        .all()
    )


async def sale_employees(db: AsyncSession, *, house_id: int) -> List[dict]:
    employees = list(
        (
            await db.execute(
                select(Employee)
                .where(Employee.house_id == house_id, Employee.status == "Active")
                .order_by(Employee.employee_name)
            )
        )
        .scalars()
        .all()
    )
    counts = {
        row[0]: row[1]
        for row in (
            await db.execute(
                select(SerialUnit.current_employee_id, func.count(SerialUnit.id))
                .where(
                    SerialUnit.house_id == house_id,
                    SerialUnit.status == "assigned",
                )
                .group_by(SerialUnit.current_employee_id)
            )
        ).all()
    }
    return [
        {
            "id": employee.id,
            "employee_name": employee.employee_name,
            "dms_code": employee.dms_code,
            "employee_id": employee.employee_id,
            "employee_type": employee.employee_type,
            "assigned_count": counts.get(employee.id, 0),
        }
        for employee in employees
    ]
