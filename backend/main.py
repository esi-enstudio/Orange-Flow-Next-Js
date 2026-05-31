import logging
import sys
import asyncio
import os
from datetime import datetime, timedelta, timezone
from logging.handlers import RotatingFileHandler
from typing import Optional

# --- Logging Setup ---
if not os.path.exists('logs'): os.makedirs('logs')
log_formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
file_handler = RotatingFileHandler('logs/orange_flow.log', maxBytes=10*1024*1024, backupCount=5, encoding='utf-8')
file_handler.setFormatter(log_formatter)
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(log_formatter)
logging.basicConfig(level=logging.INFO, handlers=[file_handler, console_handler])
logger = logging.getLogger(__name__)

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn

from config.settings import settings
from app.Services.db_service import init_db
from app.Core.automation_engine import engine
from app.Controllers import admin_controller, admin_setup_controller

# --- Routers ---
from app.Routers.auth import router as auth_router
from app.Routers.houses import router as houses_router
from app.Routers.employees import router as employees_router
from app.Routers.users import router as users_router
from app.Routers.roles_permissions import router as roles_permissions_router
from app.Routers.retailers import router as retailers_router
from app.Routers.bts import router as bts_router
from app.Routers.imports import router as imports_router
from app.Routers.reports import router as reports_router
from app.Routers.targets import router as targets_router
from app.Routers.filters import router as filters_router
from app.Routers.stats import router as stats_router
from app.Routers.todos import router as todos_router

# ==========================================
# 1. FASTAPI SETUP
# ==========================================

app = FastAPI(title="OrangeFlow Management API")

if not os.path.exists('uploads/profile_pics'):
    os.makedirs('uploads/profile_pics')

app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# Register Routers
app.include_router(admin_setup_controller.router, prefix="/api")
app.include_router(admin_controller.router, prefix="/api")
app.include_router(auth_router)
app.include_router(houses_router)
app.include_router(employees_router)
app.include_router(users_router)
app.include_router(roles_permissions_router)
app.include_router(retailers_router)
app.include_router(bts_router)
app.include_router(imports_router)
app.include_router(reports_router)
app.include_router(targets_router)
app.include_router(filters_router)
app.include_router(stats_router)
app.include_router(todos_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    return response

@app.get("/")
async def root():
    return {"message": "OrangeFlow API is running"}

# ==========================================
# 2. SCHEDULER
# ==========================================

async def master_automation_scheduler():
    from app.Services.Automation.Reports.ga_live import run_ga_live_sync, reset_daily_activations
    from app.Services.Automation.dms_report_excel import cleanup_old_dms_reports
    from app.Services.Automation.dms_sync_service import run_daily_auto_sync
    if getattr(settings, "DISABLE_SCHEDULER", False): return
    logger.info("Master Automation Scheduler started...")
    await asyncio.sleep(20)
    last_auto_sync_date = None
    while True:
        try:
            now = datetime.now()
            today_date = now.date()
            hour = now.hour
            if hour == 0 and now.minute < 5:
                await reset_daily_activations()
                await cleanup_old_dms_reports()
                await asyncio.sleep(300)
                continue
            if 8 <= hour < 24:
                await run_ga_live_sync()
                if last_auto_sync_date != today_date:
                    await run_daily_auto_sync()
                    last_auto_sync_date = today_date
                await asyncio.sleep(300)
            else:
                await asyncio.sleep(600)
        except Exception as e:
            logger.error(f"Scheduler Error: {str(e)}")
            await asyncio.sleep(60)

# ==========================================
# 3. MAIN ENTRY POINT
# ==========================================

async def main():
    max_retries = 10
    retry_delay = 5

    for i in range(max_retries):
        try:
            await init_db()
            logger.info("DB Connected Successfully!")
            break
        except Exception as e:
            logger.error(f"DB Connection Attempt {i+1} failed: {e}")
            if i < max_retries - 1:
                await asyncio.sleep(retry_delay)
            else:
                logger.error("Max DB retries reached. Exiting.")
                return

    try:
        await engine.start()
    except Exception as e:
        logger.error(f"Failed to start automation engine: {e}")
        return

    background_tasks = []
    try:
        config = uvicorn.Config(app, host="0.0.0.0", port=8000, log_level="info", reload=False)
        server = uvicorn.Server(config)
        background_tasks.append(asyncio.create_task(server.serve()))

        if settings.ENABLE_GA_SYNC:
            background_tasks.append(asyncio.create_task(master_automation_scheduler()))

        logger.info("OrangeFlow API is Live on port 8000")

        while True:
            await asyncio.sleep(3600)

    except (KeyboardInterrupt, asyncio.CancelledError): pass
    finally:
        for task in background_tasks:
            if not task.done(): task.cancel()
        await engine.stop()
        logger.info("System closed successfully.")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit): sys.exit(0)
