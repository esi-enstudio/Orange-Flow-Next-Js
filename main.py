import logging
import sys
import asyncio
import os
from datetime import datetime
from logging.handlers import RotatingFileHandler
from aiogram import Bot, Dispatcher
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy import select

from config.settings import BOT_TOKEN
from app.Services.db_service import init_db, async_session
from app.Middleware.access_control import ACLMiddleware
from app.Core.webhook_server import start_webhook_server
from config import settings
from app.Models.retailer import Retailer

# --- FastAPI Setup ---
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class RetailerSchema(BaseModel):
    id: int
    name: str
    retailer_code: Optional[str]
    itop_number: Optional[str]
    thana: Optional[str]
    contact_no: Optional[str]
    class Config: from_attributes = True

@app.get("/api/retailers", response_model=List[RetailerSchema])
async def get_retailers(search: Optional[str] = None):
    async with async_session() as session:
        query = select(Retailer)
        if search:
            search_pattern = f"%{search}%"
            query = query.where((Retailer.name.ilike(search_pattern)) | (Retailer.retailer_code.ilike(search_pattern)))
        result = await session.execute(query.limit(20))
        return result.scalars().all()

# --- কোর ইঞ্জিন ইম্পোর্ট ---
from app.Core.automation_engine import engine
# সিঙ্ক এবং রিসেট ফাংশনগুলো ইম্পোর্ট
from app.Services.Automation.Reports.ga_live import run_ga_live_sync, reset_daily_activations
from app.Services.Automation.dms_report_excel import cleanup_old_dms_reports
from app.Services.Automation.dms_sync_service import run_daily_auto_sync

# কন্ট্রোলার ইম্পোর্ট
from app.Controllers import (
    activation_controller, admin_controller, house_controller, user_controller,
    role_controller, automation_controller, sim_status_controller,
    sim_return_controller, sim_issue_controller, ga_live_controller,
    field_force_controller, retailer_controller, ga_filter_controller,
    bts_controller, mela_config_controller, mela_controller, dms_report_controller,
    issue_report_controller, target_controller, leave_controller, setup_wizard_controller,
    product_controller
)

# --- ২. লগিং কনফিগারেশন (প্রফেশনাল লেভেল) ---
if not os.path.exists('logs'):
    os.makedirs('logs')

log_formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
log_file = 'logs/orange_flow.log'

# ফাইল হ্যান্ডলার (১০ মেগাবাইট হলে নতুন ফাইল তৈরি করবে, সর্বোচ্চ ৫টি ফাইল রাখবে)
file_handler = RotatingFileHandler(log_file, maxBytes=10*1024*1024, backupCount=5, encoding='utf-8')
file_handler.setFormatter(log_formatter)
file_handler.setLevel(logging.INFO)

# কনসোল হ্যান্ডলার
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(log_formatter)
console_handler.setLevel(logging.INFO)

logging.basicConfig(
    level=logging.INFO,
    handlers=[file_handler, console_handler]
)

# অপ্রয়োজনীয় লগ বন্ধ রাখা
logging.getLogger("aiogram").setLevel(logging.ERROR)
logging.getLogger("pyngrok").setLevel(logging.ERROR)
logging.getLogger("aiohttp").setLevel(logging.ERROR)
logging.getLogger("playwright").setLevel(logging.ERROR)
logging.getLogger("aiogram.dispatcher").setLevel(logging.CRITICAL)

logger = logging.getLogger(__name__)

# ==========================================
# MASTER AUTOMATION SCHEDULER
# ==========================================

async def master_automation_scheduler():
    """
    ১. রাত ১২টায় ডাটাবেজ রিসেট করবে।
    ২. সকাল ৮টা থেকে রাত ১২টা পর্যন্ত ৫ মিনিট অন্তর GA সিঙ্ক করবে।
    ৩. সকাল ৮টায় GA সিঙ্ক শেষ হওয়ার পর অটো-সিঙ্ক (ডাউনলোড) রান করবে।
    """

    if getattr(settings, "DISABLE_SCHEDULER", False):
        logger.info("ℹ️ [Scheduler] Disabled by configuration.")
        return
    

    logger.info("🚀 Master Automation Scheduler শুরু হয়েছে...")
    
    # সিস্টেম স্ট্যাবল হওয়ার জন্য কিছুক্ষণ অপেক্ষা
    await asyncio.sleep(20)
    
    last_auto_sync_date = None

    while True:
        try:
            now = datetime.now()
            today_date = now.date()
            hour = now.hour

            # --- ১. রাত ১২টায় ডাটা রিসেট (00:00 - 00:05) ---
            if hour == 0 and now.minute < 5:
                logger.info("🧹 Midnight Reset: ক্লিনিং এবং রিসেট শুরু হচ্ছে...")
                await reset_daily_activations()
                await cleanup_old_dms_reports() # ২ বছরের পুরনো ডাটা ডিলিট করবে
                await asyncio.sleep(300) # ৫ মিনিট বিরতি
                continue

            # --- ২. সিঙ্কিং টাইম (সকাল ৮টা থেকে রাত ১২টা) ---
            if 8 <= hour < 24:
                logger.info(f"🕒 [Job Started] সময়: {now.strftime('%I:%M %p')}")
                
                # ২.১ জিএ লাইভ সিঙ্ক (৫ মিনিট পর পর)
                await run_ga_live_sync()
                
                # ২.২ ডেইলি অটো-সিঙ্ক (সকাল ৮টার পর একবার)
                if last_auto_sync_date != today_date:
                    logger.info("📅 [Daily Sync] আজকের প্রথম সিঙ্ক, অটো-ডাউনলোড শুরু হচ্ছে...")
                    await run_daily_auto_sync()
                    last_auto_sync_date = today_date
                    logger.info("✅ [Daily Sync] অটো-ডাউনলোড সম্পন্ন।")

                logger.info("✅ [Job Finished] পরবর্তী রান ৫ মিনিট পর।")
                await asyncio.sleep(300) # ৫ মিনিট বিরতি
            else:
                # রাত ১২টা থেকে সকাল ৮টা পর্যন্ত বিরতি
                logger.info(f"😴 Idle Time: এখন রাত {hour}টা। সকাল ৮টা পর্যন্ত বিরতি...")
                await asyncio.sleep(600) # ১০ মিনিট পর পর চেক করবে
                continue

        except Exception as e:
            logger.error(f"❌ [Master Scheduler Error] {str(e)}")
            await asyncio.sleep(60)

