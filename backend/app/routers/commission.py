import logging
from decimal import Decimal
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.deps import get_db, get_current_user, has_permission
from app.models.user import User
from app.models.commission import (
    CampaignType, CampaignTransaction,
    StatementBatch, CommissionStaging,
    CommissionAuditLog
)
from app.models.house import House
from app.models.employee import Employee
from app.schemas.commission import (
    CommissionFilterRequest, CampaignTypeCreate, CampaignTypeSchema, StatementBatchSchema,
    CampaignTransactionSchema, CampaignTransactionUpdate,

    PaginatedResponse, CommissionImportResponse,
    DashboardAnalytics, CommissionSummary,
    CampaignPerformance, HousePerformance,
)
from app.services.commission_service import CommissionQueryBuilder, CommissionImportService
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/commission", tags=["Commission"])


@router.post("/filter", response_model=PaginatedResponse)
async def filter_commission(
    filters: CommissionFilterRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("commission.view")),
):
    builder = CommissionQueryBuilder(db)
    items, total, summary = await builder.query_transactions(filters)

    total_pages = max(1, -(-total // filters.page_size))

    return PaginatedResponse(
        items=[{
            "id": t.id,
            "statement_date": str(t.statement_batch.statement_date) if t.statement_batch else None,
            "batch_reference": t.statement_batch.batch_reference if t.statement_batch else None,
            "house_id": t.house.id if t.house else None,
            "house_code": t.house.code if t.house else None,
            "house_name": t.house.name if t.house else None,
            "campaign_name": t.campaign_type.campaign_name if t.campaign_type else None,
            "campaign_category": t.campaign_type.category if t.campaign_type else None,
            "participant_type": t.participant_type,
            "participant_ref": t.participant_ref,
            "participant_name": t.participant_name,
            "employee_id": t.employee.id if t.employee else None,
            "employee_employee_id": t.employee.employee_id if t.employee else None,
            "employee_dms_code": t.employee.dms_code if t.employee else None,
            "employee_name": t.employee.user.name if (t.employee and t.employee.user) else None,
            "purpose": t.purpose,
            "amount": float(t.amount),
            "extra_data": t.extra_data,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        } for t in items],
        total=total,
        page=filters.page,
        page_size=filters.page_size,
        total_pages=total_pages,
        summary=summary,
    )


@router.post("/analytics", response_model=DashboardAnalytics)
async def commission_analytics(
    filters: CommissionFilterRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("commission.view")),
):
    builder = CommissionQueryBuilder(db)
    summary = await builder._compute_summary(await builder.build_filtered_query(filters))
    campaign_perf = await builder.get_campaign_performance(filters)
    house_perf = await builder.get_house_performance(filters)

    return DashboardAnalytics(
        summary=summary,
        campaign_performance=campaign_perf,
        house_performance=house_perf,
    )


@router.get("/filter-options")
async def get_filter_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("commission.view")),
):
    builder = CommissionQueryBuilder(db)
    return await builder.get_filter_options()


@router.get("/houses")
async def list_houses(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("commission.view")),
):
    result = await db.execute(
        select(House).order_by(House.code)
    )
    return [{"id": r.id, "code": r.code, "name": r.name} for r in result.scalars()]


@router.get("/campaign-types", response_model=List[CampaignTypeSchema])
async def list_campaign_types(
    category: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("commission.view")),
):
    query = select(CampaignType)
    if category:
        query = query.where(CampaignType.category == category)
    query = query.order_by(CampaignType.category, CampaignType.campaign_name)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/campaign-types", response_model=CampaignTypeSchema)
