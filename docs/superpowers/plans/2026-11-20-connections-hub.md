# Connections Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a house-scoped `/connections` page with one card per connected app (WhatsApp, Telegram, Gmail) and gate the reusable report-delivery modal on those connections.

**Architecture:** A read-only `/api/connections` aggregator derives provider state from the existing WhatsApp gateway, Telegram bot binding and Gmail OAuth config. The page reuses the existing connect flows; the report modal filters its channel tabs on the same `/whatsapp/status` and `/telegram/status` responses. No new connection table.

**Tech Stack:** Next.js App Router, TypeScript, Tailwind, shadcn/ui, FastAPI, SQLAlchemy async, Alembic, pytest.

**Spec:** `docs/superpowers/specs/2026-11-20-connections-hub-design.md`

## Global Constraints

- Every user-visible string has `en` and `bn` keys in `frontend/src/i18n/translations.ts`.
- Every endpoint checks permission and house access; never trust the frontend.
- Every mutation writes an `activity_logs` entry.
- Action permissions are exactly `whatsapp.connect`, `telegram.connect`, `gmail.connect`; page access is `connections.view`.
- Date display is `DD MMM YYYY`.
- Verification: `cd frontend && npm run lint`, `cd frontend && npx tsc --noEmit`, `cd backend && python -m pytest -q`, plus the plan-module parity tests.

## Review Focus

- A house with no provider connected: the report modal must show an empty state and keep send/save disabled.
- A house with only Telegram connected: the modal must not preselect WhatsApp.
- A user who can view Connections but lacks the provider connect permission: actions hidden or disabled, backend still rejects.
- Cross-house access: `/api/connections` must return only the active house's state.
- Gmail OAuth `return_path` tampering: only a local absolute path is accepted.

---

### Task 1: Provider registry + `/api/connections`

**Files:**
- Create: `backend/app/services/connection_providers.py`
- Create: `backend/app/routers/connections.py`
- Modify: `backend/main.py`
- Test: `backend/tests/test_connections.py`

**Interfaces:**
- Produces: `collect_house_connections(db, house) -> list[HouseConnectionState]`
- Produces: `GET /api/connections` → `{"success": True, "data": [...]}`
- `HouseConnectionState` fields: `provider`, `connected`, `status`, `account`, `detail`, `last_connected_at` (ISO string or null), `error`, `used_for`, `available`.

- [x] Write failing tests: requires `X-House-ID`; requires `connections.view`; returns whatsapp/telegram/gmail; derives connected/disconnected; other house's phone/email absent.
- [x] Run `pytest tests/test_connections.py -q` → FAIL (router missing).
- [x] Implement adapters:
  - whatsapp: `resolve_house_wa_target`; when target exists call `whatsapp_service_client.get_device_status(target.jwt_token)` inside `with_target_token`; map connected/phone/last_connected/error; `used_for=["report_delivery"]`.
  - telegram: `telegram_service.resolve_house_tg_bot`; connected when bot exists **and** `house.telegram_chat_id`; call `get_me` for username; `used_for=["report_delivery"]`.
  - gmail: query `LiveC2CAutomationConfig` for `house.id`; connected when `source_type=="gmail"` and `gmail_status=="connected"` and a token exists; `available` from `settings.GOOGLE_OAUTH_CLIENT_ID`; `used_for=["email"]`.
- [x] Implement router with `require_house_context`, `has_permission("connections.view")`, house-access check.
- [x] Register router in `backend/main.py`.
- [x] Run tests → PASS. Commit.

### Task 2: Permissions + plan module wiring

**Files:**
- Modify: `backend/config/permissions.json`
- Modify: `backend/config/modules.py`
- Modify: `backend/config/permissions.json` default roles (Distributor, Manager): `connections.view`, `telegram.connect`, `gmail.connect`.
- Test: `backend/tests/test_plan_modules_parity.py`, `backend/tests/test_module_coverage.py`

**Interfaces:** permission keys `connections.view`, `telegram.connect`, `gmail.connect`.

- [x] Add modules: `connections` → `connections.view`; `gmail` → `gmail.connect`; add `telegram.connect` to `telegram`.
- [x] Add `("/api/connections", "connections")` to `PATH_TO_MODULE`; `MODULE_LEAF_ROUTES["connections"] = ("/connections",)`; `LEAF_TO_API_PREFIXES["/connections"] = ("/api/connections",)`.
- [x] Run parity/coverage tests → PASS.

### Task 3: Telegram connect/disconnect endpoints

**Files:**
- Modify: `backend/app/routers/telegram_bots.py`
- Test: `backend/tests/test_connections.py`

**Interfaces:**
- `POST /api/telegram/connect` body `{house_id, chat_id, chat_name?}` → verifies via `telegram_service.send_message`, saves `House.telegram_chat_id`, logs `telegram.house.link_chat`.
- `DELETE /api/telegram/disconnect` with `X-House-ID` → clears chat fields, logs `telegram.house.unlink_chat`.
- Both require `telegram.connect`.

