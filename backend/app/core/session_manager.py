import asyncio
import os
import time
import logging
from playwright.async_api import async_playwright
from app.core.otp_manager import otp_manager
from config import settings

logger = logging.getLogger("app.core.session_manager")

LOGIN_URL = "https://blkdms.banglalink.net/Account/Login"
CHECK_URL = "https://blkdms.banglalink.net/SmartSearchReport"
SESSION_DIR = "sessions"
KEEPALIVE_INTERVAL = 120  # seconds between keepalive pings

class SessionManager:
    def __init__(self):
        self.browser = None
        self._playwright = None
        self._own_browser = False
        self._keepalive_ctx: dict[str, dict] = {}  # code -> {context, page, task}
        os.makedirs(SESSION_DIR, exist_ok=True)

    def set_browser(self, browser):
        """Use an externally-owned browser (from AutomationEngine) instead of launching our own."""
        if self._own_browser and self.browser and self.browser is not browser:
            logger.warning("🔁 Closing self-managed browser in favor of shared instance")
            asyncio.create_task(self.browser.close())
        self.browser = browser
        self._own_browser = False
        logger.info("🔗 SessionManager using shared browser instance.")

    async def start(self):
        if self.browser:
            return
        self._own_browser = True
        self._playwright = await async_playwright().start()
        self.browser = await self._playwright.chromium.launch(
            headless=settings.HEADLESS,
            args=[
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ]
        )
        logger.info("🚀 Browser started for automation tasks.")

    async def stop(self):
        await self._stop_all_keepalive()
        if self._own_browser and self.browser:
            await self.browser.close()
        if self._own_browser and self._playwright:
            await self._playwright.stop()
        self.browser = None
        self._playwright = None
        logger.info("🛑 SessionManager browser released.")

    def _session_path(self, credentials):
        code = credentials.get('code', str(credentials['house_id']))
        return os.path.join(SESSION_DIR, f"{code}.json")

    # ── Keepalive ──────────────────────────────────────────

    async def _start_keepalive(self, credentials: dict):
        """Start background keepalive for a house to prevent DMS session expiry."""
        code = credentials.get('code')
        if not code or code in self._keepalive_ctx:
            return

        session_path = self._session_path(credentials)
        if not os.path.exists(session_path):
            return

        try:
            context = await self.browser.new_context(storage_state=session_path)
            page = await context.new_page()
        except Exception as e:
            logger.warning(f"⚠️ Keepalive context creation failed for {code}: {e}")
            return

        MAX_CONSECUTIVE_FAILURES = 3

        async def _ping():
            try:
                await page.goto(CHECK_URL, timeout=30000, wait_until="commit")
                # Refresh storage state so anti-forgery tokens stay current
                await context.storage_state(path=session_path)
                logger.debug(f"🔄 Keepalive ping for {code}")
                return True
            except Exception:
                logger.warning(f"⚠️ Keepalive ping failed for {code}")
                return False

        async def _loop():
            consecutive_failures = 0
            try:
                while True:
                    await asyncio.sleep(KEEPALIVE_INTERVAL)
                    ok = await _ping()
                    if ok:
                        consecutive_failures = 0
                    else:
                        consecutive_failures += 1
                        if consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                            logger.error(f"🛑 Keepalive failed {consecutive_failures}x consecutively for {code}, stopping")
                            break
            except asyncio.CancelledError:
                pass
            finally:
                try:
                    await page.close()
                    await context.close()
                except Exception:
                    pass
                self._keepalive_ctx.pop(code, None)

        # Send first ping immediately to establish session
        ok = await _ping()
        if not ok:
            try:
                await page.close()
                await context.close()
            except Exception:
                pass
            return

        task = asyncio.create_task(_loop())
        self._keepalive_ctx[code] = {"context": context, "page": page, "task": task}
        logger.info(f"🔋 Keepalive started for {credentials['house_name']} ({code})")

    async def _stop_keepalive(self, code: str):
        """Stop keepalive for a specific house."""
        entry = self._keepalive_ctx.pop(code, None)
        if entry:
            entry["task"].cancel()
            try:
                await entry["page"].close()
                await entry["context"].close()
            except Exception:
                pass
            logger.info(f"⏹️ Keepalive stopped for {code}")

    async def _stop_all_keepalive(self):
        """Stop all keepalive tasks."""
        for code in list(self._keepalive_ctx.keys()):
            await self._stop_keepalive(code)

    # ── Session validation ─────────────────────────────

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

    # ── Login ─────────────────────────────────────────────

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

            # Start keepalive after successful login
            await self._start_keepalive(credentials)

            return page, context

        except Exception as e:
            logger.error(f"❌ Login failed for {credentials['house_name']}: {str(e)}")
            await page.close()
            await context.close()
            raise e

    # ── Main entry point ───────────────────────────────

    async def get_valid_page(self, credentials):
        if not self.browser:
            await self.start()

        code = credentials.get('code')

        # 1. Reuse keepalive context directly — just create a new page
        #    Return None for context so callers don't close the shared keepalive context
        if code and code in self._keepalive_ctx:
            page = await self._keepalive_ctx[code]["context"].new_page()
            logger.info(f"✅ Reused keepalive session for {credentials['house_name']}")
            return page, None

        session_path = self._session_path(credentials)

        if os.path.exists(session_path):
            logger.info(f"🔍 Checking saved session for {credentials['house_name']}...")
            test_context = await self.browser.new_context(storage_state=session_path)
            test_page = await test_context.new_page()
            try:
                if await self._is_session_valid(test_page):
                    logger.info(f"✅ Session valid for {credentials['house_name']}")
                    # Start keepalive so future calls reuse it
                    if code:
                        await self._start_keepalive(credentials)
                        # Return a page from the keepalive context, close the test context
                        await test_page.close()
                        await test_context.close()
                        page = await self._keepalive_ctx[code]["context"].new_page()
                        return page, None
                    return test_page, test_context
            except Exception:
                pass
            await test_page.close()
            await test_context.close()
            logger.info(f"⏳ Session expired for {credentials['house_name']}, re-logging in...")

        page, context = await self._login(credentials)
        # After login, keepalive is running; use that context instead
        if code and code in self._keepalive_ctx:
            await page.close()
            await context.close()
            page = await self._keepalive_ctx[code]["context"].new_page()
            return page, None
        return page, context

session_manager = SessionManager()
