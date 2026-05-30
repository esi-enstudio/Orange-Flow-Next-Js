import pandas as pd
import io
import logging
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from app.Models.bts import BTS
from app.Models.house import House
from app.Services.db_service import async_session

logger = logging.getLogger(__name__)

BTS_MAP = {
    'SITE ID': 'site_id', 'BTS CODE': 'bts_code', 'SITE TYPE': 'site_type',
    'THANA': 'thana', 'THANA BN': 'thana_bn', 'DISTRICT': 'district',
    'DISTRICT BN': 'district_bn', 'DIVISION': 'division', 'DIVISION BN': 'division_bn',
    'CLUSTER': 'cluster', 'CLUSTER BN': 'cluster_bn', 'REGION': 'region',
    'REGION BN': 'region_bn', 'NETWORK MODE': 'network_mode', 'ADDRESS': 'address',
    'ADDRESS BN': 'address_bn', 'SHORT ADDRESS': 'short_address',
    'SHORT ADDRESS BN': 'short_address_bn', 'LONGITUDE': 'longitude',
    'LATITUDE': 'latitude', 'ARCHETYPE': 'archetype', 'MARKET': 'market',
    'DISTRIBUTOR CODE': 'distributor_code', '2GONAIRDATE': 'onair_date_2g',
    '3GONAIRDATE': 'onair_date_3g', '4GONAIRDATE': 'onair_date_4g',
    'URBAN_RURAL': 'urban_rural', 'PRIORITY': 'priority'
}

async def process_bts_excel(file_path, progress_callback=None):
    try:
        df = pd.read_excel(file_path, dtype=str)
        df.columns = [c.strip().upper() for c in df.columns]
        total = len(df)
        logger.info(f"BTS Excel columns: {df.columns.tolist()}")

        def clean(val):
            v = str(val).strip()
            if v == "" or v.lower() in ["nan", "none", "null", "n/a"]:
                return None
            return v

        async with async_session() as session:
            house_res = await session.execute(select(House.id, House.code))
            house_map = {h.code.upper(): h.id for h in house_res.all() if h.code}
            logger.info(f"Loaded {len(house_map)} houses by code")

            count = 0
            skipped = 0
            batch_size = 100
            batch_data = []

            for index, row in df.iterrows():
                data = {}
                for excel_key, db_key in BTS_MAP.items():
                    data[db_key] = clean(row.get(excel_key))

                if not data.get('bts_code') or not data.get('site_id'):
                    skipped += 1
                    continue

                distributor_code = data.get('distributor_code')
                if distributor_code:
                    house_id = house_map.get(distributor_code.upper())
                    if house_id:
                        data['house_id'] = house_id
                    else:
                        skipped += 1
                        continue
                else:
                    skipped += 1
                    continue

                batch_data.append(data)

                if len(batch_data) >= batch_size:
                    await do_bulk_upsert_bts(session, batch_data)
                    count += len(batch_data)
                    batch_data = []

                if progress_callback and ((index + 1) % 50 == 0 or (index + 1) == total):
                    progress_callback(f"BTS Import: {round(((index+1)/total)*100)}% ({index+1}/{total})")

            if batch_data:
                await do_bulk_upsert_bts(session, batch_data)
                count += len(batch_data)

            await session.commit()
            logger.info(f"BTS import complete: {count} imported, {skipped} skipped")
            return count, None

    except Exception as e:
        logger.error(f"BTS Excel processing error: {str(e)}")
        return 0, str(e)

async def do_bulk_upsert_bts(session, batch_data):
    stmt = insert(BTS).values(batch_data)
    excluded = stmt.excluded
    update_cols = {
        col: getattr(excluded, col)
        for col in batch_data[0].keys()
        if col not in ['bts_code', 'house_id']
    }
    stmt = stmt.on_conflict_do_update(
        index_elements=['bts_code'],
        set_=update_cols
    )
    await session.execute(stmt)

async def export_bts_excel(bts_list):
    data = []
    for b in bts_list:
        data.append({
            'SITE ID': b.site_id,
            'BTS CODE': b.bts_code,
            'SITE TYPE': b.site_type,
            'THANA': b.thana,
            'THANA BN': b.thana_bn,
            'DISTRICT': b.district,
            'DISTRICT BN': b.district_bn,
            'DIVISION': b.division,
            'DIVISION BN': b.division_bn,
            'CLUSTER': b.cluster,
            'CLUSTER BN': b.cluster_bn,
            'REGION': b.region,
            'REGION BN': b.region_bn,
            'NETWORK MODE': b.network_mode,
            'ADDRESS': b.address,
            'ADDRESS BN': b.address_bn,
            'SHORT ADDRESS': b.short_address,
            'SHORT ADDRESS BN': b.short_address_bn,
            'LONGITUDE': b.longitude,
            'LATITUDE': b.latitude,
            'ARCHETYPE': b.archetype,
            'MARKET': b.market,
            'DISTRIBUTOR CODE': b.distributor_code,
            '2GONAIRDATE': b.onair_date_2g,
            '3GONAIRDATE': b.onair_date_3g,
            '4GONAIRDATE': b.onair_date_4g,
            'URBAN_RURAL': b.urban_rural,
            'PRIORITY': b.priority,
        })
    df = pd.DataFrame(data)
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='BTS')
    return output.getvalue()

async def generate_bts_sample(file_path):
    headers = [
        'SITE ID', 'BTS CODE', 'SITE TYPE', 'THANA', 'THANA BN', 'DISTRICT',
        'DISTRICT BN', 'DIVISION', 'DIVISION BN', 'CLUSTER', 'CLUSTER BN', 'REGION',
        'REGION BN', 'NETWORK MODE', 'ADDRESS', 'ADDRESS BN', 'SHORT ADDRESS',
        'SHORT ADDRESS BN', 'LONGITUDE', 'LATITUDE', 'ARCHETYPE', 'MARKET',
        'DISTRIBUTOR CODE', '2GONAIRDATE', '3GONAIRDATE', '4GONAIRDATE',
        'URBAN_RURAL', 'PRIORITY'
    ]
    df = pd.DataFrame(columns=headers)
    df.to_excel(file_path, index=False)
    return file_path
