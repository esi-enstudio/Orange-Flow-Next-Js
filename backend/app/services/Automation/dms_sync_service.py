import os
import asyncio
import logging
import pandas as pd
from datetime import date, datetime, timedelta
from sqlalchemy import select, func, and_
from app.models.house import House
from app.models.activation import Activation
from app.models.itopup_detail import ITopUpDetail
from app.models.scratch_card_issue import ScratchCardIssue
from app.models.sim_issue import SimIssue
from app.models.sync_history import SyncHistory
from app.services.db_service import async_session
from app.core.session_manager import session_manager
from app.services.Automation.activation_excel import process_activation_excel
from app.services.Automation.dms_report_excel import process_dms_report_excel
from app.services.Automation.issue_reports_excel import process_scratch_card_excel, process_sim_issue_excel
from colorama import Fore, Style
from sqlalchemy.dialects.postgresql import insert

logger = logging.getLogger("app.services.Automation.Sync")

async def _noop_progress(_): pass

TEMP_DIR = "temp_downloads"

URL_MAP = {
    "activation": "https://blkdms.banglalink.net/ActivationReport",
    "dms_report_C2C": "https://blkdms.banglalink.net/ITopUpStockLifting",
    "dms_report_C2S": "https://blkdms.banglalink.net/rptItopUpSales",
    "dms_report_Balance": "https://blkdms.banglalink.net/ITopUpBalanceReport",
    "scratch_card": "https://blkdms.banglalink.net/RptIssueSCToRetailer",
    "sim_issue": "https://blkdms.banglalink.net/RptIssueSimToRetailer"
}

def get_date_ranges(missing_dates):
    """Group missing dates into ranges (Start, End)"""
    if not missing_dates:
        return []
    
    missing_dates.sort()
    ranges = []
    start = missing_dates[0]
    for i in range(1, len(missing_dates)):
        if missing_dates[i] != missing_dates[i-1] + timedelta(days=1):
            ranges.append((start, missing_dates[i-1]))
            start = missing_dates[i]
    ranges.append((start, missing_dates[-1]))
    return ranges

async def get_missing_dates(session, house_id, model, date_column, dms_type=None, module_key=None, house_code=None):
    """Find gap dates in current month (with SyncHistory)"""
    today = date.today()
    start_of_month = today.replace(day=1)
    yesterday = today - timedelta(days=1)
    
    if yesterday < start_of_month:
        return []

    # 1. Dates in database
    conditions = [
        getattr(model, "house_id") == house_id,
        getattr(model, date_column) >= start_of_month,
        getattr(model, date_column) <= yesterday
    ]
    if dms_type:
        conditions.append(model.report_type == dms_type)

    stmt = select(getattr(model, date_column)).where(and_(*conditions)).distinct()
    result = await session.execute(stmt)
    existing_data_dates = {r[0] for r in result.all() if r[0]}

    # 2. Dates in sync history (success or no-data)
    m_key = module_key or model.__tablename__.replace("_issues", "_issue").replace("_reports", "_report")
    if dms_type: m_key = f"dms_report_{dms_type}"
    
    sync_stmt = select(SyncHistory.sync_date).where(
        and_(
            SyncHistory.house_id == house_id,
            SyncHistory.module_name == m_key,
            SyncHistory.sync_date >= start_of_month,
            SyncHistory.sync_date <= yesterday
        )
    )
    sync_result = await session.execute(sync_stmt)
    synced_dates = {r[0] for r in sync_result.all() if r[0]}

    # Combined list
    covered_dates = existing_data_dates.union(synced_dates)
    
    h_display = house_code or house_id
    logger.info(f"🔍 [Gap Check] {m_key} (House: {h_display}): Existing Data: {len(existing_data_dates)} dates, SyncHistory: {len(synced_dates)} dates. Total Covered: {len(covered_dates)}")

    missing_dates = []
    current_date = start_of_month
    while current_date <= yesterday:
        if current_date not in covered_dates:
            missing_dates.append(current_date)
        current_date += timedelta(days=1)
    
    if missing_dates:
        logger.info(f"📅 [Gap Found] {m_key} ({h_display}): {len(missing_dates)} missing dates. Range: {missing_dates[0]} to {missing_dates[-1]}")
    
    return missing_dates

