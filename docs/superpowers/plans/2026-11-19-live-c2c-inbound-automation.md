# Live C2C Inbound Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically import each house's matching Live C2C email or WhatsApp attachment and send its report to that house's selected WhatsApp group.

**Architecture:** Add house-scoped automation and durable inbound-file records. Gmail OAuth/polling and signed WhatsApp document webhooks enqueue into one database-backed worker, which reuses the current import and direct-report services. Expose settings on the current Live C2C page.

**Tech Stack:** FastAPI, SQLAlchemy async, Alembic, `httpx`, `cryptography` (already available through `python-jose[cryptography]`), Next.js/React, Go/Fiber and the vendored `whatsmeow` gateway.

**Spec:** `docs/superpowers/specs/2026-11-19-live-c2c-inbound-automation-design.md`

## Global Constraints

- Every data-bearing model and query is scoped by `house_id`; APIs use `X-House-ID` and verify user access.
- Every endpoint and UI action is permission-controlled; use separate `live_c2c.automation_view` and `live_c2c.automation_manage` permissions.
- Every configuration mutation and automated import/delivery is audit logged; use the automation config's last editor as the existing non-null activity-log actor. Processing failures are recorded in both inbound status and activity log.
- All user-visible text has matching `en` and `bn` translation keys.
- Files must have `.xlsx` or `.xlsb` extensions, be at most 10 MiB, and have both `Live` and `C2C` as case-insensitive filename words.
- House resolution uses only the configured mailbox or (WhatsApp device, group); never infer it from a filename.
- If present, workbook house identifiers must match the configured house; select exactly one worksheet accepted by the existing parser.
- OAuth uses Gmail read-only scope, validates one-time state, verifies the account against `House.email`, and encrypts stored tokens.
- Only a successfully imported file may trigger report delivery; source event IDs are unique and processing is durable across restarts/workers.
- Frontend has no test runner; verify frontend changes with `npm run lint`, `npx tsc --noEmit`, and 375/768/1280 responsive checks.

## Review Focus

- **Wrong Gmail account or stale OAuth state:** refuse activation and reject replay; test profile mismatch and consumed/expired state in Task 3.
- **Wrong WhatsApp device/group or invalid HMAC:** do not enqueue; test group/device mismatch and bad signature in Task 4/6.
- **Filename, extension, size, or unsafe workbook:** reject without import or send; test exact 10 MiB boundary, case-insensitive word matching, and malformed workbook in Task 1/5.
- **Duplicate webhook/Gmail delivery or worker restart:** one inbound record and one import; test unique enqueue, lease recovery, and duplicate processing in Task 5.
- **Import or WhatsApp send failure:** preserve explicit failed state and never report delivery success; test both failure paths in Task 5.

---

## File Map

| File | Responsibility |
|---|---|
| `backend/app/models/live_c2c_automation.py` | Per-house settings and durable inbound attachment state |
| `backend/app/services/live_c2c_automation_service.py` | Filename/size rules, secret encryption, and idempotent enqueue |
| `backend/app/services/live_c2c_gmail_service.py` | OAuth, token refresh, Gmail history polling and attachment extraction |
| `backend/app/services/live_c2c_inbound_service.py` | Durable import/report processing and retry state |
| `backend/app/routers/live_c2c_automation.py` | Permissioned settings/OAuth APIs and signed WhatsApp webhook |
| `backend/alembic/versions/*_add_live_c2c_automation.py` | Automation and inbound-file tables/indexes/constraints |
| `backend/app/services/live_c2c_service.py` | Allow system processing to omit the HTTP request while preserving audit |
| `backend/app/services/whatsapp_schedule_service.py` | Let direct report auditing use the `live_c2c` module |
| `backend/app/services/whatsapp_service_client.py` | Register/remove signed gateway webhooks |
| `backend/config/settings.py`, `.env.example` | OAuth and WhatsApp callback URL configuration |
| `backend/config/permissions.json` | Automation view/manage permission registration and role grants |
| `backend/main.py` | Router registration and shared DB-backed automation runner |
| `wa-gateway/pkg/whatsapp/whatsapp.go` | Download and relay only matching, bounded incoming documents |
| `wa-gateway/pkg/whatsapp/live_c2c_media.go` | Pure candidate filtering for incoming spreadsheet documents |
| `frontend/src/app/reports/live-c2c/_components/LiveC2CAutomationSettings.tsx` | House source/destination settings and connection/status UI |
| `frontend/src/app/reports/live-c2c/page.tsx` | Render the settings component for the selected house |
| `frontend/src/i18n/translations.ts` | Bilingual automation labels, status, validation and error text |
| `docs/agents/report-delivery.md` | Document the inbound automation flow and operational setup |

