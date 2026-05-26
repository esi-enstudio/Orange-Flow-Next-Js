import logging
from playwright.async_api import async_playwright
import asyncio

logger = logging.getLogger("app.Core.session_manager")

class SessionManager:
    def __init__(self):
        self.playwright = None
        self.browser = None

    async def start(self):
        if not self.playwright:
            self.playwright = await async_playwright().start()
            self.browser = await self.playwright.chromium.launch(headless=True)
            logger.info("🚀 Browser started for automation tasks.")

    async def stop(self):
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()
        logger.info("🛑 Browser stopped.")

    async def get_valid_page(self, credentials):
        """
        Creates a new context and page, logs in to Banglalink DMS, and returns the page.
        This is a simplified version for web-only mode.
        """
        if not self.browser:
            await self.start()
        
        context = await self.browser.new_context()
        page = await context.new_page()
        
        try:
            logger.info(f"🔑 Logging in for {credentials['house_name']}...")
            await page.goto("https://blkdms.banglalink.net/Login", wait_until="networkidle")
            
            await page.fill("#UserName", credentials['user'])
            await page.fill("#Password", credentials['pass'])
            await page.click("button[type='submit']")
            
            # Wait for dashboard or any indicator of success
            await page.wait_for_url("**/Dashboard**", timeout=30000)
            logger.info(f"✅ Login successful for {credentials['house_name']}")
            
            return page, context
        except Exception as e:
            logger.error(f"❌ Login failed for {credentials['house_name']}: {str(e)}")
            await page.close()
            await context.close()
            raise e

session_manager = SessionManager()
