# WhatsApp/Telegram Report Delivery

> Detail spec referenced from [AGENTS.md](../../AGENTS.md). Rules here are binding; they are not optional guidance.

## Reusable WhatsApp/Telegram Report Delivery Module

### Overview

A reusable module for scheduling and sending report images (PNG) to WhatsApp groups or Telegram chats. Supports multiple report types via a registry pattern.

### Architecture

#### Backend

**Report Builder Registry** (`backend/app/services/report_builders.py`):
- Central registry mapping `report_type` strings to builder functions
- Each builder: `async (db: AsyncSession, house_id: int) -> bytes` (returns PNG image)
- To add a new report type: add builder function + register in `REPORT_BUILDERS` dict

**Existing Report Types:**
| `report_type` | Builder Function | Description |
|---|---|---|
| `ga_live` | `build_ga_live_report_image()` | GA Live Report with RSO/BP/Supervisor sections |
| `active_lso` | `build_active_lso_report_image()` | Active LSO retailer performance |
| `active_sso` | `build_active_sso_report_image()` | Active SSO SIM activation performance |
| `activation` | `build_activation_report_image()` | Activation dashboard: house / supervisor / RSO / BP tables |
| `recharge` | `build_recharge_report_image()` | Recharge dashboard: house / supervisor / RSO tables (total recharge target) |
| `recharge_ev_secondary` | `build_recharge_ev_report_image()` | Same tables measured against the EV C2C target — the WhatsApp twin of the Recharge page's "EV Secondary" toggle |

**Schedule Model** (`backend/app/models/whatsapp_schedule.py`):
- `report_type` column (VARCHAR(50), default `"ga_live"`)
- `channel`: `"whatsapp"` or `"telegram"`
- `schedule_type`: `"daily"` (HH:MM) or `"interval"` (every N minutes)

**Schedule Service** (`backend/app/services/whatsapp_schedule_service.py`):
- `send_schedule_report()` dispatches to correct builder via `get_report_builder(schedule.report_type)`
- Background runner in `main.py` fires every 30 seconds, checks `_is_due()`

**API Endpoints** (`backend/app/routers/whatsapp_schedules.py`):
- `GET /api/whatsapp-schedules?report_type=xxx` — list (filtered by report_type)
- `POST /api/whatsapp-schedules` — create (requires `report_type` in payload)
- `PATCH /api/whatsapp-schedules/{id}` — update
- `DELETE /api/whatsapp-schedules/{id}` — soft delete
- `POST /api/whatsapp-schedules/{id}/send-now` — immediate send
- `GET /api/whatsapp/status` — WhatsApp connection status
- `GET /api/whatsapp/groups` — list WhatsApp groups

**Permission:** `live_activations.schedule` (used for all report types)

#### Frontend

**Reusable Component** (`frontend/src/components/WhatsAppReportDeliveryModal.tsx`):

```tsx
<WhatsAppReportDeliveryModal
  open={isOpen}
  houseId={houseId}
  reportType="active_lso"          // Required: which report to send
  title="Active LSO Report Delivery"   // Optional: modal title
  subtitle="Auto-send report daily"    // Optional: modal subtitle
  onClose={() => setIsOpen(false)}
/>
```

**Features:**
- WhatsApp connection status with QR code scanning
- WhatsApp group selection grid
- Telegram channel support
- Frequency: repeat every N minutes OR daily at HH:MM
- Optional caption
- Active schedule list with send now, edit, pause/resume, delete
- 5-second polling for WhatsApp connection status

#### How to Add a New Report Type

1. **Create builder function** in `backend/app/services/xxx_whatsapp_image.py`:
```python
async def build_xxx_report_image(db: AsyncSession, house_id: int) -> bytes:
    # Generate report data, render PNG with Pillow, return bytes
    ...
```

2. **Register in** `backend/app/services/report_builders.py`:
```python
from app.services.xxx_whatsapp_image import build_xxx_report_image
REPORT_BUILDERS["xxx"] = build_xxx_report_image
# only when the builder accepts a `scale` keyword (lighter on-screen preview)
SCALE_AWARE_BUILDERS["xxx"] = build_xxx_report_image
```

3. **Allow in router** — add `"xxx"` to the allowed `report_type` values in `backend/app/routers/whatsapp_schedules.py`

4. **Use in frontend:**
```tsx
import WhatsAppReportDeliveryModal from "@/components/WhatsAppReportDeliveryModal";

<WhatsAppReportDeliveryModal
  reportType="xxx"
  title="XXX Report Delivery"
  subtitle="Auto-send XXX report"
/>
```

#### Files

| File | Purpose |
|------|---------|
| `backend/app/models/whatsapp_schedule.py` | Schedule DB model |
| `backend/app/services/report_builders.py` | Registry + builder dispatch |
| `backend/app/services/whatsapp_schedule_service.py` | Schedule execution engine |
| `backend/app/services/report_image_kit.py` | Shared basic-design primitives (palette, fonts, scaled draw, bordered tables) used by the GA Live, Activation and Recharge builders |
| `backend/app/services/ga_live_whatsapp_image.py` | GA Live PNG builder |
| `backend/app/services/activation_whatsapp_image.py` | Activation PNG builder |
| `backend/app/services/recharge_whatsapp_image.py` | Recharge PNG builder |
| `backend/app/services/active_lso_whatsapp_image.py` | Active LSO PNG builder |
| `backend/app/services/active_sso_whatsapp_image.py` | Active SSO PNG builder |
| `backend/app/routers/whatsapp_schedules.py` | API endpoints |
| `frontend/src/components/WhatsAppReportDeliveryModal.tsx` | Reusable React component |
| `backend/main.py` (lines 300-322) | Background scheduler loop |
