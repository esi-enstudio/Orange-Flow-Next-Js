import json
import logging
import re
import asyncio
import time
import uuid
from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.deps import get_db, has_permission, require_house_context
from app.models.user import User
from app.models.house import House
from app.models.retailer import Retailer
from app.models.sim_issue import SimIssue
from app.utils.access_control import is_admin_user
from app.utils.activity_logger import log_activity
from app.core.session_manager import session_manager
from app.services.Automation.dms_scraper import (
    get_smart_search_results,
    get_receive_sim_from_retailer_list,
)
from app.services.Automation.Tasks.sim_issue import run_sim_issue_status, run_finalize_issue

logger = logging.getLogger("app.routers.dms")

router = APIRouter(prefix="/api/dms", tags=["DMS Automation"])

_sim_issue_in_progress: set[str] = set()

# ── DMS background job store ────────────────────────────────────────
# DMS automations (Playwright login + search + submit) can take several
# minutes, so their POST endpoints only start a background job and the client
# polls GET /<module>/status/{job_id} for progress/results.
# In-memory store — single-process uvicorn, same pattern as routers/sync.py.
# job_id -> { kind, events, done, error, result, house_id, started_at }
_dms_jobs: dict[str, dict] = {}
_dms_job_tasks: set[asyncio.Task] = set()
_DMS_JOB_TTL = 1800  # seconds before an unconsumed job is purged


def _purge_stale_dms_jobs():
    now = time.time()
    for job_id, job in list(_dms_jobs.items()):
        if now - float(job.get("started_at", now)) > _DMS_JOB_TTL:
            _dms_jobs.pop(job_id, None)


def _push_dms_event(job_id: str, msg: str):
    job = _dms_jobs.get(job_id)
    if job is not None:
        job["events"].append({"msg": msg, "ts": time.time()})


def _start_dms_job(kind: str, house_id: int) -> str:
    """Register a fresh background job and return its id."""
    _purge_stale_dms_jobs()
    job_id = str(uuid.uuid4())
    _dms_jobs[job_id] = {
        "kind": kind,
        "events": [],
        "done": False,
        "error": None,
        "result": None,
        "house_id": house_id,
        "started_at": time.time(),
    }
    return job_id


def _track_dms_task(coro) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _dms_job_tasks.add(task)
    task.add_done_callback(_dms_job_tasks.discard)
    return task


def _get_dms_job_for_user(job_id: str, kind: str, current_user) -> Optional[dict]:
    """Return a job by id when it matches `kind` and the user may see it.

    Returns None when the job is missing/expired or of a different kind (so the
    caller responds "not_found" without leaking that the id exists). Raises 403
    on cross-house access for non-admin users.
    """
    _purge_stale_dms_jobs()
    job = _dms_jobs.get(job_id)
    if job is None or job.get("kind") != kind:
        return None
    if not is_admin_user(current_user):
        user_house_ids = [h.id for h in current_user.houses]
        if job["house_id"] not in user_house_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this distribution house."
            )
    return job


def _notify_progress(progress_callback, message: str):
    """Fire a progress callback without letting UI bookkeeping break the run."""
    if progress_callback is None:
        return
    try:
        progress_callback(message)
    except Exception:
        pass

SMART_SEARCH_URL = "https://blkdms.banglalink.net/SmartSearchReport"

class SIMStatusCheckRequest(BaseModel):
    house_id: int = Field(..., description="ID of the distribution house")
    input_value: str = Field(..., description="Range-based input or list of serials")

class SIMStatusItem(BaseModel):
    sim_no: str
    status: str
    distributor: Optional[str] = None
    retailer: Optional[str] = None
    activation_date: Optional[str] = None
    msisdn: Optional[str] = None

class SIMStatusResult(BaseModel):
    results: List[SIMStatusItem]
    house_name: str
    house_code: str
    total_checked: int

class SIMStatusJobStartResponse(BaseModel):
    job_id: str
    status: str = Field(..., description="Job status at creation time")
    message: str

class SIMStatusJobStatusResponse(BaseModel):
    status: str = Field(..., description="running | complete | error | not_found")
    events: List[dict] = Field(default_factory=list)
    message: Optional[str] = None
    result: Optional[SIMStatusResult] = None

class SIMReturnRequest(BaseModel):
    house_id: int = Field(..., description="ID of the distribution house")
    input_value: str = Field(..., description="Range-based input or list of serials")

class SIMReturnItem(BaseModel):
    sim_no: str
    status: str
    remarks: Optional[str] = None

class SIMReturnResult(BaseModel):
    results: List[SIMReturnItem]
    house_name: str
    house_code: str
    total_processed: int

class SIMReturnJobStartResponse(BaseModel):
    job_id: str
    status: str = Field(..., description="Job status at creation time")
    message: str

class SIMReturnJobStatusResponse(BaseModel):
    status: str = Field(..., description="running | complete | error | not_found")
    events: List[dict] = Field(default_factory=list)
    message: Optional[str] = None
    result: Optional[SIMReturnResult] = None

