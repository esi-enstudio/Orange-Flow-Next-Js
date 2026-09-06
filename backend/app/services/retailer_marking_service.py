from typing import Optional, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.retailer import Retailer
from app.models.retailer_marking import RetailerMarking, RetailerMarkingAssignment


async def get_active_retailer_ids_for_markings(
    db: AsyncSession,
    house_id: int,
    marking_names: Sequence[str],
) -> set[int]:
    """Return retailer ids (within a house) that currently hold any of the given
    markings (matched against marking name/code).
    """
    if not marking_names:
        return set()
    query = (
        select(RetailerMarkingAssignment.retailer_id)
        .join(RetailerMarkingAssignment.marking)
        .join(RetailerMarkingAssignment.retailer)
        .where(
            RetailerMarking.name.in_(list(marking_names)),
            RetailerMarkingAssignment.status == "active",
            Retailer.house_id == house_id,
        )
    )
    res = await db.execute(query)
    return {row[0] for row in res.all()}


async def get_active_retailer_ids_for_marking(
    db: AsyncSession,
    house_id: int,
    marking_name: str,
) -> set[int]:
    return await get_active_retailer_ids_for_markings(db, house_id, [marking_name])


async def get_retailer_markings_map(
    db: AsyncSession,
    retailer_ids: Sequence[int],
    only_active: bool = True,
) -> dict[int, list[str]]:
    """Map retailer_id -> list of marking names (de-normalized for display)."""
    if not retailer_ids:
        return {}
    query = (
        select(RetailerMarkingAssignment.retailer_id, RetailerMarking.name)
        .join(RetailerMarkingAssignment.marking)
        .where(RetailerMarkingAssignment.retailer_id.in_(list(retailer_ids)))
        .order_by(RetailerMarking.name)
    )
    if only_active:
        query = query.where(RetailerMarkingAssignment.status == "active")
    res = await db.execute(query)
    result: dict[int, list[str]] = {}
    for rid, name in res.all():
        result.setdefault(rid, []).append(name)
    return result


async def get_active_markings(db: AsyncSession) -> list[RetailerMarking]:
    """All active (non-deleted) markings, ordered by name. Global across houses."""
    res = await db.execute(
        select(RetailerMarking)
        .where(RetailerMarking.status == "active", RetailerMarking.is_deleted == False)  # noqa: E712
        .order_by(RetailerMarking.name)
    )
    return list(res.scalars().all())


async def get_marking_id_by_name(db: AsyncSession, name: str) -> Optional[int]:
    row = (
        await db.execute(
            select(RetailerMarking.id).where(
                RetailerMarking.name == name,
                RetailerMarking.is_deleted == False,  # noqa: E712
            )
        )
    ).scalar_one_or_none()
    return int(row) if row is not None else None