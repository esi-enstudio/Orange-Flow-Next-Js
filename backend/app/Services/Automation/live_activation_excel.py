import pandas as pd
import logging
from datetime import date
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy import select, func
from tqdm import tqdm
from colorama import Fore, Style, init

from app.Models.live_activation import LiveActivation
from app.Models.retailer import Retailer
from app.Models.house import House
from app.Services.db_service import async_session

init(autoreset=True)
logger = logging.getLogger(__name__)

def resilient_read_excel(file_path):
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
                    if dfs: df = dfs[0].astype(str)
                except Exception:
                    df = pd.read_csv(file_path, dtype=str)
                    if len(df.columns) <= 1:
                        df = pd.read_csv(file_path, sep='\t', dtype=str)
        else:
            df = pd.read_excel(file_path, dtype=str)
    except Exception as e:
        logger.error(f"Excel Read Error: {str(e)}")
        raise e
    if df is not None:
        df = df.where(pd.notnull(df), None)
    return df

async def process_live_activation_excel(file_path, progress_callback=None):
    try:
        print(f"\n{Fore.CYAN}{Style.BRIGHT}🚀 Live Activation Processing Started...")
        df = resilient_read_excel(file_path)
        if df is None or df.empty:
            return 0, "ফাইলটি খালি।"
        df.columns = [c.strip().upper().replace(" ", "_") for c in df.columns]
        total_rows = len(df)

        today_date = date.today()

        def clean(val):
            if val is None: return None
            v = str(val).strip()
            if v.startswith("'"): v = v[1:]
            if v == "" or v.lower() in ["nan", "none", "null"]:
                return None
            if ' ' in v and '-' in v:
                v = v.split(' ')[0]
            return v if v else None

        async with async_session() as session:
            house_res = await session.execute(select(House.code, House.id))
            house_map = {h.code: h.id for h in house_res.all() if h.code}
            ret_res = await session.execute(select(Retailer.retailer_code, Retailer.id))
            retailer_map = {r.retailer_code: r.id for r in ret_res.all() if r.retailer_code}

            processed_count = 0
            inserted_count = 0
            skipped_count = 0
            today_count = 0
            batch_buffer = []
            batch_size = 500
            pbar = tqdm(total=total_rows, desc=f"{Fore.GREEN}Live Activation", unit="row", colour='green')

            for _, row in df.iterrows():
                sim_no = clean(row.get('SIM_NO'))
                if not sim_no:
                    processed_count += 1
                    pbar.update(1)
                    continue
                try:
                    raw_date = row.get('ACTIVATION_DATE')
                    act_date = pd.to_datetime(raw_date).date() if raw_date else None
                except:
                    act_date = None

                if act_date != today_date:
                    processed_count += 1
                    skipped_count += 1
                    pbar.update(1)
                    continue

                today_count += 1
                r_code = clean(row.get('RETAILER_CODE'))
                dist_code = clean(row.get('DISTRIBUTORCODE')) or clean(row.get('DISTRIBUTOR_CODE'))
                house_id = house_map.get(dist_code) if dist_code else None
                target_retailer_id = retailer_map.get(r_code) if r_code else None

                batch_buffer.append({
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
                })

                if len(batch_buffer) >= batch_size:
                    unique = {item['sim_no']: item for item in batch_buffer}.values()
                    stmt = insert(LiveActivation).values(list(unique))
                    update_cols = {c.name: c for c in stmt.excluded if c.name not in ['sim_no']}
                    await session.execute(stmt.on_conflict_do_update(index_elements=['sim_no'], set_=update_cols))
                    inserted_count += len(batch_buffer)
                    batch_buffer = []
                processed_count += 1
                pbar.update(1)
                if progress_callback and (processed_count % 200 == 0 or processed_count == total_rows):
                    await progress_callback(
                        f"Live Activations — {round((processed_count/total_rows)*100)}%"
                        f" ({processed_count} / {total_rows})"
                    )

            if today_count == 0:
                pbar.close()
                return 0, f"আজকের ({today_date}) তারিখের কোন ডাটা ফাইলে নেই। শুধুমাত্র আজকের ডাটা ইম্পোর্ট করা যাবে।"

            if batch_buffer:
                unique = {item['sim_no']: item for item in batch_buffer}.values()
                stmt = insert(LiveActivation).values(list(unique))
                update_cols = {c.name: c for c in stmt.excluded if c.name not in ['sim_no']}
                await session.execute(stmt.on_conflict_do_update(index_elements=['sim_no'], set_=update_cols))
                inserted_count += len(batch_buffer)
            await session.commit()
            pbar.close()
            msg = f"✅ {inserted_count} টি রেকর্ড ইম্পোর্ট করা হয়েছে (আজকের {today_date})"
            if skipped_count:
                msg += f" | {skipped_count} টি রেকর্ড বাদ দেওয়া হয়েছে (আজকের তারিখ নয়)"
            print(f"{Fore.GREEN}{msg}\n")
            return inserted_count, None
    except Exception as e:
        if 'pbar' in locals(): pbar.close()
        logger.error(f"Live Activation Error: {str(e)}")
        return 0, str(e)

import io
from openpyxl import Workbook

async def export_live_activations_excel(records):
    wb = Workbook()
    ws = wb.active
    ws.title = "Live Activations"
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
