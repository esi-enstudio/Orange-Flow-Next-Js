# Connections Hub — Design

Date: 2026-11-20
Status: proposed (awaiting approval)

## Intent and why

Houses integrate with external apps (WhatsApp, Telegram, Gmail, later Slack and
others). Today each integration is configured on its own page (`/whatsapp`,
`/telegram`, `/reports/live-c2c`), and the reusable report-delivery modal always
offers both WhatsApp and Telegram even when the house has not connected one.

We want one **Connections** page per house:

- one card per connection (WhatsApp, Telegram, Gmail),
- connect / disconnect from that card,
- and the reusable report-delivery modal (`ReportDeliveryModal`, renamed from
  `WhatsAppReportDeliveryModal`) shows **only the channels that the active house
  actually has connected**.

The Live C2C report page loses its inbound-file-automation section; Gmail and
the other app connections are managed only from Connections.

## Goals

- New `/connections` page, house-scoped, one independent card per provider.
- Each card shows real, live status and exposes the real connect/disconnect
  action for that provider.
- Every connection action is permission-controlled and audit-logged.
- `WhatsAppReportDeliveryModal` renders only connected channels, and shows a
  "connect an app" empty state when none are connected.
- New module is fully registered: nav item, permissions, plan module/leaf,
  i18n (en + bn), page guide, page title, skeleton, responsive.

## Non-goals

- Building new outbound integrations that have no backend (Slack, Messenger,
  Google Sheets, generic SMTP). The provider registry is the extension point;
  only providers with a real adapter ship in v1.
- Sending report images through Gmail. Gmail v1 is an OAuth account connection
  (the existing Live C2C credential store); report delivery remains WhatsApp +
  Telegram.
- Replacing `/whatsapp` and `/telegram` management pages. Connections reuses
  their backends and links to them for multi-house administration.

## Anti-goals

- A card whose "Connect" button does not really connect anything.
- A second copy of connection state that drifts from the gateway/bot/OAuth
  truth.
- Hiding the report modal channels with frontend-only logic that the backend
  does not agree with.

## Approaches considered

| Approach | Trade-off | Verdict |
|---|---|---|
| **A. Enablement hub over the existing backends** — one aggregator API derives per-house provider state from the gateway, bot binding and Live C2C OAuth config; the page reuses the existing connect flows, and the modal filters on the same derived state. | No duplicated state, no backfill, no drift. New providers plug into one registry. | **Chosen** |
| B. Full credential manager — Connections owns credentials for every provider. | Duplicates WhatsApp/Telegram/Gmail credential handling, drifts from existing systems, forces fake "coming soon" cards for providers with no send backend. | Rejected |
| C. UI-only cards with local toggles. | Looks finished but changes nothing; violates the no-fake-feature rule. | Rejected |

## Architecture

### Provider registry (backend)

`backend/app/services/connection_providers.py`:

- `ProviderSpec` (key, used-for tags, adapter class).
- `collect_house_connections(db, house)` returns one `HouseConnectionState` per
  supported provider:
  `provider`, `connected`, `status`
  (`connected|disconnected|not_configured|error`), `account`, `detail`,
  `last_connected_at`, `error`, `used_for`, `available`.
- Adapters:
  - **whatsapp** — resolves the house's target via the existing
    `resolve_house_wa_target` (shared device or own device) and reads the
    gateway status exactly like `/api/whatsapp/status`. `account` = phone,
    `detail` = device / shared-connection name.
  - **telegram** — resolves the house bot via
    `telegram_service.resolve_house_tg_bot`; connected only when the house has
    a linked `telegram_chat_id` and the bot is reachable. `account` = `@bot`,
    `detail` = chat name.
  - **gmail** — reads the house `LiveC2CAutomationConfig`; connected when
    `source_type=gmail`, `gmail_status=connected` and tokens exist.
    `available` is false when `GOOGLE_OAUTH_CLIENT_ID` is not configured.
    `used_for` = `email` (not report delivery).

The registry is the single extension point: a new app = one adapter + one
frontend copy entry. Providers without a real adapter are not returned.

### API

`GET /api/connections` — new router `backend/app/routers/connections.py`.

