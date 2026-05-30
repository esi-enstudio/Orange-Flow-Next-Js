import os
import asyncio
import logging
import pandas as pd
from datetime import date, datetime, timedelta
from sqlalchemy import select, func, and_
from app.Models.house import House
from app.Models.activation import Activation
from app.Models.itopup_detail import ITopUpDetail
from app.Models.scratch_card_issue import ScratchCardIssue
from app.Models.sim_issue import SimIssue
from app.Models.sync_history import SyncHistory
from app.Services.db_service import async_session
from app.Core.session_manager import session_manager
from app.Services.Automation.activation_excel import process_activation_excel
from app.Services.Automation.dms_report_excel import process_dms_report_excel
from app.Services.Automation.issue_reports_excel import process_scratch_card_excel, process_sim_issue_excel
from colorama import Fore, Style
from sqlalchemy.dialects.postgresql import insert

logger = logging.getLogger("app.Services.Automation.Sync")

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
    """মিসিং তারিখগুলোকে রেঞ্জ (Start, End) হিসেবে গ্রুপ করবে"""
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
    """চলতি মাসের গ্যাপ থাকা তারিখগুলো খুঁজে বের করবে (SyncHistory সহ)"""
    today = date.today()
    start_of_month = today.replace(day=1)
    yesterday = today - timedelta(days=1)
    
    if yesterday < start_of_month:
        return []

    # ১. ডাটাবেজে থাকা তারিখগুলো
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

    # ২. সিঙ্ক হিস্ট্রিতে থাকা (সফল বা নো-ডাটা) তারিখগুলো
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

    # কম্বাইনড লিস্ট
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
    """মেইন অটো-সিঙ্ক ফাংশন"""
    if not os.path.exists(TEMP_DIR):
        os.makedirs(TEMP_DIR, exist_ok=True)

    async with async_session() as session:
        result = await session.execute(
            select(House).where(
                House.dms_user != None, 
                House.is_active == True,
                House.is_sync_enabled == True
            )
        )
        houses = result.scalars().all()

    if not houses:
        logger.info("ℹ️ [Auto Sync] সিঙ্ক করার মতো কোনো হাউজ পাওয়া যায়নি।")
        return

    for house in houses:
        try:
            print(f"\n{Fore.CYAN}{Style.BRIGHT}🏠 House: {house.name} এর জন্য অটো-সিঙ্ক শুরু হচ্ছে...")
            await sync_house_modules(house)
            await asyncio.sleep(5) 
        except Exception as e:
            logger.error(f"❌ [Auto Sync Error] {house.name}: {str(e)}")

async def mark_sync_complete(house_id, module_name, start_date, end_date, status="success"):
    """সিঙ্ক হিস্ট্রিতে ডাটা রেকর্ড করা"""
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

async def sync_house_modules(house):
    """হাউজের মিসিং রেঞ্জগুলো ডাউনলোড করবে - ইম্প্রুভড স্পিড (সেশন রি-ইউজ)"""
    modules = [
        {"name": "Activation", "model": Activation, "date_col": "activation_date", "process_fn": process_activation_excel, "key": "activation"},
        {"name": "ITopUp Detail", "model": ITopUpDetail, "date_col": "report_date", "sub_types": ["C2C", "C2S", "Balance"]},
        {"name": "Scratch Card", "model": ScratchCardIssue, "date_col": "issue_date", "process_fn": process_scratch_card_excel, "key": "scratch_card"},
        {"name": "SIM Issue", "model": SimIssue, "date_col": "issue_date", "process_fn": process_sim_issue_excel, "key": "sim_issue"}
    ]

    credentials = {
        "user": house.dms_user, "pass": house.dms_pass,
        "house_id": house.dms_house_id, "house_name": house.name, "code": house.code
    }

    page = None
    context = None

    try:
        async with async_session() as session:
            for mod in modules:
                # মডিউল অনুযায়ী মিসিং তারিখ বের করা
                all_ranges = []
                if mod['name'] == "DMS Report":
                    for sub_type in mod['sub_types']:
                        missing = await get_missing_dates(session, house.id, mod['model'], mod['date_col'], dms_type=sub_type, house_code=house.code)
                        ranges = get_date_ranges(missing)
                        for start_d, end_d in ranges:
                            all_ranges.append({"url_key": f"dms_report_{sub_type}", "start_d": start_d, "end_d": end_d, "fn": process_dms_report_excel, "sub_type": sub_type})
                else:
                    missing = await get_missing_dates(session, house.id, mod['model'], mod['date_col'], module_key=mod.get('key'), house_code=house.code)
                    ranges = get_date_ranges(missing)
                    for start_d, end_d in ranges:
                        all_ranges.append({"url_key": mod['name'].lower().replace(" ", "_"), "start_d": start_d, "end_d": end_d, "fn": mod['process_fn']})

                if not all_ranges:
                    continue

                # যদি কোনো ডাউনলোড করার মতো থাকে, তবেই ব্রাউজার ওপেন করবে (একবার)
                if page is None:
                    page, context = await session_manager.get_valid_page(credentials)

                for task in all_ranges:
                    res = await download_and_process(
                        page, house, task['url_key'], 
                        task['start_d'], task['end_d'], 
                        task['fn'], sub_type=task.get('sub_type')
                    )
                    
                    # সিঙ্ক রেকর্ড সেভ করা
                    status = "success"
                    if res == "no_data": status = "no_data"
                    await mark_sync_complete(house.id, task['url_key'], task['start_d'], task['end_d'], status)

    except Exception as e:
        logger.error(f"❌ [Sync Modules Error] {house.name}: {str(e)}")
    finally:
        if page: await page.close()
        if context: await context.close()

