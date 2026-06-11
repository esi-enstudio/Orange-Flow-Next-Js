import asyncio
import logging
from app.services.Automation.dms_scraper import get_smart_search_results
from app.core.session_manager import session_manager

# Logging Setup
logger = logging.getLogger("app.services.Automation.Tasks")

# URL
SMART_SEARCH_URL = "https://blkdms.banglalink.net/SmartSearchReport"

async def run_sim_status_check(serials: list, credentials: dict):
    """
    SIM Status Check using Session Manager (JSON Storage State).
    Creates a separate context for each task and cleans up at the end.
    """
    house_name = credentials.get('house_name', 'N/A')
    h_code = credentials.get('code', 'N/A')
    
    # 1. Get valid page and context from Session Manager
    try:
        page, context = await session_manager.get_valid_page(credentials)
    except Exception as e:
        logger.error(f"❌ [Task Error] {house_name} session failed: {str(e)}")
        return f"{str(e)}"
    
    final_report = "" # Variable for final report

    try:
        logger.info(f"🔍 [Task] {house_name} ({h_code}) checking {len(serials)} SIMs...")
        
        # 2. Go to Smart Search page (domcontentloaded is more stable) ✅
        await page.goto(SMART_SEARCH_URL, wait_until="domcontentloaded", timeout=60000) 

        # Wait for element to appear
        await page.wait_for_selector("#SearchType", timeout=30000)
        
        # 3. Provide Input
        await page.select_option("#SearchType", "1") # SIM Serial
        await page.fill("#SearchValue", "\n".join(serials))
        
        # 4. Click search button and Wait for Results
        await page.click("button.btn-success")
        logger.info(f"📡 {house_name}: Search submitted, waiting for data...")

        # 5. Use Central Scraper for data collection ✅
        scanned_data, error = await get_smart_search_results(page)

        if error:
            logger.warning(f"⚠️ {house_name}: {error}")
            final_report = error
        else:
            # Generate summary if data is available
            final_report = generate_sim_summary(scanned_data, credentials)

    except Exception as e:
        logger.error(f"❌ [Task Error] {house_name} Crash: {str(e)}", exc_info=True)
        final_report = f"❌ Automation Error: {str(e).replace('_', ' ')}"
    
    finally:
        # 6. Close tab and context after work (to save RAM) ✅
        try:
            if page: await page.close()
            if context: await context.close()
            logger.info(f"🚪 [{house_name}] Task Close Tab & Session closed.")
        except:
            pass

    # Return final result
    return final_report

def generate_sim_summary(all_data, credentials):
    """Validation and summary generation by House Code ✅"""
    active_map, issued_map = {}, {}
    warehouse_list, errors = [], []
    
    # 1. Get target House Code (e.g.: RYZBRB01)
    target_code = str(credentials.get('code', '')).strip().upper()
    house_name = credentials.get('house_name', 'N/A')

    for d in all_data:
        sim = d.get("SIM No", "").strip().replace("'", "")
        # Uppercase Distributor Data from DMS
        dms_distro = str(d.get("Distributor", "")).strip().upper()
        
        retailer = d.get("Retailer", "")
        act_date = d.get("Activation Date", "")
        msisdn = d.get("MSISDN", d.get("Mobile No", ""))

        # 2. House Validation (by code) ✅
        if target_code not in dms_distro:
            errors.append(f"❌ <code>{sim}</code>: This is another house's SIM. ({d.get('Distributor')})")
            continue

        if act_date:
            if act_date not in active_map: active_map[act_date] = []
            clean_msisdn = f"0{msisdn}" if len(msisdn) == 10 else msisdn
            active_map[act_date].append(f"🟢 {sim}\n📱 {clean_msisdn}")
            
        elif retailer and retailer.strip() and "Select" not in retailer:
            if retailer not in issued_map: issued_map[retailer] = []
            issued_map[retailer].append(f"🟡 {sim}")
            
        else:
            warehouse_list.append(f"⚪ {sim}")

    # --- 3. Message Formatting ---
    output = [f"📊 <b>SIM Status Report</b>", f"🏢 House: <b>{house_name}</b>\n"]

    for date, lines in active_map.items():
        output.append("\n".join(lines) + f"\n📅 {date}\n")

    if issued_map:
        output.append("----------------------------")
        for ret, sims in issued_map.items():
            output.append("\n".join(sims) + f"\n••••••••••••••••••••••\n🏪 {ret}\n")

    if warehouse_list: output.append("\n" + "\n".join(warehouse_list))
    if errors: output.append("\n" + "\n".join(errors))

    return "\n".join(output) if len(output) > 2 else "⚠️ No information found."