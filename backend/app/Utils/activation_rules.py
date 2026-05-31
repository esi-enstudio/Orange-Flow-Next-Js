from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.Models.product_exclusion import ExcludedProductCode


async def get_excluded_codes(db: AsyncSession) -> set[str]:
    result = await db.execute(select(ExcludedProductCode.product_code))
    return {row[0] for row in result.all()}


def exclude_clause(model, excluded_codes: set[str]):
    codes = list(excluded_codes)
    if codes:
        return ~model.product_code.in_(codes)
    return None


async def get_excluded_count(
    db: AsyncSession,
    model,
    excluded_codes: set[str],
    house_filter=None,
    date_filter=None,
    date_col=None,
):
    if not excluded_codes:
        return 0
    query = select(func.count()).select_from(model)
    query = query.where(model.product_code.in_(list(excluded_codes)))
    if house_filter is not None:
        query = query.where(model.house_id == house_filter)
    if date_filter is not None and date_col is not None:
        query = query.where(date_col == date_filter)
    result = await db.execute(query)
    return result.scalar()