---

### Task 1: Add Tenant-Scoped Automation and Inbound Records

**Files:**
- Create: `backend/app/models/live_c2c_automation.py`
- Create: `backend/app/services/live_c2c_automation_service.py`
- Create: `backend/tests/test_live_c2c_automation_rules.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/alembic/versions/<revision>_add_live_c2c_automation.py`

**Interfaces:**
- Produces `matches_live_c2c_filename(filename: str) -> bool`.
- Produces `validate_live_c2c_attachment(filename: str, size: int) -> str`; returns a basename or raises `LiveC2CImportError` with the existing error-code convention.
- Produces `encrypt_secret(secret: str) -> str` and `decrypt_secret(ciphertext: str) -> str` using AES-GCM and a key derived from `settings.SECRET_KEY`.
- Produces `enqueue_live_c2c_file(db, *, config, source_event_id: str, filename: str, content: bytes, source_device_id: str | None = None, source_group_jid: str | None = None) -> LiveC2CInboundFile`; verify enabled source/device/group, apply filename/size validation, and deduplicate by source event ID. A source mismatch raises `LiveC2CSourceMismatch`; the webhook acknowledges and ignores that event.
- Produces `LiveC2CAutomationConfig` (unique `house_id`) and `LiveC2CInboundFile` (unique `(house_id, source_type, source_event_id)`).
- Config fields include source type/enabled state, Gmail address/tokens/history cursor, inbound group, destination group, WhatsApp device/webhook identifiers, and `created_by`/`updated_by`.
- Add partial unique indexes so enabled Gmail mailbox addresses and enabled `(WhatsApp device, inbound group)` mappings cannot route to two houses.
- Inbound records include `house_id`, source identity, safe filename, SHA-256, temporary file bytes, import/delivery states, explicit error, timestamps, lease timestamp, and soft-delete fields.

- [ ] **Step 1: Write failing tests** in `test_live_c2c_automation_rules.py` for mixed-case `Live` and `C2C` word matches, missing words, unsupported extensions, empty/path-like filenames, exactly 10 MiB, one byte over, ciphertext round-trip/non-plaintext, duplicate enqueue, and mismatched/disabled source.
- [ ] **Step 2: Run** `cd backend && python -m pytest -q tests/test_live_c2c_automation_rules.py`; expected: failures because the rules/model are absent.
- [ ] **Step 3: Implement** the two model classes, tested rules/encryption/enqueue, model exports, and one Alembic migration with tenant, unique-source, state, and soft-delete indexes/constraints.
- [ ] **Step 4: Run** `cd backend && python -m pytest -q tests/test_live_c2c_automation_rules.py`; expected: all rule tests pass and model metadata imports.
- [ ] **Step 5: Check** `cd backend && alembic heads`; expected: one valid head and the new migration depends on the repository's current head.

### Task 2: Make Existing Import Reusable by the Worker

**Files:**
- Modify: `backend/app/services/live_c2c_service.py`
- Modify: `backend/tests/test_live_c2c_import.py`

**Interfaces:**
- Change `store_live_c2c_rows(..., request: Request)` to `store_live_c2c_rows(..., request: Request | None = None)`; keep `user` required so existing `LiveC2CRow.created_by` and `ActivityLog.user_id` remain valid.
- Automated callers pass the automation config's last editor; manual API callers retain the current `Request`.

