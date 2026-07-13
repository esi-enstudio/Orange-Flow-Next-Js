"""
One-shot script: Delete corrupted LiveActivation records for the 3 houses
and re-sync fresh data with the fixed upsert logic (house_id excluded).

Usage:  cd backend && venv/bin/python scripts/resync_ga_live.py
"""

import asyncio
import logging
import sys

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")

# Ensure we can import from the project
sys.path.insert(0, "/home/emil/projects/Orange-Flow-Next-Js/backend")

async def main():
    from sqlalchemy import select, delete as sa_delete
    from app.services.db_service import async_session
    from app.models.house import House
    from app.models.live_activation import LiveActivation
    from app.services.Automation.Reports.ga_live import sync_house_data

    codes = ["MYMVAI01", "MYMVAI02", "RYZBRB01"]

    async with async_session() as session:
        # Find houses by code
        result = await session.execute(select(House).where(House.code.in_(codes)))
        houses = result.scalars().all()

        if not houses:
            print("❌ No houses found with codes:", codes)
            return

        print(f"🔍 Found {len(houses)} houses: {[h.name for h in houses]}")

        # Delete existing LiveActivation records for these houses
        for h in houses:
            del_stmt = sa_delete(LiveActivation).where(LiveActivation.house_id == h.id)
            await session.execute(del_stmt)
            print(f"🗑️  Deleted LiveActivation records for {h.name} ({h.code})")

        await session.commit()
        print("✅ Old data deleted.")

    # Re-sync each house
    for h in houses:
        print(f"🔄 Syncing {h.name}...")
        try:
            await sync_house_data(h)
            print(f"✅ {h.name} sync complete.")
        except Exception as e:
            print(f"❌ {h.name} sync failed: {e}")

    print("🎉 All done! The GA Live report should now show correct data.")

if __name__ == "__main__":
    asyncio.run(main())
