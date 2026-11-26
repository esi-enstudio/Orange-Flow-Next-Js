"""Legacy databases must gain every ORM-selected column added outside Alembic on boot.

Alembic is not part of the container boot path; only ``init_db`` runs schema
steps. The ORM already selects these columns, so a missing column breaks the
Live C2C scheduler, OAuth endpoints or even login until the boot step adds it.
"""
import pytest
from sqlalchemy import inspect, text

from app.services import db_service
from conftest import test_engine


def _column_names(connection, table: str) -> set[str]:
    return {column["name"] for column in inspect(connection).get_columns(table)}


async def _make_legacy_schema() -> None:
    """A database created before the Live C2C column additions existed."""
    async with test_engine.begin() as connection:
        await connection.execute(text("DROP TABLE IF EXISTS live_c2c_inbound_files"))
        await connection.execute(text(
            "CREATE TABLE live_c2c_inbound_files ("
            "id INTEGER PRIMARY KEY, config_id INTEGER, filename VARCHAR(255))"
        ))
        await connection.execute(text("DROP TABLE IF EXISTS live_c2c_automation_configs"))
        await connection.execute(text(
            "CREATE TABLE live_c2c_automation_configs ("
            "id INTEGER PRIMARY KEY, destination_group_jid VARCHAR(128))"
        ))
        await connection.execute(text(
            "INSERT INTO live_c2c_automation_configs (id, destination_group_jid) "
            "VALUES (7, 'dest@g.us')"
        ))
        await connection.execute(text(
            "INSERT INTO live_c2c_inbound_files (id, config_id, filename) "
            "VALUES (1, 7, 'report.xlsx')"
        ))


async def _make_schema_with_existing_destination_column() -> None:
    """A partially migrated database: column present, backfill never ran."""
    async with test_engine.begin() as connection:
        await connection.execute(text("DROP TABLE IF EXISTS live_c2c_inbound_files"))
        await connection.execute(text(
            "CREATE TABLE live_c2c_inbound_files ("
            "id INTEGER PRIMARY KEY, config_id INTEGER, filename VARCHAR(255), "
            "destination_group_jid VARCHAR(128))"
        ))
        await connection.execute(text("DROP TABLE IF EXISTS live_c2c_automation_configs"))
        await connection.execute(text(
            "CREATE TABLE live_c2c_automation_configs ("
            "id INTEGER PRIMARY KEY, destination_group_jid VARCHAR(128))"
        ))
        await connection.execute(text(
            "INSERT INTO live_c2c_automation_configs (id, destination_group_jid) "
            "VALUES (7, 'dest@g.us')"
        ))
        await connection.execute(text(
            "INSERT INTO live_c2c_inbound_files "
            "(id, config_id, filename, destination_group_jid) "
            "VALUES (1, 7, 'report.xlsx', NULL), (2, 7, 'kept.xlsx', 'keep@g.us')"
        ))


@pytest.fixture
async def restore_live_c2c_tables():
    """The shared SQLite connection outlives this test; let conftest rebuild both tables."""
    db_service.STARTUP_FATAL_ERRORS.clear()
    yield
    assert db_service.STARTUP_FATAL_ERRORS == []
    async with test_engine.begin() as connection:
        await connection.execute(text("DROP TABLE IF EXISTS live_c2c_inbound_files"))
        await connection.execute(text("DROP TABLE IF EXISTS live_c2c_automation_configs"))


@pytest.mark.asyncio
async def test_boot_migration_adds_missing_destination_group_jid_and_backfills(
    restore_live_c2c_tables,
):
    await _make_legacy_schema()

    await db_service._migrate_live_c2c_inbound_files_destination(db_engine=test_engine)

    async with test_engine.begin() as connection:
        columns = await connection.run_sync(_column_names, "live_c2c_inbound_files")
        assert "destination_group_jid" in columns
        destination = await connection.scalar(
            text("SELECT destination_group_jid FROM live_c2c_inbound_files WHERE id = 1")
        )
        assert destination == "dest@g.us"


@pytest.mark.asyncio
async def test_boot_migration_backfills_existing_column_with_null_rows(
    restore_live_c2c_tables,
):
    await _make_schema_with_existing_destination_column()

    await db_service._migrate_live_c2c_inbound_files_destination(db_engine=test_engine)

    async with test_engine.begin() as connection:
        destinations = await connection.execute(
            text(
                "SELECT id, destination_group_jid FROM live_c2c_inbound_files "
                "ORDER BY id"
            )
        )
        assert destinations.all() == [(1, "dest@g.us"), (2, "keep@g.us")]


