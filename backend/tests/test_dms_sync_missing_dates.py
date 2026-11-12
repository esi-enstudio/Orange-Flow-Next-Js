from datetime import date
from types import SimpleNamespace

import pytest

from app.models.activation import Activation
from app.routers import sync as sync_router
from app.services.Automation import dms_sync_service


class EmptyResult:
    def all(self):
        return []


class EmptySession:
    async def execute(self, _statement):
        return EmptyResult()


class SyncSession:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None


class NovemberTwelfth(date):
    @classmethod
    def today(cls):
        return cls(2026, 11, 12)


@pytest.mark.asyncio
async def test_manual_gap_check_includes_previous_and_current_month(monkeypatch):
    monkeypatch.setattr(dms_sync_service, "date", NovemberTwelfth)

    missing_dates = await dms_sync_service.get_missing_dates(
        EmptySession(),
        house_id=1,
        model=Activation,
        date_column="activation_date",
        include_previous_month=True,
    )

    assert missing_dates[0] == date(2026, 10, 1)
    assert date(2026, 10, 31) in missing_dates
    assert date(2026, 11, 1) in missing_dates
    assert missing_dates[-1] == date(2026, 11, 11)
    assert len(missing_dates) == 42


@pytest.mark.asyncio
async def test_default_gap_check_stays_within_current_month(monkeypatch):
    monkeypatch.setattr(dms_sync_service, "date", NovemberTwelfth)

    missing_dates = await dms_sync_service.get_missing_dates(
        EmptySession(),
        house_id=1,
        model=Activation,
        date_column="activation_date",
    )

    assert missing_dates[0] == date(2026, 11, 1)
    assert missing_dates[-1] == date(2026, 11, 11)
    assert len(missing_dates) == 11


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("handler_name", "sync_function_name", "background"),
    [
        ("manual_sync_activation", "sync_activation_module", False),
        ("manual_sync_activation", "sync_activation_module", True),
        ("manual_sync_itopup", "sync_itopup_module", False),
        ("manual_sync_itopup", "sync_itopup_module", True),
    ],
)
async def test_manual_sync_endpoints_include_previous_month(
    monkeypatch, handler_name, sync_function_name, background
):
    sync_calls = []
    scheduled = []

    async def fake_sync(house_id=None, progress_callback=None, include_previous_month=False):
        sync_calls.append((house_id, include_previous_month))

    monkeypatch.setattr(sync_router, sync_function_name, fake_sync)
    monkeypatch.setattr(sync_router, "_sync_jobs", {})
    monkeypatch.setattr(sync_router.asyncio, "create_task", scheduled.append)

    handler = getattr(sync_router, handler_name)
    response = await handler(background=background, current_user=object(), house_id=7)
    await scheduled.pop()

    assert response["job_id"] in sync_router._sync_jobs
    assert sync_router._sync_jobs[response["job_id"]]["done"]
    assert sync_calls == [(7, True)]


@pytest.mark.asyncio
async def test_itopup_sync_reports_type_and_range_progress(monkeypatch):
    messages = []
    house = SimpleNamespace(
        id=1,
        code="H001",
        name="Test House",
        dms_user="user",
        dms_pass="password",
        dms_house_id="DMS-1",
    )

    class Closable:
        async def close(self):
            return None

    async def progress_callback(message):
        messages.append(message)

    async def fake_get_missing_dates(_session, _house_id, _model, _date_column, dms_type=None, **_kwargs):
        if dms_type == "C2C":
            return [date(2026, 10, 1), date(2026, 10, 3)]
        return []

    async def fake_get_valid_page(_credentials):
        return Closable(), Closable()

    async def fake_download(*_args, **_kwargs):
        return "success"

    async def fake_mark_sync_complete(*_args, **_kwargs):
        return None

    monkeypatch.setattr(dms_sync_service, "async_session", SyncSession)
    monkeypatch.setattr(dms_sync_service, "get_missing_dates", fake_get_missing_dates)
    monkeypatch.setattr(dms_sync_service.session_manager, "get_valid_page", fake_get_valid_page)
    monkeypatch.setattr(dms_sync_service, "download_and_process", fake_download)
    monkeypatch.setattr(dms_sync_service, "mark_sync_complete", fake_mark_sync_complete)

    await dms_sync_service.sync_house_modules(
        house,
        module_filter=["itopup"],
        progress_callback=progress_callback,
        include_previous_month=True,
    )

    assert any("Checking iTopUp C2C" in message for message in messages)
    assert any("Found 2 missing range(s) for iTopUp C2C" in message for message in messages)
    assert any("No missing dates for iTopUp C2S" in message for message in messages)
    assert any("No missing dates for iTopUp Balance" in message for message in messages)
    assert "Range progress: 0/2 ranges for Test House (H001) [C2C]" in messages
    assert "Range progress: 1/2 ranges for Test House (H001) [C2C]" in messages
    assert "Range progress: 2/2 ranges for Test House (H001) [C2C]" in messages
