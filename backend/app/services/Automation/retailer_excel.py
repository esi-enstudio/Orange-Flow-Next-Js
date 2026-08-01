import pandas as pd
import os
import asyncio
import logging
from tqdm import tqdm
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy import select, func

from app.models.retailer import Retailer
from app.models.employee import Employee # Essential for auto-linking
from app.models.house import House
from app.services.db_service import async_session

logger = logging.getLogger(__name__)

# Excel header to database column mapping (all columns included)
COLUMN_MAP = {
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

async def export_retailers_excel(retailers):
    data = []
    for r in retailers:
        data.append({
            'DISTRIBUTOR_CODE': r.house.code if r.house else "",
            'RETAILER_CODE': r.retailer_code,
            'RETAILER_NAME': r.name,
            'RETAILER_TYPE': r.type,
            'ENABLED': r.enabled,
            'SIM_SELLER': r.sim_seller,
            'TRANMOBILENO': r.tran_mobile_no,
            'I_TOP_UP_SR_NUMBER': r.itop_sr_number,
            'I_TOP_UP_NUMBER': r.itop_number,
            'SERVICE_POINT': r.service_point,
            'CATEGORY': r.category,
            'OWNER_NAME': r.owner_name,
            'CONTACT_NO': r.contact_no,
            'DISTRICT': r.district,
            'THANA': r.thana,
            'ADDRESS': r.address,
            'NID': r.nid,
            'BP_CODE': r.bp_code,
            'BP_NUMBER': r.bp_number,
            'DOB': r.dob,
            'ROUTE': r.route
        })
    df = pd.DataFrame(data)
    import io
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Retailers')
    return output.getvalue()

async def process_retailer_excel(file_path, progress_callback=None):
    """Advanced bulk processing with memory mapping ✅"""
    try:
        # 1. Data load
        df = pd.read_excel(file_path, dtype=str)
        df.columns = [c.strip().upper().replace(" ", "_") for c in df.columns]
        logger.info(f"📊 Excel Columns found: {df.columns.tolist()}")
        
        total_rows = len(df)
        if total_rows == 0:
            return 0, "No data found in file."

        def clean(val):
            v = str(val).strip().replace("'", "")
            if v == "" or v.lower() in ["nan", "none", "null", "0"]:
                return None
            if v.upper() == 'Y': return 'Yes'
            if v.upper() == 'N': return 'No'
            return v

        async with async_session() as session:
            # 2. Performance optimization: load all houses and RSOs in memory ✅
            house_res = await session.execute(select(House.id, House.code))
            house_map = {h.code.upper(): h.id for h in house_res.all() if h.code}
            logger.info(f"🏠 Loaded {len(house_map)} houses by code")
            
            emp_res = await session.execute(select(Employee.itop_number, Employee.assisted_retailer_code, Employee.id))
            emp_rows = emp_res.all()
            rso_map = {f.itop_number: f.id for f in emp_rows if f.itop_number}
            assisted_map = {f.assisted_retailer_code: f.id for f in emp_rows if f.assisted_retailer_code}

            count = 0
            skipped_count = 0
            batch_size = 500
            batch_data = []

            pbar = tqdm(total=total_rows, desc="🏪 Retailer Uploading", unit="row")

            for index, row in df.iterrows():
                r_code = clean(row.get('RETAILER_CODE'))
                if not r_code:
                    skipped_count += 1
                    pbar.update(1)
                    continue

                # 3. Lookup employee ID from memory maps.
                # Priority: assisted_retailer_code ownership first (BP/CC assisted codes
                # carry the RSO's iTopUp SR number, so itop_number matching would
                # wrongly attribute BP/CC codes to the RSO). Fall back to itop_number.
                linked_emp_id = assisted_map.get(r_code)
                if linked_emp_id is None:
                    itop_sr_no = clean(row.get('I_TOP_UP_SR_NUMBER'))
                    linked_emp_id = rso_map.get(itop_sr_no) if itop_sr_no else None
                
                # 4. Get house ID via DISTRIBUTOR_CODE (DD Code)
                distributor_code_val = clean(row.get('DISTRIBUTOR_CODE'))
                house_id = None
                if distributor_code_val:
                    house_id = house_map.get(distributor_code_val.upper())
                
                if not house_id:
                    skipped_count += 1
                    pbar.update(1)
                    continue

                # 5. Build insert data dictionary
                values_to_insert = {
                    "house_id": house_id,
                    "employee_id": linked_emp_id,
                    "retailer_code": r_code
                }
                
                for excel_header, db_col in COLUMN_MAP.items():
                    if db_col not in ['retailer_code', 'dd_code']:
                        values_to_insert[db_col] = clean(row.get(excel_header))

                batch_data.append(values_to_insert)

                # 6. Batch processing and progress update
                if len(batch_data) >= batch_size:
                    await do_bulk_upsert(session, batch_data)
                    count += len(batch_data)
                    pbar.update(len(batch_data))
                    batch_data = []
                    if progress_callback:
                        await update_progress(count, total_rows, progress_callback)

            # Process remaining data
            if batch_data:
                await do_bulk_upsert(session, batch_data)
                count += len(batch_data)
                pbar.update(len(batch_data))
                if progress_callback:
                    await update_progress(count, total_rows, progress_callback)

            pbar.close()
            # Single commit at the end ✅
            await session.commit()
            logger.info(f"✅ {count} retailers processed successfully. Skipped: {skipped_count}")
            return count, None

    except Exception as e:
        logger.error(f"❌ Retailer Excel Processing Error: {str(e)}")
        return 0, f"Processing error: {str(e)}"

async def do_bulk_upsert(session, batch_data):
    """PostgreSQL Bulk Upsert Logic"""
    stmt = insert(Retailer).values(batch_data)
    
    # Fields to update on conflict
    excluded = stmt.excluded
    update_cols = {
        col: excluded[col] 
        for col in COLUMN_MAP.values() 
        if col not in ['retailer_code', 'dd_code']
    }
    # house_id and employee_id will be updated ✅
    update_cols['house_id'] = excluded.house_id
    update_cols['employee_id'] = excluded.employee_id
    update_cols['updated_at'] = func.now()

    stmt = stmt.on_conflict_do_update(
        index_elements=['retailer_code'],
        set_=update_cols
    )
    await session.execute(stmt)

async def update_progress(count, total_rows, progress_callback):
    percent = round((count / total_rows) * 100)
    await progress_callback(
        f"Retailers — {percent}%  ({count} / {total_rows})"
    )