@pytest.mark.asyncio
async def test_boot_migration_adds_missing_oauth_return_path(restore_live_c2c_tables):
    await _make_legacy_schema()

    await db_service._migrate_live_c2c_oauth_return_path(db_engine=test_engine)

    async with test_engine.begin() as connection:
        columns = await connection.run_sync(_column_names, "live_c2c_automation_configs")
        assert "oauth_return_path" in columns


@pytest.mark.asyncio
async def test_boot_migrations_are_idempotent_on_repeated_starts(restore_live_c2c_tables):
    await _make_legacy_schema()

    for _ in range(2):
        await db_service._migrate_live_c2c_inbound_files_destination(db_engine=test_engine)
        await db_service._migrate_live_c2c_oauth_return_path(db_engine=test_engine)

    async with test_engine.begin() as connection:
        inbound_columns = await connection.run_sync(
            _column_names, "live_c2c_inbound_files"
        )
        config_columns = await connection.run_sync(
            _column_names, "live_c2c_automation_configs"
        )
        assert "destination_group_jid" in inbound_columns
        assert "oauth_return_path" in config_columns


@pytest.mark.asyncio
async def test_boot_applied_revision_can_be_reapplied_by_alembic(restore_live_c2c_tables):
    """The boot path does not stamp alembic_version, so `upgrade head` may rerun it."""
    await _make_legacy_schema()

    async with test_engine.begin() as connection:
        for _ in range(2):
            await connection.run_sync(
                lambda sync_conn: db_service._apply_alembic_revision(
                    "e1f2a3b4c5d6_snapshot_live_c2c_delivery_destination.py",
                    "live_c2c_destination_migration",
                    sync_conn,
                )
            )
        destination = await connection.scalar(
            text("SELECT destination_group_jid FROM live_c2c_inbound_files WHERE id = 1")
        )
        assert destination == "dest@g.us"


class _DummyConnection:
    async def run_sync(self, fn, *args, **kwargs):
        return None


class _AsyncContext:
    def __init__(self, value):
        self.value = value

    async def __aenter__(self):
        return self.value

    async def __aexit__(self, *args):
        return False


class _DummyEngine:
    def begin(self):
        return _AsyncContext(_DummyConnection())


class _RecordingPostgresConnection:
    def __init__(self):
        self.statements: list[tuple[str, object]] = []
        self.sync_connection = type(
            "SyncConnection",
            (),
            {"dialect": type("Dialect", (), {"name": "postgresql"})()},
        )()

    async def execute(self, statement, params=None):
        self.statements.append((str(statement), params))

    async def run_sync(self, fn, *args, **kwargs):
        return fn(self.sync_connection, *args, **kwargs)


class _RecordingEngine:
    def __init__(self, connection):
        self.connection = connection

    def begin(self):
        return _AsyncContext(self.connection)


class _DummySession:
    async def commit(self):
        return None


async def _async_noop(*args, **kwargs):
    return None


async def _async_noop_zero(*args, **kwargs):
    return 0


@pytest.mark.asyncio
async def test_boot_migration_dispatches_selected_house_revision(monkeypatch):
    applied: list[str] = []

    def fake_apply(filename, module_name, connection):
        applied.append(filename)

    monkeypatch.setattr(db_service, "_apply_alembic_revision", fake_apply)
    connection = _RecordingPostgresConnection()
    db_service.STARTUP_FATAL_ERRORS.clear()

    await db_service._migrate_users_selected_house_id(
        db_engine=_RecordingEngine(connection)
    )

    assert applied == ["b6c7d8e9f0a1_add_selected_house_id_to_users.py"]
    assert db_service.STARTUP_FATAL_ERRORS == []


@pytest.fixture
async def restore_users_tables():
    """The shared SQLite connection outlives this test; let conftest rebuild users."""
    yield
    async with test_engine.begin() as connection:
        await connection.execute(text("DROP TABLE IF EXISTS users"))
        await connection.execute(text("DROP TABLE IF EXISTS houses"))


