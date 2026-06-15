import asyncio
import sys
sys.path.insert(0, '/app')
sys.path.insert(0, '/app/app')

# Simulate the router's get_db dependency
from sqlalchemy.ext.asyncio import AsyncSession
from app.services.db_service import async_session
from app.services.ga_live_service import GaLiveQueryBuilder
from datetime import date

async def test():
    async with async_session() as db:
        builder = GaLiveQueryBuilder(db, house_id=1, start_date=date(2026,6,1), end_date=date(2026,6,15))
        result = await builder.build_all()
        print("bps count:", len(result['bps']))
        for bp in result['bps']:
            print(bp)
        print()
        print("summary total_bp:", result['summary']['total_bp'])
        print("summary active_bp:", result['summary']['active_bp'])

asyncio.run(test())