async def create_campaign_type(
    data: CampaignTypeCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("commission.manage")),
):
    result = await db.execute(
        select(CampaignType).where(
            CampaignType.campaign_name == data.campaign_name,
            CampaignType.category == data.category,
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Campaign type already exists")

    campaign_type = CampaignType(**data.model_dump())
    db.add(campaign_type)
    await db.commit()
    await db.refresh(campaign_type)
    return campaign_type


@router.get("/statements", response_model=List[StatementBatchSchema])
async def list_statements(
    house_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("commission.view")),
):
    query = select(StatementBatch).order_by(StatementBatch.created_at.desc())
    if house_id:
        query = query.where(StatementBatch.house_id == house_id)
    if status:
        query = query.where(StatementBatch.status == status)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/import/upload", response_model=CommissionImportResponse)
async def upload_commission_file(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("commission.import")),
):
    import pandas as pd
    import io
    from datetime import datetime

    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ("xlsx", "xls", "csv"):
        raise HTTPException(status_code=400, detail="Only Excel (.xlsx, .xls) and CSV files are supported")

    content = await file.read()
    try:
        if ext == "csv":
            df = pd.read_csv(io.BytesIO(content))
        else:
            df = pd.read_excel(io.BytesIO(content), engine="openpyxl")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse file: {str(e)}")

    required_lower = set(df.columns.str.lower())
    has_house_code = "house_code" in required_lower or "dd_code" in required_lower
    if not has_house_code:
        raise HTTPException(
            status_code=400,
            detail="Missing required column: house_code (or dd_code)"
        )
    if "campaign_name" not in required_lower:
        raise HTTPException(status_code=400, detail="Missing required column: campaign_name")
    if "statement_date" not in required_lower:
        raise HTTPException(status_code=400, detail="Missing required column: statement_date")
    if "amount" not in required_lower:
        raise HTTPException(status_code=400, detail="Missing required column: amount")

    df.columns = df.columns.str.lower().str.strip()
    df = df.where(pd.notna(df), None)

    batch_reference = f"IMP-{now_naive().strftime('%Y%m%d%H%M%S')}-{current_user.id}"

    rows = []
    for _, row in df.iterrows():
        try:
            stmt_date = pd.to_datetime(row.get("statement_date")).date()
        except Exception:
            raise HTTPException(status_code=400, detail=f"Invalid date in row: {row.get('statement_date')}")

        rows.append({
            "house_code": str(row.get("house_code") or row.get("dd_code", "")).strip(),
            "house_name": str(row.get("house_name") or row.get("distributor_name", "")).strip() or None,
            "statement_date": stmt_date,
            "campaign_name": str(row.get("campaign_name", "")).strip(),
            "campaign_category": str(row.get("campaign_category", "")).strip() or None,
            "participant_type": str(row.get("participant_type", "")).strip() or None,
            "participant_ref": str(row.get("participant_ref", "")).strip() or None,
            "purpose": str(row.get("purpose", "")).strip() or None,
            "amount": float(row.get("amount", 0) or 0),
        })

    service = CommissionImportService(db)
    await service.stage_upload(rows, batch_reference)
    valid, failed = await service.validate_staging(batch_reference)
    await db.commit()

    return CommissionImportResponse(
        batch_reference=batch_reference,
        total_rows=len(rows),
        valid_rows=valid,
        failed_rows=failed,
    )


@router.post("/import/{batch_reference}/process")
async def process_import(
    batch_reference: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("commission.import")),
):
    service = CommissionImportService(db)
    processed = await service.process_to_production(batch_reference, current_user.id)
    if processed == 0:
        report = await service.get_import_report(batch_reference)
        raise HTTPException(
            status_code=400,
            detail=f"No valid rows to process. Report: {report}"
        )
    await db.commit()
    return {"message": f"Successfully processed {processed} records", "processed": processed}


@router.get("/import/{batch_reference}/report")
async def get_import_report(
    batch_reference: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("commission.view")),
):
    service = CommissionImportService(db)
    return await service.get_import_report(batch_reference)


@router.get("/monthly-trend")
async def monthly_trend(
    months: int = Query(default=12, ge=1, le=36),
    house_ids: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("commission.view")),
):
    filters = CommissionFilterRequest(
        house_ids=[int(x) for x in house_ids.split(",")] if house_ids else None,
    )
    builder = CommissionQueryBuilder(db)
    return await builder.get_monthly_trend(filters, months)


