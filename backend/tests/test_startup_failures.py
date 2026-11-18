import logging
from pathlib import Path

from app.services import db_service


def test_migration_warning_is_recorded_and_logged_with_traceback(caplog):
    db_service.STARTUP_MIGRATION_WARNINGS.clear()
    with caplog.at_level(logging.ERROR, logger="app.services.db_service"):
        try:
            raise RuntimeError("boom")
        except RuntimeError as error:
            db_service._migration_warning("retailer_filters.tag_id", error)

    assert db_service.STARTUP_MIGRATION_WARNINGS == ["retailer_filters.tag_id: boom"]
    record = next(
        record for record in caplog.records if record.name == "app.services.db_service"
    )
    assert record.levelno == logging.ERROR
    assert record.exc_info is not None


async def test_init_db_marks_a_schema_failure_as_fatal(monkeypatch):
    db_service.STARTUP_FATAL_ERRORS.clear()
    db_service.STARTUP_MIGRATION_WARNINGS.clear()
    monkeypatch.setattr(
        db_service, "engine", _FailingEngine("permission denied for schema public")
    )

    await db_service.init_db()

    assert any(
        "permission denied for schema public" in message
        for message in db_service.STARTUP_FATAL_ERRORS
    )


def test_no_migration_step_still_logs_a_bare_warning():
    source = Path(db_service.__file__).read_text(encoding="utf-8")
    assert 'logger.warning(f"Migration warning' not in source


class _FailingConnection:
    async def __aenter__(self):
        raise RuntimeError("permission denied for schema public")

    async def __aexit__(self, *_args):
        return None


class _FailingEngine:
    def __init__(self, message: str):
        self.message = message

    def begin(self):
        return _FailingConnection()
