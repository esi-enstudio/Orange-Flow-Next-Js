import pandas as pd
import logging
from sqlalchemy import select, delete
from app.models.mela import MelaEligibleBTS 
from app.models.bts import BTS
from app.services.db_service import async_session

logger = logging.getLogger(__name__)

async def process_eligible_bts_excel(file_path, house_id, progress_callback):
    """Create eligible BTS list from Excel"""
    try:
        df = pd.read_excel(file_path, dtype=str)
        # Remove header spaces and uppercase
        df.columns = [c.strip().upper() for c in df.columns]
        
        if 'BTS CODE' not in df.columns:
            return 0, "Column 'BTS CODE' not found in Excel."

        total = len(df)
        async with async_session() as session:
            # Delete previous eligible list for fresh upload
            await session.execute(delete(MelaEligibleBTS ).where(MelaEligibleBTS .house_id == house_id))
            
            count = 0
            for index, row in df.iterrows():
                bts_code = str(row['BTS CODE']).strip().upper()
                
                # Lookup IDs from bts_list table ✅
                res = await session.execute(select(BTS.id).where(BTS.bts_code == bts_code))
                bts_id = res.scalar_one_or_none()

                if bts_id:
                    session.add(MelaEligibleBTS (house_id=house_id, bts_id=bts_id))
                    count += 1
                
                # Progress update
                if (index + 1) % 10 == 0 or (index + 1) == total:
                    await progress_callback(f"⏳ Processing: {round(((index+1)/total)*100)}% ({index+1}/{total})")
            
            await session.commit()
            return count, None
    except Exception as e:
        logger.error(f"Eligible BTS Upload Error: {e}")
        return 0, str(e)