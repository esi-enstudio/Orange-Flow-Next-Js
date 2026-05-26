import logging
from fastapi import APIRouter

router = APIRouter(prefix="/admin", tags=["Admin"])
logger = logging.getLogger(__name__)

# Note: This controller previously handled Telegram bot commands.
# It is now a placeholder for future web-based admin administrative APIs.

@router.get("/health")
async def health_check():
    return {"status": "ok", "module": "admin"}
