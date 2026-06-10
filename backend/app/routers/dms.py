import logging
import re
import asyncio
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.deps import get_db, has_permission
from app.models.user import User
from app.models.house import House
from app.utils.access_control import is_admin_user
from app.core.session_manager import session_manager
from app.services.Automation.dms_scraper import get_smart_search_results

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
        logger.error(f"❌ [Task Error] {house_name} সেশন পেতে ব্যর্থ: {str(e)}")
        raise Exception(f"DMS session login failed: {str(e)}")
        
    try:
        logger.info(f"🔍 [Task] {house_name} ({h_code}) এর জন্য {len(serials)}টি সিম চেক শুরু...")
        
        await page.goto(SMART_SEARCH_URL, wait_until="domcontentloaded", timeout=60000) 
        await page.wait_for_selector("#SearchType", timeout=30000)
        
        await page.select_option("#SearchType", "1") # SIM Serial
        await page.fill("#SearchValue", "\n".join(serials))
        
        await page.click("button.btn-success")
        logger.info(f"📡 {house_name}: সার্চ সাবমিট হয়েছে, ডাটা সংগ্রহের অপেক্ষা...")

        scanned_data, error = await get_smart_search_results(page)

        if error:
            logger.warning(f"⚠️ {house_name}: {error}")
            raise Exception(error)
            
        if not scanned_data:
            scanned_data = []
            
        return process_structured_results(scanned_data, credentials, serials)

    except Exception as e:
        logger.error(f"❌ [Task Error] {house_name} ক্র্যাশ: {str(e)}", exc_info=True)
        raise e
    
    finally:
        try:
            if page: await page.close()
            if context: await context.close()
            logger.info(f"🚪 [{house_name}] টাস্ক ট্যাব ও সেশন ক্লোজ করা হয়েছে।")
        except:
            pass

@router.post("/sim-status", response_model=SIMStatusCheckResponse)
async def check_sim_status(
    payload: SIMStatusCheckRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_sim_status"))
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
