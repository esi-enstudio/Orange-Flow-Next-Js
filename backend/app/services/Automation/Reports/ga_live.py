import os
import asyncio
import logging
import pandas as pd
import warnings
from datetime import date, datetime
from sqlalchemy import select, delete
from sqlalchemy.dialects.postgresql import insert

# Core module imports
from app.models.house import House
from app.models.live_activation import LiveActivation
from app.services.db_service import async_session
from app.core.session_manager import session_manager
from app.models.retailer import Retailer

# Silence openpyxl warnings
warnings.filterwarnings("ignore", category=UserWarning, module="openpyxl")

REPORT_URL = "https://blkdms.banglalink.net/ActivationReport"
TEMP_DIR = "temp_downloads"

logger = logging.getLogger("app.services.Automation.GA")

async def run_ga_live_sync():
    """Main function to sync GA live data for all houses"""
    if not os.path.exists(TEMP_DIR):
        os.makedirs(TEMP_DIR)

    async with async_session() as session:
        # Fetch only houses with DMS credentials and live sync enabled
        result = await session.execute(
            select(House).where(House.dms_user != None, House.is_live_sync_enabled == True)
        )
        houses = result.scalars().all()

    if not houses:
        logger.info("ℹ️ No houses found to sync.")
        return

    logger.info(f"🕒 [GA Sync] Started for {len(houses)} houses...")

    for house in houses:
        try:
            # Sync data for each house separately
            await sync_house_data(house)
            # Processing gap to avoid DMS block
            await asyncio.sleep(5) 
        except Exception as e:
            logger.error(f"❌ [GA Sync Error] {house.name}: {str(e)}")

async def sync_live_activation_module(house_id=None, progress_callback=None):
    """Manually trigger Live Activation sync for all houses or specific house.
    
    Args:
        house_id: Optional house ID to sync (None = all eligible houses)
        progress_callback: Optional async callable for progress messages
    """
    if not os.path.exists(TEMP_DIR):
        os.makedirs(TEMP_DIR)

    async with async_session() as session:
        query = select(House).where(
            House.dms_user != None,
            House.is_live_sync_enabled == True
        )
        if house_id:
            query = query.where(House.id == house_id)
        result = await session.execute(query)
        houses = result.scalars().all()

    if not houses:
        if progress_callback:
            await progress_callback("No eligible houses found for live activation sync")
        return

    for house in houses:
        try:
            await sync_house_data(house, progress_callback=progress_callback)
            await asyncio.sleep(5)
        except Exception as e:
            logger.error(f"❌ [Manual GA Sync Error] {house.name}: {str(e)}")

async def sync_house_data(house, progress_callback=None):
    """Download report using session manager"""
    
    credentials = {
        "user": house.dms_user,
        "pass": house.dms_pass,
        "house_id": house.dms_house_id,
        "house_name": house.name,
        "code": house.code
    }

    file_path = os.path.join(TEMP_DIR, f"ga_{house.code}.xlsx")
    page = None
    context = None
    
    try:
        # Get valid page from session manager
        page, context = await session_manager.get_valid_page(credentials)

        if progress_callback:
            await progress_callback(f"Starting Live Activation sync for {house.name}...")
        logger.info(f"🚀 [GA Sync] {house.name} Report download starting...")
        
        # Navigate to report page (domcontentloaded is more stable)
        await page.goto(REPORT_URL, wait_until="domcontentloaded", timeout=60000)
        
        # Wait for date field and input
        await page.wait_for_selector("#StartDate", timeout=30000)
        
        today_str = date.today().strftime("%Y-%m-%d")
        
        # Using evaluate instead of direct type for safer date input
        await page.evaluate(f"document.getElementById('StartDate').value = '{today_str}';")
        await page.evaluate(f"document.getElementById('EndDate').value = '{today_str}';")
        
        await asyncio.sleep(1) # Input processing gap

        # Download process (click Export Details button)
        async with page.expect_download() as download_info:
            # Wait until button is visible
            await page.wait_for_selector("button:has-text('Export Details')", state="visible")
            await page.click("button:has-text('Export Details')")
        
        download = await download_info.value
        await download.save_as(file_path)

        # Call database update
        await process_and_save_data(file_path, house.id)
        
        if progress_callback:
            await progress_callback(f"✓ Live Activation sync complete for {house.name}")
        logger.info(f"✅ [GA Sync] {house.name} database update successful.")

    except Exception as e:
        logger.error(f"❌ [GA Sync Error] {house.name}: {str(e)}")
        if progress_callback:
            await progress_callback(f"✗ Error in {house.name}: {str(e)}")
        raise
    finally:
        # Close tab and context after work ✅
        if page:
            await page.close()
        if context:
            await context.close()
        
        logger.info(f"🚪 [{house.name}] Task cleanup completed.")

        # Temp file cleanup
        if os.path.exists(file_path):
            os.remove(file_path)



