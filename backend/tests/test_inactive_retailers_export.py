"""Excel download of the whole house's inactive retailers, grouped RSO by RSO.

Both report pages offer a Download button that fetches
``/reports/active-lso/retailers/export`` / ``/reports/active-sso/retailers/export``.
The workbook it returns must group the list by RSO: every group opens with a
header row carrying that RSO's name, DMS code and iTopUp number, followed by the
column headers and its retailers, and one blank row separates one group from the
next.
"""
import io
from datetime import date

import pytest

# Excel rendering (openpyxl) and the reports router's import chain (pandas) are
# deployment dependencies; skip rather than fail a dev box that lacks them.
openpyxl = pytest.importorskip("openpyxl")
reports = pytest.importorskip("app.routers.reports")

GROUPS = [
    {
        "rso_name": "Jasim Uddin",
        "dms_code": "R642686",
        "itop_number": "1915700001",
        "supervisor_name": "Sup One",
        "retailers": [
            {
                "house_code": "H1", "retailer_code": "R1", "name": "Ret One",
                "itop_number": "1700001", "days_sold": 1, "sales_amount": 100.0,
                "required_sales_amount": 500.0, "required_selling_days": 7,
                "activations_done": 1, "required_activations": 3,
                "inactive_last_month": "Y",
            },
            {
                "house_code": "H1", "retailer_code": "R2", "name": "Ret Two",
                "itop_number": "1700002", "days_sold": 2, "sales_amount": 200.0,
                "required_sales_amount": 500.0, "required_selling_days": 7,
                "activations_done": 2, "required_activations": 3,
                "inactive_last_month": "",
            },
        ],
    },
    {
        "rso_name": "Karim Ali",
        "dms_code": "R111111",
        "itop_number": "1915700002",
        "supervisor_name": "Sup Two",
        "retailers": [
            {
                "house_code": "H1", "retailer_code": "R3", "name": "Ret Three",
                "itop_number": "1700003", "days_sold": 0, "sales_amount": 0.0,
                "required_sales_amount": 500.0, "required_selling_days": 7,
                "activations_done": 0, "required_activations": 3,
                "inactive_last_month": "Y",
            },
        ],
    },
]


class _FakeService:
    """Stands in for the report services: only the grouped list is needed."""

    def __init__(self, *args, **kwargs):
        pass

    async def get_all_inactive_retailers_grouped(self):
        return GROUPS


async def _download(endpoint):
    response = await endpoint(
        start_date=date(2026, 10, 1),
        end_date=date(2026, 10, 31),
        house_id=1,
        db=None,
        current_user=None,
        house_ctx=1,
    )
    body = b"".join([chunk async for chunk in response.body_iterator])
    return openpyxl.load_workbook(io.BytesIO(body)).active


def _row(ws, row: int) -> list:
    return [ws.cell(row=row, column=col).value for col in range(1, ws.max_column + 1)]


@pytest.fixture
def endpoints(monkeypatch):
    """Both export endpoints, with the DB-backed service swapped for a stub."""
    monkeypatch.setattr(reports, "ActiveLsoReportService", _FakeService)
    monkeypatch.setattr(reports, "ActiveSsoReportService", _FakeService)

    async def _scope(*args, **kwargs):
        return 1, None, None, None

    monkeypatch.setattr(reports, "_resolve_active_lso_scope", _scope)
    # The period is passed explicitly, so the period resolvers keep the dates.
    return [reports.export_inactive_retailers, reports.export_inactive_sso_retailers]


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint_index", [0, 1])
async def test_groups_open_with_the_rso_header_and_a_blank_row_between(endpoints, endpoint_index):
    ws = await _download(endpoints[endpoint_index])

    first_header = _row(ws, 1)[0]
    assert "RSO: Jasim Uddin" in first_header
    assert "R642686" in first_header
    assert "1915700001" in first_header
    # the group's own column headers sit right below its header row
    assert _row(ws, 2)[1] == "Retailer Code"
    assert [ws.cell(row=r, column=2).value for r in (3, 4)] == ["R1", "R2"]

    # exactly one empty row, then the next RSO's group
    assert all(v is None for v in _row(ws, 5))
    second_header = _row(ws, 6)[0]
    assert "RSO: Karim Ali" in second_header
    assert "R111111" in second_header
    assert "1915700002" in second_header
    assert _row(ws, 7)[1] == "Retailer Code"
    assert ws.cell(row=8, column=2).value == "R3"


@pytest.mark.asyncio
async def test_lso_rows_keep_the_modal_columns(endpoints):
    ws = await _download(endpoints[0])
    assert [ws.cell(row=2, column=c).value for c in range(1, ws.max_column + 1)] == [
        "House", "Retailer Code", "Retailer Name", "iTopUp No",
        "Days Sold", "Sales (BDT)", "Req Days", "Req Sales (BDT)",
        "Prev Month Inactive",
    ]
    assert [ws.cell(row=3, column=c).value for c in (5, 6, 7, 8)] == [1, 100, "6/7", "400/500"]


@pytest.mark.asyncio
async def test_sso_rows_keep_the_modal_columns(endpoints):
    ws = await _download(endpoints[1])
    assert [ws.cell(row=2, column=c).value for c in range(1, ws.max_column + 1)] == [
        "House", "Retailer Code", "Retailer Name", "iTopUp No",
        "Activations Done", "Req. Activations", "Prev Month Inactive",
    ]
