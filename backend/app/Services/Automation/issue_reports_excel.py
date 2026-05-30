import pandas as pd
import logging
import re
import os
from datetime import datetime
from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert
from tqdm import tqdm
from colorama import Fore, Style, init

from app.Models.scratch_card_issue import ScratchCardIssue
from app.Models.sim_issue import SimIssue
from app.Models.house import House
from app.Models.retailer import Retailer
from app.Services.db_service import async_session
from app.Utils.helpers import bn_num

# Initialize colorama
init(autoreset=True)

logger = logging.getLogger(__name__)

def resilient_read_excel(file_path):
    """
    বিভিন্ন ফরম্যাটের (xlsx, xls, html, csv) এক্সেল ফাইল পড়ার জন্য রেজিলিয়েন্ট ফাংশন।
    """
    df = None
    file_ext = file_path.lower().split('.')[-1]
    
    try:
        if file_ext in ['xls', 'xlsx']:
            try:
                # ১. চেষ্টা: স্ট্যান্ডার্ড এক্সেল (xlrd for xls, openpyxl for xlsx)
                engine = 'xlrd' if file_ext == 'xls' else 'openpyxl'
                df = pd.read_excel(file_path, dtype=str, engine=engine)
            except Exception:
                try:
                    # ২. চেষ্টা: DMS অনেক সময় HTML ফাইলকে .xls নামে সেভ করে
                    dfs = pd.read_html(file_path)
                    if dfs:
                        df = dfs[0].astype(str)
                except Exception:
                    # ৩. চেষ্টা: অনেক সময় ফাইলটি আসলে CSV বা Tab-Separated হতে পারে
                    try:
                        df = pd.read_csv(file_path, dtype=str)
                        if len(df.columns) <= 1:
                            df = pd.read_csv(file_path, sep='\t', dtype=str)
                    except Exception:
                        # ৪. শেষ চেষ্টা: ইঞ্জিন ছাড়াই ট্রাই করো
                        df = pd.read_excel(file_path, dtype=str)
        else:
            # অন্য কোনো এক্সটেনশন হলে
            df = pd.read_excel(file_path, dtype=str)
    except Exception as e:
        logger.error(f"Resilient Excel Read Error: {str(e)}")
        raise e
    
    # NaN হ্যান্ডেলিং: সব NaN ভ্যালুকে None (NULL) দিয়ে রিপ্লেস করা
    if df is not None:
        df = df.where(pd.notnull(df), None)
    
    return df

def clean_val(val, default=None):
    """ভ্যালু ক্লিনিং এবং NaN হ্যান্ডেলিং"""
    if val is None or str(val).lower() in ['nan', 'none', 'null', '']:
        return default
    return str(val).strip()

