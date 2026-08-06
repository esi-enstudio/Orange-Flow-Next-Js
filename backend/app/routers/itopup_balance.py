from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.routers.deps import get_db, has_permission, get_house_context, require_house_context
from app.models.itopup_balance import ITopUpBalance, ITopUpBalanceLedger, ITopUpTransfer
from app.models.employee import Employee
from app.models.user import User
from app.schemas.itopup_balance import ITopUpTransferCreate
from app.services.stock_service import ensure_house_access
from app.services.itopup_service import apply_itopup_change
from app.utils.access_control import is_admin_user
from app.utils.activity_logger import log_activity

router = APIRouter(prefix="/api/itopup-balance", tags=["iTopUp Balance"])


def _pagination(page: int, per_page: int, total: int):
    total_pages = (total + per_page - 1) // per_page if total else 0
    return {
        "page": page,
        "per_page": per_page,
        "total": total,
        "total_pages": total_pages,
        "has_next": page < total_pages,
        "has_prev": page > 1,
    }


def _house_filter_condition(Model, user: User, house_id: Optional[int]):
    if house_id:
        return Model.house_id == house_id
    if not is_admin_user(user):
        user_house_ids = [h.id for h in user.houses]
        if user_house_ids:
            return Model.house_id.in_(user_house_ids)
        return Model.house_id == -1
    return None


def _emp_name(emp) -> Optional[str]:
    if emp is None:
        return None
    return (getattr(emp, "user", None).name if getattr(emp, "user", None) else None) \
        or emp.employee_id or emp.dms_code or None


@router.get("")
async def itopup_balance_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("itopup_balance.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    cond = _house_filter_condition(ITopUpBalance, current_user, house_id)
    stmt = select(ITopUpBalance)
    if cond is not None:
        stmt = stmt.where(cond)
    balances = (await db.execute(
        stmt.options(
            joinedload(ITopUpBalance.employee).joinedload(Employee.user),
            joinedload(ITopUpBalance.house),
        )
    )).unique().scalars().all()

    mothers = {}
    rso_rows = []
    for b in balances:
        if b.employee_id is None:
            house_name = b.house.name if b.house else None
            mothers[b.house_id] = {
                "house_id": b.house_id,
                "house_name": house_name,
                "balance": float(b.balance),
            }
        else:
            emp = b.employee
            rso_rows.append({
                "id": b.id,
                "house_id": b.house_id,
                "house_name": b.house.name if b.house else None,
                "employee_id": emp.id if emp else None,
                "employee_code": emp.employee_id if emp else None,
                "name": _emp_name(emp),
                "dms_code": emp.dms_code if emp else None,
                "balance": float(b.balance),
            })
    rso_rows.sort(key=lambda r: (r["house_name"] or "", r["name"] or ""))

    return {
        "success": True,
        "data": {
            "mother": list(mothers.values()),
            "rso": rso_rows,
        },
    }


@router.post("/transfers", status_code=201)
async def create_itopup_transfer(
    data: ITopUpTransferCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("itopup_balance.create")),
    house_id: int = Depends(require_house_context),
):
    await ensure_house_access(current_user, house_id)
    if data.from_employee_id is None and data.to_employee_id is None:
        raise HTTPException(status_code=422, detail="Mother SIM cannot transfer to itself")
    if data.from_employee_id is not None and data.from_employee_id == data.to_employee_id:
        raise HTTPException(status_code=422, detail="Source and destination cannot be the same")

    async def _check_emp(emp_id):
        if emp_id is None:
            return None
        emp = (await db.execute(
            select(Employee).options(joinedload(Employee.user)).where(Employee.id == emp_id)
        )).scalar_one_or_none()
        if not emp or emp.house_id != house_id:
            raise HTTPException(status_code=404, detail=f"Employee not found in this house: {emp_id}")
        return emp

    from_emp = await _check_emp(data.from_employee_id)
    to_emp = await _check_emp(data.to_employee_id)
    from_name = _emp_name(from_emp) or "Mother SIM"
    to_name = _emp_name(to_emp) or "Mother SIM"

    try:
        await apply_itopup_change(
            db, house_id=house_id, employee_id=data.from_employee_id,
            amount=-data.amount, movement_type="transfer_out",
            reference_type="itopup_transfer", reason=data.notes, user_id=current_user.id,
        )
        await apply_itopup_change(
            db, house_id=house_id, employee_id=data.to_employee_id,
            amount=data.amount, movement_type="transfer_in",
            reference_type="itopup_transfer", reason=data.notes, user_id=current_user.id,
        )
    except HTTPException:
        await db.rollback()
        raise

    transfer = ITopUpTransfer(
        house_id=house_id,
        from_employee_id=data.from_employee_id,
        to_employee_id=data.to_employee_id,
        amount=Decimal(str(data.amount)).quantize(Decimal("0.01")),
        movement=data.movement,
        notes=data.notes,
        created_by=current_user.id,
    )
    db.add(transfer)
    await db.commit()
    await db.refresh(transfer)

    await log_activity(
        db=db, user_id=current_user.id, user_name=current_user.name,
        module="itopup_balance", action="transfer", record_id=transfer.id,
        record_identifier=f"{from_name} → {to_name}",
        new_values=data.model_dump(), request=request,
    )
    return {"success": True, "data": {"id": transfer.id, "amount": float(transfer.amount)}}


