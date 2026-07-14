import json
import asyncio
import logging
import uuid
import time
from typing import Optional

from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import StreamingResponse

from app.routers.deps import has_permission, get_house_context, get_current_user
from app.models.user import User
from app.services.Automation.dms_sync_service import sync_activation_module, sync_itopup_module
from app.services.Automation.Reports.ga_live import sync_live_activation_module

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sync", tags=["Manual Sync"])

# In-memory sync job store
# job_id -> {"events": [msg, ...], "done": bool, "error": str|None, "started_at": float}
_sync_jobs: dict[str, dict] = {}

async def _write_event(job_id: str, msg: str):
    job = _sync_jobs.get(job_id)
    if job:
        job["events"].append({"msg": msg, "ts": time.time()})

async def _run_sync_job(job_id: str, sync_fn, module_name: str, house_id: Optional[int]):
    """Run the sync function in background and record all events"""
    job = _sync_jobs.get(job_id)
    if not job:
        return
    try:
        await _write_event(job_id, f"🔍 Checking database for {module_name}...")
        await sync_fn(house_id=house_id, progress_callback=lambda m: _write_event(job_id, m))
        job["done"] = True
        job["has_work"] = any(
            e["msg"].startswith(p)
            for p in ("Downloading", "✓")
            for e in job["events"]
        )
    except asyncio.CancelledError:
        job["done"] = True
        job["error"] = "Cancelled"
    except Exception as e:
        logger.exception(f"Sync error for {module_name}")
        job["done"] = True
        job["error"] = str(e)


@router.post("/activation")
async def manual_sync_activation(
    background: bool = Query(False, description="Run in background"),
    current_user: User = Depends(has_permission("automation.dms_sync")),
    house_id: Optional[int] = Depends(get_house_context),
):
    """Manually trigger missing dates sync for Activation module"""
    if background:
        asyncio.create_task(sync_activation_module(house_id=house_id))
        return {"status": "started", "message": "Activation sync started in background"}
    
    job_id = str(uuid.uuid4())
    _sync_jobs[job_id] = {"events": [], "done": False, "error": None, "has_work": False, "started_at": time.time()}
    asyncio.create_task(_run_sync_job(job_id, sync_activation_module, "Activation", house_id))
    
    return {
        "status": "started",
        "job_id": job_id,
        "message": "Activation sync started"
    }


@router.post("/itopup")
async def manual_sync_itopup(
    background: bool = Query(False, description="Run in background"),
    current_user: User = Depends(has_permission("automation.dms_sync")),
    house_id: Optional[int] = Depends(get_house_context),
):
    """Manually trigger missing dates sync for iTopUp Details module"""
    if background:
        asyncio.create_task(sync_itopup_module(house_id=house_id))
        return {"status": "started", "message": "iTopUp sync started in background"}
    
    job_id = str(uuid.uuid4())
    _sync_jobs[job_id] = {"events": [], "done": False, "error": None, "has_work": False, "started_at": time.time()}
    asyncio.create_task(_run_sync_job(job_id, sync_itopup_module, "iTopUp", house_id))
    
    return {
        "status": "started",
        "job_id": job_id,
        "message": "iTopUp sync started"
    }


@router.post("/live-activation")
async def manual_sync_live_activation(
    background: bool = Query(False, description="Run in background"),
    current_user: User = Depends(has_permission("automation.ga_sync")),
    house_id: Optional[int] = Depends(get_house_context),
):
    """Manually trigger Live Activation sync"""
    if background:
        asyncio.create_task(sync_live_activation_module(house_id=house_id))
        return {"status": "started", "message": "Live Activation sync started in background"}
    
    job_id = str(uuid.uuid4())
    _sync_jobs[job_id] = {"events": [], "done": False, "error": None, "has_work": False, "started_at": time.time()}
    asyncio.create_task(_run_sync_job(job_id, sync_live_activation_module, "Live Activation", house_id))
    
    return {
        "status": "started",
        "job_id": job_id,
        "message": "Live Activation sync started"
    }


@router.get("/status/{job_id}")
async def sync_status(job_id: str):
    """Poll this endpoint to get sync progress"""
    job = _sync_jobs.get(job_id)
    if not job:
        return {"status": "not_found"}
    
    resp = {
        "status": "running" if not job["done"] else ("error" if job["error"] else "complete"),
        "events": job["events"],
    }
    
    if job["done"]:
        if job["error"]:
            resp["message"] = job["error"]
        elif job["has_work"]:
            resp["message"] = "Sync completed successfully"
        else:
            resp["message"] = "No missing data found. Database already up to date."
        # Clean up after last fetch
        _sync_jobs.pop(job_id, None)
    
    return resp