async def _make_legacy_users_schema() -> None:
    """A partially migrated database: column present, index/FK never created."""
    async with test_engine.begin() as connection:
        await connection.execute(text("DROP TABLE IF EXISTS users"))
        await connection.execute(text("DROP TABLE IF EXISTS houses"))
        await connection.execute(text("CREATE TABLE houses (id INTEGER PRIMARY KEY)"))
        await connection.execute(text(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, selected_house_id INTEGER)"
        ))


async def _users_index_and_fk_names() -> tuple[list[str], list[str]]:
    async with test_engine.begin() as connection:
        indexes = await connection.run_sync(
            lambda sync_conn: [i["name"] for i in inspect(sync_conn).get_indexes("users")]
        )
        foreign_keys = await connection.run_sync(
            lambda sync_conn: [
                fk["name"] for fk in inspect(sync_conn).get_foreign_keys("users")
            ]
        )
    return indexes, foreign_keys


@pytest.mark.asyncio
async def test_revision_repairs_missing_index_and_fk_when_column_exists(
    restore_users_tables,
):
    await _make_legacy_users_schema()

    async with test_engine.begin() as connection:
        for _ in range(2):
            await connection.run_sync(
                lambda sync_conn: db_service._apply_alembic_revision(
                    "b6c7d8e9f0a1_add_selected_house_id_to_users.py",
                    "users_selected_house_id_migration",
                    sync_conn,
                )
            )

    indexes, foreign_keys = await _users_index_and_fk_names()
    assert "ix_users_selected_house_id" in indexes
    assert "users_selected_house_id_fkey" in foreign_keys


@pytest.mark.asyncio
async def test_boot_wrapper_repairs_users_index_and_fk(restore_users_tables):
    await _make_legacy_users_schema()

    await db_service._migrate_users_selected_house_id(db_engine=test_engine)

    indexes, foreign_keys = await _users_index_and_fk_names()
    assert "ix_users_selected_house_id" in indexes
    assert "users_selected_house_id_fkey" in foreign_keys
    assert db_service.STARTUP_FATAL_ERRORS == []


@pytest.mark.asyncio
async def test_boot_migration_serializes_concurrent_postgres_starts(monkeypatch):
    monkeypatch.setattr(db_service, "_apply_alembic_revision", lambda *args: None)
    connection = _RecordingPostgresConnection()
    db_service.STARTUP_FATAL_ERRORS.clear()

    await db_service._migrate_live_c2c_inbound_files_destination(
        db_engine=_RecordingEngine(connection)
    )

    assert any("pg_advisory_xact_lock" in sql for sql, _ in connection.statements)
    assert any(
        params == {"key": db_service._BOOT_COLUMN_LOCK_KEY}
        for _, params in connection.statements
    )
    assert db_service.STARTUP_FATAL_ERRORS == []


@pytest.mark.asyncio
async def test_init_db_registers_all_boot_column_steps(monkeypatch):
    calls: list[str] = []

    for name in dir(db_service):
        if name.startswith(("_migrate_", "_drop_", "_sync_")) and callable(
            getattr(db_service, name)
        ):
            async def spy(*args, _name=name, **kwargs):
                calls.append(_name)

            monkeypatch.setattr(db_service, name, spy)

    monkeypatch.setattr(db_service, "engine", _DummyEngine())
    monkeypatch.setattr(db_service, "async_session", lambda: _AsyncContext(_DummySession()))

    from app.services import employee_documents, house_documents, permission_sync
    from app.services import database_backup_service

    monkeypatch.setattr(employee_documents, "ensure_storage_dirs", lambda: None)
    monkeypatch.setattr(employee_documents, "cleanup_stale_staging_files", lambda: None)
    monkeypatch.setattr(house_documents, "ensure_storage_dir", lambda: None)
    monkeypatch.setattr(permission_sync, "sync_permissions_from_config", _async_noop)
    monkeypatch.setattr(database_backup_service, "reconcile_running_backups", _async_noop_zero)

    db_service.STARTUP_FATAL_ERRORS.clear()
    await db_service.init_db()

    assert "_migrate_live_c2c_inbound_files_destination" in calls
    assert "_migrate_live_c2c_oauth_return_path" in calls
    assert "_migrate_users_selected_house_id" in calls
    assert db_service.STARTUP_FATAL_ERRORS == []
