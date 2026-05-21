import pandas as pd
import os
import asyncio
import logging
from tqdm import tqdm
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy import select, func
from datetime import datetime, timedelta

from app.Models.house import House
from app.Services.db_service import async_session
from app.Utils.helpers import bn_num

logger = logging.getLogger(__name__)

HOUSE_COLUMNS = [
    'CLUSTER', 'REGION', 'WH_REGION', 'DISTRIBUTOR_CODE', 'DISTRIBUTOR_NAME',
    'DISTRICT', 'EMAIL', 'ADDRESS_REG', 'ADDRESS_PRESENT', 'PROPRIETOR_NAME', 
    'PROPRIETOR_CONTACT', 'POC_NAME', 'POC_MOBILE', 'LIFTING_DATE', 
    'LATITUDE', 'LONGITUDE', 'BTS_ID', 'DMS_USER', 'DMS_PASS', 'DMS_HOUSE_ID'
]

async def process_house_excel(file_path, progress_callback=None):
    """হাউজ বাল্ক প্রসেসিং লজিক (রিবিল্ট ভার্সন) ✅"""
    try:
        df = pd.read_excel(file_path, dtype=str)
        # হেডার ক্লিন করা (স্পেসকে আন্ডারস্কোর করা এবং আপারকেস)
        df.columns = [c.strip().upper().replace(" ", "_") for c in df.columns]
        
        total_rows = len(df)
        if total_rows == 0: return 0, [], "ফাইলটিতে কোনো ডাটা পাওয়া যায়নি।"

        def clean(val):
            if pd.isna(val): return None
            v = str(val).strip()
            if v == "" or v.lower() in ["nan", "none", "null"]:
                return None
            return v

        async with async_session() as session:
            count = 0
            created_house_ids = []
            pbar = tqdm(total=total_rows, desc="🏠 House Uploading", unit="row")

            for index, row in df.iterrows():
                # হেডার ডিটেকশন আরও ফ্লেক্সিবল করা হলো ✅
                code = clean(row.get('DISTRIBUTOR_CODE')) or clean(row.get('CODE')) or clean(row.get('DISTRIBUTOR_CODE_'))
                name = clean(row.get('DISTRIBUTOR_NAME')) or clean(row.get('NAME')) or clean(row.get('DISTRIBUTOR_NAME_'))
                
                if not code or not name:
                    logger.warning(f"⚠️ Row {index} skipped: Code={code}, Name={name}")
                    pbar.update(1)
                    continue

                # ডাটা ম্যাপ (Excel Header -> DB Column)
                data_values = {
                    "cluster": clean(row.get('CLUSTER')),
                    "region": clean(row.get('REGION')),
                    "wh_region": clean(row.get('WH_REGION')) or clean(row.get('WHREGION')),
                    "code": code,
                    "name": name,
                    "district": clean(row.get('DISTRICT')),
                    "email": clean(row.get('EMAIL')) or clean(row.get('EMAIL_ADDRESS')) or clean(row.get('EMAIL_ID')),
                    "address_reg": clean(row.get('ADDRESS_REG')) or clean(row.get('DISTRIBUTOR_ADDRESS_AS_PER_REGISTRATION/TRADE_LICENSE')) or clean(row.get('REGISTRATION_ADDRESS')),
                    "address": clean(row.get('ADDRESS_PRESENT')) or clean(row.get('PRESENT_ADDRESS_OF_THE_DISTRIBUTION_HOUSE')) or clean(row.get('PRESENT_ADDRESS')),
                    "proprietor_name": clean(row.get('PROPRIETOR_NAME')) or clean(row.get('OWNER_NAME')),
                    "proprietor_contact": clean(row.get('PROPRIETOR_CONTACT')) or clean(row.get('PROPRIETOR_CONTACT_NUMBER')) or clean(row.get('OWNER_CONTACT')),
                    "poc_name": clean(row.get('POC_NAME')),
                    "poc_mobile": clean(row.get('POC_MOBILE')) or clean(row.get('POC_MOBILE_NUMBER')) or clean(row.get('POC_CONTACT')),
                    "lifting_date": clean(row.get('LIFTING_DATE')),
                    "latitude": clean(row.get('LATITUDE')),
                    "longitude": clean(row.get('LONGITUDE')),
                    "bts_id": clean(row.get('BTS_ID')) or clean(row.get('BTSID')),
                    "dms_user": clean(row.get('DMS_USER')),
                    "dms_pass": clean(row.get('DMS_PASS')),
                    "dms_house_id": clean(row.get('DMS_HOUSE_ID')),
                    "subscription_date": datetime.now() + timedelta(days=365),
                    "is_active": True
                }
                
                stmt = insert(House).values(data_values)

                # কনফ্লিক্ট হলে আপডেট
                excluded = stmt.excluded
                update_cols = {
                    col: getattr(excluded, col) 
                    for col in data_values.keys() 
                    if col not in ['code']
                }
                update_cols['updated_at'] = func.now()

                stmt = stmt.on_conflict_do_update(
                    index_elements=['code'],
                    set_=update_cols
                )
                
                await session.execute(stmt)
                
                # আইডি সংগ্রহ
                h_res = await session.execute(select(House.id).where(House.code == code))
                h_id = h_res.scalar()
                if h_id: created_house_ids.append(h_id)

                count += 1
                pbar.update(1)
                if progress_callback and count % 5 == 0:
                    await update_progress_house(count, total_rows, progress_callback)

            pbar.close()
            await session.commit()
            return count, created_house_ids, None

    except Exception as e:
        logger.error(f"❌ House Excel Processing Error: {str(e)}")
        return 0, [], f"প্রসেসিং এরর: {str(e)}"

async def update_progress_house(count, total_rows, progress_callback):
    percent = round((count / total_rows) * 100)
    await progress_callback(
        f"📊 <b>হাউজ আপলোড প্রগ্রেস:</b> {bn_num(percent)}%\n"
        f"📈 প্রসেস হয়েছে: <code>{bn_num(count)}</code> / <code>{bn_num(total_rows)}</code>"
    )