async def process_scratch_card_excel(file_path, target_house_id=None, progress_callback=None):
    """
    Scratch Card Issue রিপোর্ট প্রসেস করার প্রফেশনাল সার্ভিস।
    """
    try:
        # ১. এক্সেল লোড করা (Resilient)
        print(f"\n{Fore.CYAN}{Style.BRIGHT}🚀 Scratch Card Processing Started...")
        df = resilient_read_excel(file_path)
        if df is None or df.empty:
            return 0, "ফাইলটিতে কোনো ডাটা পাওয়া যায়নি।"
        
        # কলাম নাম ক্লিনিং
        df.columns = [str(c).strip() for c in df.columns]

        async with async_session() as session:
            # হাউজ এবং রিটেইলার ম্যাপ তৈরি
            print(f"{Fore.YELLOW}⏳ হাউজ এবং রিটেইলার ডাটা লোড হচ্ছে...")
            house_res = await session.execute(select(House.code, House.id))
            house_map = {h.code: h.id for h in house_res.all() if h.code}
            
            retailer_res = await session.execute(select(Retailer.retailer_code, Retailer.id))
            retailer_map = {r.retailer_code: r.id for r in retailer_res.all() if r.retailer_code}

            total_rows = len(df)
            processed_rows = 0
            inserted_records = 0
            batch_buffer = []
            batch_size = 500

            pbar = tqdm(total=total_rows, desc=f"{Fore.MAGENTA}{Style.BRIGHT}SC Processing", unit="row")

            for _, row in df.iterrows():
                dist_code = clean_val(row.get('DistributorCode'), '')
                ret_code = clean_val(row.get('RetailerCode'), '')
                
                house_id = house_map.get(dist_code)
                if not house_id or (target_house_id and house_id != target_house_id):
                    processed_rows += 1
                    pbar.update(1)
                    continue

                retailer_id = retailer_map.get(ret_code)
                
                # তারিখ হ্যান্ডেলিং
                try:
                    raw_issue = row.get('IssueDate')
                    issue_date = pd.to_datetime(raw_issue).date() if raw_issue else None
                except:
                    issue_date = None
                
                try:
                    raw_lifting = row.get('LiftingDate')
                    lifting_date = pd.to_datetime(raw_lifting).date() if raw_lifting else None
                except:
                    lifting_date = None

                batch_buffer.append({
                    "cluster_name": clean_val(row.get('Cluster_Name')),
                    "region": clean_val(row.get('Region')),
                    "issue_date": issue_date,
                    "issue_time": clean_val(row.get('IssueTime')),
                    "lifting_date": lifting_date,
                    "distributor_name": clean_val(row.get('Distributor')),
                    "distributor_code": dist_code,
                    "house_id": house_id,
                    "retailer_name": clean_val(row.get('Retailer')),
                    "retailer_code": ret_code,
                    "retailer_id": retailer_id,
                    "route_code": clean_val(row.get('RouteCode')),
                    "product_name": clean_val(row.get('Product')),
                    "product_code": clean_val(row.get('ProductCode')),
                    "start_sc_no": clean_val(row.get('StartSCNo')),
                    "end_sc_no": clean_val(row.get('EndSCNo')),
                    "rso_code": clean_val(row.get('RSOCode')),
                    "quantity": int(float(str(row.get('Quantity', 0)))) if row.get('Quantity') else 0,
                    "value": float(str(row.get('Value', 0)).replace(',', '')) if row.get('Value') else 0.0
                })

                if len(batch_buffer) >= batch_size:
                    await session.execute(insert(ScratchCardIssue), batch_buffer)
                    inserted_records += len(batch_buffer)
                    batch_buffer = []

                processed_rows += 1
                pbar.update(1)
                
                if progress_callback and (processed_rows % 50 == 0 or processed_rows == total_rows):
                    percent = round((processed_rows / total_rows) * 100)
                    await progress_callback(
                        f"🎫 <b>SC প্রসেসিং:</b> {bn_num(percent)}%\n"
                        f"📈 রো: <code>{bn_num(processed_rows)}</code> / <code>{bn_num(total_rows)}</code>\n"
                        f"💾 সেভ: <code>{bn_num(inserted_records + len(batch_buffer))}</code> টি"
                    )

            if batch_buffer:
                await session.execute(insert(ScratchCardIssue), batch_buffer)
                inserted_records += len(batch_buffer)

            await session.commit()
            pbar.close()
            print(f"{Fore.GREEN}{Style.BRIGHT}✅ Success: {inserted_records} records processed successfully.\n")
            return inserted_records, None

    except Exception as e:
        if 'pbar' in locals(): pbar.close()
        logger.error(f"Scratch Card Processing Error: {str(e)}")
        return 0, str(e)

