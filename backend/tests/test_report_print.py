"""Print layout for the report pages.

The Print button on /reports/active-lso, /reports/active-sso, /reports/activations
and /reports/recharge prints the report in the WhatsApp delivery layout: the
backend renders the report with its image builder (one PNG per A4 page) and
returns an HTML document with those pages inlined, one per sheet, which starts
the browser's print dialog. The render must also honour the page's own period
(date range for the Active LSO/SSO reports, month for Activation/Recharge)
instead of always printing the current month.
"""
from datetime import date
from io import BytesIO

import pytest
from PIL import Image

from app.services import report_builders, report_print_html
from app.services.whatsapp_schedule_service import get_report_image


def _png(width: int, height: int) -> bytes:
    buf = BytesIO()
    Image.new("RGB", (width, height), "white").save(buf, format="PNG")
    return buf.getvalue()


def _pages(*sizes: tuple[int, int]) -> list[bytes]:
    return [_png(w, h) for w, h in sizes]


# ── print document ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_document_inlines_every_page_once_and_prints_it(monkeypatch):
    seen = {}

    async def fake_get_report_image(db, report_type, house_id, *, period=None):
        seen.update(report_type=report_type, house_id=house_id, period=period)
        return _pages((1400, 1000), (1400, 900))

    monkeypatch.setattr(report_print_html, "get_report_image", fake_get_report_image)

    period = {"start_date": date(2026, 10, 1), "end_date": date(2026, 10, 31)}
    document = await report_print_html.render_report_print_html(
        None, "active_lso", 7, period=period,
    )

    assert seen == {"report_type": "active_lso", "house_id": 7, "period": period}
    assert document.count('class="page"') == 2
    assert document.count("data:image/png;base64,") == 2
    # Wide pages print as landscape sheets, one page image per sheet.
    assert "@page { size: A4 landscape; margin: 0; }" in document
    assert "break-before: page" in document
    assert "window.print()" in document
    assert "<title>Active LSO Report</title>" in document


@pytest.mark.asyncio
async def test_single_image_report_prints_one_portrait_page(monkeypatch):
    async def fake_get_report_image(db, report_type, house_id, *, period=None):
        return _png(1000, 1400)  # the Activation report renders one tall PNG

    monkeypatch.setattr(report_print_html, "get_report_image", fake_get_report_image)
    document = await report_print_html.render_report_print_html(None, "activation", 1)

    assert document.count('class="page"') == 1
    assert "@page { size: A4 portrait; margin: 0; }" in document


# ── period plumbing ───────────────────────────────────────────────

@pytest.fixture
def fake_builders(monkeypatch):
    """Swap a report type's builders for stubs that record their kwargs."""
    calls: dict = {}

    def install(report_type: str, *, period_kind: str):
        if period_kind == "date":
            async def builder(db, house_id, scale=None, *, start_date=None, end_date=None):
                calls.update(start_date=start_date, end_date=end_date)
                return b"png"
        else:
            async def builder(db, house_id, scale=None, *, month=None, year=None):
                calls.update(month=month, year=year)
                return b"png"

        monkeypatch.setitem(report_builders.REPORT_BUILDERS, report_type, builder)
        monkeypatch.setitem(report_builders.SCALE_AWARE_BUILDERS, report_type, builder)
        return calls

    return install


@pytest.mark.asyncio
async def test_date_range_report_passes_its_period_to_the_builder(fake_builders):
    calls = fake_builders("active_lso", period_kind="date")
    period = {"start_date": date(2026, 9, 1), "end_date": date(2026, 9, 30)}

    await get_report_image(None, "active_lso", 987001, period=period)

    assert calls == period


@pytest.mark.asyncio
async def test_month_report_passes_its_month_to_the_builder(fake_builders):
    calls = fake_builders("recharge", period_kind="month")

    await get_report_image(None, "recharge", 987002, period={"month": 8, "year": 2025})

    assert calls == {"month": 8, "year": 2025}


@pytest.mark.asyncio
async def test_period_aware_types_are_registered():
    for report_type in ("active_lso", "active_sso"):
        assert report_type in report_builders.DATE_PERIOD_BUILDERS
    for report_type in ("activation", "recharge", "recharge_ev_secondary"):
        assert report_type in report_builders.MONTH_PERIOD_BUILDERS


@pytest.mark.asyncio
async def test_a_period_never_leaks_into_a_non_period_report(fake_builders, monkeypatch):
    calls: dict = {}

    async def builder(db, house_id):
        calls["called"] = True
        return b"png"

    monkeypatch.setitem(report_builders.REPORT_BUILDERS, "ga_live", builder)
    await get_report_image(None, "ga_live", 987003, period={"month": 8, "year": 2025})

    assert calls == {"called": True}
