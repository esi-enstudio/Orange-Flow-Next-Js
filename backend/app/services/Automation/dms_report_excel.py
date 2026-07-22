import pandas as pd
import logging
import re
import math
from datetime import datetime, timedelta
from sqlalchemy import select, func, delete
from sqlalchemy.dialects.postgresql import insert
from tqdm import tqdm
from colorama import Fore, Style, init

from app.models.itopup_detail import ITopUpDetail
from app.models.house import House
from app.models.retailer import Retailer
from app.services.db_service import async_session

init(autoreset=True)

logger = logging.getLogger(__name__)

CHUNK_SIZE = 5000

def _read_excel(file_path):
    file_ext = file_path.lower().split('.')[-1]
    errors = []
    if file_ext in ('xls', 'xlsx'):
        try:
            engine = 'xlrd' if file_ext == 'xls' else 'openpyxl'
            return pd.read_excel(file_path, dtype=str, engine=engine)
        except Exception as e:
            errors.append(f"excel({file_ext}): {e}")
            try:
                dfs = pd.read_html(file_path)
                if dfs:
                    return dfs[0].astype(str)
            except Exception as e2:
                errors.append(f"html: {e2}")
    try:
        df = pd.read_csv(file_path, dtype=str)
        if len(df.columns) <= 1:
            df = pd.read_csv(file_path, sep='\t', dtype=str)
        return df
    except Exception as e:
        errors.append(f"csv: {e}")
    raise Exception(f"Unable to read file. ({'; '.join(errors)})")


def _find_date_columns(df):
    patterns = [
        re.compile(r'\d{2}-[A-Z]{3}-\d{2}', re.IGNORECASE),
        re.compile(r'\d{2}-[A-Z]{3}-\d{4}', re.IGNORECASE),
        re.compile(r'\d{2}-\d{2}-\d{4}'),
        re.compile(r'\d{2}-\d{2}-\d{2}'),
    ]
    cols = []
    for col in df.columns:
        for p in patterns:
            if p.match(str(col)):
                cols.append(col)
                break
    return cols


async def process_dms_report_excel(file_path, report_type, target_house_id=None, progress_callback=None):
    try:
        df = _read_excel(file_path)
        if df is None or df.empty:
            return 0, "No data found in file."

        df = df.where(pd.notnull(df), None)
        df.columns = [str(c).strip().upper() for c in df.columns]

        date_cols = _find_date_columns(df)
        if not date_cols:
            return 0, "No date column found in file."

        id_cols = ['DISTRIBUTORCODE', 'RETAILER_CODE']
        id_cols = [c for c in id_cols if c in df.columns]

        total_rows = len(df)
        if progress_callback:
            await progress_callback(f"Loading reference data... 0/{total_rows}")

        async with async_session() as session:
            house_res = await session.execute(select(House.code, House.id))
            house_map = {h.code: h.id for h in house_res.all() if h.code}

            retailer_res = await session.execute(select(Retailer.retailer_code, Retailer.id))
            retailer_map = {r.retailer_code: r.id for r in retailer_res.all() if r.retailer_code}

            melted = df.melt(id_vars=id_cols, value_vars=date_cols, var_name='_date', value_name='_val')
            del df

            melted['_val'] = pd.to_numeric(melted['_val'].str.replace(',', '', regex=False), errors='coerce')
            melted = melted.dropna(subset=['_val'])
            melted = melted[melted['_val'] != 0]
            if melted.empty:
                return 0, "No non-zero values found in file."

            melted['house_id'] = melted['DISTRIBUTORCODE'].map(house_map)
            melted = melted.dropna(subset=['house_id'])
            melted['house_id'] = melted['house_id'].astype(int)

            if target_house_id:
                melted = melted[melted['house_id'] == target_house_id]

            if melted.empty:
                return 0, "No matching houses found in file."

            melted['retailer_id'] = melted['RETAILER_CODE'].map(retailer_map).astype(object)
            melted.loc[melted['retailer_id'].isna(), 'retailer_id'] = None
            melted['report_date'] = pd.to_datetime(melted['_date'], format='%d-%b-%y', errors='coerce')
            if melted['report_date'].isna().all():
                melted['report_date'] = pd.to_datetime(melted['_date'], format='%d-%b-%Y', errors='coerce')
            if melted['report_date'].isna().all():
                melted['report_date'] = pd.to_datetime(melted['_date'], errors='coerce')
            melted = melted.dropna(subset=['report_date'])
            melted['report_date'] = melted['report_date'].dt.date

            del melted['_date']

            records = melted.to_dict('records')
            del melted

            total_records = len(records)
            inserted_records = 0
            inserted_count = 0

            insert_stmt = insert(ITopUpDetail)
            upsert_stmt = insert_stmt.on_conflict_do_update(
                constraint='uix_house_retailer_type_date',
                set_={"daily_value": insert_stmt.excluded.daily_value, "updated_at": func.now()}
            )

            pbar = tqdm(total=total_records, desc=f"{Fore.GREEN}DMS Processing", unit="rec", colour='green')

            for i in range(0, total_records, CHUNK_SIZE):
                chunk = records[i:i + CHUNK_SIZE]
                batch = []
                for r in chunk:
                    batch.append({
                        "house_id": r['house_id'],
                        "retailer_id": r.get('retailer_id'),
                        "report_type": report_type,
                        "report_date": r['report_date'],
                        "daily_value": float(r['_val']),
                    })
                await session.execute(upsert_stmt, batch)
                inserted_count += len(batch)
                pbar.update(len(batch))

                if progress_callback:
                    pct = min(round((i + CHUNK_SIZE) / total_records * 100), 100)
                    await progress_callback(
                        f"DMS Processing: {pct}%\n"
                        f"Type: {report_type}\n"
                        f"Saved: {inserted_count} records"
                    )

            await session.commit()
            pbar.close()
            logger.info(f"DMS Report ({report_type}) processed: {inserted_count} records.")
            return inserted_count, None

    except Exception as e:
        if 'pbar' in locals(): pbar.close()
        logger.error(f"DMS Processing Error: {str(e)}")
        return 0, f"Processing error: {str(e)}"


async def cleanup_old_dms_reports():
    two_years_ago = datetime.now() - timedelta(days=365 * 2)
    async with async_session() as session:
        try:
            stmt = delete(ITopUpDetail).where(ITopUpDetail.report_date < two_years_ago.date())
            result = await session.execute(stmt)
            await session.commit()
            if result.rowcount > 0:
                logger.info(f"Cleanup: {result.rowcount} old DMS records deleted.")
        except Exception as e:
            logger.error(f"DMS Cleanup Error: {str(e)}")


import io
from openpyxl import Workbook

async def export_itopup_details_excel(records):
    wb = Workbook()
    ws = wb.active
    ws.title = "iTopUp Details"
    ws.append(["Report Type", "Report Date", "Daily Value", "House Code", "Retailer Code", "Retailer Name"])
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
