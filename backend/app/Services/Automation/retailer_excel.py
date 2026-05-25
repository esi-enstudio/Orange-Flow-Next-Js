import pandas as pd
import os
import asyncio
import logging
from tqdm import tqdm
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy import select, func

from app.Models.retailer import Retailer
from app.Models.field_force import FieldForce # অটো-লিঙ্কিং এর জন্য জরুরি
from app.Models.house import House
from app.Services.db_service import async_session
from app.Utils.helpers import bn_num

logger = logging.getLogger(__name__)

# এক্সেল হেডার এবং ডাটাবেজ কলামের ম্যাপিং (সকল কলাম অন্তর্ভুক্ত করা হলো)
COLUMN_MAP = {
    'CLUSTERNAME': 'cluster',
    'REGION': 'region',
    'DISTRIBUTOR_CODE': 'dd_code',
    'RETAILER_CODE': 'retailer_code',
    'RETAILER_NAME': 'name',
    'RETAILER_TYPE': 'type',
    'ENABLED': 'enabled',
    'SIM_SELLER': 'sim_seller',
    'TRANMOBILENO': 'tran_mobile_no',
    'I_TOP_UP_SR_NUMBER': 'itop_sr_number',
    'I_TOP_UP_NUMBER': 'itop_number',
    'SERVICE_POINT': 'service_point',
    'CATEGORY': 'category',
    'OWNER_NAME': 'owner_name',
    'CONTACT_NO': 'contact_no',
    'DISTRICT': 'district',
    'THANA': 'thana',
    'ADDRESS': 'address',
    'NID': 'nid',
    'BP_CODE': 'bp_code',
    'BP_NUMBER': 'bp_number',
    'DOB': 'dob',
    'ROUTE': 'route'
}

