import pandas as pd
import logging
import re
from datetime import datetime, timedelta
from sqlalchemy import select, func, delete
from sqlalchemy.dialects.postgresql import insert
from tqdm import tqdm
from colorama import Fore, Style, init

# ... rest of imports
from app.models.itopup_detail import ITopUpDetail
from app.models.house import House
from app.models.retailer import Retailer
from app.services.db_service import async_session
from app.utils.helpers import bn_num

# Initialize colorama
init(autoreset=True)

logger = logging.getLogger(__name__)

async def process_dms_report_excel(file_path, report_type, target_house_id=None, progress_callback=None):
    """
    Process DMS C2C, C2S, Balance reports.
    Supports both .xlsx and .xls files.
    """
    try:
        # 1. Excel load (Resilient Loading)
        print(f"\n{Fore.CYAN}{Style.BRIGHT}🚀 DMS Report Processing Started...")
        print(f"{Fore.YELLOW}📂 File: {file_path} | Type: {report_type}")
        
        df = None
        file_ext = file_path.lower().split('.')[-1]
        
        try:
            if file_ext == 'xls' or file_ext == 'xlsx':
                try:
                    # 1. Standard Excel (xlrd for xls, openpyxl for xlsx)
                    engine = 'xlrd' if file_ext == 'xls' else 'openpyxl'
                    df = pd.read_excel(file_path, dtype=str, engine=engine)
                except Exception:
                    try:
                        # 2. DMS often names HTML files as .xls
                        dfs = pd.read_html(file_path)
                        if dfs:
                            df = dfs[0].astype(str)
                    except Exception:
                        # 3. File is actually CSV or Tab-Separated
                        try:
                            df = pd.read_csv(file_path, dtype=str)
                            # If all data is in one column, try with tab
                            if len(df.columns) <= 1:
                                df = pd.read_csv(file_path, sep='\t', dtype=str)
                        except Exception:
                            raise Exception("Unsupported or corrupted Excel format")
            else:
                # Other extension (e.g. direct csv)
                df = pd.read_excel(file_path, dtype=str)
        except Exception as e:
            logger.error(f"Excel Read Error: {str(e)}")
            return 0, f"Unable to read file. It may be a protected or corrupted file. (Error: {str(e)})"

        if df is None or df.empty:
            return 0, "No data found in file."
        
        # NaN handling
        df = df.where(pd.notnull(df), None)
        
        df.columns = [str(c).strip().upper() for c in df.columns]
        
        # 2. Find date columns
        date_cols = []
        patterns = [
            re.compile(r'\d{2}-[A-Z]{3}-\d{2}', re.IGNORECASE),  # 01-MAY-26
            re.compile(r'\d{2}-[A-Z]{3}-\d{4}', re.IGNORECASE), # 01-JAN-2026
            re.compile(r'\d{2}-\d{2}-\d{4}'),                   # 01-01-2026
            re.compile(r'\d{2}-\d{2}-\d{2}')                    # 01-01-26
        ]

        for col in df.columns:
            for pattern in patterns:
                if pattern.match(str(col)):
                    date_cols.append(col)
                    break
        
        if not date_cols:
            logger.warning(f"No date columns found in {file_path}. Columns: {list(df.columns)}")
            return 0, "No date column found in file."

        async with async_session() as session:
            # 3. House and retailer map (performance optimization)
            print(f"{Fore.GREEN}{Style.BRIGHT}⏳ Loading house and retailer data...")
            
            # House Map: code -> id
            house_res = await session.execute(select(House.code, House.id))
            house_map = {h.code: h.id for h in house_res.all() if h.code}
            
            # Retailer Map: retailer_code -> id
            retailer_res = await session.execute(select(Retailer.retailer_code, Retailer.id))
            retailer_map = {r.retailer_code: r.id for r in retailer_res.all() if r.retailer_code}

            total_rows = len(df)
            processed_rows = 0
            inserted_records = 0
            batch_buffer = [] # Buffer for bulk insert
            batch_size = 500  # Hit database every 500 records

            # Quick upsert statement
            insert_stmt = insert(ITopUpDetail)
            upsert_stmt = insert_stmt.on_conflict_do_update(
                constraint='uix_house_retailer_type_date',
                set_={
                    "daily_value": insert_stmt.excluded.daily_value, 
                    "updated_at": func.now()
                }
            )

            # Terminal Progress Bar
            pbar = tqdm(total=total_rows, desc=f"{Fore.GREEN}{Style.BRIGHT}DMS Processing", unit="row", colour='green')

            for _, row in df.iterrows():
                dist_code = str(row.get('DISTRIBUTORCODE', '')).strip()
                ret_code = str(row.get('RETAILER_CODE', '')).strip()
                
                house_id = house_map.get(dist_code)
                if not house_id:
                    processed_rows += 1
                    pbar.update(1)
                    continue
                
                # Skip other houses if specific house is selected
                if target_house_id and house_id != target_house_id:
                    processed_rows += 1
                    pbar.update(1)
                    continue

                retailer_id = retailer_map.get(ret_code)
                
                for date_str in date_cols:
                    try:
                        raw_val = str(row.get(date_str, '0')).replace(',', '').strip()
                        value = float(raw_val) if raw_val and raw_val.lower() != 'nan' else 0.0
                    except ValueError:
                        value = 0.0
                    
                    if value == 0:
                        continue

                    try:
                        report_date = pd.to_datetime(date_str).date()
                    except Exception:
                        continue

                    # Add data to buffer
                    batch_buffer.append({
                        "house_id": house_id,
                        "retailer_id": retailer_id,
                        "report_type": report_type,
                        "report_date": report_date,
                        "daily_value": value
                    })

                    # Bulk execute when buffer full
                    if len(batch_buffer) >= batch_size:
                        await session.execute(upsert_stmt, batch_buffer)
                        inserted_records += len(batch_buffer)
                        batch_buffer = []

                processed_rows += 1
                pbar.update(1)
                
                # Progress update (Telegram)
                if progress_callback and (processed_rows % 50 == 0 or processed_rows == total_rows):
                    percent = round((processed_rows / total_rows) * 100)
                    await progress_callback(
                        f"🚀 DMS Processing: {percent}%\n"
                        f"📂 Type: {report_type}\n"
                        f"📈 Row: {processed_rows} / {total_rows}\n"
                        f"💾 Saved: {inserted_records + len(batch_buffer)} records"
                    )

            # Save remaining
            if batch_buffer:
                await session.execute(upsert_stmt, batch_buffer)
                inserted_records += len(batch_buffer)

            await session.commit()
            pbar.close()
            print(f"{Fore.GREEN}{Style.BRIGHT}✅ Success: {inserted_records} records processed successfully.\n")
            
            logger.info(f"✅ DMS Report ({report_type}) processed: {inserted_records} records saved.")
            return inserted_records, None

    except Exception as e:
        if 'pbar' in locals(): pbar.close()
        print(f"\n{Fore.RED}{Style.BRIGHT}❌ Error: {str(e)}")
        logger.error(f"❌ DMS Report Processing Error: {str(e)}")
        return 0, f"Processing error: {str(e)}"


async def cleanup_old_dms_reports():
    """Delete data older than 2 years"""
    two_years_ago = datetime.now() - timedelta(days=365 * 2)
    async with async_session() as session:
        try:
            stmt = delete(ITopUpDetail).where(ITopUpDetail.report_date < two_years_ago.date())
            result = await session.execute(stmt)
            await session.commit()
            if result.rowcount > 0:
                logger.info(f"🧹 Cleanup: {result.rowcount} old DMS records deleted.")
        except Exception as e:
            logger.error(f"❌ DMS Cleanup Error: {str(e)}")


import io
from openpyxl import Workbook

async def export_itopup_details_excel(records):
    wb = Workbook()
    ws = wb.active
    ws.title = "iTopUp Details"
    headers = ["Report Type", "Report Date", "Daily Value", "House Code", "Retailer Code", "Retailer Name"]
    ws.append(headers)
    for r in records:
        ws.append([
            r.report_type, str(r.report_date) if r.report_date else "", r.daily_value,
            r.house.code if r.house else "",
            r.retailer.retailer_code if r.retailer else "",
            r.retailer.name if r.retailer else ""
        ])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.getvalue()
