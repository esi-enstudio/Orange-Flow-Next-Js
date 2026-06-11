import asyncio
import re
import logging
from datetime import datetime
from app.core.session_manager import session_manager
from app.services.Automation.dms_scraper import get_smart_search_results
from app.utils.helpers import bn_num

# Logging Configuration
logger = logging.getLogger("app.services.Automation.Tasks")

# URLs
SMART_SEARCH_URL = "https://blkdms.banglalink.net/SmartSearchReport"
ISSUE_URL = "https://blkdms.banglalink.net/IssueSimToRetailer/IssueSim"

async def run_sim_issue_status(serials: list, credentials: dict):
    """
    Step 1: Check current status of SIMs.
    Uses Session Manager to ensure an active page.
    """
    house_name = credentials.get('house_name', 'N/A')
    logger.info(f"🚀 [{house_name}] SIM Issue Analysis starting...")

    # 1. Get active page from Session Manager (handles auto-login)
    page, context = await session_manager.get_valid_page(credentials)
    
    try:
        # 2. Go to Smart Search page
        logger.info(f"🔍 [{house_name}] Navigating to Smart Search page...")
        await page.goto(SMART_SEARCH_URL, wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_selector("#SearchType", timeout=30000)
        
        # 3. Fill and submit search form
        await page.select_option("#SearchType", "1") # Select SIM Serial
        await page.fill("#SearchValue", "\n".join(serials))
        await page.click("button.btn-success")
        logger.info(f"📡 Search request sent, scraping results...")

        # 4. Call Central Scraper (handles Error, Card, Table)
        scanned_data, error = await get_smart_search_results(page)
        return scanned_data, error
        
    except Exception as e:
        logger.error(f"❌ Analysis Crash: {str(e)}", exc_info=True)
        return None, f"❌ Status Check Error: {str(e)}"
    finally:
        # 5. Close only the tab so the profile stays in memory ✅
        if page:
            await page.close()
            logger.info(f"🚪 [{house_name}] Analysis tab closed.")

async def run_finalize_issue(serials: list, retailer_code: str, credentials: dict):
    """
    Step 2: Final SIM issue submission in DMS.
    Also uses Session Manager to prevent session failure. ✅
    """
    house_name = credentials.get('house_name', 'N/A')
    logger.info(f"📤 [{house_name}] Starting submission for retailer `{retailer_code}`...")

    # 1. Get page from Session Manager (ensures session is still active)
    page, context = await session_manager.get_valid_page(credentials)
    
    try:
        # 2. Go to issue page
        logger.info(f"🌐 Navigating to issue page...")
        await page.goto(ISSUE_URL, wait_until="domcontentloaded", timeout=60000)
        
        # 3. Set date (today's date)
        await page.wait_for_selector("#IssueDate", timeout=30000)
        today = datetime.now().strftime('%Y-%m-%d')
        await page.evaluate(f"document.getElementById('IssueDate').value = '{today}';")
        logger.info(f"📅 Date set: {today}")

        # 4. Retailer Dropdown handling (using "attached" state as it is often hidden)
        await page.wait_for_selector("#Retailer", state="attached", timeout=30000)
        
        # Precise selection logic (jQuery & Native events)
        js_select = """
            (code) => {
                let select = document.getElementById('Retailer');
                if (!select) return false;
                for (let i = 0; i < select.options.length; i++) {
                    if (select.options[i].text.includes(code)) {
                        select.selectedIndex = i;
                        if (typeof window.jQuery !== 'undefined') {
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
        selection_success = await page.evaluate(js_select, retailer_code)
        if not selection_success:
            logger.error(f"❌ Retailer `{retailer_code}` not found in dropdown!")
            return f"❌ Error: Retailer code `{retailer_code}` not found in dropdown."

        await asyncio.sleep(1.5) # Pause for dropdown processing

        # 5. SIM List Input and click Add button
        logger.info(f"📝 Providing SIM List Input...")
        await page.fill("#SimList", "\n".join(serials), force=True)
        await page.click("#AddBtn")
        logger.info(f"➕ SIM list added. Processing buffer...")

        await asyncio.sleep(1) # Brief pause makes button click more stable ✅



        # 6. DMS warning modal (SweetAlert2) handling
        try:
            confirm_btn = "button.swal2-confirm"
            await page.wait_for_selector(confirm_btn, state="visible", timeout=8000)
            await page.click(confirm_btn)
            await asyncio.sleep(1)
        except: 
            pass # No modal is fine

        # 7. Click final issue button
        logger.info(f"💾 Looking for final Submit Button...")
        try:
            # Wait for button to be visible
            await page.wait_for_selector("#SimIssueBtn", state="visible", timeout=90000)
            await page.click("#SimIssueBtn")
            logger.info(f"💾 Clicked Submit Button.")
        except Exception:
            return "❌ 'Issue' button not found within timeout. DMS may be slow."

        # 8. Success confirmation (okBtn) handling
        try:
            await page.wait_for_selector("#okBtn", state="visible", timeout=25000)
            await page.click("#okBtn")
            logger.info(f"✅ [{house_name}] SIM Issue Successful!")
            return f"✅ Successfully issued {bn_num(len(serials))} SIMs to `{retailer_code}`."
        except Exception as e:
            logger.warning(f"⚠️ Success confirmation button not found: {str(e)}")
            return f"⚠️ Process completed but success confirmation not found. Check DMS."

    except Exception as e:
        logger.error(f"💥 Issue submission error: {str(e)}", exc_info=True)
        return f"❌ Issue submission error: {str(e)}"
    
    finally:
        # 9. Close only tab and context after work ✅
        # Since this is a terminal action (last step), closing context is safe.
        if page: await page.close()
        if context: await context.close()
        logger.info(f"🚪 [{house_name}] Issue process Cleanup completed.")

def process_issue_summary(all_data, house_info):
    """SIM Issue Analysis (code-based mapping) ✅"""
    active_map, issued_map = {}, {}
    warehouse_list, ready_serials_only, errors = [], [], []

    # House Code (RYZBRB01)
    target_code = str(house_info.get('code', '')).strip().upper()
    target_name = str(house_info.get('house_name', '')).strip()

    for d in all_data:
        sim = d.get("SIM No", "").strip().replace("'", "")
        dms_distro = str(d.get("Distributor", "N/A")).strip().upper()
        
        retailer = d.get("Retailer", "")
        act_date = d.get("Activation Date", "")
        msisdn = d.get("MSISDN", d.get("Mobile No", "N/A"))

        # 1. House Validation (by code) ✅
        if target_code not in dms_distro:
            errors.append(f"❌ <code>{sim}</code>: This is another house's SIM.")
            continue

        if act_date:
            if act_date not in active_map: active_map[act_date] = []
            clean_msisdn = f"0{msisdn}" if len(msisdn) == 10 else msisdn
            active_map[act_date].append(f"🔴 {sim}\n📱 {clean_msisdn} (Active)")

        elif retailer and retailer.strip() and "Select" not in retailer:
            if retailer not in issued_map: issued_map[retailer] = []
            issued_map[retailer].append(f"🟡 {sim}")
        
        else:
            warehouse_list.append(f"⚪ {sim}")
            ready_serials_only.append(sim)

    # --- Report Formatting ---
    final_output = ["📝 <b>SIM Issue Analysis Report:</b>\n"]
    if active_map:
        for date, lines in active_map.items():
            final_output.append("\n".join(lines) + f"\n📅 {date}\n")
    if issued_map:
        final_output.append("----------------------------")
        for ret, sims in issued_map.items():
            final_output.append("\n".join(sims) + f"\n••••••••••••••••••••••\n🏪 {ret} (Already issued)\n")
    if warehouse_list:
        final_output.append("\n".join(warehouse_list))
        final_output.append(f"✅ These <b>{bn_num(len(warehouse_list))}</b> SIMs Can be issued.\n")
    if errors:
        final_output.append("\n" + "\n".join(errors))

    return "\n".join(final_output) if len(final_output) > 1 else "⚠️ No information found.", ready_serials_only