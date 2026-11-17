import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from io import BytesIO
from pathlib import PurePath
from typing import Any, Iterable, Sequence

from fastapi import Request
from openpyxl import load_workbook
from pyxlsb import convert_date, open_workbook
from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.house import House
from app.models.live_c2c import LiveC2CRow
from app.models.retailer import Retailer
from app.models.route import RetailerRoute, Route
from app.models.user import User
from app.utils.activity_logger import log_activity
from app.utils.timezone import now_naive

MAX_LIVE_C2C_FILE_SIZE = 10 * 1024 * 1024
MAX_HEADER_SCAN_ROWS = 50
DB_LOOKUP_BATCH_SIZE = 1000
DB_INSERT_BATCH_SIZE = 1000
REQUIRED_LIVE_C2C_COLUMNS = (
    "From Msisdn",
    "To Msisdn",
    "Modified ON",
    "Transfer Mrp",
)
SUPPORTED_LIVE_C2C_EXTENSIONS = {".xlsx", ".xlsb"}


class LiveC2CImportError(ValueError):
    def __init__(self, code: str, **context: Any):
        super().__init__(code)
        self.code = code
        self.context = context


@dataclass(frozen=True)
class PreparedLiveC2CImport:
    rows: list[dict[str, Any]]
    disabled_retailer_count: int


