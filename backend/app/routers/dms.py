import json
import logging
import re
import asyncio
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.deps import get_db, has_permission
from app.models.user import User
from app.models.house import House
from app.models.retailer import Retailer
from app.models.sim_issue import SimIssue
from app.utils.access_control import is_admin_user
from app.core.session_manager import session_manager
from app.services.Automation.dms_scraper import get_smart_search_results
from app.services.Automation.Tasks.sim_issue import run_sim_issue_status, run_finalize_issue

logger = logging.getLogger("app.routers.dms")

router = APIRouter(prefix="/api/dms", tags=["DMS Automation"])

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

class SIMStatusCheckResponse(BaseModel):
    house_id: int
    house_name: str
    house_code: str
    total_checked: int
    results: List[SIMStatusItem]

class SIMReturnRequest(BaseModel):
    house_id: int = Field(..., description="ID of the distribution house")
    input_value: str = Field(..., description="Range-based input or list of serials")

class SIMReturnItem(BaseModel):
    sim_no: str
    status: str
    remarks: Optional[str] = None

class SIMReturnResponse(BaseModel):
    house_id: int
    house_name: str
    house_code: str
    total_processed: int
    results: List[SIMReturnItem]

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

async def run_sim_status_check_structured(serials: list, credentials: dict):
    house_name = credentials.get('house_name', 'N/A')
    h_code = credentials.get('code', 'N/A')
    
    page = None
    context = None
    
    try:
        page, context = await session_manager.get_valid_page(credentials)
    except Exception as e:
        logger.error(f"❌ [Task Error] {house_name} Failed to get session: {str(e)}")
        raise Exception(f"DMS session login failed: {str(e)}")
        
    try:
        logger.info(f"🔍 [Task] {house_name} ({h_code}): Starting check for {len(serials)} SIMs...")
        
        await page.goto(SMART_SEARCH_URL, wait_until="domcontentloaded", timeout=60000) 
        await page.wait_for_selector("#SearchType", timeout=30000)
        
        await page.select_option("#SearchType", "1") # SIM Serial
        await page.fill("#SearchValue", "\n".join(serials))
        
        await page.click("button.btn-success")
        logger.info(f"📡 {house_name}: Search submitted, waiting for data collection...")

        scanned_data, error = await get_smart_search_results(page)

        if error:
            logger.warning(f"⚠️ {house_name}: {error}")
            raise Exception(error)
            
        if not scanned_data:
            scanned_data = []
            
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

@router.post("/sim-status", response_model=SIMStatusCheckResponse)
async def check_sim_status(
    payload: SIMStatusCheckRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("dms.sim_status"))
):
    # 1. Access validation for distributor house
    from app.routers.deps import get_current_user
    # We resolve it inside or via dependency inject:
    # current_user has user.houses loaded
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
        
    if not serials:
        return SIMStatusCheckResponse(
            house_id=house.id,
            house_name=house.name,
            house_code=house.code,
            total_checked=0,
            results=[]
        )
        
    # 4. Prepare credentials
    credentials = {
        "user": house.dms_user,
        "pass": house.dms_pass,
        "house_id": house.dms_house_id,
        "house_name": house.name,
        "code": house.code
    }
    
    # 5. Execute automation check
    try:
        results_list = await run_sim_status_check_structured(serials, credentials)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"DMS query automation failed: {str(e)}"
        )
        
    return SIMStatusCheckResponse(
        house_id=house.id,
        house_name=house.name,
        house_code=house.code,
        total_checked=len(serials),
        results=results_list
    )


SIM_RETURN_URL = "https://blkdms.banglalink.net/SmartSearchReport"


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
                    "remarks": f"SIM belongs to different distributor ({d.get('Distributor', 'N/A')})"
                })
            elif act_date:
                results.append({
                    "sim_no": sim,
                    "status": "Failed",
                    "remarks": "SIM is already activated, cannot be returned"
                })
            elif retailer and retailer != "Select" and retailer != "N/A":
                results.append({
                    "sim_no": sim,
                    "status": "Success",
                    "remarks": f"Returned from retailer: {retailer}"
                })
            else:
                results.append({
                    "sim_no": sim,
                    "status": "Already Returned",
                    "remarks": "SIM is already in warehouse stock"
                })
        else:
            results.append({
                "sim_no": sim,
                "status": "Failed",
                "remarks": "SIM not found in DMS system"
            })

    return results


async def run_sim_return_check(serials: list, credentials: dict):
    house_name = credentials.get('house_name', 'N/A')
    h_code = credentials.get('code', 'N/A')

    page = None
    context = None

    try:
        page, context = await session_manager.get_valid_page(credentials)
    except Exception as e:
        logger.error(f"❌ [Task Error] {house_name} Failed to get session: {str(e)}")
        raise Exception(f"DMS session login failed: {str(e)}")

    try:
        logger.info(f"🔙 [SIM Return] {house_name} ({h_code}): Starting SIM return check for {len(serials)} SIMs...")

        await page.goto(SIM_RETURN_URL, wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_selector("#SearchType", timeout=30000)

        await page.select_option("#SearchType", "1")
        await page.fill("#SearchValue", "\n".join(serials))

        await page.click("button.btn-success")
        logger.info(f"📡 {house_name}: Search submitted, waiting for data collection...")

        scanned_data, error = await get_smart_search_results(page)

        if error:
            logger.warning(f"⚠️ {house_name}: {error}")
            raise Exception(error)

        if not scanned_data:
            scanned_data = []

        return process_return_results(scanned_data, credentials, serials)

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


@router.post("/sim-return", response_model=SIMReturnResponse)
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

    if not serials:
        return SIMReturnResponse(
            house_id=house.id,
            house_name=house.name,
            house_code=house.code,
            total_processed=0,
            results=[]
        )

    credentials = {
        "user": house.dms_user,
        "pass": house.dms_pass,
        "house_id": house.dms_house_id,
        "house_name": house.name,
        "code": house.code
    }

    try:
        results_list = await run_sim_return_check(serials, credentials)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"SIM return automation failed: {str(e)}"
        )

    return SIMReturnResponse(
        house_id=house.id,
        house_name=house.name,
        house_code=house.code,
        total_processed=len(serials),
        results=results_list
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


def _emit(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


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
                    records_to_create.append(SimIssue(
                        issue_date=today, distributor_code=house.code, distributor_name=house.name,
                        house_id=house.id, cluster_market=getattr(retailer, "district", None),
                        retailer_code=retailer.retailer_code, retailer_name=retailer.name,
                        retailer_id=retailer.id, sim_no=sim
                    ))

                if records_to_create:
                    try:
                        db.add_all(records_to_create)
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
        "house_id": house.id, "house_name": house.name, "house_code": house.code,
        "retailer_code": retailer.retailer_code, "retailer_name": retailer.name,
        "total_processed": len(serials),
        "total_success": success_count,
        "total_skipped": skipped_count,
        "total_failed": failed_count,
        "results": results_list
    })


@router.post("/sim-issue/stream")
async def issue_sims_stream(
    payload: SIMIssueRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("dms.sim_issue"))
):
    return StreamingResponse(
        _sim_issue_stream(payload, db, current_user),
        media_type="text/event-stream"
    )
