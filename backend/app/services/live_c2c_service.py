import re
from dataclasses import dataclass, field
from datetime import date, datetime, time
from decimal import Decimal, InvalidOperation
from io import BytesIO
from pathlib import PurePath
from typing import Any, Iterable, Mapping, Sequence

from fastapi import Request
from openpyxl import load_workbook
from openpyxl.utils.datetime import from_excel
from pyxlsb import convert_date, open_workbook
from sqlalchemy import delete, func, insert, select
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
DB_INSERT_BATCH_SIZE = 5000
MAX_DIAGNOSTIC_VALUES = 200
MAX_DIAGNOSTIC_ROWS = 20
COPY_COLUMNS = (
    "house_id",
    "from_msisdn",
    "to_msisdn",
    "modified_on",
    "on_route",
    "transfer_mrp",
    "source_filename",
    "source_sheet",
    "created_by",
    "created_at",
)
REQUIRED_LIVE_C2C_COLUMNS = (
    "From Msisdn",
    "To Msisdn",
    "Modified ON",
    "Transfer Mrp",
)
# Optional house columns identify each transaction's house. When present,
# only rows matching the selected house are parsed.
HOUSE_CODE_HEADERS = (
    "House Code",
    "Distributor Code",
    "DD Code",
    "DMS Code",
    "House_Code",
)
HOUSE_NAME_HEADERS = (
    "House Name",
    "Distributor Name",
    "House_Name",
    "Parent Profile",
)
HOUSE_GENERIC_HEADERS = ("House", "Distributor")
SUPPORTED_LIVE_C2C_EXTENSIONS = {".xlsx", ".xlsb"}


class LiveC2CImportError(ValueError):
    def __init__(self, code: str, **context: Any):
        super().__init__(code)
        self.code = code
        self.context = context


@dataclass(frozen=True)
class LiveC2CEntityIssue:
    side: str
    value: str
    status: str
    row_count: int
    excel_rows: list[int]
    candidates: list[dict[str, Any]]


@dataclass(frozen=True)
class LiveC2CImportCheck:
    rows: list[dict[str, Any]]
    issues: list[LiveC2CEntityIssue]
    summary: dict[str, int]
    duplicate_excel_rows: list[int]
    disabled_retailer_count: int
    house_mismatch: bool
    matching_house: dict[str, str] | None
    truncated: bool
    can_import: bool


@dataclass
class _LiveC2CRsoTotals:
    c2c_today_route: Decimal = field(default_factory=lambda: Decimal("0"))
    c2c_other_route: Decimal = field(default_factory=lambda: Decimal("0"))
    today_route_trans: int = 0
    other_route_trans: int = 0
    transaction_times: list[time] = field(default_factory=list)


