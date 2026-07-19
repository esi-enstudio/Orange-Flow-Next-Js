from datetime import datetime, timedelta, timezone

# Bangladesh Standard Time (UTC+6)
BST = timezone(timedelta(hours=6))


def now() -> datetime:
    return datetime.now(BST)


def now_naive() -> datetime:
    return datetime.now(BST).replace(tzinfo=None)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def to_bst(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(BST)


def to_bst_naive(dt: datetime) -> datetime:
    return to_bst(dt).replace(tzinfo=None)
