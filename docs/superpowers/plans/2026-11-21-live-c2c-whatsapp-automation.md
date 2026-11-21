# MYMVAI02 Live C2C WhatsApp Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure a selected house to automatically import incoming Live C2C files from one WhatsApp group and send the generated report to a different group.

**Architecture:** Reuse the existing signed WhatsApp webhook, durable inbound queue, importer, report delivery, and house-scoped automation endpoints. Add an authorized inline configuration/status card to `/reports/live-c2c`; do not hardcode MYMVAI02 group IDs.

**Tech Stack:** Next.js App Router, React, TypeScript, FastAPI, SQLAlchemy, pytest, existing WhatsApp gateway.

**Spec:** `docs/superpowers/specs/2026-11-21-live-c2c-whatsapp-automation-design.md`

## Global Constraints

- Every data query and mutation remains scoped to the selected house via `X-House-ID`.
- Existing API permissions `live_c2c.automation_view` and `live_c2c.automation_manage` remain enforced; frontend hiding is not authorization.
- Incoming and destination WhatsApp groups must be different.
- Do not infer the house from workbook contents or hardcode group identifiers.
- Preserve signed webhook verification, event idempotency, file size/type validation, queue retries, and audit logging.
- Snapshot each file's WhatsApp destination at receipt; stop queued processing if automation is disabled or its incoming source changes.
- Retire an obsolete WhatsApp webhook only after the configuration transaction commits; retain its ID if external cleanup needs retry.
- User-visible text requires matching `en` and `bn` translation keys.
- No frontend test runner exists; verify frontend changes with lint and TypeScript check.
- Add only the queue destination snapshot column and its migration; do not add dependencies or routes/navigation.
- Resolve the existing duplicate Alembic revision ID so the new migration remains part of a single deployable head.

## Review Focus

- Same source and destination group: reject at the API boundary and prevent saving in the UI.
- No connected WhatsApp device or unavailable group list: show an actionable error and do not enable automation.
- Existing Gmail source: explain that configuring WhatsApp replaces it; never silently keep Gmail enabled.
- Queued file with a changed destination: use the destination captured at receipt; disabled or changed-source automation must not import or deliver queued files.
- Webhook cleanup failure after settings save: retain cleanup metadata and return an explicit bilingual partial-save error.
- Files with invalid name, workbook, house match, or multiple matching sheets: preserve existing rejected/failed status rather than deliver a report.
- Webhook accepted but import or delivery fails: expose the latest file status and error without showing success.

---

### Task 1: Enforce distinct WhatsApp groups

**Files:**
- Modify: `backend/app/routers/live_c2c_automation.py`
- Test: `backend/tests/test_live_c2c_automation_api.py`
- Modify: `frontend/src/i18n/translations.ts`

**Interfaces:**
- Consumes: `AutomationConfigUpdate.source_group_jid` and `destination_group_jid`.
- Produces: API error code `live_c2c_source_destination_same_group` when enabled WhatsApp automation uses the same group for both routes.

- [x] **Step 1: Write a failing API test** asserting that saving enabled WhatsApp automation with identical source/destination JIDs returns 422 with `live_c2c_source_destination_same_group` and does not commit that mapping.
- [x] **Step 2: Run the test** with `cd backend && .venv/bin/python -m pytest -q tests/test_live_c2c_automation_api.py::<new_test>`; confirm the current endpoint accepts the invalid same-group mapping.
- [x] **Step 3: Add the minimal backend validation** before webhook creation/config mutation; add the matching English and Bangla error messages.
- [x] **Step 4: Run the focused API tests** covering same-group rejection and existing successful WhatsApp configuration; confirm they pass.

### Task 2: Configure and monitor house automation

**Files:**
- Create: `frontend/src/app/reports/live-c2c/_components/LiveC2CAutomationCard.tsx`
- Modify: `frontend/src/app/reports/live-c2c/page.tsx`
- Modify: `frontend/src/i18n/translations.ts`

**Interfaces:**
- Consumes: selected `houseId`, `live_c2c.automation_view`, `live_c2c.automation_manage`, `GET/PUT /v1/live-c2c-automation`, and `GET /whatsapp/groups`.
- Produces: view-only routing/status for viewers; source/destination selectors, enable toggle, and save action for managers; latest-file import/delivery status while enabled.

- [x] **Step 1: Implement the card UI** with house-scoped requests, permission-specific read/manage behavior, WhatsApp group selectors, enabled state, save feedback, and latest-file status polling.
- [x] **Step 2: Enforce the different-group rule in the form**; disable save and show the bilingual validation message when both selections are the same.
- [x] **Step 3: Mount the card on `/reports/live-c2c`** only when a house is selected and the user has view or manage permission.
- [x] **Step 4: Add bilingual copy** for source/destination routing, Gmail-to-WhatsApp replacement, saving/errors, empty/error states, and import/delivery states.
- [x] **Step 5: Run `cd frontend && npm run lint` and `cd frontend && npx tsc --noEmit`**; confirm zero lint errors and no type errors.

### Task 3: Verify automated import-to-delivery path

**Files:**
- Modify: `backend/app/routers/live_c2c_automation.py`
- Modify: `backend/app/models/live_c2c_automation.py`
- Rename: `backend/alembic/versions/d4e5f6a7b8c9_add_live_c2c_oauth_return_path.py` to `backend/alembic/versions/e2f3a4b5c6d7_add_live_c2c_oauth_return_path.py`
- Create: `backend/alembic/versions/e1f2a3b4c5d6_snapshot_live_c2c_delivery_destination.py`
- Modify: `backend/app/services/live_c2c_automation_service.py`
- Modify: `backend/app/services/live_c2c_inbound_service.py`
- Test: `backend/tests/test_live_c2c_automation_api.py`
- Test: `backend/tests/test_live_c2c_automation_processing.py`
- Test: `backend/tests/test_live_c2c_automation_rules.py`
- Modify: `frontend/src/app/reports/live-c2c/_components/LiveC2CAutomationCard.tsx`
- Modify: `frontend/src/i18n/translations.ts`
- Modify: `docs/agents/report-delivery.md`

**Interfaces:**
- Consumes: existing signed WhatsApp webhook and background automation scheduler.
- Produces: verified regression coverage and documented distinct source/destination group requirement.

- [x] **Step 1: Add failing regressions** proving failed config saves retain their old webhook, queued files retain their receipt-time destination, and disabled automation does not import or deliver pending files.
- [x] **Step 2: Add the minimal transactional webhook cleanup and persisted destination snapshot behavior**, including a migration/backfill for queued files and terminal handling for disabled/changed sources.
- [x] **Step 3: Run targeted backend tests** for the new regressions plus webhook source/device matching, duplicate events, inbound import, and delivery.
- [x] **Step 4: Update report-delivery documentation** to state distinct source/destination groups and queue-routing behavior.
- [x] **Step 5: Run frontend lint/typecheck and the full backend suite.**
- [x] **Step 6: Run `git diff --check` and review the final diff for unrelated edits.**
