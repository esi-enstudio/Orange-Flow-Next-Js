import asyncio
import os
import time
import logging
from playwright.async_api import async_playwright, Error as PlaywrightError
from app.core.otp_manager import otp_manager
from config import settings
from app.core.automation_lock import automation_locks

logger = logging.getLogger("app.core.session_manager")

LOGIN_URL = "https://blkdms.banglalink.net/Account/Login"
CHECK_URL = "https://blkdms.banglalink.net/SmartSearchReport"
SESSION_DIR = "sessions"
KEEPALIVE_INTERVAL = 120  # seconds between keepalive pings
MAX_CONSECUTIVE_FAILURES = 3


class SessionManager:
    def __init__(self):
        self.browser = None
        self._playwright = None
        self._own_browser = False
        self._browser_epoch = 0  # bumped every time the shared browser is (re)created
        self._keepalive_ctx: dict[str, dict] = {}  # code -> {context, page, task}
        self._recovery_lock = asyncio.Lock()
        os.makedirs(SESSION_DIR, exist_ok=True)

    def set_browser(self, browser):
        """Use an externally-owned browser (from AutomationEngine)."""
        if self._own_browser and self.browser and self.browser is not browser:
            logger.warning("🔁 Closing self-managed browser in favor of shared instance")
            asyncio.create_task(self.browser.close())
        self.browser = browser
        self._own_browser = False
        self._browser_epoch += 1
        logger.info("🔗 SessionManager using shared browser instance.")

    # ── Connection-error detection ─────────────────────────
    def _is_connection_closed_error(self, e: Exception) -> bool:
        """Detect a dead/closed Playwright connection to the browser driver."""
        msg = str(e).lower()
        return any(
            token in msg
            for token in (
                "connection closed",
                "connection lost",
                "pipe closed by peer",
                "target page, context or browser has been closed",
                "browser has been closed",
                "cant reach",
                "closed by the driver",
                "connection refused",
                "target closed",
            )
        )

    # ── Centralized context creation (with auto-recovery) ──

    async def _new_context(self, **kwargs):
        """Create a new browser context, transparently recovering the shared
        browser if its driver has died.

        This is the single place that calls browser.new_context() so that every
        call site gets the same recovery + retry behavior.
        """
        await automation_locks.browser_lock.acquire()
        try:
            await self._ensure_browser_alive(raise_on_fail=True)
            return await self.browser.new_context(**kwargs)
        finally:
            automation_locks.browser_lock.release()

    async def _ensure_browser_alive(self, raise_on_fail: bool = False):
        """Verify the shared browser is still usable; recover it if the driver died.

        The Chromium subprocess can crash (pipe closed by peer) leaving a stale
        non-None browser reference. Any new_context would then fail forever with
        "Connection closed while reading from the driver". This probes the
        browser and relaunches it via the AutomationEngine when necessary.
        """
        if self.browser is None:
            await self.start()
            return

        try:
            probe = await self.browser.new_context()
            await probe.close()
            return
        except Exception as _e:
            if not self._is_connection_closed_error(_e):
                if raise_on_fail:
                    raise
                return
            err_msg = str(_e)

        logger.error(f"🔌 Browser connection dead ({err_msg}); recovering...")
        async with self._recovery_lock:
            # Re-probe under the lock: another task may have already recovered it
            try:
                probe = await self.browser.new_context()
                await probe.close()
                return
            except Exception:
                pass

            # Release any per-house locks held by tasks tied to the dead browser
            automation_locks.reset_house_locks()
            # Tear down ALL stale keepalive contexts referencing the dead browser
            await self._stop_all_keepalive()
            try:
                self.browser = None
            except Exception:
                pass

            # Ask the engine to relaunch the shared browser
            from app.core.automation_engine import engine
            try:
                await engine.start()
                self.browser = engine.browser
                self._own_browser = False
                self._browser_epoch += 1
                logger.info("✅ Browser successfully recovered.")
            except Exception as re:
                logger.error(f"❌ Browser recovery failed: {re}")
                if raise_on_fail:
                    raise
                self.browser = None

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
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-software-rasterizer'
            ]
        )
        self._browser_epoch += 1
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

    async def _start_keepalive(self, credentials: dict, attempt: int = 1):
        """Start background keepalive for a house to prevent DMS session expiry."""
        code = credentials.get('code')
        if not code or code in self._keepalive_ctx:
            return

        session_path = self._session_path(credentials)
        if not os.path.exists(session_path):
            return

        try:
            context = await self._new_context(storage_state=session_path)
            page = await context.new_page()
        except Exception as e:
            logger.warning(f"⚠️ Keepalive context creation failed for {code}: {e}")
            if attempt < 2:
                logger.warning(f"🔁 Retrying keepalive setup for {code}...")
                await self._start_keepalive(credentials, attempt=attempt + 1)
            return

        async def _ping():
            try:
                await page.goto(CHECK_URL, timeout=30000, wait_until="commit")
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

    async def stop_keepalive_for(self, code: str):
        """Public method to force-stop a house's keepalive (used when session is stale)."""
        if code and code in self._keepalive_ctx:
            await self._stop_keepalive(code)
            logger.info(f"🔁 Keepalive cleared for {code} to force fresh login")

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
        await self._ensure_browser_alive(raise_on_fail=True)
        context = await self._new_context()
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
            try:
                await page.close()
                await context.close()
            except Exception:
                pass
            raise e

    # ── Main entry point ───────────────────────────────

    async def get_valid_page(self, credentials, attempts: int = 2):
        """Return a usable (page, context) for the house, transparently
        recovering the shared browser on driver failure and retrying.

        Returns ``(page, context)``. When the returned page lives on a shared
        keepalive context, ``context`` is ``None`` so callers do not close it.
        """
        await automation_locks.browser_lock.acquire()
        try:
            if not self.browser:
                await self.start()
            else:
                await self._ensure_browser_alive()
        finally:
            automation_locks.browser_lock.release()

        last_error = None
        for attempt in range(1, attempts + 1):
            try:
                return await self._get_valid_page_inner(credentials)
            except Exception as e:
                last_error = e
                if not self._is_connection_closed_error(e):
                    raise
                # Browser died mid-operation — recover and retry with fresh browser
                logger.warning(
                    f"🔁 [{credentials.get('house_name')}] Browser died during session "
                    f"setup ({e}); recovering & retrying (attempt {attempt}/{attempts})"
                )
                await automation_locks.browser_lock.acquire()
                try:
                    await self._ensure_browser_alive(raise_on_fail=True)
                    automation_locks.reset_house_locks()
                finally:
                    automation_locks.browser_lock.release()

        raise last_error

    async def _get_valid_page_inner(self, credentials):
        if not self.browser:
            await self.start()
        else:
            await self._ensure_browser_alive(raise_on_fail=True)

        code = credentials.get('code')

        # Per-house lock: only one browser operation per house at a time.
        house_lock = automation_locks.house(code or str(credentials['house_id']))
        await house_lock.acquire()
        try:
            # 1. Reuse keepalive context directly — just create a new page
            if code and code in self._keepalive_ctx:
                try:
                    page = await self._keepalive_ctx[code]["context"].new_page()
                    logger.info(f"✅ Reused keepalive session for {credentials['house_name']}")
                    return page, None
                except Exception as e:
                    logger.warning(f"⚠️ Keepalive context unusable for {code} ({e}); falling back to fresh session")
                    await self._stop_keepalive(code)

            session_path = self._session_path(credentials)

            if os.path.exists(session_path):
                logger.info(f"🔍 Checking saved session for {credentials['house_name']}...")
                test_context = await self._new_context(storage_state=session_path)
                test_page = await test_context.new_page()
                try:
                    if await self._is_session_valid(test_page):
                        logger.info(f"✅ Session valid for {credentials['house_name']}")
                        if code:
                            await self._start_keepalive(credentials)
                            await test_page.close()
                            await test_context.close()
                            page = await self._keepalive_ctx[code]["context"].new_page()
                            return page, None
                        return test_page, test_context
                except Exception:
                    pass
                try:
                    await test_page.close()
                    await test_context.close()
                except Exception:
                    pass
                logger.info(f"⏳ Session expired for {credentials['house_name']}, re-logging in...")

            page, context = await self._login(credentials)
            if code and code in self._keepalive_ctx:
                try:
                    await page.close()
                    await context.close()
                except Exception:
                    pass
                page = await self._keepalive_ctx[code]["context"].new_page()
                return page, None
            return page, context
        finally:
            house_lock.release()


session_manager = SessionManager()
