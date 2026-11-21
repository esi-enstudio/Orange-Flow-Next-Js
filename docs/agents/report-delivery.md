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
| `live_c2c` | `build_live_c2c_report_image()` | Live C2C RSO productivity table (A4 landscape) — the WhatsApp twin of `/reports/live-c2c` |

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

**Provider gate:** the modal only offers WhatsApp and Telegram when the active house has that app connected (read from `/api/whatsapp/status` and `/api/telegram/status`). When neither is connected it shows a bilingual empty state with a provider-neutral hint and a link to `/connections` (only for users holding `connections.view`); the new/edit delivery form, saved schedules, and delivery history are hidden. Channel state is owned by the Connections hub (`/connections`, `GET /api/connections`); never duplicate connection state in the modal.

#### Frontend

**Reusable Component** (`frontend/src/components/ReportDeliveryModal.tsx`):

```tsx
<ReportDeliveryModal
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
import ReportDeliveryModal from "@/components/ReportDeliveryModal";

<ReportDeliveryModal
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
| `backend/app/services/live_c2c_whatsapp_image.py` | Live C2C PNG builder (A4 landscape) |
| `backend/app/services/live_c2c_report_rows.py` | Live C2C report rows shared by the page API and the image builder |
| `backend/app/services/active_sso_whatsapp_image.py` | Active SSO PNG builder |
| `backend/app/routers/whatsapp_schedules.py` | API endpoints |
| `frontend/src/components/ReportDeliveryModal.tsx` | Reusable React component |
| `backend/main.py` (lines 300-322) | Background scheduler loop |

## Live C2C Inbound Automation

### Source Routing

Each house can use exactly one enabled inbound source:

- **Gmail**: the mailbox is the house's `House.email` value. The same mailbox cannot be enabled for two houses.
- **WhatsApp**: the source is the selected device and source group pair. The same `(device, source group)` pair cannot be enabled for two houses.

The filename must contain both `Live` and `C2C` as case-insensitive words. House codes must not be inferred from filenames.

### Gmail OAuth Setup

Configure these environment variables:

```env
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=https://<backend-host>/api/v1/live-c2c-automation/gmail/callback
```

Register the exact redirect URI in Google Cloud Console and request Gmail read-only scope only. The callback must be reachable from the public backend host and must use HTTPS in production.

The Live C2C automation page starts OAuth for the selected house's mailbox. OAuth state is one-time, expires after ten minutes, and is bound to the initiating user and house. Stored Gmail tokens are AES-GCM encrypted. The house mailbox is verified against Google account profile data before activation.

The scheduler polls only enabled, connected Gmail configurations. Failed polls retain explicit status and retry state.

### WhatsApp Inbound Setup

Set the public callback URL for signed gateway webhooks:

```env
LIVE_C2C_WHATSAPP_WEBHOOK_URL=https://<backend-host>/api/v1/live-c2c-automation/whatsapp/webhook
```

The URL must be reachable from the WhatsApp gateway. The gateway must send `media.received` document events with the signed HMAC header. Invalid signatures, oversized bodies, wrong devices, and wrong source groups are rejected or ignored without enqueueing.

Incoming event bodies are limited to 15 MiB. Live C2C attachments are additionally limited to 10 MiB and must use `.xlsx` or `.xlsb`. Duplicate gateway event IDs are not processed twice.

Configure the incoming source group and report destination group separately for each house; the two WhatsApp groups must be different. The automation settings on `/reports/live-c2c` use the selected house's connected WhatsApp device and available group list. When a matching file is queued, its destination group is snapshotted so later changes cannot reroute it. The background scheduler processes the file (normally within 30 seconds), imports its single matching worksheet, and sends the generated Live C2C report to that snapshotted destination. If automation is disabled or its incoming source changes before processing, the queued file is marked failed rather than imported or sent. The filename must contain both `Live` and `C2C` as case-insensitive words. Transient import or delivery failures remain visible and are retried according to the existing queue policy.
