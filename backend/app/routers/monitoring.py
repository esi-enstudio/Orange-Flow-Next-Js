from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, and_
from typing import Optional, List, Dict, Any

from app.routers.deps import get_current_user, require_permission, get_db
from app.models.user import User
from app.models.system_monitoring import MonitoringAlert, AutomationJobRecord
from app.services.monitoring_service import (
    get_system_health_summary,
    get_historical_metrics,
    collect_and_store_metrics,
)
from app.utils.timezone import now_naive

router = APIRouter(prefix="/api/v1/admin/monitoring", tags=["System Monitoring"])

@router.get("/summary")
async def get_monitoring_summary(
    current_user: User = Depends(require_permission("monitoring.view")),
    db: AsyncSession = Depends(get_db),
):
    """Get comprehensive system health, container stats, active alerts, and house automation overview."""
    try:
        summary = await get_system_health_summary(db)
        return {
            "success": True,
            "data": summary
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch monitoring summary: {str(e)}")


@router.get("/history")
async def get_monitoring_history(
    hours: int = Query(24, ge=1, le=168),
    current_user: User = Depends(require_permission("monitoring.view")),
    db: AsyncSession = Depends(get_db),
):
    """Get historical time-series system metrics (CPU, RAM, Disk) for charts."""
    try:
        history = await get_historical_metrics(db, hours=hours)
        return {
            "success": True,
            "data": history
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch historical metrics: {str(e)}")


@router.get("/jobs")
async def list_automation_jobs(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    house_id: Optional[int] = None,
    job_type: Optional[str] = None,
    job_status: Optional[str] = None,
    current_user: User = Depends(require_permission("monitoring.view")),
    db: AsyncSession = Depends(get_db),
):
    """List paginated automation job records with filters."""
    query = select(AutomationJobRecord)
    if house_id:
        query = query.where(AutomationJobRecord.house_id == house_id)
    if job_type:
        query = query.where(AutomationJobRecord.job_type == job_type)
    if job_status:
        query = query.where(AutomationJobRecord.status == job_status)

    query = query.order_by(desc(AutomationJobRecord.created_at))

    # Count total
    from sqlalchemy import func
    count_query = select(func.count()).select_from(query.subquery())
    total_res = await db.execute(count_query)
    total = total_res.scalar() or 0

    # Pagination
    offset = (page - 1) * per_page
    paginated_query = query.offset(offset).limit(per_page)
    res = await db.execute(paginated_query)
    jobs = res.scalars().all()

    total_pages = (total + per_page - 1) // per_page

    return {
        "success": True,
        "data": [
            {
                "id": j.id,
                "house_id": j.house_id,
                "job_type": j.job_type,
                "job_identifier": j.job_identifier,
                "status": j.status,
                "error_message": j.error_message,
                "started_at": j.started_at,
                "completed_at": j.completed_at,
                "duration_ms": j.duration_ms,
                "retry_count": j.retry_count,
                "created_at": j.created_at,
            } for j in jobs
        ],
        "pagination": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "total_pages": total_pages,
            "has_next": page < total_pages,
            "has_prev": page > 1,
        }
    }


@router.post("/alerts/{alert_id}/acknowledge")
async def acknowledge_monitoring_alert(
    alert_id: int,
    current_user: User = Depends(require_permission("monitoring.manage")),
    db: AsyncSession = Depends(get_db),
):
    """Acknowledge or resolve a monitoring alert."""
    alert = await db.get(MonitoringAlert, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    alert.status = "resolved"
    alert.resolved_at = now_naive()
    alert.acknowledged_by_id = current_user.id
    alert.acknowledged_at = now_naive()
    await db.commit()

    return {
        "success": True,
        "message": "Alert acknowledged and resolved successfully"
    }


@router.post("/collect-now")
async def trigger_metric_collection(
    current_user: User = Depends(require_permission("monitoring.manage")),
    db: AsyncSession = Depends(get_db),
):
    """Force an immediate collection of system and container metrics."""
    await collect_and_store_metrics(db)
    return {
        "success": True,
        "message": "Metrics collected successfully"
    }
