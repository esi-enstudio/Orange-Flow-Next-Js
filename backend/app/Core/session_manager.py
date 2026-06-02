import asyncio
import os
import time
import logging
from playwright.async_api import async_playwright
from app.Core.otp_manager import otp_manager
from config import settings

logger = logging.getLogger("app.Core.session_manager")

LOGIN_URL = "https://blkdms.banglalink.net/Account/Login"
CHECK_URL = "https://blkdms.banglalink.net/SmartSearchReport"
SESSION_DIR = "sessions"

class SessionManager:
    def __init__(self):
        self.playwright = None
        self.browser = None
        os.makedirs(SESSION_DIR, exist_ok=True)

    async def start(self):
        if not self.playwright:
            self.playwright = await async_playwright().start()
            self.browser = await self.playwright.chromium.launch(
                headless=settings.HEADLESS,
                args=[
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox',
                    '--disable-setuid-sandbox'
                ]
            )
            logger.info("🚀 Browser started for automation tasks.")

    async def stop(self):
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()
        logger.info("🛑 Browser stopped.")

    def _session_path(self, credentials):
        code = credentials.get('code', str(credentials['house_id']))
        return os.path.join(SESSION_DIR, f"{code}.json")

    async def _is_session_valid(self, page):
        try:
            await page.goto(CHECK_URL, timeout=40000, wait_until="commit")
            await asyncio.sleep(2)
            if "login" not in page.url.lower():
                if await page.query_selector("#SearchType"):
                    return True
            return False
        except Exception:
            return False

    async def _login(self, credentials):
        context = await self.browser.new_context()
        page = await context.new_page()

        try:
            logger.info(f"🔑 Logging in for {credentials['house_name']}...")
            await page.goto(LOGIN_URL)
            await asyncio.sleep(2)

            await page.fill("#Email", str(credentials['user']))
            await page.fill("#Password", str(credentials['pass']))

            house_id = str(credentials['house_id'])
            target_option = f"select#Distributor option[value='{house_id}']"
            try:
                await page.wait_for_selector(target_option, state="attached", timeout=20000)
            except:
                logger.error(f"❌ Distributor option {house_id} not found.")
                raise Exception("Distributor option not found")

            await asyncio.sleep(1)
            await page.evaluate(f"""
                (function() {{
                    let select = document.getElementById('Distributor');
                    if (select) {{
                        select.value = '{house_id}';
                        select.dispatchEvent(new Event('change', {{ bubbles: true }}));
                        if (window.jQuery) {{
                            window.jQuery(select).val('{house_id}').trigger('change');
                        }}
                    }}
                }})();
            """)
            await asyncio.sleep(1)

            login_click_time = time.time()
            await page.click("#btnSubmit")

            otp_box_found = False
            try:
                await page.wait_for_selector("#OTP", state="visible", timeout=12000)
                otp_box_found = True
                logger.info(f"⏳ [Login] OTP page detected.")
            except:
                logger.info("ℹ️ [Login] No OTP box.")

            if otp_box_found:
                h_code = credentials.get('code')
                otp = await otp_manager.wait_for_fresh_otp(
                    target_id=h_code,
                    request_time=login_click_time
                )
                if otp:
                    await page.fill("#OTP", str(otp))
                    await page.click("#submitButton")
                    logger.info(f"🔵 [Login] OTP {otp} submitted.")
                    try:
                        await page.wait_for_function(
                            "() => !window.location.href.toLowerCase().includes('login')",
                            timeout=25000
                        )
                    except:
                        logger.warning("⚠️ [Login] Redirect slow...")
                else:
                    raise Exception(f"OTP timeout for house {h_code}")

            await asyncio.sleep(4)
            if "login" in page.url.lower():
                raise Exception("Still on login page")

            logger.info(f"✅ Login successful for {credentials['house_name']}")
            await context.storage_state(path=self._session_path(credentials))
            logger.info(f"💾 Session saved for {credentials.get('code', house_id)}")
            return page, context

        except Exception as e:
            logger.error(f"❌ Login failed for {credentials['house_name']}: {str(e)}")
            await page.close()
            await context.close()
            raise e

    async def get_valid_page(self, credentials):
        if not self.browser:
            await self.start()

        session_path = self._session_path(credentials)

        if os.path.exists(session_path):
            logger.info(f"🔍 Checking saved session for {credentials['house_name']}...")
            test_context = await self.browser.new_context(storage_state=session_path)
            test_page = await test_context.new_page()
            try:
                if await self._is_session_valid(test_page):
                    logger.info(f"✅ Session valid for {credentials['house_name']}")
                    return test_page, test_context
            except Exception:
                pass
            await test_page.close()
            await test_context.close()
            logger.info(f"⏳ Session expired for {credentials['house_name']}, re-logging in...")

        return await self._login(credentials)

session_manager = SessionManager()