def parse_serial_input(input_val: str) -> List[str]:
    # Split by newlines, commas, or semicolons
    raw_lines = re.split(r'[\n,\;]+', input_val)
    serials = []
    
    for line in raw_lines:
        line = line.strip()
        if not line:
            continue
            
        # Check if this line is a range (e.g. 12345-567 or 12345-12350)
        # We look for a hyphen. But make sure it only contains digits and one hyphen.
        if '-' in line and line.count('-') == 1:
            parts = line.split('-')
            start_str = parts[0].strip()
            end_str = parts[1].strip()
            
            if start_str.isdigit() and end_str.isdigit():
                start_num = int(start_str)
                # Compute end number
                if len(end_str) < len(start_str):
                    prefix = start_str[:-len(end_str)]
                    end_num_str = prefix + end_str
                    end_num = int(end_num_str)
                else:
                    end_num = int(end_str)
                
                # Swap if needed
                if start_num > end_num:
                    start_num, end_num = end_num, start_num
                    
                # Generate serials for the range
                range_size = end_num - start_num + 1
                if range_size > 500:
                    raise ValueError(f"Range size {range_size} exceeds the maximum limit of 500 serials.")
                    
                for val in range(start_num, end_num + 1):
                    # pad to start_str length
                    serials.append(f"{val:0{len(start_str)}d}")
                continue
                
        # Not a range or invalid range, treat as a single serial if it is numeric
        clean_serial = "".join(c for c in line if c.isdigit())
        if clean_serial:
            serials.append(clean_serial)
            
    if len(serials) > 500:
        raise ValueError(f"Total number of serials ({len(serials)}) exceeds the limit of 500.")
        
    return serials

def process_structured_results(all_data, credentials, input_serials):
    target_code = str(credentials.get('code', '')).strip().upper()
    
    # Index scanned data by SIM serial for fast lookup
    scanned_map = {}
    for d in all_data:
        sim = d.get("SIM No", "").strip().replace("'", "")
        if sim:
            scanned_map[sim] = d
            
    results = []
    for sim in input_serials:
        if sim in scanned_map:
            d = scanned_map[sim]
            dms_distro = str(d.get("Distributor", "")).strip().upper()
            
            # 1. House check
            if target_code not in dms_distro:
                results.append({
                    "sim_no": sim,
                    "status": "Other House",
                    "distributor": d.get("Distributor"),
                    "retailer": None,
                    "activation_date": None,
                    "msisdn": None
                })
                continue
                
            act_date = d.get("Activation Date", "")
            retailer = d.get("Retailer", "")
            msisdn = d.get("MSISDN", d.get("Mobile No", ""))
            
            if act_date:
                clean_msisdn = f"0{msisdn}" if len(msisdn) == 10 else msisdn
                results.append({
                    "sim_no": sim,
                    "status": "Active",
                    "distributor": d.get("Distributor"),
                    "retailer": retailer if retailer else None,
                    "activation_date": act_date,
                    "msisdn": clean_msisdn
                })
            elif retailer and retailer.strip() and "Select" not in retailer:
                results.append({
                    "sim_no": sim,
                    "status": "Issued",
                    "distributor": d.get("Distributor"),
                    "retailer": retailer,
                    "activation_date": None,
                    "msisdn": None
                })
            else:
                results.append({
                    "sim_no": sim,
                    "status": "Warehouse",
                    "distributor": d.get("Distributor"),
                    "retailer": None,
                    "activation_date": None,
                    "msisdn": None
                })
        else:
            results.append({
                "sim_no": sim,
                "status": "Not Found",
                "distributor": None,
                "retailer": None,
                "activation_date": None,
                "msisdn": None
            })
            
    return results

async def run_sim_status_check_structured(serials: list, credentials: dict, progress_callback=None):
    house_name = credentials.get('house_name', 'N/A')
    h_code = credentials.get('code', 'N/A')
    
    page = None
    context = None
    
    _notify_progress(progress_callback, "Opening DMS session (logging in if needed)...")
    try:
        page, context = await session_manager.get_valid_page(credentials)
    except Exception as e:
        logger.error(f"❌ [Task Error] {house_name} Failed to get session: {str(e)}")
        raise Exception(f"DMS session login failed: {str(e)}")
        
    try:
        logger.info(f"🔍 [Task] {house_name} ({h_code}): Starting check for {len(serials)} SIMs...")
        _notify_progress(progress_callback, "DMS session ready. Loading Smart Search Report...")
        
        await page.goto(SMART_SEARCH_URL, wait_until="domcontentloaded", timeout=60000) 
        await page.wait_for_selector("#SearchType", state="attached", timeout=30000)
        
        await page.select_option("#SearchType", "1") # SIM Serial
        await page.fill("#SearchValue", "\n".join(serials))
        
        await page.click("button.btn-success")
        logger.info(f"📡 {house_name}: Search submitted, waiting for data collection...")
        _notify_progress(progress_callback, f"Searching {len(serials)} serial number(s) in DMS...")

        scanned_data, error = await get_smart_search_results(page)

        if error:
            logger.warning(f"⚠️ {house_name}: {error}")
            raise Exception(error)
            
        if not scanned_data:
            scanned_data = []
        
        _notify_progress(progress_callback, "Parsing SIM status results...")
        return process_structured_results(scanned_data, credentials, serials)

    except Exception as e:
        logger.error(f"❌ [Task Error] {house_name} crashed: {str(e)}", exc_info=True)
        raise e
    
    finally:
        try:
            if page: await page.close()
            if context: await context.close()
            logger.info(f"🚪 [{house_name}] Task tab & session closed.")
        except:
            pass

