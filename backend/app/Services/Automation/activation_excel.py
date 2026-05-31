import pandas as pd
import logging
import os
import asyncio
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy import select, func
from tqdm import tqdm
from colorama import Fore, Style, init

from app.Models.activation import Activation
from app.Models.retailer import Retailer
from app.Models.house import House
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
                engine = 'xlrd' if file_ext == 'xls' else 'openpyxl'
                df = pd.read_excel(file_path, dtype=str, engine=engine)
            except Exception:
                try:
                    dfs = pd.read_html(file_path)
                    if dfs:
                        df = dfs[0].astype(str)
                except Exception:
                    try:
                        df = pd.read_csv(file_path, dtype=str)
                        if len(df.columns) <= 1:
                            df = pd.read_csv(file_path, sep='\t', dtype=str)
                    except Exception:
                        df = pd.read_excel(file_path, dtype=str)
        else:
            df = pd.read_excel(file_path, dtype=str)
    except Exception as e:
        logger.error(f"Resilient Excel Read Error: {str(e)}")
        raise e
    
    # NaN হ্যান্ডেলিং
    if df is not None:
        df = df.where(pd.notnull(df), None)
        
    return df

async def process_activation_excel(file_path, house_id, progress_callback):
    """উন্নত বাল্ক প্রসেসিং লজিক (৯,৫০০+ ডাটার জন্য অপ্টিমাইজড) ✅"""
    try:
        # ১. ডাটা লোড (Resilient)
        print(f"\n{Fore.CYAN}{Style.BRIGHT}🚀 Activation Processing Started...")
        df = resilient_read_excel(file_path)
        if df is None or df.empty:
            return 0, "ফাইলটি খালি।"

        df.columns = [c.strip().upper().replace(" ", "_") for c in df.columns]
        total_rows = len(df)

        def clean(val):
            if val is None: return None
            v = str(val).strip()
            # Excel এ leading single quote থাকলে তা সরানো
            if v.startswith("'"):
                v = v[1:]
            v = v.replace("'", "")
            if v == "" or v.lower() in ["nan", "none", "null"]:
                return None

            # তারিখ থেকে সময় বাদ দেওয়া
            if ' ' in v and '-' in v:
                v = v.split(' ')[0]  # "2026-04-21 00:00:00" -> "2026-04-21"

            return v if v else None

        async with async_session() as session:
            # হাউজ কোড খুঁজে বের করা
            house_res = await session.execute(select(House.code).where(House.id == house_id))
            house_code = house_res.scalar() or str(house_id)

            # ২. পারফরম্যান্স বুস্ট: সব রিটেইলারকে মেমরিতে নিয়ে আসা ✅
            print(f"{Fore.YELLOW}⏳ হাউজ {house_code} এর রিটেইলার ম্যাপ তৈরি হচ্ছে...")
            ret_res = await session.execute(
                select(Retailer.retailer_code, Retailer.id).where(Retailer.house_id == house_id)
            )
            retailer_map = {r.retailer_code: r.id for r in ret_res.all()}

            processed_count = 0
            inserted_count = 0
            batch_buffer = []
            batch_size = 500  # ৫০০ রেকর্ডের ব্যাচ

            # Terminal Progress Bar
            pbar = tqdm(total=total_rows, desc=f"{Fore.GREEN}{Style.BRIGHT}GA Processing", unit="row", colour='green')

            # ৩. ডাটা প্রসেসিং লুপ
            for _, row in df.iterrows():
                sim_no = clean(row.get('SIM_NO'))
                if not sim_no:
                    processed_count += 1
                    pbar.update(1)
                    continue
                
                r_code = clean(row.get('RETAILER_CODE'))
                target_retailer_id = retailer_map.get(r_code) if r_code else None

                # তারিখ প্রসেসিং
                try:
                    raw_date = row.get('ACTIVATION_DATE')
                    act_date = pd.to_datetime(raw_date).date() if raw_date else None
                except:
                    act_date = None

                # ডাটা ম্যাপ
                data_map = {
                    "house_id": house_id,
                    "retailer_id": target_retailer_id,
                    "sim_no": sim_no,
                    "activation_date": act_date,
                    "activation_time": clean(row.get('ACTIVATION_TIME')),
                    "retailer_code": r_code,
                    "retailer_name": clean(row.get('RETAILER_NAME')),
                    "bts_code": clean(row.get('BTS_CODE')),
                    "thana": clean(row.get('THANA')),
                    "promotion": clean(row.get('PROMOTION')),
                    "product_code": clean(row.get('PRODUCT_CODE')),
                    "product_name": clean(row.get('PRODUCT_NAME')),
                    "msisdn": clean(row.get('MSISDN')),
                    "selling_price": clean(row.get('SELLING_PRICE')),
                    "bp_flag": clean(row.get('BP_FLAG')),
                    "bp_number": clean(row.get('BP_NUMBER')),
                    "fc_bts_code": clean(row.get('FC_BTS_CODE')),
                    "bio_bts_code": clean(row.get('BIO_BTS_CODE')),
                    "dh_lifting_date": clean(row.get('DH_LIFTINGDATE')),
                    "issue_date": clean(row.get('ISSUEDATE')),
                    "subscription_type": clean(row.get('SUBSCRIPTION_TYPE')),
                    "service_class": clean(row.get('SERVICE_CLASS')),
                    "customer_second_contact": clean(row.get('CUSTOMER_SECOND_CONTACT')),
                    "updated_at": func.now()
                }

                batch_buffer.append(data_map)

                if len(batch_buffer) >= batch_size:
                    # ৪. PostgreSQL Bulk Upsert (Deduplication within batch is required)
                    # একই ব্যাচে একই sim_no থাকলে CardinalityViolationError দেয়।
                    # তাই ব্যাচটিকে ডিকশনারি ম্যাপ ব্যবহার করে ইউনিক করছি।
                    unique_batch = {item['sim_no']: item for item in batch_buffer}.values()
                    
                    insert_stmt = insert(Activation).values(list(unique_batch))
                    update_cols = {c.name: c for c in insert_stmt.excluded if c.name not in ['sim_no', 'house_id']}
                    upsert_stmt = insert_stmt.on_conflict_do_update(
                        index_elements=['sim_no'],
                        set_=update_cols
                    )
                    await session.execute(upsert_stmt)
                    inserted_count += len(batch_buffer)
                    batch_buffer = []

                processed_count += 1
                pbar.update(1)

                # ৫. টেলিগ্রাম প্রগ্রেস আপডেট (থ্রোটলিং)
                if processed_count % 200 == 0 or processed_count == total_rows:
                    percent = round((processed_count / total_rows) * 100)
                    await progress_callback(
                        f"📊 Activation Import Progress: {percent}%\n"
                        f"📈 Processed: {processed_count} / {total_rows}\n"
                        f"💾 Saved: {inserted_count + len(batch_buffer)} records"
                    )
            
            # অবশিষ্টাংশ সেভ করা
            if batch_buffer:
                unique_batch = {item['sim_no']: item for item in batch_buffer}.values()
                insert_stmt = insert(Activation).values(list(unique_batch))
                update_cols = {c.name: c for c in insert_stmt.excluded if c.name not in ['sim_no', 'house_id']}
                upsert_stmt = insert_stmt.on_conflict_do_update(
                    index_elements=['sim_no'],
                    set_=update_cols
                )
                await session.execute(upsert_stmt)
                inserted_count += len(batch_buffer)

            await session.commit()
            pbar.close()
            print(f"{Fore.GREEN}{Style.BRIGHT}✅ Success: {inserted_count} records processed successfully.\n")
            return inserted_count, None

    except Exception as e:
        if 'pbar' in locals(): pbar.close()
        logger.error(f"❌ Critical Sync Error: {str(e)}")
        return 0, f"{str(e)}"


import io
from openpyxl import Workbook

async def export_activations_excel(records):
    wb = Workbook()
    ws = wb.active
    ws.title = "Activations"
    headers = ["SIM No", "Activation Date", "Activation Time", "Retailer Code", "Retailer Name",
               "BTS Code", "Thana", "Promotion", "Product Code", "Product Name", "MSISDN",
               "Selling Price", "BP Flag", "BP Number", "FC BTS Code", "Bio BTS Code",
               "DH Lifting Date", "Issue Date", "Subscription Type", "Service Class",
               "Customer Second Contact", "House Code"]
    ws.append(headers)
    for r in records:
        ws.append([
            r.sim_no, r.activation_date, r.activation_time, r.retailer_code, r.retailer_name,
            r.bts_code, r.thana, r.promotion, r.product_code, r.product_name, r.msisdn,
            r.selling_price, r.bp_flag, r.bp_number, r.fc_bts_code, r.bio_bts_code,
            r.dh_lifting_date, r.issue_date, r.subscription_type, r.service_class,
            r.customer_second_contact, r.house.code if r.house else ""
        ])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.getvalue()