"""PostgreSQL integration check for transactional document numbering.

Set ``DOCUMENTS_TEST_DATABASE_URL`` to a disposable PostgreSQL database whose
name ends in ``_test`` to run this test. It creates and drops an isolated schema.
"""

import os
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.services.document_numbering import allocate_document_number

DATABASE_URL = os.getenv("DOCUMENTS_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(
    not DATABASE_URL,
    reason="Set DOCUMENTS_TEST_DATABASE_URL to run PostgreSQL document-numbering integration tests",
)


async def test_number_allocation_is_atomic_and_rolls_back_with_document_transaction():
    engine = create_async_engine(DATABASE_URL)
    if engine.dialect.name != "postgresql":
        await engine.dispose()
        pytest.skip("DOCUMENTS_TEST_DATABASE_URL must use PostgreSQL")
    schema = f"document_numbering_test_{uuid.uuid4().hex[:12]}"

    try:
        async with engine.connect() as connection:
            database_name = (
                await connection.execute(text("SELECT current_database()"))
            ).scalar_one()
            if not database_name.endswith("_test"):
                pytest.skip("Refusing to run against a database not suffixed with _test")

            await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            await connection.execute(text(f'SET search_path TO "{schema}"'))
            await connection.execute(
                text(
                    "CREATE TABLE document_number_sequences ("
                    "id SERIAL PRIMARY KEY, "
                    "house_id INTEGER NOT NULL, "
                    "document_type_id INTEGER NOT NULL, "
                    "year INTEGER NOT NULL, "
                    "last_number BIGINT NOT NULL DEFAULT 0, "
                    "CONSTRAINT uq_document_number_sequence "
                    "UNIQUE (house_id, document_type_id, year))"
                )
            )
            await connection.commit()

            async with AsyncSession(bind=connection, expire_on_commit=False) as session:
                first = await allocate_document_number(
                    session,
                    house_id=11,
                    document_type_id=7,
                    year=2026,
                    prefix="NOC",
                )
                assert first == "NOC-2026-000001"
                await session.rollback()

                retried = await allocate_document_number(
                    session,
                    house_id=11,
                    document_type_id=7,
                    year=2026,
                    prefix="NOC",
                )
                assert retried == "NOC-2026-000001"
                await session.commit()

                next_number = await allocate_document_number(
                    session,
                    house_id=11,
                    document_type_id=7,
                    year=2026,
                    prefix="NOC",
                )
                assert next_number == "NOC-2026-000002"
                await session.rollback()
    finally:
        async with engine.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        await engine.dispose()