async def process_retailer_excel(file_path, house_id, progress_callback=None):
    """উন্নত বাল্ক প্রসেসিং এবং মেমরি ম্যাপিং লজিক ✅"""
    try:
        # ১. ডাটা লোড
        df = pd.read_excel(file_path, dtype=str)
        df.columns = [c.strip().upper().replace(" ", "_") for c in df.columns]
        logger.info(f"📊 Excel Columns found: {df.columns.tolist()}")
        
        total_rows = len(df)
        if total_rows == 0:
            return 0, "ফাইলটিতে কোনো ডাটা পাওয়া যায়নি।"

        def clean(val):
            v = str(val).strip().replace("'", "")
            if v == "" or v.lower() in ["nan", "none", "null", "0"]:
                return None
            if v.upper() == 'Y': return 'Yes'
            if v.upper() == 'N': return 'No'
            return v

        async with async_session() as session:
            # ২. পারফরম্যান্স অপ্টিমাইজেশন: সকল হাউজ এবং আরএসও মেমরিতে লোড করা ✅
            house_res = await session.execute(select(House).where(House.id == house_id))
            current_house = house_res.scalar_one_or_none()
            if not current_house:
                return 0, f"হাউজ আইডি {house_id} পাওয়া যায়নি।"
            
            target_house_code = current_house.code.upper()
            logger.info(f"🎯 Target House: {current_house.name} ({target_house_code})")
            
            ff_res = await session.execute(select(FieldForce.itop_number, FieldForce.id))
            rso_map = {f.itop_number: f.id for f in ff_res.all() if f.itop_number}

            count = 0
            skipped_count = 0
            batch_size = 500
            batch_data = []

            pbar = tqdm(total=total_rows, desc="🏪 Retailer Uploading", unit="row")

            for index, row in df.iterrows():
                r_code = clean(row.get('RETAILER_CODE'))
                if not r_code:
                    pbar.update(1)
                    continue

                # ৩. মেমরি ম্যাপ থেকে আরএসও আইডি খুঁজে বের করা
                itop_sr_no = clean(row.get('I_TOP_UP_SR_NUMBER'))
                linked_ff_id = rso_map.get(itop_sr_no) if itop_sr_no else None
                
                # ৪. হাউজ ফিল্টারিং লজিক (DISTRIBUTOR_CODE দিয়ে) ✅
                # লজিক: শুধুমাত্র যে হাউজটি সিলেক্ট করা হয়েছে, সেই হাউজের রিটেইলার ইমপোর্ট হবে।
                # যদি ফাইলে অন্য কোনো হাউজ কোড থাকে, তবে সেটি বাদ যাবে।
                distributor_code_val = clean(row.get('DISTRIBUTOR_CODE'))
                
                if distributor_code_val:
                    # যদি ফাইলের কোড এবং আমাদের টার্গেট হাউজ কোড না মিলে, তবে স্কিপ
                    if distributor_code_val.upper() != target_house_code:
                        skipped_count += 1
                        pbar.update(1)
                        continue
                else:
                    # যদি কোড না থাকে, আমরা রিস্ক নেব না, স্কিপ করে দেব (অথবা আপনি চাইলে এখানে ডিফল্ট এলাউ করতে পারেন)
                    # তবে সেফটির জন্য স্কিপ করাই ভালো যেহেতু আপনি বলছেন ৩২৩০ টি হওয়ার কথা।
                    skipped_count += 1
                    pbar.update(1)
                    continue

                # ৫. ইনসার্ট ডাটা ডিকশনারি তৈরি
                values_to_insert = {
                    "house_id": house_id,
                    "field_force_id": linked_ff_id,
                    "retailer_code": r_code
                }
                
                for excel_header, db_col in COLUMN_MAP.items():
                    if db_col not in ['retailer_code', 'dd_code']:
                        values_to_insert[db_col] = clean(row.get(excel_header))

                batch_data.append(values_to_insert)

                # ৬. ব্যাচ প্রসেসিং এবং প্রগ্রেস আপডেট
                if len(batch_data) >= batch_size:
                    await do_bulk_upsert(session, batch_data)
                    count += len(batch_data)
                    pbar.update(len(batch_data))
                    batch_data = []
                    if progress_callback:
                        await update_progress(count, total_rows, progress_callback)

            # অবশিষ্ট ডাটা প্রসেস করা
            if batch_data:
                await do_bulk_upsert(session, batch_data)
                count += len(batch_data)
                pbar.update(len(batch_data))
                if progress_callback:
                    await update_progress(count, total_rows, progress_callback)

            pbar.close()
            # সব শেষে একবারই কমিট ✅
            await session.commit()
            logger.info(f"✅ {count} retailers processed successfully. Skipped: {skipped_count}")
            return count, None

    except Exception as e:
        logger.error(f"❌ Retailer Excel Processing Error: {str(e)}")
        return 0, f"প্রসেসিং এরর: {str(e)}"

async def do_bulk_upsert(session, batch_data):
    """PostgreSQL Bulk Upsert Logic"""
    stmt = insert(Retailer).values(batch_data)
    
    # কনফ্লিক্ট হলে কি কি আপডেট হবে
    excluded = stmt.excluded
    update_cols = {
        col: excluded[col] 
        for col in COLUMN_MAP.values() 
        if col not in ['retailer_code', 'dd_code']
    }
    # house_id এবং field_force_id আপডেট হবে ✅
    update_cols['house_id'] = excluded.house_id
    update_cols['field_force_id'] = excluded.field_force_id
    update_cols['updated_at'] = func.now()

    stmt = stmt.on_conflict_do_update(
        index_elements=['retailer_code'],
        set_=update_cols
    )
    await session.execute(stmt)

async def update_progress(count, total_rows, progress_callback):
    """টেলিগ্রাম প্রগ্রেস আপডেট হেল্পার"""
    percent = round((count / total_rows) * 100)
    await progress_callback(
        f"📊 <b>রিটেইলার আপলোড প্রগ্রেস:</b> {bn_num(percent)}%\n"
        f"📈 প্রসেস হয়েছে: <code>{bn_num(count)}</code> / <code>{bn_num(total_rows)}</code>"
    )