@router.get("/export")
async def export_commission(
    filters: CommissionFilterRequest = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("commission.view")),
):
    from fastapi.responses import StreamingResponse
    import pandas as pd
    import io

    builder = CommissionQueryBuilder(db)
    items, total, _ = await builder.query_transactions(filters)

    records = []
    for t in items:
        records.append({
            "Statement Date": str(t.statement_batch.statement_date) if t.statement_batch else "",
            "Batch Reference": t.statement_batch.batch_reference if t.statement_batch else "",
            "House Code": t.house.code if t.house else "",
            "House Name": t.house.name if t.house else "",
            "Campaign": t.campaign_type.campaign_name if t.campaign_type else "",
            "Category": t.campaign_type.category if t.campaign_type else "",
            "Participant Type": t.participant_type,
            "Participant Ref": t.participant_ref,
            "Participant Name": t.participant_name or "",
            "Purpose": t.purpose or "",
            "Amount": float(t.amount),
        })

    df = pd.DataFrame(records)
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Commission")
    output.seek(0)

    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=commission_export.xlsx"},
    )


@router.get("/health")
async def commission_health():
    return {"status": "ok", "module": "commission"}


@router.put("/transactions/{transaction_id}", response_model=CampaignTransactionSchema)
async def update_transaction(
    transaction_id: int,
    data: CampaignTransactionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("commission.manage")),
):
    result = await db.execute(
        select(CampaignTransaction).where(CampaignTransaction.id == transaction_id)
    )
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")

    old_values = {
        "campaign_type_id": txn.campaign_type_id,
        "participant_type": txn.participant_type,
        "participant_ref": txn.participant_ref,
        "participant_name": txn.participant_name,
        "purpose": txn.purpose,
        "amount": float(txn.amount),
    }

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(txn, field, value)

    new_values = {k: v for k, v in update_data.items()}

    log = CommissionAuditLog(
        table_name="campaign_transactions",
        record_id=txn.id,
        action="UPDATE",
        old_values=old_values,
        new_values=new_values,
        changed_by=current_user.id,
    )
    db.add(log)

    await db.commit()
    await db.refresh(txn)
    return txn


@router.delete("/transactions/{transaction_id}")
async def delete_transaction(
    transaction_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("commission.manage")),
):
    result = await db.execute(
        select(CampaignTransaction).where(CampaignTransaction.id == transaction_id)
    )
    txn = result.scalar_one_or_none()
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")

    log = CommissionAuditLog(
        table_name="campaign_transactions",
        record_id=txn.id,
        action="DELETE",
        old_values={
            "campaign_type_id": txn.campaign_type_id,
            "participant_type": txn.participant_type,
            "participant_ref": txn.participant_ref,
            "participant_name": txn.participant_name,
            "purpose": txn.purpose,
            "amount": float(txn.amount),
            "house_id": txn.house_id,
            "statement_batch_id": txn.statement_batch_id,
        },
        changed_by=current_user.id,
    )
    db.add(log)

    await db.delete(txn)
    await db.commit()
    return {"message": "Transaction deleted successfully"}


@router.delete("/batches/{batch_id}")
async def delete_batch(
    batch_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("commission.manage")),
):
    result = await db.execute(
        select(StatementBatch).where(StatementBatch.id == batch_id)
    )
    batch = result.scalar_one_or_none()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    txn_count_result = await db.execute(
        select(CampaignTransaction).where(CampaignTransaction.statement_batch_id == batch_id)
    )
    txn_count = len(txn_count_result.scalars().all())

    log = CommissionAuditLog(
        table_name="statement_batches",
        record_id=batch.id,
        action="DELETE",
        old_values={
            "batch_reference": batch.batch_reference,
            "statement_date": str(batch.statement_date),
            "house_id": batch.house_id,
            "total_records": batch.total_records,
            "status": batch.status,
            "transactions_deleted": txn_count,
        },
        changed_by=current_user.id,
    )
    db.add(log)

    await db.delete(batch)
    await db.commit()
    return {"message": f"Batch '{batch.batch_reference}' and {txn_count} transactions deleted"}
