import pandas as pd
import os
import asyncio
import logging
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy import select, func

from app.Models.retailer import Retailer
from app.Models.field_force import FieldForce # অটো-লিঙ্কিং এর জন্য জরুরি
from app.Models.house import House
from app.Services.db_service import async_session
from app.Utils.helpers import bn_num

logger = logging.getLogger(__name__)

# এক্সেল হেডার এবং ডাটাবেজ কলামের ম্যাপিং
COLUMN_MAP = {
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
        
        total_rows = len(df)
        if total_rows == 0:
            return 0, "ফাইলটিতে কোনো ডাটা পাওয়া যায়নি।"

        def clean(val):
            v = str(val).strip().replace("'", "")
            if v == "" or v.lower() in ["nan", "none", "null", "0"]:
                return None
            return v

        async with async_session() as session:
            # হাউজ কোড খুঁজে বের করা
            house_res = await session.execute(select(House.code).where(House.id == house_id))
            house_code = house_res.scalar() or str(house_id)

            # ২. পারফরম্যান্স অপ্টিমাইজেশন: ওই হাউজের সকল আরএসও মেমরিতে লোড করা ✅
            logger.info(f"⏳ হাউজ {house_code} এর আরএসও ম্যাপ তৈরি হচ্ছে...")
            ff_res = await session.execute(
                select(FieldForce.itop_number, FieldForce.id).where(FieldForce.house_id == house_id)
            )
            # iTop Number -> FieldForce ID ম্যাপ
            rso_map = {f.itop_number: f.id for f in ff_res.all() if f.itop_number}

            count = 0
            batch_size = 100
            batch_data = []

            for index, row in df.iterrows():
                r_code = clean(row.get('RETAILER_CODE'))
                if not r_code:
                    continue

                # ৩. মেমরি ম্যাপ থেকে আরএসও আইডি খুঁজে বের করা (খুবই দ্রুত) ✅
                itop_sr_no = clean(row.get('I_TOP_UP_SR_NUMBER'))
                linked_ff_id = rso_map.get(itop_sr_no) if itop_sr_no else None

                # ৪. ইনসার্ট ডাটা ডিকশনারি তৈরি
                values_to_insert = {
                    "house_id": house_id,
                    "field_force_id": linked_ff_id,
                    "retailer_code": r_code
                }
                
                for excel_header, db_col in COLUMN_MAP.items():
                    if db_col != 'retailer_code':
                        values_to_insert[db_col] = clean(row.get(excel_header))

                batch_data.append(values_to_insert)

                # ৫. ব্যাচ প্রসেসিং এবং প্রগ্রেস আপডেট ✅
                if len(batch_data) >= batch_size:
                    await do_bulk_upsert(session, batch_data)
                    count += len(batch_data)
                    batch_data = []
                    if progress_callback:
                        await update_progress(count, total_rows, progress_callback)

            # অবশিষ্ট ডাটা প্রসেস করা
            if batch_data:
                await do_bulk_upsert(session, batch_data)
                count += len(batch_data)
                if progress_callback:
                    await update_progress(count, total_rows, progress_callback)

            # সব শেষে একবারই কমিট ✅
            await session.commit()
            logger.info(f"✅ House {house_code}: {count} retailers processed successfully.")
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
        if col != 'retailer_code'
    }
    # house_id আপডেট করার প্রয়োজন নেই, তবে field_force_id আপডেট হতে পারে
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