async def run_daily_auto_sync():
    """Main auto-sync function"""
    from app.models.app_setting import AppSetting

    if not os.path.exists(TEMP_DIR):
        os.makedirs(TEMP_DIR, exist_ok=True)

    async with async_session() as session:
        # Check global settings (super admin/admin can toggle)
        setting_result = await session.execute(
            select(AppSetting).where(AppSetting.id == 1)
        )
        app_setting = setting_result.scalar_one_or_none()
        if app_setting and not app_setting.is_daily_sync_enabled:
            logger.info("ℹ️ [Auto Sync] Daily sync is disabled (AppSettings).")
            return

        result = await session.execute(
            select(House).where(
                House.dms_user != None,
                House.is_active == True,
                House.is_sync_enabled == True
            )
        )
        houses = result.scalars().all()

    if not houses:
        logger.info("ℹ️ [Auto Sync] No houses found to sync.")
        return

    for house in houses:
        try:
            print(f"\n{Fore.CYAN}{Style.BRIGHT}🏠 Auto-sync starting for {house.name}...")
            await sync_house_modules(house)
            await asyncio.sleep(5) 
        except Exception as e:
            logger.error(f"❌ [Auto Sync Error] {house.name}: {str(e)}")

async def mark_sync_complete(house_id, module_name, start_date, end_date, status="success"):
    """Save sync record"""
    async with async_session() as session:
        current_date = start_date
        while current_date <= end_date:
            stmt = insert(SyncHistory).values(
                house_id=house_id,
                module_name=module_name,
                sync_date=current_date,
                status=status
            ).on_conflict_do_update(
                index_elements=['house_id', 'module_name', 'sync_date'],
                set_={'status': status}
            )
            await session.execute(stmt)
            current_date += timedelta(days=1)
        await session.commit()

async def sync_house_modules(house, module_filter=None, progress_callback=None):
    """Download missing ranges for house - improved speed (session reuse)
    
    Args:
        house: House object
        module_filter: Optional list of module name keys to filter (e.g., ["activation", "itopup"])
        progress_callback: Optional async callable for progress messages
    """
    ALL_MODULES = [
        {"name": "Activation", "model": Activation, "date_col": "activation_date", "process_fn": process_activation_excel, "key": "activation"},
        {"name": "ITopUp Detail", "model": ITopUpDetail, "date_col": "report_date", "sub_types": ["C2C", "C2S", "Balance"]},
        {"name": "Scratch Card", "model": ScratchCardIssue, "date_col": "issue_date", "process_fn": process_scratch_card_excel, "key": "scratch_card"},
        {"name": "SIM Issue", "model": SimIssue, "date_col": "issue_date", "process_fn": process_sim_issue_excel, "key": "sim_issue"}
    ]

    modules = ALL_MODULES
    if module_filter:
        filtered = []
        for m in ALL_MODULES:
            name_key = m.get('key') or m['name'].lower().replace(" ", "_")
            if name_key in module_filter:
                filtered.append(m)
            elif 'sub_types' in m and 'itopup' in module_filter:
                filtered.append(m)
        modules = filtered

    credentials = {
        "user": house.dms_user, "pass": house.dms_pass,
        "house_id": house.dms_house_id, "house_name": house.name, "code": house.code
    }

    page = None
    context = None

    try:
        async with async_session() as session:
            for mod in modules:
                mod_name = mod.get('key') or mod['name'].lower().replace(" ", "_")
                if progress_callback:
                    await progress_callback(f"Checking {mod['name']} for {house.name}...")

                # Find missing dates per module
                all_ranges = []
                if 'sub_types' in mod:
                    for sub_type in mod['sub_types']:
                        missing = await get_missing_dates(session, house.id, mod['model'], mod['date_col'], dms_type=sub_type, house_code=house.code)
                        ranges = get_date_ranges(missing)
                        for start_d, end_d in ranges:
                            all_ranges.append({"url_key": f"dms_report_{sub_type}", "start_d": start_d, "end_d": end_d, "fn": process_dms_report_excel, "sub_type": sub_type})
                else:
                    missing = await get_missing_dates(session, house.id, mod['model'], mod['date_col'], module_key=mod.get('key'), house_code=house.code)
                    ranges = get_date_ranges(missing)
                    for start_d, end_d in ranges:
                        all_ranges.append({"url_key": mod_name, "start_d": start_d, "end_d": end_d, "fn": mod['process_fn']})

                if not all_ranges:
                    if progress_callback:
                        await progress_callback(f"No missing dates for {mod['name']} in {house.name}")
                    continue

                if progress_callback:
                    await progress_callback(f"Downloading {len(all_ranges)} range(s) for {mod['name']} in {house.name}...")

                # Only open browser if there's something to download (once)
                if page is None:
                    page, context = await session_manager.get_valid_page(credentials)

                for task in all_ranges:
                    if progress_callback:
                        await progress_callback(f"Downloading {task['url_key']} ({task['start_d']} to {task['end_d']})...")
                    res = await download_and_process(
                        page, house, task['url_key'], 
                        task['start_d'], task['end_d'], 
                        task['fn'], sub_type=task.get('sub_type'),
                        progress_callback=progress_callback
                    )
                    
                    # Save sync record
                    status = "success"
                    if res == "no_data": status = "no_data"
                    await mark_sync_complete(house.id, task['url_key'], task['start_d'], task['end_d'], status)

                    if progress_callback:
                        await progress_callback(f"✓ {task['url_key']}: {'success' if res == 'success' else res}")

    except Exception as e:
        logger.error(f"❌ [Sync Modules Error] {house.name}: {str(e)}")
        if progress_callback:
            await progress_callback(f"✗ Error in {house.name}: {str(e)}")
        raise
    finally:
        if page: await page.close()
        if context: await context.close()