# ==========================================
# MAIN ENTRY POINT
# ==========================================

async def main():
    # ১. ডাটাবেজ ইনিশিয়ালাইজেশন
    try:
        await init_db()
        print("✅ DB Connected Successfully!")
    except Exception as e:
        print(f"❌ DB Connection Error: {e}")
        return

    # ২. ব্রাউজার ইঞ্জিন স্টার্ট
    await engine.start()

    # ৩. বট এবং ডিসপ্যাচার সেটআপ
    bot = Bot(token=BOT_TOKEN)
    dp = Dispatcher()

    # মিডলওয়্যার রেজিস্ট্রেশন (Message & Callback)
    dp.message.middleware(ACLMiddleware())
    dp.callback_query.middleware(ACLMiddleware())

    # ৪. রাউটারগুলো রেজিস্টার করা
    dp.include_routers(
        admin_controller.router, setup_wizard_controller.router, house_controller.router,
        user_controller.router, role_controller.router,
        automation_controller.router, sim_status_controller.router,
        sim_return_controller.router, sim_issue_controller.router,
        ga_live_controller.router, field_force_controller.router,
        retailer_controller.router, ga_filter_controller.router,
        bts_controller.router, mela_config_controller.router,
        activation_controller.router, mela_controller.router, dms_report_controller.router,
        issue_report_controller.router, target_controller.router, leave_controller.router,
        product_controller.router
    )

    # পেন্ডিং মেসেজ স্কিপ করা
    await bot.delete_webhook(drop_pending_updates=True)

    background_tasks = []
    try:
        # FastAPI এপিআই সার্ভার চালু করা (পোর্ট ৮০০০ এ) ✅
        config = uvicorn.Config(app, host="0.0.0.0", port=8000, log_level="error")
        server = uvicorn.Server(config)
        api_task = asyncio.create_task(server.serve())
        background_tasks.append(api_task)

        # ওটিপি রিসিভার সার্ভার (এটি সবসময় চালু থাকবে)
        webhook_task = asyncio.create_task(start_webhook_server(settings.WEBHOOK_PORT))
        background_tasks.append(webhook_task)

        # জিএ লাইভ সিঙ্ক সিডিউলার (.env থেকে কন্ট্রোল হবে) ✅
        if settings.ENABLE_GA_SYNC:
            scheduler_task = asyncio.create_task(master_automation_scheduler())
            background_tasks.append(scheduler_task)
            logger.info("📡 [System] GA Live Sync সিডিউলার চালু হয়েছে।")
        else:
            logger.warning("🚫 [System] GA Live Sync বর্তমানে .env থেকে বন্ধ রাখা হয়েছে।")

        logger.info(f"🤖 Bot is Live! Mode: {'Master (Ngrok ON)' if settings.START_NGROK else 'Slave (Local Only)'}")

        # টেলিগ্রাম পোলিং শুরু
        await dp.start_polling(bot)


    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
    except Exception as e:
        logger.error(f"❌ Critical runtime error: {e}")
    finally:
        logger.info("👋 Shutdown initiated. Cleaning up...")



        # ১. সব ব্যাকগ্রাউন্ড টাস্ক (Webhook, Scheduler) বন্ধ করা
        for task in background_tasks:
            if not task.done():
                task.cancel()
        
        if background_tasks:
            await asyncio.gather(*background_tasks, return_exceptions=True)

        # প্লে-রাইট ইঞ্জিন এবং বট সেশন বন্ধ করা
        await engine.stop()
        await bot.session.close()
        
        logger.info("✅ System closed successfully.")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        sys.exit(0)
