import logging
import sys
import asyncio
import os
from datetime import datetime, timedelta, timezone
from logging.handlers import RotatingFileHandler
from typing import Optional

# --- Bangladesh Time (BST = UTC+6) ---
BST = timezone(timedelta(hours=6))

class BangladeshFormatter(logging.Formatter):
    def formatTime(self, record, datefmt=None):
        dt = datetime.fromtimestamp(record.created, tz=BST)
        return f"{dt.strftime('%Y-%m-%d %H:%M:%S')},{int(record.msecs):03d}"

# --- Logging Setup ---
if not os.path.exists('logs'): os.makedirs('logs')
log_formatter = BangladeshFormatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
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
from app.services.db_service import init_db
from app.core.automation_engine import engine
from app.routers import admin_controller, admin_setup_controller

# --- Routers ---
from app.routers.auth import router as auth_router
from app.routers.houses import router as houses_router
from app.routers.employees import router as employees_router
from app.routers.users import router as users_router
from app.routers.roles_permissions import router as roles_permissions_router
from app.routers.retailers import router as retailers_router
from app.routers.bts import router as bts_router
from app.routers.imports import router as imports_router
from app.routers.reports import router as reports_router
from app.routers.targets import router as targets_router
from app.routers.filters import router as filters_router
from app.routers.stats import router as stats_router
from app.routers.todos import router as todos_router
from app.routers.webhook import router as webhook_router
from app.routers.app_settings import router as app_settings_router
from app.routers.ga_section_configs import router as ga_section_configs_router
from app.routers.dms import router as dms_router
from app.routers.products import router as products_router
from app.routers.lifting import router as lifting_router

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
app.include_router(webhook_router)
app.include_router(app_settings_router)
app.include_router(ga_section_configs_router)
app.include_router(dms_router)
app.include_router(products_router)
app.include_router(lifting_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "https://orange-flow-next-js.vercel.app"],
    allow_origin_regex=r"https://orange-flow-next-.*\.vercel\.app",
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

@app.post("/receive-otp")
@app.post("/receive-sms")
async def receive_otp(request: Request):
    payload = {}
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        payload = await request.json()
    elif "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
        form = await request.form()
        payload = dict(form)
    else:
        try:
            payload = await request.json()
        except Exception:
            try:
                form = await request.form()
                payload = dict(form)
            except Exception:
                body = await request.body()
                payload = {"raw": body.decode("utf-8", errors="replace")}

    otp_code = payload.get("otp_code") or payload.get("otp") or payload.get("code") or ""
    house_code = payload.get("house_code") or payload.get("house_name") or payload.get("house") or ""
    sender = (payload.get("from") or payload.get("from_") or payload.get("sender")
              or payload.get("phone") or payload.get("sender_number") or house_code or "Unknown")
    message = (payload.get("message") or payload.get("body") or payload.get("text")
               or payload.get("msg") or payload.get("sms") or payload.get("content")
               or (f"OTP: {otp_code}" if otp_code else "")
               or str(payload))

    if otp_code and house_code:
        from app.core.otp_manager import otp_manager
        otp_manager.update_otp(str(otp_code), house_code)

    logger.info("=" * 60)
    if otp_code and house_code:
        logger.info(f"🔐 OTP Received — House: {house_code} | OTP: {otp_code}")
        logger.info(f"🏢 House: {house_code}  |  🔑 OTP Code: {otp_code}")
    else:
        logger.info(f"🔐 OTP Received — From: {sender}")
        logger.info(f"🔑 OTP/Message: {message}")
    logger.info(f"📦 Full Payload: {payload}")
    logger.info("=" * 60)

    try:
        import aiohttp
        async with aiohttp.ClientSession() as session:
            await session.post("http://host.docker.internal:8080/receive-otp", json=payload, timeout=2)
    except Exception:
        pass

    return {"status": "ok", "message": "OTP received"}

# ==========================================
# 2. SCHEDULER
# ==========================================