def _normalize_header(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(str(value).strip().lower().split())


def _normalize_house_identifier(value: str | None) -> str:
    return " ".join((value or "").split()).casefold()


def _matches_house_name(value: str, expected_name: str) -> bool:
    normalized_value = _normalize_house_identifier(value)
    normalized_name = _normalize_house_identifier(expected_name)
    return normalized_value == normalized_name or (
        bool(normalized_name)
        and re.fullmatch(
            rf"{re.escape(normalized_name)} \(\d+\)",
            normalized_value,
        )
        is not None
    )


def _cell_value(cell: Any) -> Any:
    if cell is None:
        return None
    return getattr(cell, "value", getattr(cell, "v", None))


def _cell_column_index(cell: Any) -> int:
    column = getattr(cell, "column", None)
    return column - 1 if column is not None else cell.c


def _cell_text(cell: Any) -> str:
    value = _cell_value(cell)
    if value is None:
        return ""
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


def _modified_on_text(cell: Any, *, xlsb: bool, row_number: int) -> str:
    value = _cell_value(cell)
    if value is None:
        return ""
    if (
        xlsb
        and not isinstance(value, bool)
        and isinstance(value, (int, float))
        and 0 <= value <= 2958465
    ):
        value = convert_date(value)
    elif (
        not xlsb
        and not isinstance(value, bool)
        and isinstance(value, (int, float))
        and getattr(cell, "is_date", False)
    ):
        value = from_excel(value)

    if isinstance(value, datetime):
        return value.time().isoformat()
    if isinstance(value, time):
        return value.isoformat()
    if isinstance(value, date):
        return ""

    text = str(value).strip()
    if not text:
        return ""
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).time().isoformat()
    except ValueError:
        try:
            return time.fromisoformat(text).isoformat()
        except ValueError as error:
            raise LiveC2CImportError(
                "live_c2c_invalid_timestamp",
                row=row_number,
            ) from error


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
    house_code: str | None = None,
    house_name: str | None = None,
) -> list[dict[str, Any]]:
    required_headers = {
        _normalize_header(header): header for header in REQUIRED_LIVE_C2C_COLUMNS
    }
    house_code_headers = {_normalize_header(header) for header in HOUSE_CODE_HEADERS}
    house_name_headers = {_normalize_header(header) for header in HOUSE_NAME_HEADERS}
    house_generic_headers = {
        _normalize_header(header) for header in HOUSE_GENERIC_HEADERS
    }
    indexed_rows = enumerate(rows, start=1)
    header_row_number = None
    column_indexes: dict[str, int] = {}
    house_code_indexes: list[int] = []
    house_name_indexes: list[int] = []
    house_generic_indexes: list[int] = []
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
            # Also capture optional house columns from the same header row.
            for cell in cells:
                normalized = _normalize_header(_cell_text(cell))
                if normalized in house_code_headers:
                    house_code_indexes.append(_cell_column_index(cell))
                elif normalized in house_name_headers:
                    house_name_indexes.append(_cell_column_index(cell))
                elif normalized in house_generic_headers:
                    house_generic_indexes.append(_cell_column_index(cell))
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

    house_columns = [
        ("code", index) for index in house_code_indexes
    ] + [
        ("name", index) for index in house_name_indexes
    ] + [
        ("generic", index) for index in house_generic_indexes
    ]
    expected_code = _normalize_house_identifier(house_code)
    expected_name = _normalize_house_identifier(house_name)
    parsed_rows: list[dict[str, Any]] = []
    for row_number, cells in indexed_rows:
        values: dict[str, str] = {}
        for header in REQUIRED_LIVE_C2C_COLUMNS:
            column_index = column_indexes[header]
            cell = cells[column_index] if column_index < len(cells) else None
            values[header] = (
                _modified_on_text(cell, xlsb=xlsb, row_number=row_number)
                if header == "Modified ON"
                else _cell_text(cell)
            )
        if not any(values.values()):
            continue
        if house_columns:
            identifiers = [
                (
                    kind,
                    _cell_text(cells[index] if index < len(cells) else None).strip(),
                )
                for kind, index in house_columns
            ]
            populated_identifiers = [
                (kind, value)
                for kind, value in identifiers
                if value
            ]
            if not populated_identifiers:
                raise LiveC2CImportError(
                    "live_c2c_house_missing",
                    row=row_number,
                )

            if any(
                (
                    kind == "code"
                    and _normalize_house_identifier(value) != expected_code
                )
                or (
                    kind == "name"
                    and not _matches_house_name(value, expected_name)
                )
                or (
                    kind == "generic"
                    and _normalize_house_identifier(value)
                    not in {expected_code, expected_name}
                )
                for kind, value in populated_identifiers
            ):
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
    *,
    house_code: str | None = None,
    house_name: str | None = None,
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
            return _parse_worksheet_rows(
                workbook[sheet_name].iter_rows(),
                xlsb=False,
                house_code=house_code,
                house_name=house_name,
            )
        finally:
            workbook.close()

    try:
        with open_workbook(BytesIO(content)) as workbook:
            if sheet_name not in workbook.sheets:
                raise LiveC2CImportError("live_c2c_missing_sheet")
            with workbook.get_sheet(sheet_name) as worksheet:
                return _parse_worksheet_rows(
                    worksheet.rows(),
                    xlsb=True,
                    house_code=house_code,
                    house_name=house_name,
                )
    except LiveC2CImportError:
        raise
    except Exception as error:
        raise LiveC2CImportError("live_c2c_invalid_workbook") from error


def _number_candidates(number: str) -> tuple[str, ...]:
    if number.isdigit() and not number.startswith("0"):
        return number, f"0{number}"
    return (number,)