- Requires `require_house_context` and `connections.view`.
- Verifies the user may access the house (same rule as the WhatsApp router).
- Returns `{success, data: HouseConnectionState[]}`.
- Read-only. All mutations stay on their existing, already-secured endpoints,
  and each one is gated by its provider connection permission:
  - WhatsApp: `/api/whatsapp/connect`, `/api/whatsapp/connect/pairing`,
    `/api/whatsapp/reconnect`, `/api/whatsapp/disconnect` — `whatsapp.connect`.
  - Telegram: new `POST /api/telegram/connect` (verify + link chat) and
    `DELETE /api/telegram/disconnect` (unlink), both `telegram.connect` and
    audit-logged. The existing admin `/api/telegram/test-delivery` stays on
    `telegram.manage` for the `/telegram` page.
  - Gmail: `/api/v1/live-c2c-automation/gmail/authorize` and
    `/gmail/disconnect` — `gmail.connect` (legacy
    `live_c2c.automation_manage` still accepted for existing roles).

The action permissions are exactly `whatsapp.connect`, `telegram.connect` and
`gmail.connect`. There is no extra `connections.manage` gate: `connections.view`
opens the page, and each card's actions are gated by that provider's connect
permission.

### Gmail OAuth return path

`live_c2c_automation_configs` gets `oauth_return_path VARCHAR(100) NULL`
(migration). `/gmail/authorize` accepts an optional `return_path`; it is
accepted only when it starts with `/` and is not `//`, stored with the one-time
state, and cleared with the state. The callback redirects there instead of the
hard-coded Live C2C page. Default (no path) behaviour is unchanged.

### Report delivery modal

`frontend/src/components/ReportDeliveryModal.tsx` (renamed from
`WhatsAppReportDeliveryModal.tsx`; every import, the component name, default
title and the docs are updated):

- Uses its existing `/whatsapp/status` and `/telegram/status` responses to build
  `visibleChannels`.
- Renders a channel tab only for a connected channel; if exactly one is
  connected it is preselected; if the selected channel disconnects it switches.
- If none is connected, the channel section shows a bilingual empty state with a
  link to `/connections` (link hidden when the user lacks `connections.view`)
  and the send/save actions stay disabled.
- Existing schedules for a disconnected channel remain visible but cannot be
  sent until reconnected.

No backend change is needed for the modal; it reads the same truth as the page.

## Data model

No new table. State is derived from the gateway, the bot binding and the Live
C2C config, which stays the single source of truth. The only schema change is
`live_c2c_automation_configs.oauth_return_path`.

## Frontend

### Page

`frontend/src/app/connections/page.tsx`

- Standard page header: breadcrumb → icon tile + `<h1>` + `PageGuideModal` →
  subtitle → divider (reference: `/reports/live-c2c`).
- Active house comes from `useAuth().selectedHouse` and is sent as
  `X-House-ID` by the shared API client.
- Header action: refresh. No inline filter section (not a data table page).
- Grid: `grid-cols-1 sm:grid-cols-2 xl:grid-cols-3`, one card per provider.
- Loading: content-aware skeleton cards (icon, title, two lines, button).
- Error/empty states: retry action; "no house selected" message.
- Actions disabled while a request is in flight; `cursor-pointer` on controls,
  44×44 touch targets, no horizontal scroll at 375/768/1280.

### Cards (one component per connection)

`frontend/src/app/connections/_components/`

- `ProviderCard.tsx` — shared shell (provider icon tile, name, category chip,
  status badge, `used for` chips, last-connected date in `DD MMM YYYY`).
- `WhatsAppCard.tsx` — phone/device detail; Connect opens the existing
  `WhatsAppConnectModal`; Reconnect and Disconnect use the existing endpoints
  with confirmation.
- `TelegramCard.tsx` — bot + linked chat; inline chat-id form calling the new
  `/api/telegram/connect`; Send test; Disconnect calling
  `/api/telegram/disconnect`; "no bot assigned" state links to `/telegram` for
  admins.
- `GmailCard.tsx` — house mailbox; Connect starts the OAuth flow and returns to
  `/connections`; Disconnect calls the existing endpoint; "not configured by
  administrator" state when OAuth env is missing.

