import time
import asyncio
import logging

logger = logging.getLogger(__name__)

class OTPManager:
    def __init__(self):
        self.otp_pool = []

    def update_otp(self, code: str, house_identifier: str):
        new_otp = {
            "code": str(code),
            "identifier": str(house_identifier).strip().upper(),
            "received_at": time.time(),
            "is_used": False
        }
        self.otp_pool.append(new_otp)
        logger.info(f"🆕 [OTP Pool] New OTP: {code} for {house_identifier}")
        self._cleanup_old_otps()

    async def wait_for_fresh_otp(self, target_id: str, request_time: float, timeout=110):
        start_wait = time.time()
        target_id = str(target_id).strip().upper()
        logger.info(f"⏳ [OTP] {target_id} এর ওটিপি খুঁজছি...")
        while time.time() - start_wait < timeout:
            for otp_data in self.otp_pool:
                if not otp_data["is_used"] and \
                   otp_data["identifier"] == target_id and \
                   (time.time() - otp_data["received_at"] < 120) and \
                   (otp_data["received_at"] >= request_time - 2):
                    otp_code = otp_data["code"]
                    otp_data["is_used"] = True
                    logger.info(f"✅ [OTP] {target_id} এর জন্য ম্যাচ পাওয়া গেছে: {otp_code}")
                    return otp_code
            await asyncio.sleep(1)
        logger.error(f"❌ [OTP] ওটিপি পাওয়ার সময় শেষ (Timeout) হাউজ: {target_id}")
        return None

    def _cleanup_old_otps(self):
        current_time = time.time()
        self.otp_pool = [otp for otp in self.otp_pool if current_time - otp["received_at"] < 300]

otp_manager = OTPManager()