def _matching_employee_records(
    matches: dict[str, list[dict[str, Any]]],
    number: str,
) -> list[dict[str, Any]]:
    exact_matches = matches.get(number)
    if exact_matches:
        return exact_matches
    records: list[dict[str, Any]] = []
    seen: set[int] = set()
    for candidate in _number_candidates(number)[1:]:
        for record in matches.get(candidate, []):
            if record["id"] in seen:
                continue
            seen.add(record["id"])
            records.append(record)
    return records


def _matching_retailer_records(
    matches: dict[str, list[dict[str, Any]]],
    number: str,
) -> list[dict[str, Any]]:
    exact_matches = matches.get(number)
    if exact_matches:
        return exact_matches
    records: list[dict[str, Any]] = []
    seen: set[int] = set()
    for candidate in _number_candidates(number)[1:]:
        for record in matches.get(candidate, []):
            if record["id"] in seen:
                continue
            seen.add(record["id"])
            records.append(record)
    return records


def _value_row_numbers(rows: list[dict[str, Any]], key: str) -> dict[str, list[int]]:
    """Group workbook row numbers per distinct value, in workbook order."""
    grouped: dict[str, list[int]] = {}
    for row in rows:
        grouped.setdefault(row[key], []).append(row["_row_number"])
    return grouped


def _chunks(values: Sequence[Any]) -> Iterable[Sequence[Any]]:
    for start in range(0, len(values), DB_LOOKUP_BATCH_SIZE):
        yield values[start : start + DB_LOOKUP_BATCH_SIZE]


async def _find_accessible_matching_house(
    db: AsyncSession,
    *,
    house_ids: Sequence[int],
    selected_house_id: int,
    from_values: dict[str, list[int]],
    to_values: dict[str, list[int]],
    from_numbers: Sequence[str],
    to_numbers: Sequence[str],
) -> dict[str, str] | None:
    other_house_ids = set(house_ids) - {selected_house_id}
    if not other_house_ids:
        return None

    employees_by_house: dict[int, set[str]] = {}
    for number_batch in _chunks(from_numbers):
        result = await db.execute(
            select(Employee.house_id, Employee.itop_number).where(
                Employee.house_id.in_(other_house_ids),
                Employee.employee_type == "rso",
                Employee.status == "Active",
                Employee.itop_number.in_(number_batch),
            )
        )
        for house_id, number in result.all():
            employees_by_house.setdefault(house_id, set()).add(number)

    retailers_by_house: dict[int, set[str]] = {}
    for number_batch in _chunks(to_numbers):
        result = await db.execute(
            select(Retailer.house_id, Retailer.itop_number).where(
                Retailer.house_id.in_(other_house_ids),
                Retailer.itop_number.in_(number_batch),
            )
        )
        for house_id, number in result.all():
            retailers_by_house.setdefault(house_id, set()).add(number)

    def all_numbers_match(
        values: dict[str, list[int]],
        matches_by_house: dict[int, set[str]],
        house_id: int,
    ) -> bool:
        matched_numbers = matches_by_house.get(house_id, set())
        return all(
            any(candidate in matched_numbers for candidate in _number_candidates(number))
            for number in values
        )

    matching_house_ids = [
        house_id
        for house_id in other_house_ids
        if all_numbers_match(from_values, employees_by_house, house_id)
        and all_numbers_match(to_values, retailers_by_house, house_id)
    ]
    if len(matching_house_ids) != 1:
        return None

    result = await db.execute(
        select(House.name, House.code).where(House.id == matching_house_ids[0])
    )
    house = result.one_or_none()
    if house is None:
        return None
    return {"name": house.name, "code": house.code}


def _is_disabled(value: str | None) -> bool:
    return (value or "").strip().lower() in {"n", "no"}


def _build_issue(
    *,
    side: str,
    value: str,
    row_numbers: list[int],
    candidates: list[dict[str, Any]],
) -> LiveC2CEntityIssue:
    return LiveC2CEntityIssue(
        side=side,
        value=value,
        status="not_found" if not candidates else "ambiguous",
        row_count=len(row_numbers),
        excel_rows=row_numbers[:MAX_DIAGNOSTIC_ROWS],
        candidates=candidates,
    )