async def handle_swal_popup(page, house_name):
    """SweetAlert2 পপআপ হ্যান্ডেল করবে"""
    try:
        swal = await page.query_selector(".swal2-container")
        if swal and await swal.is_visible():
            text = await page.inner_text(".swal2-content") or await page.inner_text(".swal2-html-container") or ""
            logger.info(f"ℹ️ [{house_name}] DMS পপআপ: {text.strip()}")
            
            # কনফার্ম বাটন ক্লিক করে পপআপ বন্ধ করা
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

async def download_and_process(page, house, url_key, start_date, end_date, process_fn, sub_type=None):
    """রেঞ্জ অনুযায়ী ডাটা ডাউনলোড (Existing Page ব্যবহার করে) - ইম্প্রুভড স্পিড ও স্ট্যাবিলিটি"""
    s_date_str = start_date.strftime("%Y-%m-%d")
    e_date_str = end_date.strftime("%Y-%m-%d")
    file_path = os.path.join(TEMP_DIR, f"sync_{url_key}_{house.code}_{s_date_str}_to_{e_date_str}.xlsx")
    
    try:
        url = URL_MAP.get(url_key)
        logger.info(f"🚀 [{house.name}] {url_key} ({s_date_str} to {e_date_str}) ডাউনলোড শুরু...")
        
        # পেজ নেভিগেশন
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=60000)
        except:
            await page.goto(url, wait_until="load", timeout=60000)
        
        await page.wait_for_selector("#StartDate", timeout=30000)
        # তারিখ সেট করা এবং 'change' ইভেন্ট ট্রিগার করা (নিশ্চিত হওয়ার জন্য)
        await page.evaluate(f"""
            const sd = document.getElementById('StartDate');
            const ed = document.getElementById('EndDate');
            if(sd) {{ sd.value = '{s_date_str}'; sd.dispatchEvent(new Event('change')); }}
            if(ed) {{ ed.value = '{e_date_str}'; ed.dispatchEvent(new Event('change')); }}
        """)
        await asyncio.sleep(2)

        # ১. পপআপ চেক (যদি আগে থেকেই থাকে)
        if await handle_swal_popup(page, house.name) == "no_data":
            return "no_data"

        # ২. ডাউনলোড প্রসেস
        if "scratch_card" in url_key:
            # Scratch Card এর জন্য View Detail করা বাধ্যতামূলক
            await page.click("button:has-text('View Detail')")
            if await handle_swal_popup(page, house.name) == "no_data":
                return "no_data"
                
            try:
                await page.wait_for_selector("#DMSdatatableTest", timeout=20000)
                empty_msg = await page.query_selector("td.dataTables_empty")
                if empty_msg and "No data found" in await empty_msg.inner_text():
                    logger.info(f"ℹ️ [{house.name}] Scratch Card: {s_date_str}-{e_date_str} এ ডাটা নেই।")
                    return "no_data"
                
                async with page.expect_download(timeout=180000) as download_info:
                    await page.click("a:has-text('Export Excel')", no_wait_after=True)
                download = await download_info.value
            except Exception as e:
                if await handle_swal_popup(page, house.name) == "no_data": return "no_data"
                logger.error(f"❌ [{house.name}] Scratch Card check failed: {str(e)}")
                return "error"
        else:
            # অন্যান্য রিপোর্টের জন্য সরাসরি এক্সপোর্ট
            selector = "input[value='Export to Excel']"
            if "sim_issue" in url_key: selector = "button:has-text('Export Detail')"
            elif "activation" in url_key: selector = "button:has-text('Export Details')"
            
            async with page.expect_download(timeout=180000) as download_info:
                try:
                    await page.click(selector, timeout=15000, no_wait_after=True)
                except Exception as e:
                    # পপআপ হ্যান্ডেল করে আবার চেষ্টা
                    if await handle_swal_popup(page, house.name) == "no_data":
                        return "no_data"
                    await page.click(selector, no_wait_after=True)
            
            download = await download_info.value
        
        await download.save_as(file_path)

        # ৪. প্রসেসিং শুরু
        async def silent_progress(text): pass
        if sub_type:
            count, err = await process_fn(file_path, sub_type, house.id, silent_progress)
        else:
            count, err = await process_fn(file_path, house.id, silent_progress)
            
        if err: 
            if "কোনো ডাটা পাওয়া যায়নি" in str(err): return "no_data"
            logger.error(f"❌ [{house.name}] প্রসেসিং এরর: {err}")
            return "error"
        else: 
            logger.info(f"✅ [{house.name}] {url_key} সফল। মোট: {count}")
            return "success"

    except Exception as e:
        logger.error(f"💥 [{house.name}] {url_key} ফেইলড: {str(e)}")
        return "error"
    finally:
        if os.path.exists(file_path): os.remove(file_path)

