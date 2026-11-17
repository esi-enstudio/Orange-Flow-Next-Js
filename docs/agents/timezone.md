# Timezone Configuration

> Detail spec referenced from [AGENTS.md](../../AGENTS.md). Rules here are binding; they are not optional guidance.

### Timezone Configuration

#### Canonical Timezone

The project consistently uses **Bangladesh Standard Time (BST, UTC+6)** via a centralized utility.

#### Utility Module

```python
# backend/app/utils/timezone.py
BST = timezone(timedelta(hours=6))

def now() -> datetime:           # Timezone-aware BST datetime
def now_naive() -> datetime:     # Naive BST datetime (no tzinfo)
def utc_now() -> datetime:       # UTC datetime (for JWT tokens)
def to_bst(dt) -> datetime:      # Convert any datetime to BST-aware
def to_bst_naive(dt) -> datetime: # Convert to naive BST
```

#### Environment Variable

```env
TIME_ZONE=Asia/Dhaka
```

Added to `backend/config/settings.py`:

```python
TIME_ZONE: str = "Asia/Dhaka"
```

#### Rules

1. **Use `now_naive()` for all timestamp assignments** in routers — replaces `datetime.utcnow()` or `datetime.utcnow() + timedelta(hours=6)`
2. **Use `now()` for scheduler/logger** — timezone-aware BST
3. **Use `utc_now()` for JWT token expiry** — JWT standard expects UTC
4. **Model column defaults** should use `now_naive` (not `datetime.utcnow`)
5. **Never hardcode** `datetime.utcnow() + timedelta(hours=6)` — always use `now_naive()`

#### Files Updated

- `backend/app/utils/timezone.py` — centralized utility
- `backend/config/settings.py` — `TIME_ZONE` field
- `backend/main.py` — uses utility instead of hardcoded BST
- `backend/app/routers/deps.py` — `utc_now()` for JWT
- `backend/app/routers/scratch_card_serials.py`
- `backend/app/routers/sim_replacement.py` (13 occurrences)
- `backend/app/routers/cv.py`, `zoom_in.py`, `commission.py`, `bp_targets.py`
- `backend/app/models/commission.py`, `cv.py` — model defaults
- `.env` / `.env.example` / `backend/.env`