async def sync_activation_module(house_id=None, progress_callback=None):
    """Manually trigger Activation sync for all houses or specific house.
    
    Args:
        house_id: Optional house ID to sync (None = all eligible houses)
        progress_callback: Optional async callable for progress messages
    """
    if not os.path.exists(TEMP_DIR):
        os.makedirs(TEMP_DIR, exist_ok=True)

    async with async_session() as session:
        query = select(House).where(
            House.dms_user != None,
            House.is_active == True,
            House.is_sync_enabled == True
        )
        if house_id:
            query = query.where(House.id == house_id)
        result = await session.execute(query)
        houses = result.scalars().all()

    if not houses:
        if progress_callback:
            await progress_callback("No eligible houses found for sync")
        return

    for house in houses:
        try:
            if progress_callback:
                await progress_callback(f"🏠 Starting sync for {house.name}...")
            await sync_house_modules(house, module_filter=["activation"], progress_callback=progress_callback)
            await asyncio.sleep(5)
        except Exception as e:
            logger.error(f"❌ [Manual Activation Sync Error] {house.name}: {str(e)}")

async def sync_itopup_module(house_id=None, progress_callback=None):
    """Manually trigger iTopUp sync for all houses or specific house.
    
    Args:
        house_id: Optional house ID to sync (None = all eligible houses)
        progress_callback: Optional async callable for progress messages
    """
    if not os.path.exists(TEMP_DIR):
        os.makedirs(TEMP_DIR, exist_ok=True)

    async with async_session() as session:
        query = select(House).where(
            House.dms_user != None,
            House.is_active == True,
            House.is_sync_enabled == True
        )
        if house_id:
            query = query.where(House.id == house_id)
        result = await session.execute(query)
        houses = result.scalars().all()

    if not houses:
        if progress_callback:
            await progress_callback("No eligible houses found for sync")
        return

    for house in houses:
        try:
            if progress_callback:
                await progress_callback(f"🏠 Starting sync for {house.name}...")
            await sync_house_modules(house, module_filter=["itopup"], progress_callback=progress_callback)
            await asyncio.sleep(5)
        except Exception as e:
            logger.error(f"❌ [Manual iTopUp Sync Error] {house.name}: {str(e)}")

