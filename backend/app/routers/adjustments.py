"""Adjustment API (P4): stock adjustments with approval workflow."""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.house import House
from app.models.stock import StockDocument
from app.routers.deps import get_db, get_current_user, get_house_context, has_permission
from app.schemas.stock import AdjustmentCreate, AdjustmentDecision, AdjustmentSerialDecision
from app.services.adjustment_service import create_adjustment, submit_adjustment, approve_adjustment, decide_adjustment_serial
from app.models.user import User

router = APIRouter(prefix="/api/v1/adjustments", tags=["adjustments"])

ADJUSTMENT_VIEW = has_permission("adjustment.view")
ADJUSTMENT_CREATE = has_permission("adjustment.create")
ADJUSTMENT_APPROVE = has_permission("adjustment.approve")


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_adjustment_endpoint(
    payload: AdjustmentCreate,
    request: Request,
    house_id: int = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(ADJUSTMENT_CREATE),
):
    ledger = await create_adjustment(
        db, house_id=house_id, user_id=current_user.id, data=payload
    )
    await db.commit()
    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="adjustment",
        action="create",
        record_id=ledger.id,
        record_identifier=payload.serials,
        new_values={"product_id": payload.product_id, "serial_count": len(payload.serials)},
        request=request,
        status_code=201,
    )
    return {"success": True, "data": {"id": ledger.id, "status": "draft"}}


@router.post("/{adjustment_id}/submit", status_code=status.HTTP_200_OK)
async def submit_adjustment_endpoint(
    adjustment_id: int,
    request: Request,
    house_id: int = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(ADJUSTMENT_VIEW),
):
    ledger = await submit_adjustment(
        db, house_id=house_id, user_id=current_user.id, adjustment_id=adjustment_id
    )
    await db.commit()
    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="adjustment",
        action="submit",
        record_id=adjustment_id,
        new_values={"status": "submitted"},
        request=request,
    )
    return {"success": True, "data": {"id": adjustment_id, "status": "submitted"}}


@router.post("/{adjustment_id}/approve", status_code=status.HTTP_200_OK)
async def approve_adjustment_endpoint(
    adjustment_id: int,
    request: Request,
    house_id: int = Depends(get_house_context),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(ADJUSTMENT_APPROVE),
):
    ledger = await approve_adjustment(
        db, house_id=house_id, user_id=current_user.id, adjustment_id=adjustment_id
    )
    await db.commit()
    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="adjustment",
        action="approve",
        record_id=adjustment_id,
        new_values={"status": "approved"},
        request=request,
    )
    return {"success": True, "data": {"id": adjustment_id, "status": "approved"}}


@router.post("/{adjustment_id}/decide", status_code=status.HTTP_200_OK)
async def decide_adjustment_serial_endpoint(
    adjustment_id: int,
    payload: AdjustmentSerialDecision,
    request: Request,
    house_id: int = Depends(get_house_context),
    db: AsyncSession = Depends(has_permission("adjustment.decide")),
):
    result = await decide_adjustment_serial(
        db,
        house_id=house_id,
        user_id=current_user.id,
        adjustment_id=adjustment_id,
        serial_number=payload.serial_number,
        decision=payload.decision,
    )
    await db.commit()
    await log_activity(
        db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="adjustment",
        action="decide",
        record_id=adjustment_id,
        new_values={payload.serial_number: payload.decision},
        request=request,
    )
    return {"success": True, "data": result}