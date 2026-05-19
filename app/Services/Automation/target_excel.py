import pandas as pd
import logging
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy import func
from app.Models.house_target import HouseTarget
from app.Models.supervisor_target import SupervisorTarget
from app.Models.rso_target import RSOTarget
from app.Services.db_service import async_session
from app.Utils.helpers import bn_num

logger = logging.getLogger(__name__)

def clean_val(val):
    if pd.isna(val):
        return None
    v = str(val).strip().replace("'", "")
    if v == "" or v.lower() in ["nan", "none", "null"]:
        return None
    return v

def clean_float(val):
    if pd.isna(val):
        return 0.0
    try:
        return float(val)
    except:
        return 0.0

def clean_int(val):
    if pd.isna(val):
        return 0
    try:
        return int(float(val))
    except:
        return 0

HOUSE_COLUMN_MAP = {
    'CLUSTER': 'cluster',
    'REGION': 'region',
    'D_CODE': 'house_code',
    'D_NAME': 'house_name',
    'EV_C2C_TARGET': ('ev_c2c_target', clean_float),
    'SC_PRIMARY_TARGET': ('sc_primary_target', clean_float),
    'TOTAL_RECHARGE_TARGET_(EV_C2C+_SC_PRIMARY)': ('total_recharge_target', clean_float),
    'TOTAL_GA_TARGET': ('total_ga_target', clean_int),
    'BP_GA': ('bp_ga', clean_int),
    'RSO_GA': ('rso_ga', clean_int),
    'M2_SURVIVAL': ('m2_survival', clean_int),
    'EV_SCR': ('ev_scr', clean_float),
    'DEVICE_TARGET': ('device_target', clean_int),
    'FWA_TARGET': ('fwa_target', clean_int),
    'SSO': ('sso', clean_int),
    'ALSO': ('also', clean_int),
    'BSO': ('bso', clean_int),
    'DDSO': ('ddso', clean_int),
    'GA_PRODUCTIVITY': ('ga_productivity', clean_float)
}

SUPERVISOR_COLUMN_MAP = {
    'CLUSTER': 'cluster',
    'REGION': 'region',
    'DD_CODE': 'house_code',
    'DD_NAME': 'house_name',
    'RS0_SUPERVISOR_NAME': 'supervisor_name',
    'RS0_SUPERVISOR_MSISDN': 'supervisor_msisdn',
    'EV_SECONDARY': ('ev_secondary', clean_float),
    'SC_SECONDARY': ('sc_secondary', clean_float),
    'TOTAL_RECHAGE_(EV_SECONDARY+SC_SECONDARY)': ('total_recharge', clean_float),
    'TOTAL_GA': ('total_ga', clean_int),
    'BP_GA': ('bp_ga', clean_int),
    'GA_(RSO)': ('ga_rso', clean_int),
    'ASSO': ('asso', clean_int),
    'ALSO': ('also', clean_int),
    'BSO': ('bso', clean_int),
    'DDSO': ('ddso', clean_int)
}

RSO_COLUMN_MAP = {
    'CLUSTER': 'cluster',
    'REGION': 'region',
    'DD_CODE': 'house_code',
    'NEW_MARKET_TYPE': 'new_market_type',
    'ARCHETYPE': 'archetype',
    'TYPE_OF_THANA': 'type_of_thana',
    'DD_NAME': 'house_name',
    'RS0_CODE': 'rso_code',
    "RS0_MSISDN_[I'TOP-UP_NUMBER]": 'rso_msisdn',
    'RS0_NAME': 'rso_name',
    'RS0_SUPERVISOR_NAME': 'supervisor_name',
    'RS0_SUPERVISOR_MSISDN': 'supervisor_msisdn',
    'DD_MANAGER_NAME': 'manager_name',
    'DD_MANAGER_CONTACT_NUMBER': 'manager_contact',
    'EV_SECONDARY': ('ev_secondary', clean_float),
    'SC_SECONDARY': ('sc_secondary', clean_float),
    'TOTAL_RECHAGE_(EV_SECONDARY+SC_SECONDARY)': ('total_recharge', clean_float),
    'GA_(RSO)': ('ga_rso', clean_int),
    'ASSO': ('asso', clean_int),
    'ALSO': ('also', clean_int),
    'BSO': ('bso', clean_int),
    'DDSO': ('ddso', clean_int),
    'MAIN_HOUSE/OSDO/RESIDENTIAL_RSO': 'market_type',
    'THANA_NAME_(ONLY_FOR_OSDO)': 'thana_name',
    'GA_TARGET_(RS0_APP)': ('ga_target_app', clean_int),
    'RS0_RECHARGE_TARGET_(RS0_APP)': ('recharge_target_app', clean_float),
    'ACTIVE_LSO_TARGET_(RSO_APP)': ('active_lso_target_app', clean_int),
    'SSO_TARGET_(RS0_APP)': ('sso_target_app', clean_int),
    'BSO_TARGET_(RS0_APP)': ('bso_target_app', clean_int),
    'DAILY_DSO_TARGET_(RS0_APP)': ('daily_dso_target_app', clean_int)
}

