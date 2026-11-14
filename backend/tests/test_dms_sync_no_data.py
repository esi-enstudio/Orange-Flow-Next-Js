from datetime import date
from types import SimpleNamespace

import pandas as pd
import pytest

from app.routers import sync as sync_router
from app.services.Automation import activation_excel, dms_sync_service


class SyncSession:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None


class Closable:
    async def close(self):
        return None


def _house():
    return SimpleNamespace(
        id=3,
        code="RYZBRB01",
        name="M/s Pawary Telecom",
        dms_user="user",
        dms_pass="password",
        dms_house_id="DMS-3",
    )


@pytest.mark.parametrize(
    "message",
    [
        "File is empty.",
        "No data found in file.",
        "Data not found",
        "found no data",
        "Empty workbook returned by DMS",
        "the export file is empty",
    ],
)
def test_no_data_messages_are_recognised(message):
    assert dms_sync_service.is_no_data_error(message)


@pytest.mark.parametrize(
    "message",
    [
        "OTP timeout for house RYZBRB01",
        "Login failed for M/s Pawary Telecom",
        "File is not a zip file",
        "date range not applied",
        None,
        "",
    ],
)
def test_real_errors_are_not_mistaken_for_no_data(message):
    assert not dms_sync_service.is_no_data_error(message)


@pytest.mark.asyncio
async def test_empty_activation_workbook_is_no_data_not_error(tmp_path):
    path = tmp_path / "empty_activation.xlsx"
    pd.DataFrame(columns=["SIM_NO", "RETAILER_CODE", "ACTIVATION_DATE"]).to_excel(
        path, index=False
    )

    count, err = await activation_excel.process_activation_excel(str(path), house_id=3)

    assert count == 0
    assert dms_sync_service.is_no_data_error(err)
    assert dms_sync_service._classify_process_result(count, err) == "no_data"


def test_process_result_classification():
    assert dms_sync_service._classify_process_result(10, None) == "success"
    assert dms_sync_service._classify_process_result(0, None) == "no_data"
    assert dms_sync_service._classify_process_result(0, "No data found in file.") == "no_data"
    assert dms_sync_service._classify_process_result(0, "File is empty.") == "no_data"
    assert dms_sync_service._classify_process_result(0, "OTP timeout") == "error"


@pytest.mark.asyncio
async def test_no_data_range_is_not_reported_as_an_error(monkeypatch):
    messages = []

    async def progress_callback(message):
        messages.append(message)

    async def fake_get_missing_dates(_session, _house_id, _model, _date_column, **_kwargs):
        return [date(2026, 11, 13)]

    async def fake_get_valid_page(_credentials):
        return Closable(), Closable()

    async def fake_download(*_args, **_kwargs):
        return "no_data"

    async def fake_mark_sync_complete(*_args, **_kwargs):
        return None

    monkeypatch.setattr(dms_sync_service, "async_session", SyncSession)
    monkeypatch.setattr(dms_sync_service, "get_missing_dates", fake_get_missing_dates)
    monkeypatch.setattr(dms_sync_service.session_manager, "get_valid_page", fake_get_valid_page)
    monkeypatch.setattr(dms_sync_service, "download_and_process", fake_download)
    monkeypatch.setattr(dms_sync_service, "mark_sync_complete", fake_mark_sync_complete)

    await dms_sync_service.sync_house_modules(
        _house(),
        module_filter=["activation"],
        progress_callback=progress_callback,
    )

    assert (
        "⚠️ Activation (M/s Pawary Telecom (RYZBRB01)): "
        "No Activation data available for 13 Nov 2026"
    ) in messages
    assert not any(": error" in message for message in messages)
    assert not any(message.startswith("✗") for message in messages)


@pytest.mark.asyncio
async def test_no_data_for_multiple_ranges_reports_each_range(monkeypatch):
    messages = []

    async def progress_callback(message):
        messages.append(message)

    async def fake_get_missing_dates(_session, _house_id, _model, _date_column, **_kwargs):
        return [date(2026, 11, 10), date(2026, 11, 11), date(2026, 11, 13)]

    async def fake_get_valid_page(_credentials):
        return Closable(), Closable()

    async def fake_download(*_args, **_kwargs):
        return "no_data"

    async def fake_mark_sync_complete(*_args, **_kwargs):
        return None

    monkeypatch.setattr(dms_sync_service, "async_session", SyncSession)
    monkeypatch.setattr(dms_sync_service, "get_missing_dates", fake_get_missing_dates)
    monkeypatch.setattr(dms_sync_service.session_manager, "get_valid_page", fake_get_valid_page)
    monkeypatch.setattr(dms_sync_service, "download_and_process", fake_download)
    monkeypatch.setattr(dms_sync_service, "mark_sync_complete", fake_mark_sync_complete)

    await dms_sync_service.sync_house_modules(
        _house(),
        module_filter=["activation"],
        progress_callback=progress_callback,
    )

    assert (
        "⚠️ Activation (M/s Pawary Telecom (RYZBRB01)): "
        "No Activation data available for 10 Nov 2026 to 11 Nov 2026"
    ) in messages
    assert (
        "⚠️ Activation (M/s Pawary Telecom (RYZBRB01)): "
        "No Activation data available for 13 Nov 2026"
    ) in messages
    assert not any(": error" in message for message in messages)


@pytest.mark.asyncio
async def test_sync_status_returns_warnings_without_marking_the_job_as_error():
    job_id = "warnings-only-job"
    warning = (
        "⚠️ Activation (M/s Pawary Telecom (RYZBRB01)): "
        "No Activation data available for 13 Nov 2026"
    )
    sync_router._sync_jobs[job_id] = {
        "events": [
            {"msg": "Downloading activation ...", "ts": 0},
            {"msg": warning, "ts": 1},
            {"msg": "Range progress: 1/1 ranges for RYZBRB01 [activation]", "ts": 2},
        ],
        "done": True,
        "error": None,
        "has_work": True,
    }

    response = await sync_router.sync_status(job_id)
    sync_router._sync_jobs.pop(job_id, None)

    assert response["status"] == "complete"
    assert response["warnings"] == [warning]
    assert response["message"] == (
        "Activation (M/s Pawary Telecom (RYZBRB01)): "
        "No Activation data available for 13 Nov 2026"
    )


@pytest.mark.asyncio
async def test_real_range_failure_is_reported_with_a_failure_marker(monkeypatch):
    messages = []

    async def progress_callback(message):
        messages.append(message)

    async def fake_get_missing_dates(_session, _house_id, _model, _date_column, **_kwargs):
        return [date(2026, 11, 13)]

    async def fake_get_valid_page(_credentials):
        return Closable(), Closable()

    async def fake_download(*_args, **_kwargs):
        return "error"

    async def fake_mark_sync_complete(*_args, **_kwargs):
        return None

    monkeypatch.setattr(dms_sync_service, "async_session", SyncSession)
    monkeypatch.setattr(dms_sync_service, "get_missing_dates", fake_get_missing_dates)
    monkeypatch.setattr(dms_sync_service.session_manager, "get_valid_page", fake_get_valid_page)
    monkeypatch.setattr(dms_sync_service, "download_and_process", fake_download)
    monkeypatch.setattr(dms_sync_service, "mark_sync_complete", fake_mark_sync_complete)

    await dms_sync_service.sync_house_modules(
        _house(),
        module_filter=["activation"],
        progress_callback=progress_callback,
    )

    assert "✗ activation (M/s Pawary Telecom (RYZBRB01)): error" in messages