- [ ] **Step 1: Add a failing test** that stores valid rows with `request=None` and asserts both rows and the `live_c2c.import` activity record are written for the supplied user.
- [ ] **Step 2: Run** `cd backend && python -m pytest -q tests/test_live_c2c_import.py -k automation`; expected: failure from the current required request argument.
- [ ] **Step 3: Implement** optional request handling without changing manual import behavior or transaction rollback semantics.
- [ ] **Step 4: Run** `cd backend && python -m pytest -q tests/test_live_c2c_import.py`; expected: existing and new import tests pass.

### Task 3: Implement House-Scoped Gmail OAuth and Polling

**Files:**
- Create: `backend/app/services/live_c2c_gmail_service.py`
- Create: `backend/tests/test_live_c2c_gmail_service.py`
- Modify: `backend/config/settings.py`
- Modify: `.env.example`

**Interfaces:**
- Consumes Task 1's `encrypt_secret()` / `decrypt_secret()`.
- Produces `build_gmail_authorization_url(config: LiveC2CAutomationConfig, state: str) -> str` with scope `https://www.googleapis.com/auth/gmail.readonly` and `login_hint=House.email`.
- Produces `exchange_gmail_code(db, config, code: str) -> None`; it must fetch Gmail profile and refuse a mailbox mismatch before persisting encrypted tokens/history ID.
- Produces `poll_gmail_config(db, config) -> int`; use Gmail `history.list` from the saved cursor, fetch message attachments, and enqueue matching files through Task 1's rules. A stale/expired history cursor marks the connection as needing attention without backfilling old mail.
- Settings are `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `GOOGLE_OAUTH_REDIRECT_URI`; the callback must be publicly reachable and registered with Google.

- [ ] **Step 1: Write failing tests** for encrypted token round-trip/non-plaintext storage, wrong mailbox rejection, state-bound authorization URL, matching attachment extraction, cursor advancement only after enqueue, and expired history handling.
- [ ] **Step 2: Run** `cd backend && python -m pytest -q tests/test_live_c2c_gmail_service.py`; expected: missing-service failures.
- [ ] **Step 3: Implement** OAuth/token refresh and Gmail REST calls with existing `httpx`; do not add Google client packages.
- [ ] **Step 4: Run** `cd backend && python -m pytest -q tests/test_live_c2c_gmail_service.py`; expected: all tests pass with mocked HTTP responses.
- [ ] **Step 5: Validate** settings load with empty OAuth config and fail explicitly when an OAuth connection is attempted without required deployment configuration.

### Task 4: Relay Incoming WhatsApp Spreadsheet Documents

**Files:**
- Create: `wa-gateway/pkg/whatsapp/live_c2c_media.go`
- Create: `wa-gateway/pkg/whatsapp/live_c2c_media_test.go`
- Modify: `wa-gateway/pkg/whatsapp/whatsapp.go`

**Interfaces:**
- Produces `isLiveC2CSpreadsheet(filename string, fileLength uint64) bool`; only matching `.xlsx`/`.xlsb` documents up to 10 MiB are downloaded.
- For a qualifying `DocumentMessage`, dispatch `media.received` with `jid`, `message_id`, `chat`, `media_type`, `filename`, `mimetype`, and base64 `file_content`. Non-document media behavior remains unchanged.
- Gateway keeps using its existing signed webhook and retry delivery; backend callback accepts at most 15 MiB to cover base64 expansion.

- [ ] **Step 1: Write failing Go tests** for mixed-case valid filenames, missing `Live`/`C2C`, wrong extension, and the 10 MiB boundary.
- [ ] **Step 2: Run** `cd wa-gateway && go test ./pkg/whatsapp -run LiveC2C`; expected: missing helper/test failures.
- [ ] **Step 3: Implement** the pure filter and use the existing `WhatsAppDownloadMedia` only for matching bounded WhatsApp document messages.
- [ ] **Step 4: Run** `cd wa-gateway && go test ./pkg/whatsapp`; expected: package tests pass.
- [ ] **Step 5: Run** `cd wa-gateway && go test ./...`; expected: all gateway packages pass.

### Task 5: Process the Durable Queue and Deliver the Report

**Files:**
- Create: `backend/app/services/live_c2c_inbound_service.py`
- Create: `backend/tests/test_live_c2c_automation_processing.py`
- Modify: `backend/app/services/whatsapp_schedule_service.py`

**Interfaces:**
- Consumes Task 1's `enqueue_live_c2c_file()` and Task 2's request-optional import service.
- Produces `process_pending_live_c2c_files(db, *, limit: int = 10) -> int`; use `FOR UPDATE SKIP LOCKED`, a persisted lease, and separate import/delivery states. A stale processing lease is recoverable.
- Parse via `parse_live_c2c_workbook`; test each worksheet and require exactly one accepted sheet. Call `prepare_live_c2c_import` with `accessible_house_ids=[house_id]` and reject `house_mismatch`. Clear file bytes only after successful import; retain the event/status/error metadata.
- After successful import, call `send_direct_report(... report_type="live_c2c", whatsapp_chat_id=config.destination_group_jid, user_id=config.updated_by, user_name=...)`.
- Add optional `activity_module: str = "live_activations"` to `send_direct_report`; use `activity_module="live_c2c"` for this caller without changing existing callers.

- [ ] **Step 1: Write failing service tests** for malformed workbook, zero/multiple matching worksheets, workbook house mismatch, successful import/report, report-send failure after import, and recovery of an expired processing lease.
- [ ] **Step 2: Run** `cd backend && python -m pytest -q tests/test_live_c2c_automation_processing.py`; expected: missing pipeline failures.
- [ ] **Step 3: Implement** claim/lease/import/delivery transitions with explicit failed states and idempotent retries. Audit processing failures. Do not retry an already imported file by importing it again.
- [ ] **Step 4: Implement** the direct-report audit-module parameter and call it with the configured output group.
- [ ] **Step 5: Run** `cd backend && python -m pytest -q tests/test_live_c2c_automation_processing.py tests/test_live_c2c_import.py`; expected: all selected tests pass.

### Task 6: Add Permissioned Configuration, OAuth Callback, Webhook, and Runner

**Files:**
- Create: `backend/app/routers/live_c2c_automation.py`
- Create: `backend/tests/test_live_c2c_automation_api.py`
- Modify: `backend/config/settings.py`
- Modify: `.env.example`
- Modify: `backend/app/services/whatsapp_service_client.py`
- Modify: `backend/config/permissions.json`
- Modify: `backend/main.py`

**Interfaces:**
- `GET /api/v1/live-c2c-automation` — requires `live_c2c.automation_view` and house context; returns safe config/status (including the latest processing and delivery state) and never returns token or webhook secrets.
- `PUT /api/v1/live-c2c-automation` — requires `live_c2c.automation_manage`; validates house email, source/group fields, active mapping uniqueness, and records an activity log.
- `POST /api/v1/live-c2c-automation/gmail/authorize` — requires manage permission, stores a one-time hashed state bound to user/house/expiry, and returns the authorization URL.
- `GET /api/v1/live-c2c-automation/gmail/callback` — validates and consumes state, rechecks initiating user's permission/house access, then redirects to the Live C2C page with a localized status code.
- `POST /api/v1/live-c2c-automation/gmail/disconnect` — revokes/clears credentials and audit logs the change.
- `POST /api/v1/live-c2c-automation/whatsapp/webhook` — no user auth; enforce 15 MiB body limit and constant-time HMAC validation using the registered gateway secret, then match device/group before enqueue.
- Register/remove the device webhook through new `whatsapp_service_client` methods for gateway `POST /webhooks` / `DELETE /webhooks/{id}`; use `media.received`, `LIVE_C2C_WHATSAPP_WEBHOOK_URL`, and retain returned webhook ID/secret encrypted.
- Add `LIVE_C2C_WHATSAPP_WEBHOOK_URL` to `backend/config/settings.py` and `.env.example`; refuse to enable WhatsApp input when it is unset.
- Add `live_c2c_automation_scheduler()` to poll enabled Gmail configs and process queue work every 30 seconds; use DB row locks so multiple app workers cannot claim the same mailbox or file.

- [ ] **Step 1: Write failing API tests** for denied permission, foreign-house access, secret redaction, invalid/duplicate mappings, one-time OAuth state, valid/invalid webhook HMAC, and wrong device/group.
- [ ] **Step 2: Run** `cd backend && python -m pytest -q tests/test_live_c2c_automation_api.py`; expected: missing router/permission failures.
- [ ] **Step 3: Implement** versioned routes, permission registration/role grants, state/HMAC checks, and safe responses.
- [ ] **Step 4: Implement** lifespan/scheduler wiring with error logging and DB-coordinated polling/processing; retain `DISABLE_SCHEDULER` behavior.
- [ ] **Step 5: Run** `cd backend && python -m pytest -q tests/test_live_c2c_automation_api.py tests/test_live_c2c_automation_processing.py`; expected: all selected tests pass.

### Task 7: Add Bilingual Live C2C Automation Settings UI

**Files:**
- Create: `frontend/src/app/reports/live-c2c/_components/LiveC2CAutomationSettings.tsx`
- Modify: `frontend/src/app/reports/live-c2c/page.tsx`
- Modify: `frontend/src/i18n/translations.ts`

**Interfaces:**
- Component props: `houseId: number | null`, `canManage: boolean`, `canView: boolean`.
- Load config/status with `X-House-ID`; show a content-aware loading state, actionable error/status, and controls only with the corresponding permission.
- Source choices are Gmail or WhatsApp. Gmail uses the displayed `/houses` email as the OAuth account hint; WhatsApp source uses existing `/whatsapp/groups`. Destination group is a separate `EntitySelector`.
- Connect/disconnect Gmail, save source/destination, enable/disable automation, and show recent import/delivery status. No secrets are rendered.

- [ ] **Step 1: Add matching `en` and `bn` translation keys** for source, mailbox, groups, connect/disconnect, enabled state, progress, and failure messages.
- [ ] **Step 2: Implement** the component using existing shadcn/`EntitySelector` patterns and render it only for an authorized selected house.
- [ ] **Step 3: Verify** language switching, permission-based visibility, source-dependent fields, field errors, OAuth redirect status, and 44px touch targets at 375/768/1280px.
- [ ] **Step 4: Run** `cd frontend && npm run lint && npx tsc --noEmit`; expected: no lint or type errors.

### Task 8: Complete Operational Documentation and Full Verification

**Files:**
- Modify: `docs/agents/report-delivery.md`

- [ ] **Step 1: Document** Google OAuth consent/scope and registered redirect URI, callback reachability, Gmail polling behavior, WhatsApp callback URL reachability, 15 MiB ingress limit, and the one-mailbox/one-source mapping constraints.
- [ ] **Step 2: Run backend suite** `cd backend && python -m pytest -q`; expected: all tests pass.
- [ ] **Step 3: Run required tenant guards** `cd backend && python -m pytest -q tests/test_entitlement.py tests/test_house_access_guard.py tests/test_tenant_isolation.py`; expected: all tests pass.
- [ ] **Step 4: Run plan wiring guards** `cd backend && python -m pytest -q tests/test_plan_modules_parity.py tests/test_module_coverage.py`; expected: all tests pass.
- [ ] **Step 5: Run frontend checks** `cd frontend && npm run lint && npx tsc --noEmit`; expected: both pass.
- [ ] **Step 6: Run gateway suite** `cd wa-gateway && go test ./...`; expected: all packages pass.
- [ ] **Step 7: Run** `git diff --check`; expected: no whitespace errors.
