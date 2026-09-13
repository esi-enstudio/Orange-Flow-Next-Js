"""In-memory cache for built report images.

Report image builds are expensive (the GA Live report renders a large PNG in
~10s). Preview, "Send Now", direct sends and scheduled deliveries all call the
same builder, so we cache the bytes for a short TTL keyed by
(report_type, house_id, report_date, scale). With a 60s window a user who
previews and then sends (or sends twice in quick succession) reuses the exact
same built image instead of rebuilding it.

The GA Live report is "live", but a 60-second staleness window is negligible
for this workflow, and it is what makes repeated previews/sends instant.
"""
import time
from threading import Lock

TTL_SECONDS = 60.0
MAX_ENTRIES = 64

_cache: dict[tuple, tuple[float, bytes]] = {}
_lock = Lock()


def _key(report_type: str, house_id: int, day, scale: int | None) -> tuple:
    return (str(report_type), int(house_id), str(day), scale)


def get(report_type: str, house_id: int, day, scale: int | None = None) -> bytes | None:
    k = _key(report_type, house_id, day, scale)
    with _lock:
        item = _cache.get(k)
        if item is None:
            return None
        ts, data = item
        if time.monotonic() - ts > TTL_SECONDS:
            _cache.pop(k, None)
            return None
        return data


def set(report_type: str, house_id: int, day, scale: int | None, data: bytes) -> None:
    k = _key(report_type, house_id, day, scale)
    with _lock:
        if len(_cache) >= MAX_ENTRIES:
            _cache.pop(next(iter(_cache)))
        _cache[k] = (time.monotonic(), data)


def clear() -> None:
    with _lock:
        _cache.clear()