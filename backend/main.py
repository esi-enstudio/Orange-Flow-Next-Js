import logging
import sys
import asyncio
import os
from datetime import datetime
from logging.handlers import RotatingFileHandler
from typing import Optional

from app.utils.timezone import BST

class BangladeshFormatter(logging.Formatter):
    def formatTime(self, record, datefmt=None):
        dt = datetime.fromtimestamp(record.created, tz=BST)
        return f"{dt.strftime('%Y-%m-%d %H:%M:%S')},{int(record.msecs):03d}"

# --- Logging Setup ---
if not os.path.exists('logs'): os.makedirs('logs')
log_formatter = BangladeshFormatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
log_dir = 'logs'
os.makedirs(log_dir, exist_ok=True)
log_path = os.path.join(log_dir, 'orange_flow.log')
if not os.access(log_path, os.W_OK) if os.path.exists(log_path) else os.access(log_dir, os.W_OK):
    log_path = '/tmp/orange_flow.log'
file_handler = RotatingFileHandler(log_path, maxBytes=10*1024*1024, backupCount=5, encoding='utf-8')
file_handler.setFormatter(log_formatter)
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(log_formatter)
logging.basicConfig(level=logging.INFO, handlers=[file_handler, console_handler])
logger = logging.getLogger(__name__)

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
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
from app.routers.commission import router as commission_router
from app.routers.bp_retailer_codes import router as bp_retailer_codes_router
from app.routers.bp_targets import router as bp_targets_router
from app.routers.retailer_visits import router as retailer_visits_router
from app.routers.order_collections import router as order_collections_router
from app.routers.zoom_in import router as zoom_in_router
from app.routers.scratch_cards import router as scratch_cards_router
from app.routers.scratch_card_serials import router as scratch_card_serials_router
from app.routers.cv import router as cv_router
from app.routers.sync import router as sync_router
from app.routers.sim_replacement import router as sim_replacement_router
from app.routers.shifts import router as shifts_router
from app.routers.stock import router as stock_router
from app.routers.sales import router as sales_router
from app.routers.itopup_balance import router as itopup_balance_router
from app.routers.whatsapp_schedules import router as whatsapp_schedules_router
from app.routers.whatsapp_gateway import router as whatsapp_gateway_router
from app.routers.whatsapp_connections import router as whatsapp_connections_router
from app.routers.telegram_bots import router as telegram_bots_router
from app.routers.transactions import router as transactions_router
from app.routers.ga_report_builder import router as ga_report_builder_router
from app.routers.otp import router as otp_router

# ==========================================
# 1. FASTAPI SETUP
# ==========================================

app = FastAPI(title="OrangeFlow Management API")

from app.core.session_manager import session_manager
import gc

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
app.include_router(commission_router)
app.include_router(bp_retailer_codes_router)
app.include_router(bp_targets_router)
app.include_router(retailer_visits_router)
app.include_router(order_collections_router)
app.include_router(zoom_in_router)
app.include_router(scratch_cards_router)
app.include_router(scratch_card_serials_router)
app.include_router(cv_router)
app.include_router(sync_router)
app.include_router(sim_replacement_router)
app.include_router(shifts_router)
app.include_router(stock_router)
app.include_router(sales_router)
app.include_router(itopup_balance_router)
app.include_router(whatsapp_schedules_router)
app.include_router(whatsapp_gateway_router)
app.include_router(whatsapp_connections_router)
app.include_router(telegram_bots_router)
app.include_router(transactions_router)
app.include_router(ga_report_builder_router)
app.include_router(otp_router)

async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    return response

app.add_middleware(BaseHTTPMiddleware, dispatch=security_headers)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "https://orange-flow-next-js.vercel.app"],
    allow_origin_regex=r"https://orange-flow-next-.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error on {request.method} {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": {
                "code": "INTERNAL_SERVER_ERROR",
                "message": "Internal server error",
            },
        },
    )

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
        try:
            from app.services.db_service import async_session
            from app.models.otp import OTP
            from app.models.house import House
            from app.utils.timezone import now_naive
            from sqlalchemy import select
            async with async_session() as session:
                house_id = None
                hres = await session.execute(
                    select(House.id).where(House.code == str(house_code).strip())
                )
                row = hres.scalar_one_or_none()
                if row is not None:
                    house_id = row
                session.add(OTP(
                    house_id=house_id,
                    house_code=str(house_code).strip().upper(),
                    otp_code=str(otp_code),
                    sender=sender if sender != house_code else None,
                    message=message,
                    received_at=now_naive(),
                    is_used=False,
                ))
                await session.commit()
        except Exception as e:
            logger.warning(f"Failed to persist OTP to DB: {e}")

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

_ga_sync_lock = asyncio.Lock()

