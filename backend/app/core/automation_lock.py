import asyncio
from collections import defaultdict


class AutomationLockManager:
    """Centralized async lock manager for the shared DMS browser.

    - Per-house lock: ensures only one DMS browser operation runs per house
      at a time, preventing concurrent tasks from colliding on the same
      keepalive context / session.
    - Global browser lock: held while the shared browser is being (re)launched
      so that all other tasks wait for a fresh browser instead of racing on a
      stale reference.
    - Global sync lock: shared by the scheduler GA sync and the manual GA sync
      endpoint so they never overlap.
    """

    def __init__(self):
        self._house_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self.browser_lock = asyncio.Lock()
        self.ga_sync_lock = asyncio.Lock()
        self._reset_guard = asyncio.Lock()

    def house(self, key: str) -> asyncio.Lock:
        """Return (and lazily create) the per-house lock for the given key."""
        return self._house_locks[key]

    def reset_house_locks(self):
        """Drop all per-house locks. Call when the browser is being recovered
        to avoid waiting forever on a lock held by a dead task."""
        self._house_locks.clear()


automation_locks = AutomationLockManager()