async def _run_sim_status_job(job_id: str, serials: list, credentials: dict):
    await _run_dms_job(
        job_id,
        lambda: run_sim_status_check_structured(
            serials, credentials,
            progress_callback=lambda msg: _push_dms_event(job_id, msg),
        ),
        lambda results: SIMStatusResult(
            results=results,
            house_name=credentials.get("house_name", ""),
            house_code=credentials.get("code", ""),
            total_checked=len(serials),
        ),
        label="SIM Status Check",
    )


@router.post("/sim-status", response_model=SIMStatusJobStartResponse)
async def check_sim_status(
    payload: SIMStatusCheckRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("dms.sim_status"))
):
    # 1. Access validation for distributor house
    is_admin = is_admin_user(current_user)
    
    # Query the house
    result = await db.execute(select(House).where(House.id == payload.house_id))
    house = result.scalar_one_or_none()
    
    if not house:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Distribution house not found."
        )
        
    if not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if house.id not in user_house_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this distribution house."
            )
            
    # 2. Check DMS credentials
    if not house.dms_user or not house.dms_pass or not house.dms_house_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="DMS credentials are not configured for this distribution house. Please configure them in House Settings."
        )
        
    # 3. Parse serial numbers
    try:
        serials = parse_serial_input(payload.input_value)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
        
    # 4. Prepare credentials
    credentials = {
        "user": house.dms_user,
        "pass": house.dms_pass,
        "house_id": house.dms_house_id,
        "house_name": house.name,
        "code": house.code
    }
    
    # 5. Start the automation as a background job. The Playwright run can take
    # minutes, so it must never hold the HTTP request open — clients poll
    # GET /sim-status/status/{job_id} instead.
    job_id = _start_dms_job("sim_status", house.id)

    if serials:
        _track_dms_task(_run_sim_status_job(job_id, serials, credentials))
        message = f"SIM status check started for {len(serials)} SIM(s)."
    else:
        # Nothing to process — complete immediately so the first poll returns it.
        _dms_jobs[job_id]["done"] = True
        _dms_jobs[job_id]["result"] = SIMStatusResult(
            results=[],
            house_name=house.name,
            house_code=house.code,
            total_checked=0,
        )
        message = "No serial numbers to process."

    return SIMStatusJobStartResponse(job_id=job_id, status="started", message=message)


@router.get("/sim-status/status/{job_id}", response_model=SIMStatusJobStatusResponse)
async def sim_status_job_status(
    job_id: str,
    current_user: User = Depends(has_permission("dms.sim_status")),
):
    """Poll this endpoint while the background SIM status check runs."""
    job = _get_dms_job_for_user(job_id, "sim_status", current_user)
    if job is None:
        return SIMStatusJobStatusResponse(
            status="not_found",
            message="SIM status job not found or expired",
        )

    if not job["done"]:
        return SIMStatusJobStatusResponse(status="running", events=job["events"])

    if job.get("error"):
        return SIMStatusJobStatusResponse(
            status="error",
            events=job["events"],
            message=job["error"],
        )

    return SIMStatusJobStatusResponse(
        status="complete",
        events=job["events"],
        message="SIM status check completed",
        result=job["result"],
    )


SIM_RETURN_URL = "https://blkdms.banglalink.net/SmartSearchReport"
RECEIVE_URL = "https://blkdms.banglalink.net/ReceiveSimsFromRetailersSubmit"


def process_return_results(scanned_data: list, credentials: dict, input_serials: list) -> list:
    target_code = str(credentials.get('code', '')).strip().upper()

    scanned_map = {}
    for d in scanned_data:
        sim = d.get("SIM No", "").strip().replace("'", "")
        if sim:
            scanned_map[sim] = d

    results = []
    for sim in input_serials:
        if sim in scanned_map:
            d = scanned_map[sim]
            dms_distro = str(d.get("Distributor", "")).strip().upper()
            retailer = d.get("Retailer", "").strip()
            act_date = d.get("Activation Date", "").strip()

            if target_code not in dms_distro:
                results.append({
                    "sim_no": sim,
                    "status": "Failed",
                    "remarks": f"SIM belongs to different distributor ({d.get('Distributor', 'N/A')})",
                    "retailer_code": None
                })
            elif act_date:
                results.append({
                    "sim_no": sim,
                    "status": "Failed",
                    "remarks": "SIM is already activated, cannot be returned",
                    "retailer_code": None
                })
            elif retailer and retailer != "Select" and retailer != "N/A":
                match = re.search(r'R\d+', retailer)
                code = match.group(0) if match else retailer
                results.append({
                    "sim_no": sim,
                    "status": "Success",
                    "remarks": f"Returned from retailer: {retailer}",
                    "retailer_code": code
                })
            else:
                results.append({
                    "sim_no": sim,
                    "status": "Already Returned",
                    "remarks": "SIM is already in warehouse stock",
                    "retailer_code": None
                })
        else:
            results.append({
                "sim_no": sim,
                "status": "Failed",
                "remarks": "SIM not found in DMS system",
                "retailer_code": None
            })

    return results