@router.get("/ledger")
async def itopup_balance_ledger(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    movement_type: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("itopup_balance.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    cond = _house_filter_condition(ITopUpBalanceLedger, current_user, house_id)
    base = select(ITopUpBalanceLedger)
    if cond is not None:
        base = base.where(cond)
    if movement_type:
        base = base.where(ITopUpBalanceLedger.movement_type == movement_type)

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    query = (
        base
        .options(
            joinedload(ITopUpBalanceLedger.employee).joinedload(Employee.user),
            joinedload(ITopUpBalanceLedger.creator),
        )
        .order_by(ITopUpBalanceLedger.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    rows = (await db.execute(query)).unique().scalars().all()

    data = [{
        "id": e.id,
        "house_id": e.house_id,
        "employee_id": e.employee_id,
        "employee_name": _emp_name(e.employee),
        "movement_type": e.movement_type,
        "amount": float(e.amount),
        "balance_after": float(e.balance_after),
        "reference_type": e.reference_type,
        "reference_id": e.reference_id,
        "reason": e.reason,
        "created_at": e.created_at,
        "created_by_name": e.creator.name if e.creator else None,
    } for e in rows]
    return {"success": True, "data": data, "pagination": _pagination(page, per_page, total)}


@router.get("/transfers")
async def list_itopup_transfers(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("itopup_balance.view")),
    house_id: Optional[int] = Depends(get_house_context),
):
    cond = _house_filter_condition(ITopUpTransfer, current_user, house_id)
    base = select(ITopUpTransfer).where(ITopUpTransfer.is_deleted == False)
    if cond is not None:
        base = base.where(cond)

    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    query = (
        base
        .options(
            joinedload(ITopUpTransfer.from_employee).joinedload(Employee.user),
            joinedload(ITopUpTransfer.to_employee).joinedload(Employee.user),
            joinedload(ITopUpTransfer.creator),
        )
        .order_by(ITopUpTransfer.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    rows = (await db.execute(query)).unique().scalars().all()

    data = [{
        "id": t.id,
        "house_id": t.house_id,
        "from_employee_id": t.from_employee_id,
        "from_employee_name": _emp_name(t.from_employee),
        "to_employee_id": t.to_employee_id,
        "to_employee_name": _emp_name(t.to_employee),
        "amount": float(t.amount),
        "movement": t.movement,
        "notes": t.notes,
        "created_at": t.created_at,
        "created_by_name": t.creator.name if t.creator else None,
    } for t in rows]
    return {"success": True, "data": data, "pagination": _pagination(page, per_page, total)}
