"""Lifting → DMS PreRF pull endpoints.

The actual Playwright work runs in a background job; these endpoints validate
access/business preconditions, start the job, and expose polling status.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.constants.dms import (
    DMS_BANKS,
    DMS_PRERF_ITOPUP_PRODUCT_ID,
    DMS_PRERF_WAREHOUSE_ID,
    DMS_PRERF_WAREHOUSE_NAME,
)
from app.core import pull_jobs
from app.models.house import House
from app.models.lifting import LiftingRecord
from app.models.user import User
from app.routers.deps import get_db, has_permission
from app.schemas.lifting import (
    LiftingPullRequest,
    LiftingPullStartResponse,
    LiftingPullStatusResponse,
)
from app.services.Automation.Tasks.lifting_pull import (
    floor_quantity,
    run_lifting_pre_rf_pull,
)
from app.services.db_service import async_session
from app.utils.access_control import is_admin_user
from app.utils.activity_logger import log_activity
from app.utils.timezone import now_naive

logger = logging.getLogger("app.routers.lifting_pull")

router = APIRouter(prefix="/api/lifting", tags=["lifting-pull"])

JOB_KIND = "lifting_prf_pull"
RUNNING_TIMEOUT_SECONDS = 30 * 60


class _RequestInfo:
    """Small request snapshot safe to use from a background task."""

    def __init__(self, request: Request):
        self.url = request.url
        self.method = request.method
        self.client = request.client
        self.headers = request.headers


def _house_credentials(house: House) -> dict:
    return {
        "user": house.dms_user,
        "pass": house.dms_pass,
        "house_id": house.dms_house_id,
        "house_name": house.display_name or house.name,
        "code": house.code,
    }


def _ensure_house_access(current_user: User, house_id: int) -> None:
    if is_admin_user(current_user):
        return
    if house_id not in [h.id for h in current_user.houses]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this distribution house.",
        )


@router.get("/pull/options")
async def get_pull_options(
    current_user: User = Depends(has_permission("lifting.view")),
):
    """Bank list and fixed PreRF warehouse used by the create/edit form."""
    return {
        "banks": DMS_BANKS,
        "warehouse": {
            "id": DMS_PRERF_WAREHOUSE_ID,
            "name": DMS_PRERF_WAREHOUSE_NAME,
        },
        "itopup_product_id": DMS_PRERF_ITOPUP_PRODUCT_ID,
    }


@router.post("/{record_id}/pull", response_model=LiftingPullStartResponse)
async def start_lifting_pull(
    record_id: int,
    payload: LiftingPullRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("lifting.pull")),
):
    result = await db.execute(
        select(LiftingRecord)
        .options(selectinload(LiftingRecord.house))
        .where(LiftingRecord.id == record_id, LiftingRecord.is_deleted == False)
    )
    record = result.unique().scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Lifting record not found")

    _ensure_house_access(current_user, record.house_id)

    house = record.house
    if not house:
        raise HTTPException(status_code=404, detail="Distribution house not found")

    if not house.show_pull_button:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="PULL is disabled for this distribution house.",
        )

    if not house.dms_user or not house.dms_pass or not house.dms_house_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="DMS credentials are not configured for this distribution house.",
        )

    record_status = getattr(record.status, "value", record.status)
    if record_status not in ("Confirmed", "Approved"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only Confirmed or Approved lifting records can be pulled.",
        )

    if not record.bank_id or not record.bank_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Select and save a Bank Name in the lifting record before pulling.",
        )

    if float(record.total_bank_deposit or 0) <= 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The lifting record has no bank deposit amount.",
        )

    quantity = floor_quantity(float(record.itopup_amount or 0))
    if quantity < 1:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The lifting record's iTopUp amount is less than 1.",
        )

    if not record.deposit_slip:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Upload a bank deposit slip before pulling.",
        )

    if payload.dry_run and not is_admin_user(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Dry run is available to administrators only.",
        )

    if record.pull_status == "submitted":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This lifting record has already been submitted to DMS.",
        )

    if record.pull_status == "running" and record.pull_requested_at:
        age = (now_naive() - record.pull_requested_at).total_seconds()
        if age < RUNNING_TIMEOUT_SECONDS:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A PULL request is already running for this lifting record.",
            )

    if pull_jobs.is_record_running(record.id) or pull_jobs.is_house_running(house.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Another PULL request is already running for this house.",
        )

    if not pull_jobs.mark_record_running(record.id, house.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Another PULL request is already running for this house.",
        )

    previous_status = record.pull_status
    previous_rf_code = record.pull_rf_code
    previous_message = record.pull_message
    previous_completed_at = record.pull_completed_at

    try:
        record.pull_status = "running"
        record.pull_message = None
        record.pull_rf_code = None
        record.pull_requested_at = now_naive()
        record.pull_completed_at = None
        record.pull_requested_by = current_user.id
        await db.commit()
    except Exception:
        pull_jobs.release_record_running(record.id, house.id)
        raise

    credentials = _house_credentials(house)
    record_data = {
        "id": record.id,
        "lifting_date": str(record.lifting_date),
        "total_bank_deposit": float(record.total_bank_deposit or 0),
        "itopup_amount": float(record.itopup_amount or 0),
        "bank_id": record.bank_id,
        "bank_name": record.bank_name,
        "deposit_slip": record.deposit_slip,
        "previous_pull_status": previous_status,
        "previous_pull_rf_code": previous_rf_code,
        "previous_pull_message": previous_message,
        "previous_pull_completed_at": previous_completed_at,
        "house_name": house.display_name or house.name,
        "house_code": house.code,
    }

    job_id = pull_jobs.start_job(
        kind=JOB_KIND,
        house_id=house.id,
        record_id=record.id,
        user_id=current_user.id,
    )

    try:
        await log_activity(
            db=db,
            user_id=current_user.id,
            user_name=current_user.name,
            module="lifting",
            action="pull",
            record_id=record.id,
            record_identifier=f"{record.lifting_date} - {house.display_name or house.name}",
            old_values={"pull_status": previous_status},
            new_values={
                "pull_status": "running",
                "dry_run": payload.dry_run,
                "bank_id": record.bank_id,
                "bank_name": record.bank_name,
            },
            request=request,
            status_code=status.HTTP_202_ACCEPTED,
        )
    except Exception:
        logger.exception("Could not write the PULL start activity log (record %s)", record.id)
        pull_jobs.release_record_running(record.id, house.id)
        try:
            record.pull_status = previous_status
            record.pull_rf_code = previous_rf_code
            record.pull_message = previous_message
            record.pull_completed_at = previous_completed_at
            await db.commit()
        except Exception:
            logger.exception("Could not restore PULL state (record %s)", record.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not start the PULL process. Please try again.",
        )

    pull_jobs.track_task(
        _run_lifting_pull_job(
            job_id=job_id,
            record_id=record.id,
            house_id=house.id,
            credentials=credentials,
            record_data=record_data,
            dry_run=payload.dry_run,
            user_id=current_user.id,
            user_name=current_user.name,
            request_info=_RequestInfo(request),
        )
    )

    return LiftingPullStartResponse(
        job_id=job_id,
        status="started",
        message="PULL process started.",
    )


async def _run_lifting_pull_job(
    *,
    job_id: str,
    record_id: int,
    house_id: int,
    credentials: dict,
    record_data: dict,
    dry_run: bool,
    user_id: int,
    user_name: Optional[str],
    request_info: _RequestInfo,
) -> None:
    previous_status = record_data.get("previous_pull_status")
    try:
        result = await run_lifting_pre_rf_pull(
            credentials=credentials,
            record=record_data,
            progress=lambda code, message, params: pull_jobs.push_event(
                job_id, code, message, params
            ),
            dry_run=dry_run,
        )

        outcome = result.get("outcome")
        message = result.get("message") or ""

        async with async_session() as session:
            record = await session.get(LiftingRecord, record_id)
            if record:
                if outcome == "created":
                    record.pull_status = "submitted"
                    record.pull_rf_code = result.get("rf_code")
                    record.pull_completed_at = now_naive()
                elif outcome in ("blocked_pending", "blocked_rejected"):
                    record.pull_status = "blocked"
                    record.pull_completed_at = now_naive()
                elif outcome == "dry_run_ok":
                    record.pull_status = (
                        previous_status if previous_status not in (None, "running") else None
                    )
                    record.pull_rf_code = record_data.get("previous_pull_rf_code")
                    record.pull_completed_at = record_data.get("previous_pull_completed_at")
                else:
                    record.pull_status = "failed"
                    record.pull_completed_at = now_naive()
                record.pull_message = message
                await session.commit()

                await log_activity(
                    db=session,
                    user_id=user_id,
                    user_name=user_name,
                    module="lifting",
                    action="pull",
                    record_id=record_id,
                    record_identifier=f"{record_data.get('lifting_date')} - {credentials.get('house_name')}",
                    old_values={"pull_status": "running"},
                    new_values={
                        "outcome": outcome,
                        "pull_status": record.pull_status,
                        "rf_code": result.get("rf_code"),
                        "total_price": result.get("total_price"),
                        "requisition_sum": result.get("requisition_sum"),
                        "dry_run": dry_run,
                        "message": message,
                    },
                    request=request_info,
                    status_code=status.HTTP_200_OK,
                )

        if outcome in ("created", "dry_run_ok"):
            pull_jobs.complete_job(job_id, result)
        elif outcome in ("blocked_pending", "blocked_rejected"):
            pull_jobs.complete_job(job_id, result)
        else:
            pull_jobs.fail_job(job_id, message, result)
    except Exception as exc:
        logger.exception("Lifting PULL job failed (record %s)", record_id)
        message = f"PULL process failed: {exc}"
        try:
            async with async_session() as session:
                record = await session.get(LiftingRecord, record_id)
                if record:
                    record.pull_status = "failed"
                    record.pull_message = message
                    record.pull_completed_at = now_naive()
                    await session.commit()
        except Exception:
            logger.exception("Could not persist failed PULL state (record %s)", record_id)
        pull_jobs.fail_job(job_id, message, {"outcome": "failed", "message": message})
    finally:
        pull_jobs.release_record_running(record_id, house_id)


@router.get("/pull/status/{job_id}", response_model=LiftingPullStatusResponse)
async def get_lifting_pull_status(
    job_id: str,
    current_user: User = Depends(has_permission("lifting.pull")),
):
    job = pull_jobs.get_job(job_id, JOB_KIND)
    if job is None:
        return LiftingPullStatusResponse(
            status="not_found",
            message="PULL job not found or expired.",
        )

    _ensure_house_access(current_user, job["house_id"])

    if job.get("error"):
        return LiftingPullStatusResponse(
            status="error",
            events=job.get("events", []),
            message=job["error"],
            result=job.get("result"),
        )
    if job.get("done"):
        return LiftingPullStatusResponse(
            status="complete",
            events=job.get("events", []),
            result=job.get("result"),
        )
    return LiftingPullStatusResponse(
        status="running",
        events=job.get("events", []),
    )
