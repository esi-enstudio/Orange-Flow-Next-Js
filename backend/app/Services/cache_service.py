import json
import logging
from typing import Optional, Any
from config.settings import settings

REDIS_URL = settings.REDIS_URL
CACHE_TTL = 300
CACHE_ENABLED = settings.CACHE_ENABLED

logger = logging.getLogger(__name__)

class CacheService:
    _redis = None

    async def connect(self):
        if not CACHE_ENABLED:
            logger.info("Caching disabled via config")
            return
        if self._redis is None:
            try:
                import redis.asyncio as aioredis
                self._redis = aioredis.from_url(REDIS_URL, decode_responses=True)
                await self._redis.ping()
                logger.info("Redis connected")
            except Exception as e:
                logger.warning(f"Redis unavailable (caching disabled): {e}")
                self._redis = None

    async def close(self):
        if self._redis:
            await self._redis.close()
            self._redis = None

    async def get(self, key: str) -> Optional[Any]:
        if not self._redis:
            return None
        try:
            data = await self._redis.get(key)
            return json.loads(data) if data else None
        except Exception as e:
            logger.warning(f"Cache get failed: {e}")
            return None

    async def set(self, key: str, value: Any, ttl: int = CACHE_TTL):
        if not self._redis:
            return
        try:
            await self._redis.setex(key, ttl, json.dumps(value, default=str))
        except Exception as e:
            logger.warning(f"Cache set failed: {e}")

    async def delete(self, key: str):
        if not self._redis:
            return
        try:
            await self._redis.delete(key)
        except Exception as e:
            logger.warning(f"Cache delete failed: {e}")

    async def invalidate_pattern(self, pattern: str):
        if not self._redis:
            return
        try:
            keys = await self._redis.keys(pattern)
            if keys:
                await self._redis.delete(*keys)
        except Exception as e:
            logger.warning(f"Cache invalidate failed: {e}")

    def cache_key(self, prefix: str, *args, **kwargs) -> str:
        parts = [str(a) for a in args if a is not None]
        parts.extend(f"{k}:{v}" for k, v in sorted(kwargs.items()) if v is not None)
        return f"{prefix}:{':'.join(parts)}" if parts else prefix

cache_service = CacheService()