async def _raw_pg_connection(db: AsyncSession):
    """The raw asyncpg connection when the session runs on PostgreSQL.

    Same helper shape as ``app/services/inventory_service.py``: a Live C2C
    import writes thousands of rows, and one ``COPY`` beats thousands of
    ``INSERT`` statements inside the same transaction.
    """
    connection = await db.connection()
    if connection.dialect.name != "postgresql":
        return None
    return (await connection.get_raw_connection()).driver_connection


async def _bulk_insert_live_c2c_rows(
    db: AsyncSession,
    rows: Sequence[dict[str, Any]],
) -> None:
    if not rows:
        return
    pg = await _raw_pg_connection(db)
    if pg is not None:
        await pg.copy_records_to_table(
            "live_c2c",
            records=[tuple(row[column] for column in COPY_COLUMNS) for row in rows],
            columns=list(COPY_COLUMNS),
        )
        return
    for batch in _chunks_by_size(rows, DB_INSERT_BATCH_SIZE):
        await db.execute(insert(LiveC2CRow), list(batch))


def _chunks_by_size(
    values: Sequence[Any],
    size: int,
) -> Iterable[Sequence[Any]]:
    for start in range(0, len(values), size):
        yield values[start : start + size]


def live_c2c_check_payload(check: LiveC2CImportCheck) -> dict[str, Any]:
    """Serialize a check result for API responses (preview body / error detail)."""
    return {
        "can_import": check.can_import,
        "summary": dict(check.summary),
        "issues": [
            {
                "side": issue.side,
                "value": issue.value,
                "status": issue.status,
                "row_count": issue.row_count,
                "excel_rows": list(issue.excel_rows),
                "candidates": list(issue.candidates),
            }
            for issue in check.issues
        ],
        "duplicate_excel_rows": list(check.duplicate_excel_rows),
        "house_mismatch": check.house_mismatch,
        "matching_house": check.matching_house,
        "truncated": check.truncated,
    }


