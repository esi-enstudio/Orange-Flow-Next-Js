"""Legacy databases must gain the Live C2C delivery-destination column on boot.

Alembic is not part of the container boot path; only ``init_db`` runs schema
steps. The ORM already selects this column, so a missing column makes the
scheduler fail on every iteration until the boot migration adds it.
"""
import pytest
from sqlalchemy import inspect, text

from app.services import db_service
from conftest import test_engine


def _column_names(connection, table: str) -> set[str]:
    return {column["name"] for column in inspect(connection).get_columns(table)}


async def _make_legacy_schema() -> None:
    """A database created before the delivery-destination snapshot existed."""
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


@pytest.fixture
async def restore_live_c2c_tables():
    """The shared SQLite connection outlives this test; let conftest rebuild both tables."""
    yield
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
