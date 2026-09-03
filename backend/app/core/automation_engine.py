import asyncio
import logging
from playwright.async_api import async_playwright
from config import settings

logger = logging.getLogger(__name__)

class AutomationEngine:
    def __init__(self):
        self.playwright = None
        self.browser = None

    async def start(self):
        # If we already have a browser object but the underlying driver died,
        # tear it down so we can relaunch a fresh one.
        if self.browser is not None:
            try:
                probe = await self.browser.new_context()
                await probe.close()
                return
            except Exception:
                logger.error("🔌 Engine browser connection dead; relaunching...")
                try:
                    await self.browser.close()
                except Exception:
                    pass
                self.browser = None
                if self.playwright:
                    try:
                        await self.playwright.stop()
                    except Exception:
                        pass
                    self.playwright = None

        if not self.playwright:
            self.playwright = await async_playwright().start()
            # Launch standard browser
            self.browser = await self.playwright.chromium.launch(
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
            logger.info("🚀 [Engine] Browser Engine Started.")

    async def get_browser(self):
        """Return browser object, start if stopped"""
        if not self.browser or not self.playwright:
            await self.start()
        return self.browser


    async def stop(self):
        """Cleanly close browser and Playwright when bot stops"""
        try:
            if self.browser:
                await self.browser.close()
                self.browser = None
            
            if self.playwright:
                await self.playwright.stop()
                self.playwright = None
                
            logger.info("✅ [Engine] Browser Engine and Playwright Stopped.")
        except Exception as e:
            logger.error(f"⚠️ [Engine] Error during engine stop: {e}")


# Global engine instance
engine = AutomationEngine()