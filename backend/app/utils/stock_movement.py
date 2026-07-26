from sqlalchemy.ext.asyncio import AsyncSession
from app.models.stock_movement import StockMovement


async def log_stock_movement(
    db: AsyncSession,
    product_id: int,
    quantity_change: int,
    before_qty: int,
    movement_type: str,
    house_id: int = None,
    employee_id: int = None,
    reference_id: int = None,
    note: str = None,
    created_by: int = None,
):
    after_qty = before_qty + quantity_change
    record = StockMovement(
        product_id=product_id,
        house_id=house_id,
        employee_id=employee_id,
        quantity_change=quantity_change,
        before_qty=before_qty,
        after_qty=after_qty,
        movement_type=movement_type,
        reference_id=reference_id,
        note=note,
        created_by=created_by,
    )
    db.add(record)
