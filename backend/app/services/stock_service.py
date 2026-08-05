from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.stock import StockItem, StockLedger
from app.models.user import User
from app.utils.access_control import is_admin_user

LOCATION_WAREHOUSE = "warehouse"
LOCATION_RSO = "rso"


def user_house_ids(user: User) -> list[int]:
    return [h.id for h in user.houses]


async def ensure_house_access(user: User, house_id: int):
    """Raises 403 if a non-admin user does not belong to the given house."""
    if is_admin_user(user):
        return house_id
    if house_id not in user_house_ids(user):
        raise HTTPException(status_code=403, detail="You do not have access to this house")
    return house_id


async def get_stock_item(
    db: AsyncSession,
    house_id: int,
    product_id: int,
    location_type: str,
    employee_id: Optional[int],
    for_update: bool = False,
) -> Optional[StockItem]:
    stmt = (
        select(StockItem)
        .where(
            StockItem.house_id == house_id,
            StockItem.product_id == product_id,
            StockItem.location_type == location_type,
            StockItem.is_deleted == False,
        )
    )
    if employee_id is None:
        stmt = stmt.where(StockItem.employee_id.is_(None))
    else:
        stmt = stmt.where(StockItem.employee_id == employee_id)
    if for_update:
        stmt = stmt.with_for_update()
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def apply_stock_change(
    db: AsyncSession,
    *,
    house_id: int,
    product_id: int,
    location_type: str,
    employee_id: Optional[int],
    delta: int,
    movement_type: str,
    reference_type: Optional[str] = None,
    reference_id: Optional[int] = None,
    reason: Optional[str] = None,
    user_id: Optional[int] = None,
) -> StockItem:
    """Apply a signed quantity change to a stock location and append a ledger entry.

    delta > 0 increases stock, delta < 0 decreases. Raises 400 if it would go negative.
    """
    if location_type == LOCATION_RSO and not employee_id:
        raise HTTPException(status_code=422, detail="employee_id is required for RSO stock")

    item = await get_stock_item(db, house_id, product_id, location_type, employee_id, for_update=True)

    if item is None:
        if delta < 0:
            raise HTTPException(status_code=400, detail="Insufficient stock")
        item = StockItem(
            house_id=house_id,
            product_id=product_id,
            location_type=location_type,
            employee_id=employee_id,
            quantity=0,
        )
        db.add(item)
        await db.flush()

    new_qty = item.quantity + delta
    if new_qty < 0:
        raise HTTPException(status_code=400, detail="Insufficient stock")
    item.quantity = new_qty

    db.add(StockLedger(
        house_id=house_id,
        product_id=product_id,
        location_type=location_type,
        employee_id=employee_id,
        movement_type=movement_type,
        quantity=delta,
        balance_after=new_qty,
        reference_type=reference_type,
        reference_id=reference_id,
        reason=reason,
        created_by=user_id,
    ))
    await db.flush()
    return item