async def master_automation_scheduler():
    from app.services.Automation.Reports.ga_live import run_ga_live_sync, reset_daily_activations
    from app.services.Automation.dms_report_excel import cleanup_old_dms_reports
    from app.services.Automation.dms_sync_service import run_daily_auto_sync
    from app.utils.timezone import now
    if getattr(settings, "DISABLE_SCHEDULER", False): return
    logger.info("Master Automation Scheduler started...")
    await asyncio.sleep(20)
    last_auto_sync_date = None
    last_heartbeat = now()
    while True:
        try:
            now_time = now()
            today_date = now_time.date()
            hour = now_time.hour
            minute = now_time.minute

            if (now_time - last_heartbeat).total_seconds() >= 600:
                ga_status = 'Active' if 8 <= hour < 24 else 'Sleeping'
                daily_status = f"Daily Sync: {'Done' if last_auto_sync_date == today_date else 'Pending'}"
                mem = _get_memory_mb()
                logger.info(f"⏳ [Scheduler Heartbeat] Hour: {hour}, GA Sync {ga_status}, {daily_status}, Mem: {mem}MB")
                last_heartbeat = now_time

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
                async with _ga_sync_lock:
                    await run_ga_live_sync()
                await asyncio.sleep(300)
            else:
                # 1:00 AM - 6:59 AM — Check every 1 minute (so as not to miss 7:00 AM)
                await asyncio.sleep(60)

        except Exception as e:
            logger.error(f"Scheduler Error: {str(e)}", exc_info=True)
            await asyncio.sleep(60)

def _get_memory_mb() -> int:
    try:
        import psutil
        return int(psutil.Process().memory_info().rss / 1024 / 1024)
    except ImportError:
        return 0

# ==========================================
# 2b. WHATSAPP REPORT DELIVERY SCHEDULER
# ==========================================

async def whatsapp_schedule_runner():
    """Dedicated loop that delivers due GA live report WhatsApp schedules.

    Runs every 30 seconds so deliveries fire close to the configured time
    without disturbing the main automation cadence.
    """
    from app.services.db_service import async_session
    from app.services.whatsapp_schedule_service import check_and_run_due_schedules
    from config.settings import settings as _settings
    if getattr(_settings, "DISABLE_SCHEDULER", False):
        return
    logger.info("WhatsApp Report Scheduler started...")
    await asyncio.sleep(25)
    while True:
        try:
            async with async_session() as session:
                await check_and_run_due_schedules(session)
        except Exception as e:
            logger.error(f"WhatsApp schedule runner error: {e}", exc_info=True)
        await asyncio.sleep(30)

# ==========================================
# 3. MAIN ENTRY POINT
# ==========================================

async def main():
    max_retries = 30
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
                logger.error("Max DB retries reached. Exiting process.")
                sys.exit(1)

    try:
        from app.services.db_service import async_session
        from seed_db import seed_system_data
        async with async_session() as session:
            from app.models.user import User
            from sqlalchemy import select, func
            result = await session.execute(select(func.count()).select_from(User))
            if result.scalar() > 0:
                await seed_system_data(session)
                logger.info("Permissions synced from config.")
    except Exception as e:
        logger.warning(f"Permission sync skipped: {e}")

    from app.services.cache_service import cache_service
    await cache_service.connect()

    background_tasks = []
    ngrok_tunnel = None
    server_task = None
    engine_ok = False
    try:
        # Start engine FIRST and share browser with session_manager
        # (before server starts accepting requests, eliminating any race)
        try:
            await engine.start()
            session_manager.set_browser(engine.browser)
            engine_ok = True
            logger.info("🤖 Automation engine ready, browser shared with SessionManager")
        except Exception as e:
            logger.error(f"Failed to start automation engine: {e}")
            logger.info("API server continues running without automation engine")

        config = uvicorn.Config(app, host="0.0.0.0", port=8000, log_level="info")
        server = uvicorn.Server(config)
        server_task = asyncio.create_task(server.serve())
        background_tasks.append(server_task)

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

        if settings.ENABLE_GA_SYNC and engine_ok:
            background_tasks.append(asyncio.create_task(master_automation_scheduler()))

        if settings.WA_GATEWAY_ENABLED:
            background_tasks.append(asyncio.create_task(whatsapp_schedule_runner()))

        logger.info("OrangeFlow API is Live on port 8000")

        # Wait for server task to finish (signals = clean shutdown)
        if server_task:
            try:
                await server_task
            except (asyncio.CancelledError, KeyboardInterrupt):
                pass

    except (KeyboardInterrupt, asyncio.CancelledError):
        logger.info("Server shutdown requested")
    except Exception:
        logger.critical("🔥 Fatal error in main loop", exc_info=True)
    finally:
        # Cancel all background tasks
        for task in background_tasks:
            if task is not server_task and not task.done():
                task.cancel()
        if background_tasks:
            await asyncio.gather(*[t for t in background_tasks if not t.done()], return_exceptions=True)

        # Cleanup cache
        try:
            await cache_service.close()
        except Exception as e:
            logger.warning(f"Cache close error: {e}")

        # Cleanup ngrok
        if ngrok_tunnel:
            try:
                from pyngrok import ngrok
                ngrok.disconnect(ngrok_tunnel.public_url)
                logger.info("Ngrok tunnel closed.")
            except Exception:
                pass

        # Stop session manager keepalive (before engine so pages close first)
        try:
            await session_manager.stop()
        except Exception as e:
            logger.warning(f"Session manager stop error: {e}")

        # Stop engine
        try:
            await engine.stop()
        except Exception as e:
            logger.warning(f"Engine stop error: {e}")

        gc.collect()
        logger.info("System closed successfully.")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit): sys.exit(0)
