from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.itopup_balance import ITopUpBalance, ITopUpBalanceLedger


async def get_itopup_balance(
    db: AsyncSession,
    house_id: int,
    employee_id: Optional[int],
    for_update: bool = False,
) -> Optional[ITopUpBalance]:
    stmt = select(ITopUpBalance).where(ITopUpBalance.house_id == house_id)
    if employee_id is None:
        stmt = stmt.where(ITopUpBalance.employee_id.is_(None))
    else:
        stmt = stmt.where(ITopUpBalance.employee_id == employee_id)
    if for_update:
        stmt = stmt.with_for_update()
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def apply_itopup_change(
    db: AsyncSession,
    *,
    house_id: int,
    employee_id: Optional[int],
    amount: float,
    movement_type: str,
    reference_type: Optional[str] = None,
    reference_id: Optional[int] = None,
    reason: Optional[str] = None,
    user_id: Optional[int] = None,
) -> ITopUpBalance:
    """Apply a signed monetary change to an iTopUp holder balance and append a ledger entry.

    amount > 0 increases balance, amount < 0 decreases. Raises 400 if it would go negative.
    """
    amount_dec = Decimal(str(amount)).quantize(Decimal("0.01"))
    holder = await get_itopup_balance(db, house_id, employee_id, for_update=True)

    if holder is None:
        if amount_dec < 0:
            raise HTTPException(status_code=400, detail="Insufficient iTopUp balance")
        holder = ITopUpBalance(house_id=house_id, employee_id=employee_id, balance=Decimal("0.00"))
        db.add(holder)
        await db.flush()

    new_balance = Decimal(str(holder.balance)) + amount_dec
    if new_balance < 0:
        raise HTTPException(status_code=400, detail="Insufficient iTopUp balance")
    holder.balance = new_balance

    db.add(ITopUpBalanceLedger(
        house_id=house_id,
        employee_id=employee_id,
        movement_type=movement_type,
        amount=amount_dec,
        balance_after=new_balance,
        reference_type=reference_type,
        reference_id=reference_id,
        reason=reason,
        created_by=user_id,
    ))
    await db.flush()
    return holder
