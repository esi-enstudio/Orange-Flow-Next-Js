"""Excel exports for the finance module (expenses, receipts, cashbook, closing).

Excel is the only export format used by the finance pages: the routers hand in
already-filtered rows and these helpers flatten them into one worksheet per
report so operators can reconcile a period in Excel.

openpyxl is used directly (instead of pandas) so importing the finance router
never drags a heavy dataframe dependency into every worker process.
"""

from io import BytesIO
from typing import Iterable, Mapping

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

EXPENSE_COLUMNS = [
    "ID",
    "BUSINESS_DATE",
    "SOURCE",
    "CATEGORY",
    "EMPLOYEE",
    "DESCRIPTION",
    "AMOUNT",
    "STATUS",
    "REJECTION_REASON",
    "PAYMENT_REFERENCE",
    "NOTES",
    "CREATED_AT",
]

RECEIPT_COLUMNS = [
    "ID",
    "BUSINESS_DATE",
    "RECEIPT_TYPE",
    "SOURCE_NAME",
    "RELATED_PARTY",
    "RELATED_DUE_REFERENCE",
    "AMOUNT",
    "PAYMENT_METHOD",
    "REFERENCE",
    "NOTES",
    "CREATED_AT",
]

CLOSING_COLUMNS = [
    "ID",
    "BUSINESS_DATE",
    "STATUS",
    "OPENING_CASH",
    "CASH_IN",
    "CASH_OUT",
    "EXPECTED_CASH",
    "COUNTED_CASH",
    "DIFFERENCE",
    "NOTES",
    "SUBMITTED_AT",
    "APPROVED_AT",
]

CASHBOOK_COLUMNS = [
    "TRANSACTION_ID",
    "DIRECTION",
    "AMOUNT",
    "SOURCE_TYPE",
    "SOURCE_ID",
    "REFERENCE",
    "DESCRIPTION",
    "REVERSAL_OF",
    "CREATED_AT",
]

HEADER_FILL = PatternFill("solid", fgColor="1E293B")
HEADER_FONT = Font(bold=True, color="FFFFFF")
MONEY_FORMAT = "#,##0.00"


def _iso(value) -> str:
    if value is None:
        return ""
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _number(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _write_workbook(sheets: Mapping[str, tuple[Iterable[dict], list]]) -> bytes:
    workbook = Workbook()
    workbook.remove(workbook.active)

    for sheet_name, (records, columns) in sheets.items():
        worksheet = workbook.create_sheet(title=sheet_name[:31])
        worksheet.append(list(columns))
        for cell in worksheet[1]:
            cell.fill = HEADER_FILL
            cell.font = HEADER_FONT
            cell.alignment = Alignment(horizontal="center", vertical="center")

        rows = list(records)
        for record in rows:
            worksheet.append([record.get(column, "") for column in columns])

        worksheet.freeze_panes = "A2"
        for index, column in enumerate(columns, start=1):
            longest = len(str(column))
            for record in rows:
                longest = max(longest, len(str(record.get(column, "") or "")))
            worksheet.column_dimensions[get_column_letter(index)].width = min(longest + 2, 48)
            if column in {"AMOUNT", "OPENING_CASH", "CASH_IN", "CASH_OUT", "EXPECTED_CASH",
                          "COUNTED_CASH", "DIFFERENCE"}:
                for cell in worksheet[get_column_letter(index)][1:]:
                    cell.number_format = MONEY_FORMAT

    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return buffer.getvalue()


async def export_expenses_excel(rows) -> bytes:
    data = [
        {
            "ID": row.id,
            "BUSINESS_DATE": _iso(row.business_date),
            "SOURCE": row.source,
            "CATEGORY": getattr(row.category, "name", "") or "",
            "EMPLOYEE": getattr(row.employee, "employee_name", "") or "",
            "DESCRIPTION": row.description or "",
            "AMOUNT": _number(row.amount),
            "STATUS": row.status,
            "REJECTION_REASON": row.rejection_reason or "",
            "PAYMENT_REFERENCE": row.payment_reference or "",
            "NOTES": row.notes or "",
            "CREATED_AT": _iso(row.created_at),
        }
        for row in rows
    ]
    return _write_workbook({"Expenses": (data, EXPENSE_COLUMNS)})


async def export_receipts_excel(rows) -> bytes:
    data = [
        {
            "ID": row.id,
            "BUSINESS_DATE": _iso(row.business_date),
            "RECEIPT_TYPE": row.receipt_type or "",
            "SOURCE_NAME": row.source_name or "",
            "RELATED_PARTY": row.related_party or "",
            "RELATED_DUE_REFERENCE": row.related_due_reference or "",
            "AMOUNT": _number(row.amount),
            "PAYMENT_METHOD": row.payment_method,
            "REFERENCE": row.reference or "",
            "NOTES": row.notes or "",
            "CREATED_AT": _iso(row.created_at),
        }
        for row in rows
    ]
    return _write_workbook({"Receipts": (data, RECEIPT_COLUMNS)})


async def export_closings_excel(rows) -> bytes:
    data = [
        {
            "ID": row.id,
            "BUSINESS_DATE": _iso(row.business_date),
            "STATUS": row.status,
            "OPENING_CASH": _number(row.opening_cash),
            "CASH_IN": _number(row.cash_in),
            "CASH_OUT": _number(row.cash_out),
            "EXPECTED_CASH": _number(row.expected_cash),
            "COUNTED_CASH": _number(row.counted_cash),
            "DIFFERENCE": _number(row.difference),
            "NOTES": row.notes or "",
            "SUBMITTED_AT": _iso(row.submitted_at),
            "APPROVED_AT": _iso(row.approved_at),
        }
        for row in rows
    ]
    return _write_workbook({"Daily Closing": (data, CLOSING_COLUMNS)})


async def export_cashbook_excel(book: dict) -> bytes:
    summary = [
        {"METRIC": "Business Date", "VALUE": book.get("business_date")},
        {"METRIC": "Account", "VALUE": (book.get("account") or {}).get("name")},
        {"METRIC": "Opening Cash", "VALUE": _number(book.get("opening_cash"))},
        {"METRIC": "Cash In", "VALUE": _number(book.get("cash_in"))},
        {"METRIC": "Cash Out", "VALUE": _number(book.get("cash_out"))},
        {"METRIC": "Expected Cash", "VALUE": _number(book.get("expected_cash"))},
        {"METRIC": "Counted Cash", "VALUE": book.get("counted_cash")},
        {"METRIC": "Difference", "VALUE": book.get("difference")},
        {"METRIC": "Closing Status", "VALUE": book.get("closing_status") or "open"},
    ]
    transactions = [
        {
            "TRANSACTION_ID": row.get("id"),
            "DIRECTION": row.get("direction"),
            "AMOUNT": _number(row.get("amount")),
            "SOURCE_TYPE": row.get("source_type"),
            "SOURCE_ID": row.get("source_id"),
            "REFERENCE": row.get("reference") or "",
            "DESCRIPTION": row.get("description") or "",
            "REVERSAL_OF": row.get("reversal_of"),
            "CREATED_AT": _iso(row.get("created_at")),
        }
        for row in book.get("transactions") or []
    ]
    return _write_workbook(
        {
            "Summary": (summary, ["METRIC", "VALUE"]),
            "Transactions": (transactions, CASHBOOK_COLUMNS),
        }
    )
