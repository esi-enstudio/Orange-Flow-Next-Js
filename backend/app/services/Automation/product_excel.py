import pandas as pd
import os
import logging
from io import BytesIO
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy import select, func
from app.models.product import Product
from app.services.db_service import async_session
from app.utils.helpers import bn_num

logger = logging.getLogger(__name__)

PROD_COLUMNS = [
    "PRODUCT_CODE", "CATEGORY", "SUBCATEGORY", "PRODUCT_NAME",
    "MRP", "DD_LIFTING_PRICE", "RET_LIFTING_PRICE", "STATUS"
]

async def process_product_excel(file_path, progress_callback=None):
    try:
        df = pd.read_excel(file_path, dtype=str)
        df.columns = [c.strip().upper().replace(" ", "_") for c in df.columns]

        total_rows = len(df)
        if total_rows == 0:
            return 0, "No data found in file."

        def clean(val):
            if pd.isna(val):
                return None
            v = str(val).strip().replace("'", "")
            if v == "" or v.lower() in ["nan", "none", "null"]:
                return None
            return v

        def to_float(val):
            try:
                v = clean(val)
                return float(v) if v is not None else 0.0
            except:
                return 0.0

        async with async_session() as session:
            count = 0
            batch_size = 500
            batch_data = []

            for index, row in df.iterrows():
                p_code = clean(row.get("PRODUCT_CODE"))
                if not p_code:
                    continue

                values_to_insert = {
                    "product_code": p_code.upper(),
                    "category": clean(row.get("CATEGORY")) or "Other",
                    "subcategory": clean(row.get("SUBCATEGORY")),
                    "product_name": clean(row.get("PRODUCT_NAME")) or p_code,
                    "mrp": to_float(row.get("MRP")),
                    "dd_lifting_price": to_float(row.get("DD_LIFTING_PRICE")),
                    "ret_lifting_price": to_float(row.get("RET_LIFTING_PRICE")),
                    "status": clean(row.get("STATUS")) or "Active",
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
        logger.error(f"Product Excel Processing Error: {str(e)}")
        return 0, f"Processing error: {str(e)}"

async def do_bulk_upsert(session, batch_data):
    stmt = insert(Product).values(batch_data)
    excluded = stmt.excluded

    update_cols = {
        "category": excluded.category,
        "subcategory": excluded.subcategory,
        "product_name": excluded.product_name,
        "mrp": excluded.mrp,
        "dd_lifting_price": excluded.dd_lifting_price,
        "ret_lifting_price": excluded.ret_lifting_price,
        "status": excluded.status,
        "updated_at": func.now()
    }

    stmt = stmt.on_conflict_do_update(
        index_elements=["product_code"],
        set_=update_cols
    )
    await session.execute(stmt)

async def update_progress(count, total_rows, progress_callback):
    percent = round((count / total_rows) * 100)
    await progress_callback(
        f"Product Upload Progress: {bn_num(percent)}%\n"
        f"Processed: {bn_num(count)} / {bn_num(total_rows)}"
    )

async def export_products_excel(products):
    data = []
    for p in products:
        data.append({
            "PRODUCT_CODE": p.product_code,
            "CATEGORY": p.category,
            "SUBCATEGORY": p.subcategory or "",
            "PRODUCT_NAME": p.product_name,
            "MRP": p.mrp,
            "DD_LIFTING_PRICE": p.dd_lifting_price,
            "RET_LIFTING_PRICE": p.ret_lifting_price,
            "STATUS": p.status,
        })
    df = pd.DataFrame(data, columns=PROD_COLUMNS)
    buf = BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Products")
    buf.seek(0)
    return buf.getvalue()

def generate_product_sample_excel(file_path):
    df = pd.DataFrame(columns=PROD_COLUMNS)
    df.loc[0] = ["SIM001", "SIM", "Prepaid", "Sample SIM 4G", "100", "90", "95", "Active"]
    df.loc[1] = ["SCR001", "Scratch Card", "Data", "Sample Scratch 50", "50", "45", "47", "Active"]
    df.to_excel(file_path, index=False)
    return file_path

def generate_product_sample_bytes():
    df = pd.DataFrame(columns=PROD_COLUMNS)
    df.loc[0] = ["SIM001", "SIM", "Prepaid", "Sample SIM 4G", "100", "90", "95", "Active"]
    df.loc[1] = ["SCR001", "Scratch Card", "Data", "Sample Scratch 50", "50", "45", "47", "Active"]
    buf = BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Products")
    buf.seek(0)
    return buf.getvalue()