async def process_and_save_data(file_path, house_id):
    """Map all columns and link retailer IDs for data save (with ON CONFLICT DO UPDATE)"""
    try:
        # Read file
        df = pd.read_excel(file_path, dtype=str)
        if df.empty:
            logger.info(f"ℹ️ {file_path} No data found in file.")
            return

        # Clean all NaN and empty values
        df = df.fillna("")
        df = df.replace({pd.NA: "", "nan": "", "NaN": ""})

        async with async_session() as session:
            # Find house code
            house_res = await session.execute(select(House.code).where(House.id == house_id))
            house_code = house_res.scalar() or str(house_id)

            # Build retailer code-to-ID map for fast performance
            ret_res = await session.execute(
                select(Retailer.retailer_code, Retailer.id).where(Retailer.house_id == house_id)
            )
            retailer_map = {str(r.retailer_code).strip(): r.id for r in ret_res.all()}

            records = []
            for _, row in df.iterrows():
                sim_no = str(row.get('SIM_NO', '')).strip()
                ret_code = str(row.get('RETAILER_CODE', '')).strip()
                if not sim_no:
                    continue

                retailer_db_id = retailer_map.get(ret_code)

                def get_val(key):
                    v = str(row.get(key, '')).strip()
                    if ' ' in v and '-' in v:
                        v = v.split(' ')[0]
                    return v

                raw_date = get_val('ACTIVATION_DATE')
                activation_date_val = None
                if raw_date:
                    try:
                        parsed_date = pd.to_datetime(raw_date, format='%d-%b-%Y')
                    except (ValueError, TypeError, AssertionError):
                        try:
                            parsed_date = pd.to_datetime(raw_date, format='%Y-%m-%d')
                        except (ValueError, TypeError, AssertionError):
                            parsed_date = pd.to_datetime(raw_date, errors='coerce')
                    if isinstance(parsed_date, pd.Timestamp) and pd.notna(parsed_date):
                        activation_date_val = parsed_date.date()

                records.append({
                    "house_id": house_id,
                    "retailer_id": retailer_db_id,
                    "activation_date": activation_date_val,
                    "activation_time": get_val('ACTIVATION_TIME'),
                    "retailer_code": ret_code,
                    "retailer_name": get_val('RETAILER_NAME'),
                    "bts_code": get_val('BTS_CODE'),
                    "thana": get_val('THANA'),
                    "promotion": get_val('PROMOTION'),
                    "product_code": get_val('PRODUCT_CODE'),
                    "product_name": get_val('PRODUCT_NAME'),
                    "sim_no": sim_no,
                    "msisdn": get_val('MSISDN'),
                    "selling_price": get_val('SELLING_PRICE'),
                    "bp_flag": get_val('BP_FLAG'),
                    "bp_number": get_val('BP_NUMBER'),
                    "fc_bts_code": get_val('FC_BTS_CODE'),
                    "bio_bts_code": get_val('BIO_BTS_CODE'),
                    "dh_lifting_date": get_val('DH_LIFTINGDATE'),
                    "issue_date": get_val('ISSUEDATE'),
                    "subscription_type": get_val('SUBSCRIPTION_TYPE'),
                    "service_class": get_val('SERVICE_CLASS'),
                    "customer_second_contact": get_val('CUSTOMER_SECOND_CONTACT'),
                })

            # Bulk upsert (ON CONFLICT DO UPDATE) — safely handles duplicate sim_no
            if records:
                unique = {r['sim_no']: r for r in records}.values()
                stmt = insert(LiveActivation).values(list(unique))
                update_cols = {c.name: c for c in stmt.excluded if c.name not in ['sim_no', 'house_id']}
                await session.execute(stmt.on_conflict_do_update(index_elements=['sim_no'], set_=update_cols))
                await session.commit()
                logger.info(f"📊 [Sync] House {house_code}: {len(unique)} records upserted.")
            else:
                logger.info(f"ℹ️ House {house_code}: No new data found.")

    except Exception as e:
        logger.error(f"❌ [Process Error] Data processing error: {str(e)}", exc_info=True)










async def reset_daily_activations():
    """Logic to delete data at midnight"""
    async with async_session() as session:
        try:
            await session.execute(delete(LiveActivation))
            await session.commit()
            logger.info("🧹 [Reset] Live Activation table cleaned successfully.")
        except Exception as e:
            logger.error(f"❌ [Reset Error] Data reset failed: {str(e)}")