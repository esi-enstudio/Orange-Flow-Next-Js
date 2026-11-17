"""Excel export formatting and safety tests."""

from datetime import datetime
from io import BytesIO

from openpyxl import load_workbook

from app.services.report_engine.excel import HEADERS, build_report_workbook


def test_workbook_includes_header_warnings_and_formula_safe_rows():
    rows = [
        {
            "label": '=HYPERLINK("http://x")',
            "sublabel": "R001",
            "achievement": 3,
            "target": 5,
            "adjusted_target": 5,
            "percent_applied": None,
            "proration_factor": None,
            "percentage": 60,
            "remaining": 2,
            "status": "needs_attention",
        }
    ]
    content = build_report_workbook(
        meta={
            "metric": "ga_activation",
            "metric_label_en": "GA Activation",
            "group_by": "rso",
            "dimension_label_en": "RSO",
            "date_from": "2026-11-01",
            "date_to": "2026-11-17",
            "target_source": "house",
        },
        rows=rows,
        summary={"achievement": 3, "target": 5},
        warnings=[{"code": "TARGET_MISSING_MONTH", "message": "Target missing", "count": 1}],
        filters_text="{}",
        generated_by="Manager",
        generated_at=datetime(2026, 11, 17, 9, 0),
    )

    sheet = load_workbook(BytesIO(content), read_only=True).active
    data = list(sheet.iter_rows(values_only=True))
    flattened = [value for row in data for value in row if value is not None]

    assert "GA Activation" in flattened
    assert "01 Nov 2026 – 17 Nov 2026" in flattened
    assert any(row[0] == "Warning" and row[1] == "TARGET_MISSING_MONTH" for row in data)
    header_index = next(i for i, row in enumerate(data) if row[:len(HEADERS)] == HEADERS)
    assert len(data) == header_index + 2
    assert data[header_index + 1][0] == '\'=HYPERLINK("http://x")'
