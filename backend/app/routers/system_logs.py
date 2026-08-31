import logging
import os
import re
from typing import List, Optional

from fastapi import APIRouter, Depends, Query

from app.routers.deps import has_permission
from app.models.user import User

router = APIRouter(prefix="/api/system-logs", tags=["System Logs"])

logger = logging.getLogger(__name__)

_LOG_PATH_CANDIDATES = (
    os.path.join("logs", "orange_flow.log"),
    "/tmp/orange_flow.log",
)

# Matches: 2026-08-31 10:54:58,614 - app.core.x - INFO - message
_LINE_RE = re.compile(
    r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:,\d{3})?) - (.*?) - (INFO|DEBUG|WARNING|ERROR|CRITICAL) - (.*)$"
)

# OTP-related logs are excluded per requirement ("all terminal logs except OTP").
_OTP_KEYWORDS = ("otp", "🔐", "🔑")


def _find_log_path() -> Optional[str]:
    for p in _LOG_PATH_CANDIDATES:
        if os.path.isfile(p):
            return p
    return None


def _tail_lines(path: str, max_lines: int) -> List[str]:
    """Efficiently read the last `max_lines` lines without loading the whole file."""
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        size = f.tell()
        chunk = min(size, 256 * 1024)
        f.seek(size - chunk)
        data = f.read()
    text = data.decode("utf-8", errors="replace")
    lines = text.splitlines()
    if len(lines) > max_lines:
        lines = lines[-max_lines:]
    return lines


def _is_otp_line(line: str) -> bool:
    low = line.lower()
    return any(k in low for k in _OTP_KEYWORDS)


@router.get("")
async def get_system_logs(
    limit: int = Query(200, ge=10, le=500),
    current_user: User = Depends(has_permission("system_logs.view")),
):
    """Return the latest backend/terminal log entries, excluding OTP-related lines."""
    path = _find_log_path()
    if not path:
        return {"success": True, "data": [], "source": None}

    raw_lines = _tail_lines(path, max_lines=limit * 3)

    records: List[dict] = []
    last = None
    for line in raw_lines:
        if _is_otp_line(line):
            last = None  # break grouping so OTP continuation lines don't leak in
            continue
        m = _LINE_RE.match(line)
        if m:
            ts, logger_name, level, message = m.groups()
            last = {
                "timestamp": ts,
                "level": level.upper(),
                "logger": logger_name,
                "lines": [message.strip()],
            }
            records.append(last)
        elif last is not None:
            last["lines"].append(line.strip())

    records = records[-limit:]
    data = [
        {
            "timestamp": r["timestamp"],
            "level": r["level"],
            "logger": r["logger"],
            "message": "\n".join(r["lines"]),
        }
        for r in records
    ]

    return {"success": True, "data": data, "source": path}