def _normalize_header(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(str(value).strip().lower().split())


def _cell_value(cell: Any) -> Any:
    if cell is None:
        return None
    return getattr(cell, "value", getattr(cell, "v", None))


def _cell_column_index(cell: Any) -> int:
    column = getattr(cell, "column", None)
    return column - 1 if column is not None else cell.c


def _cell_text(cell: Any, *, xlsb_date: bool = False) -> str:
    value = _cell_value(cell)
    if value is None:
        return ""
    if (
        xlsb_date
        and not isinstance(value, bool)
        and isinstance(value, (int, float))
        and 0 <= value <= 2958465
    ):
        value = convert_date(value)
    if isinstance(value, datetime):
        return value.isoformat(sep=" ")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    text = str(value).strip()
    number_format = str(getattr(cell, "number_format", "") or "")
    if isinstance(value, int) and re.fullmatch(r"0+", number_format):
        text = text.zfill(len(number_format))
    return text


def _parse_transfer_mrp(cell: Any, row_number: int) -> Decimal:
    text = _cell_text(cell)
    if not text:
        raise LiveC2CImportError("live_c2c_invalid_amount", row=row_number)
    try:
        amount = Decimal(text.replace(",", ""))
    except InvalidOperation as error:
        raise LiveC2CImportError("live_c2c_invalid_amount", row=row_number) from error
    if (
        not amount.is_finite()
        or amount.as_tuple().exponent < -2
        or abs(amount) >= Decimal("10000000000000000")
    ):
        raise LiveC2CImportError("live_c2c_invalid_amount", row=row_number)
    return amount


def _safe_filename(filename: str | None) -> str:
    normalized = (filename or "upload.xlsx").replace("\\", "/").rsplit("/", 1)[-1]
    return PurePath(normalized).name[:255] or "upload.xlsx"


def _workbook_extension(filename: str | None) -> str:
    return PurePath(filename or "").suffix.lower()


def _list_xlsx_worksheet_names(content: bytes) -> list[str]:
    try:
        workbook = load_workbook(BytesIO(content), read_only=True, data_only=True)
    except Exception as error:
        raise LiveC2CImportError("live_c2c_invalid_workbook") from error
    try:
        names = list(workbook.sheetnames)
    finally:
        workbook.close()
    if not names:
        raise LiveC2CImportError("live_c2c_missing_sheet")
    return names


def list_live_c2c_worksheet_names(content: bytes, filename: str) -> list[str]:
    extension = _workbook_extension(filename)
    if extension not in SUPPORTED_LIVE_C2C_EXTENSIONS:
        raise LiveC2CImportError("live_c2c_invalid_file_type")
    if extension == ".xlsx":
        return _list_xlsx_worksheet_names(content)

    try:
        with open_workbook(BytesIO(content)) as workbook:
            names = list(workbook.sheets)
    except Exception as error:
        raise LiveC2CImportError("live_c2c_invalid_workbook") from error
    if not names:
        raise LiveC2CImportError("live_c2c_missing_sheet")
    return names


def _parse_worksheet_rows(
    rows: Iterable[Sequence[Any]],
    *,
    xlsb: bool,
) -> list[dict[str, Any]]:
    required_headers = {
        _normalize_header(header): header for header in REQUIRED_LIVE_C2C_COLUMNS
    }
    indexed_rows = enumerate(rows, start=1)
    header_row_number = None
    column_indexes: dict[str, int] = {}
    best_headers: set[str] = set()
    duplicate_headers = False

    for row_number, cells in indexed_rows:
        if row_number > MAX_HEADER_SCAN_ROWS:
            break
        matches: dict[str, int] = {}
        duplicates: set[str] = set()
        for cell in cells:
            normalized = _normalize_header(_cell_text(cell))
            if normalized not in required_headers:
                continue
            if normalized in matches:
                duplicates.add(normalized)
                continue
            matches[normalized] = _cell_column_index(cell)
        if len(matches) > len(best_headers):
            best_headers = set(matches)
        if len(matches) == len(REQUIRED_LIVE_C2C_COLUMNS) and not duplicates:
            header_row_number = row_number
            column_indexes = {
                required_headers[header]: index for header, index in matches.items()
            }
            break
        duplicate_headers = duplicate_headers or bool(duplicates)

    if header_row_number is None:
        if duplicate_headers and len(best_headers) == len(REQUIRED_LIVE_C2C_COLUMNS):
            raise LiveC2CImportError("live_c2c_duplicate_columns")
        missing = [
            header
            for header in REQUIRED_LIVE_C2C_COLUMNS
            if _normalize_header(header) not in best_headers
        ]
        raise LiveC2CImportError("live_c2c_missing_columns", missing_columns=missing)

    parsed_rows: list[dict[str, Any]] = []
    for row_number, cells in indexed_rows:
        values: dict[str, str] = {}
        for header in REQUIRED_LIVE_C2C_COLUMNS:
            column_index = column_indexes[header]
            cell = cells[column_index] if column_index < len(cells) else None
            values[header] = _cell_text(
                cell,
                xlsb_date=xlsb and header == "Modified ON",
            )
        if not any(values.values()):
            continue
        if not values["From Msisdn"] or not values["To Msisdn"]:
            raise LiveC2CImportError("live_c2c_missing_msisdn", row=row_number)
        if len(values["From Msisdn"]) > 64 or len(values["To Msisdn"]) > 64:
            raise LiveC2CImportError("live_c2c_msisdn_too_long", row=row_number)

        parsed_rows.append(
            {
                "from_number": values["From Msisdn"],
                "to_number": values["To Msisdn"],
                "modified_on": values["Modified ON"] or None,
                "transfer_mrp": _parse_transfer_mrp(
                    cells[column_indexes["Transfer Mrp"]]
                    if column_indexes["Transfer Mrp"] < len(cells)
                    else None,
                    row_number,
                ),
                "_row_number": row_number,
            }
        )

    if not parsed_rows:
        raise LiveC2CImportError("live_c2c_empty_sheet")
    return parsed_rows


def parse_live_c2c_workbook(
    content: bytes,
    sheet_name: str,
    filename: str,
) -> list[dict[str, Any]]:
    extension = _workbook_extension(filename)
    if extension not in SUPPORTED_LIVE_C2C_EXTENSIONS:
        raise LiveC2CImportError("live_c2c_invalid_file_type")
    if extension == ".xlsx":
        try:
            workbook = load_workbook(BytesIO(content), read_only=True, data_only=True)
        except Exception as error:
            raise LiveC2CImportError("live_c2c_invalid_workbook") from error
        try:
            if sheet_name not in workbook.sheetnames:
                raise LiveC2CImportError("live_c2c_missing_sheet")
            return _parse_worksheet_rows(workbook[sheet_name].iter_rows(), xlsb=False)
        finally:
            workbook.close()

    try:
        with open_workbook(BytesIO(content)) as workbook:
            if sheet_name not in workbook.sheets:
                raise LiveC2CImportError("live_c2c_missing_sheet")
            with workbook.get_sheet(sheet_name) as worksheet:
                return _parse_worksheet_rows(worksheet.rows(), xlsb=True)
    except LiveC2CImportError:
        raise
    except Exception as error:
        raise LiveC2CImportError("live_c2c_invalid_workbook") from error


def _number_candidates(number: str) -> tuple[str, ...]:
    if number.isdigit() and not number.startswith("0"):
        return number, f"0{number}"
    return (number,)


def _matching_employee_ids(
    matches: dict[str, set[int]],
    number: str,
) -> set[int]:
    exact_matches = matches.get(number)
    if exact_matches:
        return exact_matches
    return {
        employee_id
        for candidate in _number_candidates(number)[1:]
        for employee_id in matches.get(candidate, set())
    }


def _matching_retailer_records(
    matches: dict[str, list[tuple[int, str | None]]],
    number: str,
) -> list[tuple[int, str | None]]:
    exact_matches = matches.get(number)
    if exact_matches:
        return exact_matches
    return [
        retailer
        for candidate in _number_candidates(number)[1:]
        for retailer in matches.get(candidate, [])
    ]


def _chunks(values: Sequence[Any]) -> Iterable[Sequence[Any]]:
    for start in range(0, len(values), DB_LOOKUP_BATCH_SIZE):
        yield values[start : start + DB_LOOKUP_BATCH_SIZE]


def _is_disabled(value: str | None) -> bool:
    return (value or "").strip().lower() in {"n", "no"}


async def prepare_live_c2c_import(
    db: AsyncSession,
    *,
    house_id: int,
    rows: list[dict[str, Any]],
) -> PreparedLiveC2CImport:
    from_numbers = sorted(
        {
            candidate
            for row in rows
            for candidate in _number_candidates(row["from_number"])
        }
    )
    to_numbers = sorted(
        {
            candidate
            for row in rows
            for candidate in _number_candidates(row["to_number"])
        }
    )

    employee_matches: dict[str, set[int]] = {}
    for number_batch in _chunks(from_numbers):
        result = await db.execute(
            select(Employee.itop_number, Employee.id).where(
                Employee.house_id == house_id,
                Employee.employee_type == "rso",
                Employee.status == "Active",
                Employee.itop_number.in_(number_batch),
            )
        )
        for number, employee_id in result.all():
            employee_matches.setdefault(number, set()).add(employee_id)

    retailer_matches: dict[str, list[tuple[int, str | None]]] = {}
    for number_batch in _chunks(to_numbers):
        result = await db.execute(
            select(Retailer.itop_number, Retailer.id, Retailer.enabled).where(
                Retailer.house_id == house_id,
                Retailer.itop_number.in_(number_batch),
            )
        )
        for number, retailer_id, enabled in result.all():
            retailer_matches.setdefault(number, []).append((retailer_id, enabled))

    resolved_ids: list[tuple[int, int, str | None]] = []
    for row in rows:
        employee_ids = _matching_employee_ids(employee_matches, row["from_number"])
        if not employee_ids:
            raise LiveC2CImportError(
                "live_c2c_employee_not_found",
                row=row["_row_number"],
            )
        if len(employee_ids) > 1:
            raise LiveC2CImportError(
                "live_c2c_employee_ambiguous",
                row=row["_row_number"],
            )

        retailers = {
            retailer_id: enabled
            for retailer_id, enabled in _matching_retailer_records(
                retailer_matches,
                row["to_number"],
            )
        }
        if not retailers:
            raise LiveC2CImportError(
                "live_c2c_retailer_not_found",
                row=row["_row_number"],
            )
        if len(retailers) > 1:
            raise LiveC2CImportError(
                "live_c2c_retailer_ambiguous",
                row=row["_row_number"],
            )

        retailer_id, enabled = next(iter(retailers.items()))
        resolved_ids.append((next(iter(employee_ids)), retailer_id, enabled))

    retailer_ids = sorted({retailer_id for _, retailer_id, _ in resolved_ids})
    route_today_ids: set[int] = set()
    today = now_naive().strftime("%A").lower()
    for retailer_id_batch in _chunks(retailer_ids):
        result = await db.execute(
            select(RetailerRoute.retailer_id, Route.visit_days)
            .join(Route, Route.id == RetailerRoute.route_id)
            .join(Retailer, Retailer.id == RetailerRoute.retailer_id)
            .where(
                RetailerRoute.retailer_id.in_(retailer_id_batch),
                RetailerRoute.status == "active",
                Retailer.house_id == house_id,
                Route.house_id == house_id,
                Route.is_active.is_(True),
                Route.is_deleted.is_(False),
            )
        )
        for retailer_id, visit_days in result.all():
            if today in {str(day).lower() for day in (visit_days or [])}:
                route_today_ids.add(retailer_id)

    prepared_rows = [
        {
            "from_msisdn": employee_id,
            "to_msisdn": retailer_id,
            "modified_on": row["modified_on"],
            "transfer_mrp": row["transfer_mrp"],
            "on_route": "Y" if retailer_id in route_today_ids else "N",
        }
        for row, (employee_id, retailer_id, _) in zip(rows, resolved_ids, strict=True)
    ]
    disabled_retailer_count = len(
        {
            retailer_id
            for _, retailer_id, enabled in resolved_ids
            if _is_disabled(enabled)
        }
    )
    return PreparedLiveC2CImport(
        rows=prepared_rows,
        disabled_retailer_count=disabled_retailer_count,
    )


async def replace_live_c2c_rows(
    db: AsyncSession,
    *,
    house_id: int,
    user: User,
    filename: str | None,
    sheet_name: str,
    rows: list[dict[str, Any]],
    request: Request,
) -> tuple[int, int]:
    try:
        house = await db.scalar(
            select(House.id).where(House.id == house_id).with_for_update()
        )
        if house is None:
            raise LiveC2CImportError("live_c2c_house_not_found")
        prepared = await prepare_live_c2c_import(
            db,
            house_id=house_id,
            rows=rows,
        )
        previous_count = await db.scalar(
            select(func.count(LiveC2CRow.id)).where(
                LiveC2CRow.house_id == house_id,
                LiveC2CRow.is_deleted.is_(False),
            )
        ) or 0
        timestamp = now_naive()
        await db.execute(
            update(LiveC2CRow)
            .where(
                LiveC2CRow.house_id == house_id,
                LiveC2CRow.is_deleted.is_(False),
            )
            .values(
                is_deleted=True,
                deleted_at=timestamp,
                deleted_by=user.id,
                updated_by=user.id,
                updated_at=timestamp,
            )
        )

        source_filename = _safe_filename(filename)
        insert_values = [
            {
                **row,
                "house_id": house_id,
                "created_by": user.id,
                "source_filename": source_filename,
                "source_sheet": sheet_name,
            }
            for row in prepared.rows
        ]
        for batch in _chunks(insert_values):
            await db.execute(insert(LiveC2CRow), batch)

        await log_activity(
            db=db,
            user_id=user.id,
            user_name=user.name,
            module="live_c2c",
            action="import",
            record_identifier=f"house:{house_id}",
            old_values={"active_rows": previous_count},
            new_values={
                "file_name": source_filename,
                "sheet_name": sheet_name,
                "imported_rows": len(prepared.rows),
                "disabled_retailers": prepared.disabled_retailer_count,
            },
            request=request,
            commit=False,
        )
        await db.commit()
        return len(prepared.rows), prepared.disabled_retailer_count
    except Exception:
        await db.rollback()
        raise
