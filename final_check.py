import asyncio
import asyncpg
from urllib.parse import quote_plus

async def check():
    user = "postgres"
    password = quote_plus("NeelimA54@#")
    host = "localhost"
    port = "5432"
    db_name = "orange_flow_dev_db"
    url = f"postgresql://{user}:{password}@{host}:{port}/{db_name}"
    
    conn = await asyncpg.connect(url)
    rows = await conn.fetch("SELECT * FROM sync_history WHERE house_id = 1 AND module_name = 'sim_issue'")
    print(f"SyncHistory for sim_issue: {rows}")
    
    # Also check if any data exists in sim_issues for house 1
    sim_rows = await conn.fetch("SELECT COUNT(*) FROM sim_issues WHERE house_id = 1")
    print(f"SimIssue count for house 1: {sim_rows[0][0]}")
    
    await conn.close()

if __name__ == "__main__":
    asyncio.run(check())