async def run_sim_return_submit(page, results: list, credentials: dict, progress_callback=None) -> list:
    """Group Success SIMs by retailer and submit to RECEIVE_URL, updating results."""
    retailer_groups = {}
    for r in results:
        if r["status"] == "Success" and r.get("retailer_code"):
            code = r["retailer_code"]
            if code not in retailer_groups:
                retailer_groups[code] = []
            retailer_groups[code].append(r["sim_no"])

    if not retailer_groups:
        return results

    house_name = credentials.get('house_name', 'N/A')
    logger.info(f"🔄 [{house_name}] Submitting returns for {len(retailer_groups)} retailer(s)...")
    _notify_progress(progress_callback, f"Submitting returns to {len(retailer_groups)} retailer(s)...")

    today = datetime.now().strftime('%Y-%m-%d')

    for idx, (retailer_code, sims) in enumerate(retailer_groups.items(), start=1):
        logger.info(f"  ➡️  Submitting {len(sims)} SIM(s) to retailer {retailer_code}...")
        _notify_progress(progress_callback, f"Returning {len(sims)} SIM(s) to retailer {retailer_code} ({idx}/{len(retailer_groups)})...")
        try:
            await page.goto(RECEIVE_URL, wait_until="domcontentloaded", timeout=60000)
            await page.wait_for_selector("#Retailer", state="attached", timeout=30000)

            await page.evaluate(f"document.getElementById('IssueDate').value = '{today}';")

            js_select = """
                (code) => {
                    let select = document.getElementById('Retailer');
                    if(!select) return false;
                    for (let i = 0; i < select.options.length; i++) {
                        if (select.options[i].text.includes(code)) {
                            select.selectedIndex = i;
                            if(window.jQuery) {
                                window.jQuery(select).trigger('chosen:updated').change();
                            } else {
                                select.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                            return true;
                        }
                    }
                    return false;
                }
            """

            if not await page.evaluate(js_select, retailer_code):
                logger.warning(f"  ⚠️ Retailer {retailer_code} not found in dropdown")
                for r in results:
                    if r.get("sim_no") in sims and r["status"] == "Success":
                        r["status"] = "Failed"
                        r["remarks"] = f"Retailer {retailer_code} not found in DMS dropdown"
                continue

            await asyncio.sleep(1.5)
            await page.fill("#SimList", "\n".join(sims), force=True)
            await page.click("#SaveBtn")

            try:
                confirm_btn = "button.swal2-confirm"
                await page.wait_for_selector(confirm_btn, state="visible", timeout=15000)
                await page.click(confirm_btn)
                logger.info(f"  ✅ Retailer {retailer_code}: {len(sims)} SIM(s) returned successfully")
                for r in results:
                    if r.get("sim_no") in sims and r["status"] == "Success":
                        r["status"] = "Returned"
                        r["remarks"] = f"Successfully returned to retailer {retailer_code}"
            except:
                logger.warning(f"  ⚠️ Confirmation modal not found for {retailer_code}")
                for r in results:
                    if r.get("sim_no") in sims and r["status"] == "Success":
                        r["status"] = "Failed"
                        r["remarks"] = "Return submission failed - no confirmation from DMS"

        except Exception as e:
            logger.error(f"  ❌ Error submitting for retailer {retailer_code}: {str(e)}")
            for r in results:
                if r.get("sim_no") in sims and r["status"] == "Success":
                    r["status"] = "Failed"
                    r["remarks"] = f"Return error: {str(e)}"

    return results


