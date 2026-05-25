import logging
import asyncio
import aiohttp
from aiohttp import web
from pyngrok import ngrok, conf
from app.Core.otp_manager import otp_manager
from config import settings

# লগিং কনফিগারেশন
logging.getLogger("pyngrok").setLevel(logging.ERROR)
logger = logging.getLogger(__name__)

# ওটিপি অন্য বটে পাঠানোর ফাংশন (Relay) ✅
async def forward_otp_to_peer(data):
    """এটি রিসিভ করা ডাটাটি লোকাললি অন্য বটের পোর্টে পাঠিয়ে দিবে"""
    forward_url = getattr(settings, "FORWARD_OTPS_TO", None)
    
    if forward_url and forward_url != "None" and forward_url.strip() != "":
        async with aiohttp.ClientSession() as session:
            try:
                # অন্য বটকে ওটিপি ডাটা ফরওয়ার্ড করা
                async with session.post(forward_url, json=data, timeout=3) as resp:
                    if resp.status == 200:
                        print(f"📤 [Dispatcher] ওটিপি সফলভাবে ফরওয়ার্ড করা হয়েছে: {forward_url}")
            except Exception:
                # যদি অন্য বটটি বন্ধ থাকে তবে এরর ইগনোর করবে
                pass

async def handle_otp_webhook(request):
    """ম্যাক্রোড্রয়েড থেকে আসা ওটিপি হ্যান্ডেল করা"""
    try:
        data = await request.json()
        otp_code = data.get("otp_code")
        h_id = data.get("house_code") or data.get("house_name") or "UNKNOWN"

        if otp_code and len(str(otp_code)) == 6:
            # ১. নিজের ওটিপি পুলে আপডেট করা
            otp_manager.update_otp(str(otp_code), h_id)
            
            # ২. টার্মিনালে সুন্দরভাবে দেখানো
            print(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
            print(f"📥 [Webhook] ওটিপি রিসিভ হয়েছে!")
            print(f"🏢 হাউজ: {h_id}")
            print(f"🔑 ওটিপি: {otp_code}")
            print(f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

            # ৩. অন্য বটের কাছে ওটিপি ফরওয়ার্ড করা (ব্যাকগ্রাউন্ড টাস্ক) ✅
            asyncio.create_task(forward_otp_to_peer(data))
            
            return web.Response(text="OTP Received and Dispatched", status=200)
        
        return web.Response(text="Invalid Data Format", status=400)
    except Exception as e:
        logger.error(f"❌ [Webhook Error] {str(e)}")
        return web.Response(text=str(e), status=500)

async def start_webhook_server(port=None):
    """সার্ভার এবং এনগ্রোক স্টার্ট করার প্রফেশনাল লজিক"""

    # পোর্ট নির্ধারণ (প্যারামিটার না থাকলে সেটিংস থেকে নিবে)
    current_port = port if port else getattr(settings, "WEBHOOK_PORT", 8080)
    
    # এনগ্রোক ক্লিনআপ
    ngrok.kill() 
    
    # শুধুমাত্র যদি .env তে START_NGROK=True থাকে তবেই এনগ্রোক চলবে ✅
    should_start_ngrok = getattr(settings, "START_NGROK", False)

    if should_start_ngrok:
        if not settings.NGROK_AUTH_TOKEN:
            print("❌ [Ngrok] এরর: NGROK_AUTH_TOKEN নেই!")
        else:
            try:
                conf.get_default().auth_token = settings.NGROK_AUTH_TOKEN
                static_domain = getattr(settings, "STATIC_DOMAIN", None)

                if static_domain:
                    # স্ট্যাটিক ডোমেইন দিয়ে কানেক্ট করা (লাইভ বটের জন্য)
                    ngrok.connect(current_port, domain=static_domain)
                    print(f"✅ [System] Master Ngrok Active: {static_domain}")
                else:
                    # র্যান্ডম ইউআরএল (যদি ডোমেইন না থাকে)
                    public_url = ngrok.connect(current_port)
                    print(f"✅ [System] Ngrok Active: {public_url.public_url}")

            except Exception as e:
                if "already bound" not in str(e):
                    print(f"❌ [Ngrok Error] {e}")

    # aiohttp সার্ভার সেটআপ
    app = web.Application()
    app.add_routes([web.post('/receive-otp', handle_otp_webhook)])
    
    runner = web.AppRunner(app)
    await runner.setup()
    
    try:
        site = web.TCPSite(runner, '0.0.0.0', current_port)
        await site.start()
        print(f"🚀 [Webhook] সার্ভার পোর্ট {current_port}-এ ওটিপি-র জন্য প্রস্তুত।")
    except OSError:
        print(f"❌ [Error] পোর্ট {current_port} দখল হয়ে আছে!")