- [x] Write failing tests for link and unlink + audit rows.
- [x] Implement both, reusing the `test_delivery` logic and `_user_house_ids` access check.
- [x] Run tests → PASS. Commit.

### Task 4: WhatsApp connect audit

**Files:**
- Modify: `backend/app/routers/whatsapp_gateway.py`

- [x] Add `log_activity(... module="whatsapp", action="connect")` after successful `/whatsapp/connect` and `action="connect_pairing"` after pairing, with house-scoped identifier.
- [x] Run related backend tests → PASS.

### Task 5: Gmail OAuth return path + permission

**Files:**
- Modify: `backend/app/models/live_c2c_automation.py`
- Create: `backend/alembic/versions/<rev>_add_live_c2c_oauth_return_path.py`
- Modify: `backend/app/routers/live_c2c_automation.py`
- Test: `backend/tests/test_connections.py`

**Interfaces:** `oauth_return_path = Column(String(100), nullable=True)`; authorize accepts `return_path`; callback redirects to it only when it starts with `/` and not `//`; authorize/disconnect accept `gmail.connect` in addition to `live_c2c.automation_manage`.

- [x] Write failing tests: `?return_path=/connections` reflected in redirect; `https://evil` ignored; authorize allowed with `gmail.connect`.
- [x] Add column + migration chained to `c3d4e5f6a7b8`.
- [x] Update authorize payload (query param), state storage, callback redirect helper, permissions.
- [x] Run tests → PASS. Commit.

### Task 6: Rename the modal

**Files:**
- Rename: `frontend/src/components/WhatsAppReportDeliveryModal.tsx` → `ReportDeliveryModal.tsx`
- Modify: 6 report pages under `frontend/src/app/reports/*/page.tsx`
- Modify: `docs/agents/report-delivery.md`

- [x] `git mv`, rename default export, default title `"Report Delivery"`.
- [x] Update all imports/usages.
- [x] `npm run lint` + `npx tsc --noEmit` → PASS.

### Task 7: Modal channel gating

**Files:**
- Modify: `frontend/src/components/ReportDeliveryModal.tsx`

- [x] Derive `visibleChannels` from `whatsappReady`/`telegramReady`.
- [x] Render tabs only for visible channels; auto-select the single available one; switch away when the selected channel disconnects.
- [x] If none: bilingual empty state with a `/connections` link (only when `hasPermission("connections.view")`), disable send/save.
- [x] `npx tsc --noEmit` → PASS.

### Task 8: Navigation, i18n, provider presentation

**Files:**
- Modify: `frontend/src/lib/constants.ts`
- Create: `frontend/src/lib/connectionProviders.ts`
- Modify: `frontend/src/i18n/translations.ts`

- [x] Add nav item `nav.connections` → `/connections`, module `connections`, icon `Plug`, permission `connections.view`.
- [x] Add `connections_page` copy in `en` + `bn`: header, subtitle, guide (overview/features/steps/notes), provider descriptions, statuses, actions, errors, empty states.
- [x] Add provider map (icon, colour, description key, permission, used-for keys).

### Task 9: Connections page + cards

**Files:**
- Create: `frontend/src/app/connections/page.tsx`
- Create: `frontend/src/app/connections/_components/ProviderCard.tsx`
- Create: `frontend/src/app/connections/_components/WhatsAppCard.tsx`
- Create: `frontend/src/app/connections/_components/TelegramCard.tsx`
- Create: `frontend/src/app/connections/_components/GmailCard.tsx`
- Create: `frontend/src/hooks/useHouseConnections.ts`

- [x] Standard header + guide + refresh.
- [x] Grid of cards; skeleton; empty/error states.
- [x] WhatsApp: existing `WhatsAppConnectModal`, reconnect, disconnect.
- [x] Telegram: bot display, chat-id form → `/telegram/connect`, send test, disconnect.
- [x] Gmail: authorize with `return_path=/connections`, disconnect, unavailable state.
- [x] Permission-gated actions and `cursor-pointer`/44px targets.
- [x] `npm run lint` + `npx tsc --noEmit` → PASS.

### Task 10: Remove Live C2C inbound automation UI

**Files:**
- Modify: `frontend/src/app/reports/live-c2c/page.tsx`
- Delete: `frontend/src/app/reports/live-c2c/_components/LiveC2CAutomationSettings.tsx`

- [x] Remove import, automation permission consts and JSX block.
- [x] Delete the component (no other usages).
- [x] `npm run lint` + `npx tsc --noEmit` → PASS.

### Task 11: Docs + final verification

- [x] Update `docs/agents/report-delivery.md` (component name, provider gate note).
- [x] Run full backend suite, frontend lint/typecheck, parity tests.
- [x] Manual responsive check at 375 / 768 / 1280 and both locales.