async def run_sim_return_check(serials: list, credentials: dict, progress_callback=None):
    house_name = credentials.get('house_name', 'N/A')
    h_code = credentials.get('code', 'N/A')

    page = None
    context = None

    _notify_progress(progress_callback, "Opening DMS session (logging in if needed)...")
    try:
        page, context = await session_manager.get_valid_page(credentials)
    except Exception as e:
        logger.error(f"❌ [Task Error] {house_name} Failed to get session: {str(e)}")
        raise Exception(f"DMS session login failed: {str(e)}")

    results = []
    try:
        logger.info(f"🔙 [SIM Return] {house_name} ({h_code}): Starting SIM return check for {len(serials)} SIMs...")
        _notify_progress(progress_callback, "DMS session ready. Loading the SIM return page...")

        await page.goto(SIM_RETURN_URL, wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_selector("#SearchType", state="attached", timeout=30000)

        await page.select_option("#SearchType", "1")
        await page.fill("#SearchValue", "\n".join(serials))

        await page.click("button.btn-success")
        logger.info(f"📡 {house_name}: Search submitted, waiting for data collection...")
        _notify_progress(progress_callback, f"Searching {len(serials)} serial number(s) in DMS...")

        scanned_data, error = await get_smart_search_results(page)

        if error:
            logger.warning(f"⚠️ {house_name}: {error}")
            raise Exception(error)

        if not scanned_data:
            scanned_data = []

        _notify_progress(progress_callback, "Classifying return eligibility for each SIM...")
        results = process_return_results(scanned_data, credentials, serials)

        # Now perform actual submission for Success SIMs
        results = await run_sim_return_submit(page, results, credentials, progress_callback=progress_callback)

        _notify_progress(progress_callback, "Finalizing SIM return results...")
        return results

    except Exception as e:
        logger.error(f"❌ [Task Error] {house_name} return crashed: {str(e)}", exc_info=True)
        raise e
    finally:
        try:
            if page: await page.close()
            if context: await context.close()
            logger.info(f"🚪 [{house_name}] Return task tab & session closed.")
        except:
            pass


async def _run_dms_job(job_id: str, work, build_result, label: str):
    """Execute `work()` in the background and record its outcome on the job.

    `work` is a zero-arg callable returning an awaitable; `build_result(raw)`
    maps the raw automation output to the job's typed result model.
    """
    job = _dms_jobs.get(job_id)
    if job is None:
        return
    try:
        raw = await work()
        job["result"] = build_result(raw)
    except asyncio.CancelledError:
        job["error"] = f"{label} job was cancelled"
    except Exception as e:
        logger.error(f"❌ [{label} Job] failed: {str(e)}", exc_info=True)
        job["error"] = str(e)
    finally:
        job["done"] = True


async def _run_sim_return_job(job_id: str, serials: List[str], credentials: dict):
    await _run_dms_job(
        job_id,
        lambda: run_sim_return_check(
            serials,
            credentials,
            progress_callback=lambda msg: _push_dms_event(job_id, msg),
        ),
        lambda results: SIMReturnResult(
            results=results,
            house_name=credentials.get("house_name", ""),
            house_code=credentials.get("code", ""),
            total_processed=len(serials),
        ),
        label="SIM Return",
    )


@router.post("/sim-return", response_model=SIMReturnJobStartResponse)
async def return_sim(
    payload: SIMReturnRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("dms.sim_return"))
):
    is_admin = is_admin_user(current_user)

    result = await db.execute(select(House).where(House.id == payload.house_id))
    house = result.scalar_one_or_none()

    if not house:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Distribution house not found."
        )

    if not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if house.id not in user_house_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this distribution house."
            )

    if not house.dms_user or not house.dms_pass or not house.dms_house_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="DMS credentials are not configured for this distribution house. Please configure them in House Settings."
        )

    try:
        serials = parse_serial_input(payload.input_value)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

    credentials = {
        "user": house.dms_user,
        "pass": house.dms_pass,
        "house_id": house.dms_house_id,
        "house_name": house.name,
        "code": house.code
    }

    # Start the automation as a background job. The Playwright run can take
    # minutes (login + search + per-retailer submit), so it must never hold the
    # HTTP request open — clients poll GET /sim-return/status/{job_id} instead.
    job_id = _start_dms_job("sim_return", house.id)

    if serials:
        _track_dms_task(_run_sim_return_job(job_id, serials, credentials))
        message = f"SIM return job started for {len(serials)} SIM(s)."
    else:
        # Nothing to process — complete immediately so the first poll returns it.
        _dms_jobs[job_id]["done"] = True
        _dms_jobs[job_id]["result"] = SIMReturnResult(
            results=[],
            house_name=house.name,
            house_code=house.code,
            total_processed=0,
        )
        message = "No serial numbers to process."

    return SIMReturnJobStartResponse(job_id=job_id, status="started", message=message)


@router.get("/sim-return/status/{job_id}", response_model=SIMReturnJobStatusResponse)
async def sim_return_job_status(
    job_id: str,
    current_user: User = Depends(has_permission("dms.sim_return")),
):
    """Poll this endpoint while the background SIM return automation runs."""
    job = _get_dms_job_for_user(job_id, "sim_return", current_user)
    if job is None:
        return SIMReturnJobStatusResponse(
            status="not_found",
            message="SIM return job not found or expired",
        )

    if not job["done"]:
        return SIMReturnJobStatusResponse(status="running", events=job["events"])

    if job.get("error"):
        return SIMReturnJobStatusResponse(
            status="error",
            events=job["events"],
            message=job["error"],
        )

    return SIMReturnJobStatusResponse(
        status="complete",
        events=job["events"],
        message="SIM return completed",
        result=job["result"],
    )


class ReceiveSimRequestItem(BaseModel):
    distributor_name: str = ""
    retailer_name: str = ""
    receive_date: str = ""
    sim_qty: int = 0
    status: str = Field("", description="S = Pending, A = Approved, R = Rejected")
    remarks: Optional[str] = None
    create_by: str = ""
    details_url: Optional[str] = None


class ReceiveSimRequestListResponse(BaseModel):
    success: bool = True
    house_id: int
    house_name: str
    house_code: str
    status: str
    total: int
    data: List[ReceiveSimRequestItem]


