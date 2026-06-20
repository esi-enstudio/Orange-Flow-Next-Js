import pandas as pd
import logging
from collections import defaultdict
from io import BytesIO
from sqlalchemy import select, delete
from app.models.mela import MelaEligibleBTS 
from app.models.bts import BTS
from app.models.house import House
from app.services.db_service import async_session

logger = logging.getLogger(__name__)


def generate_eligible_bts_sample_bytes():
    headers = ['HOUSE CODE', 'BTS CODE']
    df = pd.DataFrame(columns=headers)
    df.loc[0] = ['MYMVAI01', 'BTS001']
    df.loc[1] = ['MYMVAI01', 'BTS002']
    buf = BytesIO()
    with pd.ExcelWriter(buf, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='EligibleBTS')
    buf.seek(0)
    return buf.getvalue()


async def process_eligible_bts_excel(file_path, user_house_ids, progress_callback):
    """Create eligible BTS list from Excel.

    Excel must have columns: HOUSE CODE, BTS CODE.
    Each row specifies which house the BTS belongs to.
    """
    try:
        df = pd.read_excel(file_path, dtype=str)
        df.columns = [c.strip().upper() for c in df.columns]

        if 'BTS CODE' not in df.columns:
            return 0, "Column 'BTS CODE' not found in Excel."
        if 'HOUSE CODE' not in df.columns:
            return 0, "Column 'HOUSE CODE' not found in Excel. First column must be HOUSE CODE."

        async with async_session() as session:
            house_codes = df['HOUSE CODE'].dropna().unique().tolist()
            result = await session.execute(
                select(House.id, House.code).where(House.code.in_(house_codes))
            )
            house_map = {row.code: row.id for row in result.all()}

            unknown_codes = [c for c in house_codes if c not in house_map]
            if unknown_codes:
                return 0, f"Unknown house code(s): {', '.join(unknown_codes)}"

            verified_house_ids = set(house_map.values())
            if user_house_ids is not None:
                blocked = verified_house_ids - set(user_house_ids)
                if blocked:
                    return 0, "You do not have access to one or more houses in the file."

            grouped = defaultdict(list)
            for _, row in df.iterrows():
                house_code = str(row['HOUSE CODE']).strip().upper()
                bts_code = str(row['BTS CODE']).strip().upper()
                if bts_code:
                    grouped[house_code].append(bts_code)

            result = await session.execute(select(BTS.bts_code, BTS.id))
            bts_map = {row.bts_code: row.id for row in result.all()}

            total = sum(len(codes) for codes in grouped.values())
            processed = 0

            for house_code, bts_codes in grouped.items():
                hid = house_map[house_code]
                await session.execute(delete(MelaEligibleBTS).where(MelaEligibleBTS.house_id == hid))

                for bts_code in bts_codes:
                    bts_id = bts_map.get(bts_code)
                    if bts_id:
                        session.add(MelaEligibleBTS(house_id=hid, bts_id=bts_id))
                        processed += 1

                if progress_callback:
                    await progress_callback(
                        f"Processing {house_code}: {len(bts_codes)} BTS codes"
                    )

            await session.commit()
            return processed, None
    except Exception as e:
        logger.error(f"Eligible BTS Upload Error: {e}")
        return 0, str(e)