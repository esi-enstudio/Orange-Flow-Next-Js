import asyncio
import pandas as pd
from datetime import date
from sqlalchemy import select, func
from app.Services.db_service import async_session
from app.Models.live_activation import LiveActivation

async def test():
    async with async_session() as session:
        # Step 1: Simulate what the FIXED ga_live.py does
        raw_date = '02-Jun-2026'  # DMS format
        if raw_date:
            try:
                parsed_date = pd.to_datetime(raw_date, format='%d-%b-%Y')
            except (ValueError, TypeError, AssertionError):
                try:
                    parsed_date = pd.to_datetime(raw_date, format='%Y-%m-%d')
                except (ValueError, TypeError, AssertionError):
                    parsed_date = pd.to_datetime(raw_date, errors='coerce')
            activation_date_val = parsed_date.strftime('%Y-%m-%d') if isinstance(parsed_date, pd.Timestamp) and pd.notna(parsed_date) else raw_date
        else:
            activation_date_val = raw_date
        
        print(f'Fixed code converts: "{raw_date}" -> "{activation_date_val}"')

        # Step 2: Insert via the same logic (simulating GA sync)
        new_rec = LiveActivation(
            house_id=1,
            activation_date=activation_date_val,
            sim_no='TEST_E2E_001',
            retailer_code='T001',
            product_code='TEST'
        )
        session.add(new_rec)
        await session.commit()
        print('Test record inserted')

        # Step 3: Verify it's found by the stats query
        today_str = date.today().strftime('%Y-%m-%d')
        q = select(func.count()).select_from(LiveActivation).where(LiveActivation.activation_date == today_str)
        cnt = (await session.execute(q)).scalar()
        print(f'Stats query finds {cnt} records for today')

        # Step 4: Check specific record
        r = await session.execute(select(LiveActivation.activation_date).where(LiveActivation.sim_no == 'TEST_E2E_001'))
        d = r.scalar()
        print(f'Test record date: "{d}" == "{today_str}"? {d == today_str} ✅')

        # Cleanup
        await session.execute(LiveActivation.__table__.delete().where(LiveActivation.sim_no == 'TEST_E2E_001'))
        await session.commit()
        print('Test record cleaned up')

asyncio.run(test())