@router.get("/sim-return/receive-requests", response_model=ReceiveSimRequestListResponse)
async def list_receive_sim_requests(
    request: Request,
    status_filter: str = Query(
        "S",
        alias="status",
        description="S = Pending, A = Approved, R = Rejected",
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("dms.sim_return")),
    house_id: int = Depends(require_house_context),
):
    """Read-only list of 'Receive SIM From Retailer' requests scraped from DMS,
    filtered by approval status (S/Pending, A/Approved, R/Rejected)."""
    status_filter = (status_filter or "S").strip().upper()
    if status_filter not in ("S", "A", "R"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid status. Allowed values: S (Pending), A (Approved), R (Rejected)."
        )

    result = await db.execute(select(House).where(House.id == house_id))
    house = result.scalar_one_or_none()

    if not house:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Distribution house not found."
        )

    if not house.dms_user or not house.dms_pass or not house.dms_house_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="DMS credentials are not configured for this distribution house. Please configure them in House Settings."
        )

    credentials = {
        "user": house.dms_user,
        "pass": house.dms_pass,
        "house_id": house.dms_house_id,
        "house_name": house.name,
        "code": house.code
    }

    page = None
    context = None
    try:
        page, context = await session_manager.get_valid_page(credentials)
    except Exception as e:
        logger.error(f"❌ [Receive SIM] {house.name} ({house.code}) failed to get session: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"DMS session login failed: {str(e)}"
        )

    try:
        rows, error = await get_receive_sim_from_retailer_list(page, status_filter)
    except Exception as e:
        logger.error(f"❌ [Receive SIM] {house.name} ({house.code}) scrape crashed: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch receive SIM requests: {str(e)}"
        )
    finally:
        try:
            if page:
                await page.close()
            if context:
                await context.close()
            logger.info(f"🚪 [{house.name}] Receive SIM tab & session closed.")
        except Exception:
            pass

    if error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch receive SIM requests: {error}"
        )

    await log_activity(
        db, current_user.id, current_user.name, "dms", "view",
        record_identifier=f"receive_sim_requests:{status_filter}:{house.code}",
        request=request, status_code=200,
    )

    return ReceiveSimRequestListResponse(
        house_id=house.id,
        house_name=house.name,
        house_code=house.code,
        status=status_filter,
        total=len(rows),
        data=[ReceiveSimRequestItem(**row) for row in rows],
    )


class SIMIssueRequest(BaseModel):
    house_id: int = Field(..., description="ID of the distribution house")
    retailer_id: int = Field(..., description="ID of the retailer")
    input_value: str = Field(..., description="Range-based input or list of serials")

class SIMIssueItem(BaseModel):
    sim_no: str
    status: str
    message: Optional[str] = None

class SIMIssueResponse(BaseModel):
    house_id: int
    house_name: str
    house_code: str
    retailer_code: str
    retailer_name: str
    total_processed: int
    total_success: int
    total_skipped: int
    total_failed: int
    results: List[SIMIssueItem]


@router.post("/sim-issue", response_model=SIMIssueResponse)
async def issue_sims(
    payload: SIMIssueRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("dms.sim_issue"))
):
    is_admin = is_admin_user(current_user)

    # 1. Validate house
    result = await db.execute(select(House).where(House.id == payload.house_id))
    house = result.scalar_one_or_none()
    if not house:
        raise HTTPException(status_code=404, detail="Distribution house not found.")
    if not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if house.id not in user_house_ids:
            raise HTTPException(status_code=403, detail="You do not have access to this distribution house.")

    # 2. Validate retailer
    result = await db.execute(
        select(Retailer).where(Retailer.id == payload.retailer_id)
    )
    retailer = result.scalar_one_or_none()
    if not retailer:
        raise HTTPException(status_code=404, detail="Retailer not found.")
    if retailer.house_id != house.id:
        raise HTTPException(status_code=400, detail="Retailer does not belong to the selected house.")

    # 3. Parse serial numbers
    try:
        serials = parse_serial_input(payload.input_value)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not serials:
        return SIMIssueResponse(
            house_id=house.id, house_name=house.name, house_code=house.code,
            retailer_code=retailer.retailer_code, retailer_name=retailer.name,
            total_processed=0, total_success=0, total_skipped=0, total_failed=0, results=[]
        )

    if not house.dms_user or not house.dms_pass or not house.dms_house_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="DMS credentials are not configured for this distribution house. Please configure them in House Settings."
        )

    credentials = {
        "user": house.dms_user,
        "pass": house.dms_pass,
        "house_id": house.dms_house_id,
        "house_name": house.name,
        "code": house.code
    }

    # 4. Check DMS status of serials
    try:
        scanned_data, error = await run_sim_issue_status(serials, credentials)
        if error:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"DMS serial analysis failed: {error}"
            )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"DMS query automation failed: {str(e)}"
        )

    if not scanned_data:
        scanned_data = []

    # Map scanned results
    scanned_map = {}
    for d in scanned_data:
        sim = d.get("SIM No", "").strip().replace("'", "")
        if sim:
            scanned_map[sim] = d

    results_list = []
    ready_serials = []
    success_count = 0
    skipped_count = 0
    failed_count = 0

    target_code = str(house.code).strip().upper()

    for sim in serials:
        if sim in scanned_map:
            d = scanned_map[sim]
            dms_distro = str(d.get("Distributor", "")).strip().upper()
            retailer_val = str(d.get("Retailer", "")).strip()
            act_date = str(d.get("Activation Date", "")).strip()
            msisdn = d.get("MSISDN", d.get("Mobile No", ""))

            if target_code not in dms_distro:
                results_list.append({
                    "sim_no": sim,
                    "status": "Failed",
                    "message": f"Belongs to other house ({d.get('Distributor')})"
                })
                failed_count += 1
            elif act_date:
                results_list.append({
                    "sim_no": sim,
                    "status": "Failed",
                    "message": f"Already active (MSISDN: {msisdn})"
                })
                failed_count += 1
            elif retailer_val and retailer_val != "Select" and retailer_val != "N/A":
                # Check if it matches target retailer
                if retailer.retailer_code in retailer_val or retailer.name in retailer_val:
                    results_list.append({
                        "sim_no": sim,
                        "status": "Skipped",
                        "message": f"Already issued to this retailer ({retailer_val})"
                    })
                    skipped_count += 1
                else:
                    results_list.append({
                        "sim_no": sim,
                        "status": "Failed",
                        "message": f"Already issued to retailer: {retailer_val}"
                    })
                    failed_count += 1
            else:
                # Warehouse, ready to be issued
                ready_serials.append(sim)
        else:
            results_list.append({
                "sim_no": sim,
                "status": "Failed",
                "message": "Not found in DMS system"
            })
            failed_count += 1

    # 5. Execute DMS issue if there are any ready serials
    if ready_serials:
        try:
            finalize_res = await run_finalize_issue(ready_serials, retailer.retailer_code, credentials)
            if finalize_res.startswith("✅"):
                # Success: update status and save to local DB
                today = date.today()
                records_to_create = []
                for sim in ready_serials:
                    results_list.append({
                        "sim_no": sim,
                        "status": "Success",
                        "message": f"Successfully issued to {retailer.retailer_code}"
                    })
                    success_count += 1
                    
                    records_to_create.append(SimIssue(
                        issue_date=today,
                        distributor_code=house.code,
                        distributor_name=house.name,
                        house_id=house.id,
                        cluster_market=getattr(retailer, "district", None),
                        retailer_code=retailer.retailer_code,
                        retailer_name=retailer.name,
                        retailer_id=retailer.id,
                        sim_no=sim
                    ))
                
                # Bulk insert new records in local DB
                if records_to_create:
                    try:
                        db.add_all(records_to_create)
                        await db.commit()
                    except Exception as e:
                        await db.rollback()
                        logger.error(f"Failed to record SIM issues in database: {str(e)}")
            else:
                # Issue failed
                for sim in ready_serials:
                    results_list.append({
                        "sim_no": sim,
                        "status": "Failed",
                        "message": f"DMS issue failed: {finalize_res}"
                    })
                    failed_count += 1
        except Exception as e:
            for sim in ready_serials:
                results_list.append({
                    "sim_no": sim,
                    "status": "Failed",
                    "message": f"DMS issue error: {str(e)}"
                })
                failed_count += 1

    return SIMIssueResponse(
        house_id=house.id, house_name=house.name, house_code=house.code,
        retailer_code=retailer.retailer_code, retailer_name=retailer.name,
        total_processed=len(serials),
        total_success=success_count,
        total_skipped=skipped_count,
        total_failed=failed_count,
        results=results_list
    )