async def process_sim_issue_excel(file_path, target_house_id=None, progress_callback=None):
    """
    SIM Issue রিপোর্ট প্রসেস করার প্রফেশনাল সার্ভিস।
    """
    try:
        # ১. এক্সেল লোড করা (Resilient)
        print(f"\n{Fore.CYAN}{Style.BRIGHT}🚀 SIM Issue Processing Started...")
        df = resilient_read_excel(file_path)
        if df is None or df.empty:
            return 0, "ফাইলটিতে কোনো ডাটা পাওয়া যায়নি।"
        
        df.columns = [str(c).strip().upper() for c in df.columns]

        async with async_session() as session:
            print(f"{Fore.YELLOW}⏳ হাউজ এবং রিটেইলার ডাটা লোড হচ্ছে...")
            house_res = await session.execute(select(House.code, House.id))
            house_map = {h.code: h.id for h in house_res.all() if h.code}
            
            retailer_res = await session.execute(select(Retailer.retailer_code, Retailer.id))
            retailer_map = {r.retailer_code: r.id for r in retailer_res.all() if r.retailer_code}

            total_rows = len(df)
            processed_rows = 0
            inserted_records = 0
            batch_buffer = []
            batch_size = 500

            pbar = tqdm(total=total_rows, desc=f"{Fore.GREEN}{Style.BRIGHT}SIM Processing", unit="row", colour='green')

            for _, row in df.iterrows():
                dist_code = clean_val(row.get('DISTRIBUTORCODE'), '')
                ret_code = clean_val(row.get('RETAILERCODE'), '')
                
                house_id = house_map.get(dist_code)
                if not house_id or (target_house_id and house_id != target_house_id):
                    processed_rows += 1
                    pbar.update(1)
                    continue

                retailer_id = retailer_map.get(ret_code)
                
                try:
                    raw_issue = row.get('ISSUEDATE')
                    issue_date = pd.to_datetime(raw_issue).date() if raw_issue else None
                except:
                    issue_date = None

                batch_buffer.append({
                    "issue_date": issue_date,
                    "distributor_code": dist_code,
                    "distributor_name": clean_val(row.get('DISTRIBUTORNAME')),
                    "house_id": house_id,
                    "cluster_market": clean_val(row.get('CLUSTER_MARKET')),
                    "retailer_code": ret_code,
                    "retailer_name": clean_val(row.get('RETAILERNAME')),
                    "retailer_id": retailer_id,
                    "promotion": clean_val(row.get('PROMOTION')),
                    "product_code": clean_val(row.get('PRODUCTCODE')),
                    "product_name": clean_val(row.get('PRODUCTNAME')),
                    "selling_price": float(str(row.get('SELLINGPRICE', 0))) if row.get('SELLINGPRICE') else 0.0,
                    "sim_no": clean_val(row.get('SIMNO'), '')
                })

                if len(batch_buffer) >= batch_size:
                    stmt = insert(SimIssue).values(batch_buffer).on_conflict_do_nothing(index_elements=['sim_no'])
                    await session.execute(stmt) 
                    inserted_records += len(batch_buffer)
                    batch_buffer = []

                processed_rows += 1
                pbar.update(1)
                
                if progress_callback and (processed_rows % 50 == 0 or processed_rows == total_rows):
                    percent = round((processed_rows / total_rows) * 100)
                    await progress_callback(
                        f"📲 <b>SIM প্রসেসিং:</b> {bn_num(percent)}%\n"
                        f"📈 রো: <code>{bn_num(processed_rows)}</code> / <code>{bn_num(total_rows)}</code>\n"
                        f"💾 সেভ: <code>{bn_num(inserted_records + len(batch_buffer))}</code> টি"
                    )

            if batch_buffer:
                stmt = insert(SimIssue).values(batch_buffer).on_conflict_do_nothing(index_elements=['sim_no'])
                await session.execute(stmt)
                inserted_records += len(batch_buffer)

            await session.commit()
            pbar.close()
            print(f"{Fore.GREEN}{Style.BRIGHT}✅ Success: {inserted_records} records processed successfully.\n")
            return inserted_records, None

    except Exception as e:
        if 'pbar' in locals(): pbar.close()
        logger.error(f"SIM Issue Processing Error: {str(e)}")
        return 0, str(e)


import io
from openpyxl import Workbook

async def export_scratch_card_excel(records):
    wb = Workbook()
    ws = wb.active
    ws.title = "Scratch Card Issues"
    headers = ["Cluster", "Region", "Issue Date", "Issue Time", "Lifting Date", "Distributor",
               "Distributor Code", "Retailer", "Retailer Code", "Route Code", "Product",
               "Product Code", "Start SC No", "End SC No", "RSO Code", "Quantity", "Value"]
    ws.append(headers)
    for r in records:
        ws.append([
            r.cluster_name, r.region, str(r.issue_date) if r.issue_date else "", r.issue_time,
            str(r.lifting_date) if r.lifting_date else "", r.distributor_name,
            r.distributor_code, r.retailer_name, r.retailer_code, r.route_code,
            r.product_name, r.product_code, r.start_sc_no, r.end_sc_no, r.rso_code,
            r.quantity, r.value
        ])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.getvalue()

async def export_sim_issue_excel(records):
    wb = Workbook()
    ws = wb.active
    ws.title = "SIM Issues"
    headers = ["Issue Date", "Distributor Code", "Distributor Name", "Cluster Market",
               "Retailer Code", "Retailer Name", "Promotion", "Product Code", "Product Name",
               "Selling Price", "SIM No"]
    ws.append(headers)
    for r in records:
        ws.append([
            str(r.issue_date) if r.issue_date else "", r.distributor_code, r.distributor_name,
            r.cluster_market, r.retailer_code, r.retailer_name, r.promotion,
            r.product_code, r.product_name, r.selling_price, r.sim_no
        ])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.getvalue()