async def prepare_live_c2c_import(
    db: AsyncSession,
    *,
    house_id: int,
    rows: list[dict[str, Any]],
    accessible_house_ids: Sequence[int] = (),
) -> LiveC2CImportCheck:
    from_values = _value_row_numbers(rows, "from_number")
    to_values = _value_row_numbers(rows, "to_number")
    from_numbers = sorted(
        {
            candidate
            for number in from_values
            for candidate in _number_candidates(number)
        }
    )
    to_numbers = sorted(
        {
            candidate
            for number in to_values
            for candidate in _number_candidates(number)
        }
    )

    employee_matches: dict[str, list[dict[str, Any]]] = {}
    for number_batch in _chunks(from_numbers):
        result = await db.execute(
            select(
                Employee.itop_number,
                Employee.id,
                Employee.employee_name,
                Employee.employee_name_bn,
                Employee.dms_code,
            ).where(
                Employee.house_id == house_id,
                Employee.employee_type == "rso",
                Employee.status == "Active",
                Employee.itop_number.in_(number_batch),
            )
        )
        for number, employee_id, name, name_bn, dms_code in result.all():
            employee_matches.setdefault(number, []).append(
                {
                    "id": employee_id,
                    "name": name,
                    "name_bn": name_bn,
                    "dms_code": dms_code,
                    "itop_number": number,
                }
            )

    retailer_matches: dict[str, list[dict[str, Any]]] = {}
    for number_batch in _chunks(to_numbers):
        result = await db.execute(
            select(
                Retailer.itop_number,
                Retailer.id,
                Retailer.name,
                Retailer.retailer_code,
                Retailer.enabled,
            ).where(
                Retailer.house_id == house_id,
                Retailer.itop_number.in_(number_batch),
            )
        )
        for number, retailer_id, name, retailer_code, enabled in result.all():
            retailer_matches.setdefault(number, []).append(
                {
                    "id": retailer_id,
                    "name": name,
                    "retailer_code": retailer_code,
                    "itop_number": number,
                    "enabled": enabled,
                }
            )

    from_resolved: dict[str, int] = {}
    to_resolved: dict[str, int] = {}
    disabled_retailer_ids: set[int] = set()
    from_issues: list[LiveC2CEntityIssue] = []
    to_issues: list[LiveC2CEntityIssue] = []

    for number, row_numbers in from_values.items():
        candidates = _matching_employee_records(employee_matches, number)
        if len(candidates) == 1:
            from_resolved[number] = candidates[0]["id"]
            continue
        from_issues.append(
            _build_issue(
                side="from",
                value=number,
                row_numbers=row_numbers,
                candidates=candidates,
            )
        )

    for number, row_numbers in to_values.items():
        candidates = _matching_retailer_records(retailer_matches, number)
        if len(candidates) == 1:
            to_resolved[number] = candidates[0]["id"]
            if _is_disabled(candidates[0]["enabled"]):
                disabled_retailer_ids.add(candidates[0]["id"])
            continue
        to_issues.append(
            _build_issue(
                side="to",
                value=number,
                row_numbers=row_numbers,
                candidates=candidates,
            )
        )

    # Workbook order: the first row using a value decides where it is listed.
    from_issues.sort(key=lambda issue: issue.excel_rows[0])
    to_issues.sort(key=lambda issue: issue.excel_rows[0])

    issue_count = len(from_issues) + len(to_issues)
    truncated = (
        len(from_issues) > MAX_DIAGNOSTIC_VALUES
        or len(to_issues) > MAX_DIAGNOSTIC_VALUES
    )
    issues = (
        from_issues[:MAX_DIAGNOSTIC_VALUES] + to_issues[:MAX_DIAGNOSTIC_VALUES]
    )
    affected_rows = sum(
        1
        for row in rows
        if row["from_number"] not in from_resolved
        or row["to_number"] not in to_resolved
    )
    house_mismatch = (
        bool(from_values)
        and bool(to_values)
        and not from_resolved
        and not to_resolved
        and bool(from_issues)
        and bool(to_issues)
        and all(
            issue.status == "not_found"
            for issue in (*from_issues, *to_issues)
        )
    )
    matching_house = None
    if house_mismatch:
        matching_house = await _find_accessible_matching_house(
            db,
            house_ids=accessible_house_ids,
            selected_house_id=house_id,
            from_values=from_values,
            to_values=to_values,
            from_numbers=from_numbers,
            to_numbers=to_numbers,
        )

    can_import = issue_count == 0
    prepared_rows: list[dict[str, Any]] = []
    duplicate_row_numbers: list[int] = []
    if can_import:
        seen_transfers: set[tuple[Any, ...]] = set()
        unique_rows: list[dict[str, Any]] = []
        for row in rows:
            transfer_key = (
                from_resolved[row["from_number"]],
                to_resolved[row["to_number"]],
                row["modified_on"],
                row["transfer_mrp"],
            )
            if transfer_key in seen_transfers:
                duplicate_row_numbers.append(row["_row_number"])
                continue
            seen_transfers.add(transfer_key)
            unique_rows.append(row)

        retailer_ids = sorted(set(to_resolved.values()))
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
                "from_msisdn": from_resolved[row["from_number"]],
                "to_msisdn": to_resolved[row["to_number"]],
                "modified_on": row["modified_on"],
                "transfer_mrp": row["transfer_mrp"],
                "on_route": "Y" if to_resolved[row["to_number"]] in route_today_ids else "N",
            }
            for row in unique_rows
        ]

    disabled_retailer_count = len(disabled_retailer_ids)

    return LiveC2CImportCheck(
        rows=prepared_rows,
        issues=issues,
        summary={
            "total_rows": len(rows),
            "importable_rows": sum(
                1
                for row in rows
                if row["from_number"] in from_resolved
                and row["to_number"] in to_resolved
            ),
            "issue_count": issue_count,
            "affected_rows": affected_rows,
            "duplicate_rows": len(duplicate_row_numbers),
        },
        duplicate_excel_rows=duplicate_row_numbers[:MAX_DIAGNOSTIC_ROWS],
        disabled_retailer_count=disabled_retailer_count,
        house_mismatch=house_mismatch,
        matching_house=matching_house,
        truncated=truncated,
        can_import=can_import,
    )