async def _sim_issue_stream(payload: SIMIssueRequest, db: AsyncSession, current_user: User):
    is_admin = is_admin_user(current_user)

    # 1. Validate house
    yield _emit("log", {"message": "🔍 Validating distribution house..."})
    result = await db.execute(select(House).where(House.id == payload.house_id))
    house = result.scalar_one_or_none()
    if not house:
        yield _emit("error", {"message": "Distribution house not found."})
        return
    if not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if house.id not in user_house_ids:
            yield _emit("error", {"message": "You do not have access to this distribution house."})
            return

    yield _emit("log", {"message": f"✅ House: {house.name} ({house.code})"})

    # 2. Validate retailer
    yield _emit("log", {"message": "🔍 Validating retailer..."})
    result = await db.execute(select(Retailer).where(Retailer.id == payload.retailer_id))
    retailer = result.scalar_one_or_none()
    if not retailer:
        yield _emit("error", {"message": "Retailer not found."})
        return
    if retailer.house_id != house.id:
        yield _emit("error", {"message": "Retailer does not belong to the selected house."})
        return

    yield _emit("log", {"message": f"✅ Retailer: {retailer.name} ({retailer.retailer_code})"})

    # 3. Parse serial numbers
    try:
        serials = parse_serial_input(payload.input_value)
    except ValueError as e:
        yield _emit("error", {"message": str(e)})
        return

    if not serials:
        yield _emit("complete", {
            "house_id": house.id, "house_name": house.name, "house_code": house.code,
            "retailer_code": retailer.retailer_code, "retailer_name": retailer.name,
            "total_processed": 0, "total_success": 0, "total_skipped": 0, "total_failed": 0,
            "results": []
        })
        return

    yield _emit("log", {"message": f"📄 Parsed {len(serials)} SIM serials"})

    if not house.dms_user or not house.dms_pass or not house.dms_house_id:
        yield _emit("error", {"message": "DMS credentials not configured for this house."})
        return

    credentials = {
        "user": house.dms_user,
        "pass": house.dms_pass,
        "house_id": house.dms_house_id,
        "house_name": house.name,
        "code": house.code
    }

    # 4. Check DMS status of serials
    yield _emit("log", {"message": "🚀 Launching browser automation..."})
    yield _emit("log", {"message": "🔍 Checking SIM status in DMS portal..."})

    try:
        scanned_data, error = await run_sim_issue_status(serials, credentials)
        if error:
            yield _emit("error", {"message": f"DMS analysis failed: {error}"})
            return
    except Exception as e:
        yield _emit("error", {"message": f"DMS query automation failed: {str(e)}"})
        return

    if not scanned_data:
        scanned_data = []

    yield _emit("log", {"message": f"📊 DMS scan complete — {len(scanned_data)} SIMs found"})

    # Map scanned results
    scanned_map = {}
    for d in scanned_data:
        sim = d.get("SIM No", "").strip().replace("'", "")
        if sim:
            scanned_map[sim] = d

    results_list = []
    ready_serials = []
    success_count = 0
    skipped_count = 0
    failed_count = 0

    target_code = str(house.code).strip().upper()

    yield _emit("log", {"message": "📋 Processing scan results..."})

    for sim in serials:
        if sim in scanned_map:
            d = scanned_map[sim]
            dms_distro = str(d.get("Distributor", "")).strip().upper()
            retailer_val = str(d.get("Retailer", "")).strip()
            act_date = str(d.get("Activation Date", "")).strip()
            msisdn = d.get("MSISDN", d.get("Mobile No", ""))

            if target_code not in dms_distro:
                results_list.append({"sim_no": sim, "status": "Failed", "message": f"Belongs to other house ({d.get('Distributor')})"})
                failed_count += 1
            elif act_date:
                results_list.append({"sim_no": sim, "status": "Failed", "message": f"Already active (MSISDN: {msisdn})"})
                failed_count += 1
            elif retailer_val and retailer_val != "Select" and retailer_val != "N/A":
                if retailer.retailer_code in retailer_val or retailer.name in retailer_val:
                    results_list.append({"sim_no": sim, "status": "Skipped", "message": f"Already issued to this retailer ({retailer_val})"})
                    skipped_count += 1
                else:
                    results_list.append({"sim_no": sim, "status": "Failed", "message": f"Already issued to retailer: {retailer_val}"})
                    failed_count += 1
            else:
                ready_serials.append(sim)
        else:
            results_list.append({"sim_no": sim, "status": "Failed", "message": "Not found in DMS system"})
            failed_count += 1

    yield _emit("log", {"message": f"📊 Results: {len(ready_serials)} ready, {success_count} success, {skipped_count} skipped, {failed_count} failed"})

    # Save plain values before DB operations to avoid MissingGreenlet after rollback
    house_id = house.id
    house_name = house.name
    house_code = house.code
    retailer_code = retailer.retailer_code
    retailer_name = retailer.name

    # 5. Execute DMS issue
    if ready_serials:
        yield _emit("log", {"message": f"📤 Submitting {len(ready_serials)} SIMs to DMS for issuance..."})
        try:
            finalize_res = await run_finalize_issue(ready_serials, retailer.retailer_code, credentials)
            if finalize_res.startswith("✅"):
                today = date.today()
                records_to_create = []
                for sim in ready_serials:
                    results_list.append({"sim_no": sim, "status": "Success", "message": f"Successfully issued to {retailer.retailer_code}"})
                    success_count += 1
                    records_to_create.append({
                        "issue_date": today, "distributor_code": house_code, "distributor_name": house_name,
                        "house_id": house_id, "cluster_market": getattr(retailer, "district", None),
                        "retailer_code": retailer_code, "retailer_name": retailer_name,
                        "retailer_id": retailer.id, "sim_no": sim
                    })

                if records_to_create:
                    try:
                        stmt = pg_insert(SimIssue).values(records_to_create)
                        stmt = stmt.on_conflict_do_nothing(index_elements=['sim_no'])
                        await db.execute(stmt)
                        await db.commit()
                    except Exception as e:
                        await db.rollback()
                        logger.error(f"Failed to record SIM issues in database: {str(e)}")

                yield _emit("log", {"message": f"✅ {finalize_res}"})
            else:
                for sim in ready_serials:
                    results_list.append({"sim_no": sim, "status": "Failed", "message": f"DMS issue failed: {finalize_res}"})
                    failed_count += 1
                yield _emit("log", {"message": f"❌ DMS issuance failed: {finalize_res}"})
        except Exception as e:
            for sim in ready_serials:
                results_list.append({"sim_no": sim, "status": "Failed", "message": f"DMS issue error: {str(e)}"})
                failed_count += 1
            yield _emit("log", {"message": f"❌ DMS issuance error: {str(e)}"})

    yield _emit("log", {"message": "✅ SIM Issue process completed!"})

    yield _emit("complete", {
        "house_id": house_id, "house_name": house_name, "house_code": house_code,
        "retailer_code": retailer_code, "retailer_name": retailer_name,
        "total_processed": len(serials),
        "total_success": success_count,
        "total_skipped": skipped_count,
        "total_failed": failed_count,
        "results": results_list
    })


def _emit(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"

async def _sim_issue_stream_with_guard(payload: SIMIssueRequest, db: AsyncSession, current_user: User, dedup_key: str):
    try:
        async for event in _sim_issue_stream(payload, db, current_user):
            yield event
    finally:
        _sim_issue_in_progress.discard(dedup_key)


async def _sim_issue_already_running():
    yield _emit("log", {"message": "⚠️ Another SIM issue request is already in progress for this house + retailer."})
    yield _emit("error", {"message": "Request already in progress. Please wait for the current operation to complete."})

@router.post("/sim-issue/stream")
async def issue_sims_stream(
    payload: SIMIssueRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("dms.sim_issue"))
):
    dedup_key = f"{payload.house_id}:{payload.retailer_id}"
    if dedup_key in _sim_issue_in_progress:
        return StreamingResponse(
            _sim_issue_already_running(),
            media_type="text/event-stream"
        )
    _sim_issue_in_progress.add(dedup_key)
    return StreamingResponse(
        _sim_issue_stream_with_guard(payload, db, current_user, dedup_key),
        media_type="text/event-stream"
    )