Provider presentation (icon, accent colour, description i18n key, required
permission) lives in `frontend/src/lib/connectionProviders.ts`.

Data hook: `frontend/src/hooks/useHouseConnections.ts` (fetch, refresh, action
callbacks, error state).

## Permissions and plan module

- `backend/config/permissions.json` — new module `connections` with
  `connections.view`; display name "Connections". Add `telegram.connect` to the
  `telegram` module and `gmail.connect` to a new `gmail` module (or the
  `connections` module) so the three action permissions are
  `whatsapp.connect`, `telegram.connect`, `gmail.connect`.
- Default roles: `connections.view` for Distributor and Manager so report
  sharing keeps working; `telegram.connect` and `gmail.connect` for
  Distributor and Manager so the house can connect its own apps. Admin already
  receives every permission.
- `frontend/src/lib/constants.ts` — top-level `nav.connections` →
  `/connections`, `moduleKey: "connections"`, permission `connections.view`,
  icon `Plug`.
- `backend/config/modules.py`:
  - `PATH_TO_MODULE`: `("/api/connections", "connections")`.
  - `MODULE_LEAF_ROUTES["connections"] = ("/connections",)`.
  - `LEAF_TO_API_PREFIXES["/connections"] = ("/api/connections",)`.
- `DynamicPageTitle` resolves the title from `navItems`.

## Live C2C page cleanup

- Remove the "Inbound file automation" section from
  `frontend/src/app/reports/live-c2c/page.tsx`: the import, the
  `canViewAutomation` / `canManageAutomation` permissions and the
  `<LiveC2CAutomationSettings>` block.
- Delete `_components/LiveC2CAutomationSettings.tsx` (used only there). The
  backend Live C2C automation API and scheduler stay intact; only its UI entry
  point moves away from the report page.
- The Gmail OAuth callback still works for accounts connected from Connections.

## Modal rename

- `git mv frontend/src/components/WhatsAppReportDeliveryModal.tsx
  frontend/src/components/ReportDeliveryModal.tsx`; rename the exported
  component and default title.
- Update all six report pages (`activations`, `active-lso`, `active-sso`,
  `live-activations`, `live-c2c`, `recharge`).
- Update `docs/agents/report-delivery.md` to the new name.

## Audit

- Existing WhatsApp connect endpoints get the missing `log_activity` calls
  (`whatsapp.connect`, `whatsapp.connect_pairing`) so every card action is
  audited.
- New Telegram connect/unlink endpoints log `telegram.house.link_chat` and
  `telegram.house.unlink_chat`.
- Gmail authorize/disconnect already log.
- `GET /api/connections` is read-only and not logged.

## i18n

`frontend/src/i18n/translations.ts` — new `nav.connections` and
`connections_page.*` namespace in **both** `en` and `bn`:

- header title/subtitle, page-guide overview/features/steps/notes,
- each provider name/description, status badges, used-for chips,
- actions (connect, reconnect, disconnect, verify, send test, refresh),
- form labels/placeholders/errors and empty states,
- confirmation dialog copy.

## Verification

- `cd frontend && npm run lint`
- `cd frontend && npx tsc --noEmit`
- `cd backend && python -m pytest -q`
- `cd backend && python -m pytest -q tests/test_plan_modules_parity.py tests/test_module_coverage.py`
- Manual responsive check at 375 / 768 / 1280 and both locales.
- New `backend/tests/test_connections.py`: house context required, permission
  required, house isolation, provider derivation (connected/disconnected),
  Telegram connect/unlink audit, Gmail return-path sanitisation.

## My calls (not asked, settle here unless corrected)

1. No new connection table — derive state from the existing systems.
2. v1 ships only providers with a real backend: WhatsApp, Telegram, Gmail.
3. Gmail is an account connection (OAuth) and is not a report-delivery channel.
4. The three action permissions are `whatsapp.connect`, `telegram.connect`,
   `gmail.connect`; `connections.view` opens the page. No extra
   `connections.manage`.
5. The Connections page is a top-level nav item, not a Settings tab.
6. The Live C2C inbound automation UI is removed; its backend remains.