async def process_target_excel(file_path, target_type, month, year, target_house_code=None, progress_callback=None):
    """উন্নত বাল্ক প্রসেসিং লজিক ✅"""
    try:
        df = pd.read_excel(file_path)
        df.columns = [str(c).strip().upper().replace(" ", "_").replace("\n", "_") for c in df.columns]
        
        total_rows = len(df)
        if total_rows == 0:
            return 0, "ফাইলটিতে কোনো ডাটা পাওয়া যায়নি।"

        if target_type == 'house':
            model = HouseTarget
            col_map = HOUSE_COLUMN_MAP
            conflict_elements = ['house_code', 'month', 'year']
        elif target_type == 'supervisor':
            model = SupervisorTarget
            col_map = SUPERVISOR_COLUMN_MAP
            conflict_elements = ['supervisor_msisdn', 'month', 'year']
        elif target_type == 'rso':
            model = RSOTarget
            col_map = RSO_COLUMN_MAP
            conflict_elements = ['rso_code', 'month', 'year']
        else:
            return 0, "Invalid target type"

        async with async_session() as session:
            count = 0
            batch_size = 100
            batch_data = []

            for index, row in df.iterrows():
                values = {"month": month, "year": year}
                
                for excel_header, db_field in col_map.items():
                    if isinstance(db_field, tuple):
                        field_name, cleaner = db_field
                        values[field_name] = cleaner(row.get(excel_header))
                    else:
                        values[db_field] = clean_val(row.get(excel_header))

                h_code = values.get('house_code')
                if not h_code: continue
                
                if target_house_code and str(h_code).strip().upper() != str(target_house_code).strip().upper():
                    continue

                if target_type == 'supervisor' and not values.get('supervisor_msisdn'): continue
                if target_type == 'rso' and not values.get('rso_code'): continue

                batch_data.append(values)

                if len(batch_data) >= batch_size:
                    await do_bulk_upsert_target(session, model, batch_data, conflict_elements)
                    count += len(batch_data)
                    batch_data = []
                    if progress_callback:
                        await update_progress_target(count, total_rows, target_type, progress_callback)

            if batch_data:
                await do_bulk_upsert_target(session, model, batch_data, conflict_elements)
                count += len(batch_data)
                if progress_callback:
                    await update_progress_target(count, total_rows, target_type, progress_callback)

            await session.commit()
            return count, None

    except Exception as e:
        logger.error(f"Error processing {target_type} target excel: {str(e)}")
        return 0, f"Error: {str(e)}"

async def do_bulk_upsert_target(session, model, batch_data, conflict_elements):
    """টার্গেটের জন্য বাল্ক আপসার্ট লজিক"""
    stmt = insert(model).values(batch_data)
    excluded = stmt.excluded
    update_dict = {
        k: getattr(excluded, k) 
        for k in batch_data[0].keys() 
        if k not in conflict_elements
    }
    update_dict['updated_at'] = func.now()
    
    stmt = stmt.on_conflict_do_update(
        index_elements=conflict_elements,
        set_=update_dict
    )
    await session.execute(stmt)

async def update_progress_target(count, total_rows, target_type, progress_callback):
    """টার্গেট প্রগ্রেস আপডেট হেল্পার"""
    percent = round((count / total_rows) * 100)
    await progress_callback(
        f"📊 <b>টার্গেট আপলোড ({target_type}):</b> {bn_num(percent)}%\n"
        f"📈 প্রসেস হয়েছে: <code>{bn_num(count)}</code> / <code>{bn_num(total_rows)}</code>"
    )