async def master_automation_scheduler():
    from app.services.Automation.Reports.ga_live import run_ga_live_sync, reset_daily_activations
    from app.services.Automation.dms_report_excel import cleanup_old_dms_reports
    from app.services.Automation.dms_sync_service import run_daily_auto_sync
    if getattr(settings, "DISABLE_SCHEDULER", False): return
    logger.info("Master Automation Scheduler started...")
    await asyncio.sleep(20)
    last_auto_sync_date = None
    last_heartbeat = datetime.now(BST)
    while True:
        try:
            now = datetime.now(BST)
            today_date = now.date()
            hour = now.hour
            minute = now.minute

            if (now - last_heartbeat).total_seconds() >= 600:
                ga_status = 'Active' if 8 <= hour < 24 else 'Sleeping'
                daily_status = f"Daily Sync: {'Done' if last_auto_sync_date == today_date else 'Pending'}"
                logger.info(f"⏳ [Scheduler Heartbeat] Hour: {hour}, GA Sync {ga_status}, {daily_status}")
                last_heartbeat = now

            # Midnight reset (00:00-00:05)
            if hour == 0 and minute < 5:
                logger.info("🌙 [Scheduler] 12:00 AM — Daily reset in progress...")
                await reset_daily_activations()
                await cleanup_old_dms_reports()
                last_auto_sync_date = None
                await asyncio.sleep(300)
                continue

            # 7:00 AM — Daily report sync (Activation, iTopUp, Scratch Card, SIM Issue)
            if hour == 7 and last_auto_sync_date != today_date:
                logger.info("🌅 [Scheduler] 7:00 AM — Daily report sync starting...")
                await run_daily_auto_sync()
                last_auto_sync_date = today_date
                logger.info("✅ [Scheduler] Daily report sync completed.")
                await asyncio.sleep(60)
                continue

            # 8:00 AM - 11:59 PM — Live activation sync (every 5 minutes)
            if 8 <= hour < 24:
                from app.models.app_setting import AppSetting
                from sqlalchemy import select
                try:
                    from app.services.db_service import async_session
                    async with async_session() as session:
                        setting_result = await session.execute(
                            select(AppSetting).where(AppSetting.id == 1)
                        )
                        app_setting = setting_result.scalar_one_or_none()
                        live_sync_enabled = app_setting.is_live_sync_enabled if app_setting else 1
                except Exception:
                    live_sync_enabled = 1
                if live_sync_enabled:
                    await run_ga_live_sync()
                else:
                    logger.debug("⏸️ [Scheduler] Live sync is disabled (AppSettings).")
                await asyncio.sleep(300)
            else:
                # 1:00 AM - 6:59 AM — Check every 1 minute (so as not to miss 7:00 AM)
                await asyncio.sleep(60)

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

    from app.services.cache_service import cache_service
    await cache_service.connect()

    background_tasks = []
    ngrok_tunnel = None
    try:
        config = uvicorn.Config(app, host="0.0.0.0", port=8000, log_level="info", reload=False)
        server = uvicorn.Server(config)
        background_tasks.append(asyncio.create_task(server.serve()))

        if settings.START_NGROK:
            try:
                from pyngrok import ngrok, conf
                if settings.NGROK_AUTH_TOKEN:
                    ngrok.set_auth_token(settings.NGROK_AUTH_TOKEN)
                ngrok_cfg = conf.PyngrokConfig(request_timeout=30)
                ngrok.connect(8000, pyngrok_config=ngrok_cfg)
                tunnels = ngrok.get_tunnels(pyngrok_config=ngrok_cfg)
                if tunnels:
                    public_url = tunnels[0].public_url
                    logger.info(f"🌐 Ngrok tunnel opened: {public_url}")
                    logger.info(f"📱 Configure SMS Forwarder to POST to: {public_url}/api/webhook/sms")
                else:
                    logger.error("❌ Ngrok tunnel not available")
            except Exception as e:
                logger.error(f"❌ Failed to start ngrok: {e}")
                logger.info("⚠️  App running without ngrok tunnel")

        if settings.ENABLE_GA_SYNC:
            background_tasks.append(asyncio.create_task(master_automation_scheduler()))

        logger.info("OrangeFlow API is Live on port 8000")

        while True:
            await asyncio.sleep(3600)

    except (KeyboardInterrupt, asyncio.CancelledError): pass
    finally:
        from app.services.cache_service import cache_service
        await cache_service.close()
        if ngrok_tunnel:
            try:
                from pyngrok import ngrok
                ngrok.disconnect(ngrok_tunnel.public_url)
                logger.info("Ngrok tunnel closed.")
            except Exception:
                pass
        for task in background_tasks:
            if not task.done(): task.cancel()
        await engine.stop()
        logger.info("System closed successfully.")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit): sys.exit(0)