def build_live_c2c_productivity_report(
    *,
    house_code: str,
    employees: Sequence[Employee],
    targets: Mapping[int, tuple[float, float]],
    rows: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    totals_by_employee = {
        employee.id: _LiveC2CRsoTotals()
        for employee in employees
    }

    for row in rows:
        employee_id = row["from_msisdn"]
        totals = totals_by_employee.get(employee_id)
        if totals is None:
            raise LiveC2CImportError("live_c2c_employee_not_found")

        amount = row["transfer_mrp"]
        if not isinstance(amount, Decimal):
            amount = Decimal(str(amount))

        if row["on_route"] == "Y":
            totals.c2c_today_route += amount
            totals.today_route_trans += 1
        else:
            totals.c2c_other_route += amount
            totals.other_route_trans += 1

        modified_on = row.get("modified_on")
        if modified_on:
            try:
                transaction_time = time.fromisoformat(modified_on).replace(tzinfo=None)
            except ValueError:
                transaction_time = None
            if transaction_time is not None:
                totals.transaction_times.append(transaction_time)

    report: list[dict[str, Any]] = []
    for employee in employees:
        totals = totals_by_employee[employee.id]
        c2c_target, trans_target = targets.get(employee.id, (0.0, 0.0))
        total_c2c = totals.c2c_today_route + totals.c2c_other_route
        total_trans = totals.today_route_trans + totals.other_route_trans
        decimal_c2c_target = Decimal(str(c2c_target))
        decimal_trans_target = Decimal(str(trans_target))
        transaction_times = totals.transaction_times
        start_time = min(transaction_times) if transaction_times else None
        end_time = max(transaction_times) if transaction_times else None
        serving_hours = None
        if start_time is not None and end_time is not None:
            serving_hours = round(
                (end_time.hour * 3600 + end_time.minute * 60 + end_time.second
                 - start_time.hour * 3600 - start_time.minute * 60 - start_time.second)
                / 3600,
                2,
            )

        report.append(
            {
                "employee_id": employee.id,
                "house_code": house_code,
                "dms_code": employee.dms_code,
                "rso_name": employee.employee_name or employee.dms_code or "",
                "rso_itop_number": employee.itop_number,
                "productivity_c2c_tgt": float(decimal_c2c_target),
                "c2c_today_route": float(totals.c2c_today_route),
                "c2c_other_route": float(totals.c2c_other_route),
                "total_c2c": float(total_c2c),
                "c2c_achievement_pct": (
                    round(float(total_c2c / decimal_c2c_target * 100), 2)
                    if decimal_c2c_target > 0
                    else 0.0
                ),
                "c2c_remaining": float(decimal_c2c_target - total_c2c),
                "productivity_trans_tgt": float(decimal_trans_target),
                "today_route_trans": totals.today_route_trans,
                "other_route_trans": totals.other_route_trans,
                "trans_achievement_pct": (
                    round(float(Decimal(total_trans) / decimal_trans_target * 100), 2)
                    if decimal_trans_target > 0
                    else 0.0
                ),
                "trans_remaining": float(decimal_trans_target - total_trans),
                "start_time": start_time.isoformat(timespec="seconds") if start_time else None,
                "end_time": end_time.isoformat(timespec="seconds") if end_time else None,
                "serving_hours": serving_hours,
            }
        )

    return report


async def replace_live_c2c_rows(
    db: AsyncSession,
    *,
    house_id: int,
    user: User,
    filename: str | None,
    sheet_name: str,
    rows: list[dict[str, Any]],
    request: Request,
) -> LiveC2CImportCheck:
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
        if not prepared.can_import:
            raise LiveC2CImportError(
                "live_c2c_entity_mismatch",
                diagnostics=live_c2c_check_payload(prepared),
            )
        previous_count = await db.scalar(
            select(func.count(LiveC2CRow.id)).where(LiveC2CRow.house_id == house_id)
        ) or 0
        await db.execute(delete(LiveC2CRow).where(LiveC2CRow.house_id == house_id))

        source_filename = _safe_filename(filename)
        insert_values = [
            {
                **row,
                "house_id": house_id,
                "created_by": user.id,
                "created_at": now_naive(),
                "source_filename": source_filename,
                "source_sheet": sheet_name,
            }
            for row in prepared.rows
        ]
        await _bulk_insert_live_c2c_rows(db, insert_values)

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
                "duplicate_rows": prepared.summary["duplicate_rows"],
                "disabled_retailers": prepared.disabled_retailer_count,
            },
            request=request,
            commit=False,
        )
        await db.commit()
        return prepared
    except Exception:
        await db.rollback()
        raise
