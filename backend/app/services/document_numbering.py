"""PostgreSQL-backed transactional document number allocation."""

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.documents import DocumentNumberSequence


def _sequence_upsert_statement(house_id: int, document_type_id: int, year: int):
    return (
        insert(DocumentNumberSequence)
        .values(
            house_id=house_id,
            document_type_id=document_type_id,
            year=year,
            last_number=1,
        )
        .on_conflict_do_update(
            index_elements=[
                DocumentNumberSequence.house_id,
                DocumentNumberSequence.document_type_id,
                DocumentNumberSequence.year,
            ],
            set_={
                "last_number": DocumentNumberSequence.last_number + 1,
            },
        )
        .returning(DocumentNumberSequence.last_number)
    )


async def allocate_document_number(
    db: AsyncSession,
    *,
    house_id: int,
    document_type_id: int,
    year: int,
    prefix: str,
) -> str:
    """Reserve a number without committing the caller's transaction.

    The sequence update must share the generated-document transaction. If that
    transaction rolls back, the reservation rolls back with it.
    """
    if db.get_bind().dialect.name != "postgresql":
        raise RuntimeError("Document number allocation requires PostgreSQL")
    if not prefix or not prefix.strip():
        raise ValueError("Document number prefix is required")
    if year < 1:
        raise ValueError("Document number year must be positive")

    result = await db.execute(
        _sequence_upsert_statement(house_id, document_type_id, year)
    )
    sequence = result.scalar_one()
    return f"{prefix.strip()}-{year}-{sequence:06d}"