async def handle_swal_popup(page, house_name):
    """Handle SweetAlert2 popup"""
    try:
        swal = await page.query_selector(".swal2-container")
        if swal and await swal.is_visible():
            text = await page.inner_text(".swal2-content") or await page.inner_text(".swal2-html-container") or ""
            logger.info(f"ℹ️ [{house_name}] DMS popup: {text.strip()}")
            
            # Close popup by clicking confirm button
            confirm_btn = await page.query_selector("button.swal2-confirm")
            if confirm_btn:
                await confirm_btn.click()
                await asyncio.sleep(1)
            
            if "No data found" in text or "Data not found" in text or "found no data" in text.lower():
                return "no_data"
            return "popup_closed"
    except:
        pass
    return None

async def download_and_process(page, house, url_key, start_date, end_date, process_fn, sub_type=None, progress_callback=None):
    """Download data by range (using existing page) - improved speed & stability"""
    s_date_str = start_date.strftime("%Y-%m-%d")
    e_date_str = end_date.strftime("%Y-%m-%d")
    file_path = os.path.join(TEMP_DIR, f"sync_{url_key}_{house.code}_{s_date_str}_to_{e_date_str}.xlsx")
    
    try:
        url = URL_MAP.get(url_key)
        logger.info(f"🚀 [{house.name}] {url_key} ({s_date_str} to {e_date_str}) download starting...")
        
        # Page navigation
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=60000)
        except:
            await page.goto(url, wait_until="load", timeout=60000)
        
        await page.wait_for_selector("#StartDate", timeout=30000)
        # Set date and trigger 'change' event (for certainty)
        await page.evaluate(f"""
            const sd = document.getElementById('StartDate');
            const ed = document.getElementById('EndDate');
            if(sd) {{ sd.value = '{s_date_str}'; sd.dispatchEvent(new Event('change')); }}
            if(ed) {{ ed.value = '{e_date_str}'; ed.dispatchEvent(new Event('change')); }}
        """)
        await asyncio.sleep(2)

        # 1. Check popup (if already present)
        if await handle_swal_popup(page, house.name) == "no_data":
            return "no_data"

        # 2. Download process
        if "scratch_card" in url_key:
            # View Detail is mandatory for Scratch Card
            await page.click("button:has-text('View Detail')")
            if await handle_swal_popup(page, house.name) == "no_data":
                return "no_data"
                
            try:
                await page.wait_for_selector("#DMSdatatableTest", timeout=20000)
                empty_msg = await page.query_selector("td.dataTables_empty")
                if empty_msg and "No data found" in await empty_msg.inner_text():
                    logger.info(f"ℹ️ [{house.name}] Scratch Card: No data for {s_date_str}-{e_date_str}.")
                    return "no_data"
                
                async with page.expect_download(timeout=180000) as download_info:
                    await page.click("a:has-text('Export Excel')", no_wait_after=True)
                download = await download_info.value
            except Exception as e:
                if await handle_swal_popup(page, house.name) == "no_data": return "no_data"
                logger.error(f"❌ [{house.name}] Scratch Card check failed: {str(e)}")
                return "error"
        else:
            # Direct export for other reports
            selector = "input[value='Export to Excel']"
            if "sim_issue" in url_key: selector = "button:has-text('Export Detail')"
            elif "activation" in url_key: selector = "button:has-text('Export Details')"
            
            async with page.expect_download(timeout=180000) as download_info:
                try:
                    await page.click(selector, timeout=15000, no_wait_after=True)
                except Exception as e:
                    # Handle popup and retry
                    if await handle_swal_popup(page, house.name) == "no_data":
                        return "no_data"
                    await page.click(selector, no_wait_after=True)
            
            download = await download_info.value
        
        await download.save_as(file_path)

        # 4. Processing started
        cb = progress_callback or _noop_progress
        if sub_type:
            count, err = await process_fn(file_path, sub_type, house.id, cb)
        else:
            count, err = await process_fn(file_path, house.id, cb)
            
        if err: 
            if "No data found" in str(err): return "no_data"
            logger.error(f"❌ [{house.name}] Processing error: {err}")
            return "error"
        else: 
            logger.info(f"✅ [{house.name}] {url_key} success. Total: {count}")
            return "success"

    except Exception as e:
        logger.error(f"💥 [{house.name}] {url_key} failed: {str(e)}")
        return "error"
    finally:
        if os.path.exists(file_path): os.remove(file_path)

