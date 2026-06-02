import asyncio
from datetime import date
from sqlalchemy import select, func
from app.Services.db_service import async_session
from app.Models.live_activation import LiveActivation

async def test():
    async with async_session() as session:
        today_str = date.today().strftime('%Y-%m-%d')
        q = select(func.count()).select_from(LiveActivation).where(LiveActivation.activation_date == today_str)
        cnt = (await session.execute(q)).scalar()
        print(f'Total matching today ({today_str}): {cnt}')

        q2 = select(func.count()).select_from(LiveActivation).where(LiveActivation.sim_no == 'TEST_FIX_001')
        cnt2 = (await session.execute(q2)).scalar()
        print(f'Test record exists: {cnt2}')

        r = await session.execute(select(LiveActivation.activation_date).where(LiveActivation.sim_no == 'TEST_FIX_001'))
        d = r.scalar()
        print(f'Test record date: "{d}" == "{today_str}"? {d == today_str}')

asyncio.run(test())
