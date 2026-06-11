import pandas as pd
import os
import logging
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy import select, func
from app.models.product import Product
from app.services.db_service import async_session
from app.utils.helpers import bn_num

logger = logging.getLogger(__name__)

COLUMN_MAP = {
    'PRODUCT_CODE': 'product_code',
    'PRODUCT_TYPE': 'product_type',
    'MRP': 'mrp',
    'DD_LIFTING_PRICE': 'dd_lifting_price',
    'RET_LIFTING_PRICE': 'ret_lifting_price'
}

async def process_product_excel(file_path, progress_callback=None):
    try:
        df = pd.read_excel(file_path, dtype=str)
        df.columns = [c.strip().upper().replace(" ", "_") for c in df.columns]
        
        total_rows = len(df)
        if total_rows == 0:
            return 0, "No data found in file."

        def clean(val):
            v = str(val).strip().replace("'", "")
            if v == "" or v.lower() in ["nan", "none", "null", "0"]:
                return None
            return v

        def to_float(val):
            try:
                return float(clean(val) or 0)
            except:
                return 0.0

        async with async_session() as session:
            count = 0
            batch_size = 500
            batch_data = []

            for index, row in df.iterrows():
                p_code = clean(row.get('PRODUCT_CODE'))
                if not p_code:
                    continue

                values_to_insert = {
                    "product_code": p_code,
                    "product_type": clean(row.get('PRODUCT_TYPE')),
                    "mrp": to_float(row.get('MRP')),
                    "dd_lifting_price": to_float(row.get('DD_LIFTING_PRICE')),
                    "ret_lifting_price": to_float(row.get('RET_LIFTING_PRICE'))
                }

                batch_data.append(values_to_insert)

                if len(batch_data) >= batch_size:
                    await do_bulk_upsert(session, batch_data)
                    count += len(batch_data)
                    batch_data = []
                    if progress_callback:
                        await update_progress(count, total_rows, progress_callback)

            if batch_data:
                await do_bulk_upsert(session, batch_data)
                count += len(batch_data)
                if progress_callback:
                    await update_progress(count, total_rows, progress_callback)

            await session.commit()
            return count, None

    except Exception as e:
        logger.error(f"❌ Product Excel Processing Error: {str(e)}")
        return 0, f"Processing error: {str(e)}"

async def do_bulk_upsert(session, batch_data):
    stmt = insert(Product).values(batch_data)
    excluded = stmt.excluded
    
    update_cols = {
        "product_type": excluded.product_type,
        "mrp": excluded.mrp,
        "dd_lifting_price": excluded.dd_lifting_price,
        "ret_lifting_price": excluded.ret_lifting_price,
        "updated_at": func.now()
    }

    stmt = stmt.on_conflict_do_update(
        index_elements=['product_code'],
        set_=update_cols
    )
    await session.execute(stmt)

async def update_progress(count, total_rows, progress_callback):
    percent = round((count / total_rows) * 100)
    await progress_callback(
        f"📊 <b>Product Upload Progress:</b> {bn_num(percent)}%\n"
        f"📈 Processed: <code>{bn_num(count)}</code> / <code>{bn_num(total_rows)}</code>"
    )

def generate_product_sample_excel(file_path):
    df = pd.DataFrame(columns=COLUMN_MAP.keys())
    # Add a sample row
    df.loc[0] = ["P123", "Voice", "100", "90", "95"]
    df.to_excel(file_path, index=False)
    return file_path
