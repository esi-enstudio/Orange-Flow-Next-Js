import asyncio
import re
import os
import logging
from datetime import datetime
from app.services.Automation.dms_scraper import get_smart_search_results
from app.core.session_manager import session_manager
from app.utils.helpers import bn_num

# Logging Configuration
logger = logging.getLogger("app.services.Automation.Tasks")

# DMS URLs
SMART_SEARCH_URL = "https://blkdms.banglalink.net/SmartSearchReport"
RECEIVE_URL = "https://blkdms.banglalink.net/ReceiveSimsFromRetailersSubmit"

async def run_sim_return_task(serials: list, credentials: dict, bot, chat_id):
    """
    SIM Return Automation using Session Manager.
    It first checks the SIM statuses and then submits per retailer.
    """
    house_name = credentials.get('house_name', 'N/A')
    
    # 1. Get valid browser page and context from Session Manager
    logger.info(f"🚀 [{house_name}] SIM Return process starting...")
    try:
        page, context = await session_manager.get_valid_page(credentials)
    except Exception as e:
        logger.error(f"❌ Session creation failed: {e}")
        return f"❌ Error: {str(e)}"
    
    try:
        # 2. Navigate to Smart Search page
        logger.info(f"🌐 [{house_name}] Navigating to Smart Search Report...")
        await page.goto(SMART_SEARCH_URL, wait_until="domcontentloaded", timeout=60000)
        
        # 3. Fill search form (select SIM Serial option)
        await page.wait_for_selector("#SearchType", timeout=30000)
        await page.select_option("#SearchType", "1") 
        await page.fill("#SearchValue", "\n".join(serials))
        
        # 4. Click search button and wait for results
        await page.click("button.btn-success")
        logger.info(f"📡 Search submitted, scraping data...")

        # 5. Call Central Scraper (dms_scraper.py)
        scanned_data, error = await get_smart_search_results(page)

        if error:
            logger.error(f"❌ DMS scraping error: {error}")
            return error 

        # 6. Analyze scraped data to create report and grouping
        summary_msg, grouped_return_data = process_return_summary(scanned_data, credentials)
        
        # Send analysis summary to user via Telegram (HTML mode)
        await bot.send_message(chat_id, summary_msg, parse_mode="HTML")

        # If no SIMs are returnable
        if not grouped_return_data:
            logger.info("🏁 No returnable (issued) SIMs found.")
            return "🏁 <b>No returnable serials found. Process ended.</b>"

        # 7. Start per-retailer submission (action phase)
        total_retailers = len(grouped_return_data)
        logger.info(f"🛠 Starting submission for {bn_num(total_retailers)} retailers...")
        
        count = 1
        for retailer_code, sims in grouped_return_data.items():
            logger.info(f"🔄 [{bn_num(count)}/{bn_num(total_retailers)}] Processing retailer `{retailer_code}`...")
            
            # Navigate to return submission page
            await page.goto(RECEIVE_URL, wait_until="domcontentloaded", timeout=60000)
            
            # 8. Ensure retailer dropdown (using "attached" state since it's hidden)
            try:
                await page.wait_for_selector("#Retailer", state="attached", timeout=30000)
            except:
                logger.error(f"❌ Dropdown not found for retailer: {retailer_code}")
                await bot.send_message(chat_id, f"❌ Error: Dropdown not loaded for <b>{retailer_code}</b>.")
                continue

            # 9. Date input (today's date)
            today = datetime.now().strftime('%Y-%m-%d')
            await page.evaluate(f"document.getElementById('IssueDate').value = '{today}';")

            # 10. Select retailer from 'Chosen' dropdown via JavaScript
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
                logger.warning(f"⚠️ Retailer {retailer_code} not in dropdown.")
                await bot.send_message(chat_id, f"⚠️ Retailer code <code>{retailer_code}</code> not found in dropdown.")
                continue

            # 11. Input SIM serials and click save button
            await asyncio.sleep(1.5) # Wait for selection processing
            await page.fill("#SimList", "\n".join(sims), force=True) 
            await page.click("#SaveBtn")
            logger.info(f"💾 Submit button clicked for {retailer_code}.")

            # 12. SweetAlert2 confirmation modal handling
            try:
                confirm_btn = "button.swal2-confirm"
                await page.wait_for_selector(confirm_btn, state="visible", timeout=15000)
                await page.click(confirm_btn)
                
                logger.info(f"✅ {retailer_code} return successful.")
                status_text = f"✅ [{bn_num(count)}/{bn_num(total_retailers)}] <b>{retailer_code}</b> {bn_num(len(sims))} SIM Return Successful."
                await bot.send_message(chat_id, status_text, parse_mode="HTML")
            except:
                logger.warning(f"⚠️ Confirmation modal did not appear for {retailer_code}.")
                await bot.send_message(chat_id, f"⚠️ Return confirmation not found for <b>{retailer_code}</b>. Check DMS.")
            
            count += 1
            await asyncio.sleep(2) # Pause for server load balancing

        logger.info(f"🏁 [{house_name}] All tasks completed successfully.")
        return "🏁 <b>SIM Return process completed successfully.</b>"

    except Exception as e:
        logger.error(f"💥 Critical error: {str(e)}", exc_info=True)
        return f"❌ Automation Error: {str(e).replace('_', ' ')}"
    
    finally:
        # 13. Close page and session context (to save memory)
        if page: await page.close()
        if context: await context.close()
        logger.info(f"🚪 [{house_name}] Task session closed.")


def process_return_summary(scanned_data, credentials):
    """Filter returnable SIMs by House Code ✅"""
    active_map, issued_map = {}, {}
    warehouse_list, errors = [], []
    grouped_return_data = {} 

    # Target House Code
    target_code = str(credentials.get('code', '')).strip().upper() 
    target_name = credentials.get('house_name', 'N/A')

    for d in scanned_data:
        sim = d.get("SIM No", "").strip().replace("'", "")
        dms_distro = str(d.get("Distributor", "")).strip().upper() 
        
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
            active_map[act_date].append(f"🔴 {sim} | 📱 {clean_msisdn} (Active)")

        elif retailer and retailer.strip() and "Select" not in retailer:
            if retailer not in issued_map: issued_map[retailer] = []
            issued_map[retailer].append(f"🟡 {sim}")
            
            match = re.search(r'R\d+', retailer)
            code = match.group(0) if match else retailer
            if code not in grouped_return_data: grouped_return_data[code] = []
            grouped_return_data[code].append(sim)
        else:
            warehouse_list.append(f"⚪ {sim} (In warehouse)")

    # 2. Report text formatting (HTML)
    output = [f"📊 <b>SIM Return Analysis Report</b>", f"🏢 House: <b>{target_name}</b>\n"]

    if active_map:
        for date, lines in active_map.items():
            output.append("\n".join(lines) + f"\n📅 {date}\n")

    if issued_map:
        if len(output) > 2: output.append("----------------------------")
        for ret, sims in issued_map.items():
            output.append("\n".join(sims) + f"\n••••••••••••••••••••••\n🏪 {ret} (Will be returned)\n")

    if warehouse_list: output.append("\n".join(warehouse_list))
    if errors: output.append("\n" + "\n".join(errors))

    return "\n".join(output), grouped_return_data