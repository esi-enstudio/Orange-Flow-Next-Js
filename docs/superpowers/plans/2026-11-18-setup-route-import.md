# Setup Wizard Route Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional DMS route-list upload step after Employees and before Retailers in the initial setup wizard.

**Architecture:** Reuse `import_route_list` for route validation, house scoping, and RSO assignment. Add a setup endpoint that streams its result in the wizard's existing upload format and uses the initialized Super Admin as the import actor. Add the step/state to the frontend and bilingual copy.

**Tech Stack:** FastAPI, SQLAlchemy async, pytest, Next.js App Router, TypeScript, existing SSE upload helper, typed translations.

**Spec:** `docs/superpowers/specs/2026-11-18-setup-route-import-design.md`

## Global Constraints

- Preserve the current setup step order except inserting Routes after Employees and before Retailers.
- Keep Routes optional, like the existing import steps.
- Reuse the DMS route-list importer; do not duplicate route validation, house checks, or RSO matching.
- Write a `routes` / `import` activity log for a successful setup upload.
- Add any new user-visible copy in both English and Bengali.
- Do not change unrelated setup/auth behavior or route import semantics.
- Run `cd backend && python -m pytest -q`, `cd frontend && npm run lint`, and `cd frontend && npx tsc --noEmit`.

## Review Focus

- No initialized Super Admin: return a clear failure rather than a success-shaped empty import; cover in the setup endpoint test.
- Invalid workbook or missing required route columns: surface the importer error through the existing SSE error event; cover in the setup endpoint test.
- Route codes do not match a house: preserve existing importer rejection and ensure no foreign-house route is created; cover in the setup endpoint test.
- RSO identity is unmatched: route import must still complete with an unmatched count, matching existing DMS importer semantics; cover in the setup endpoint test.
- Route upload is skipped: Retailers remains reachable and the final setup summary remains correct; verify through frontend lint/typecheck and step/state review.

---

### Task 1: Setup API Route-List Upload

**Files:**
- Modify: `backend/app/routers/admin_setup_controller.py`
- Test: `backend/tests/test_setup_route_import.py`

**Interfaces:**
- Consumes: `import_route_list(db, data, current_user)` from `app.services.route_list_excel`; the existing `_setup_import_stream` SSE helper.
- Produces: `POST /api/admin/setup/import/routes`, accepting an Excel upload and streaming a completion count or importer error.

- [ ] **Step 1: Write a failing endpoint test**
  - Add `test_setup_route_import_registers_route_and_assigns_active_rso`.
  - Post a small DMS route-list workbook to `/api/admin/setup/import/routes` with a seeded Super Admin, one house, and one Active RSO.
  - Assert the SSE completion count and persisted `Route` plus active `EmployeeRoute`.
  - Add `test_setup_route_import_reports_invalid_workbook` and assert an SSE error event without a created route.
  - Add `test_setup_route_import_requires_initialized_super_admin` and assert an explicit 400 without route changes when no active Super Admin exists.

- [ ] **Step 2: Run the tests and verify RED**
  - Run: `cd backend && python -m pytest -q tests/test_setup_route_import.py`
  - Expected: FAIL because the setup route endpoint does not exist.

- [ ] **Step 3: Implement the endpoint**
  - Add `POST /import/routes` under the existing `/api/admin/setup` router.
  - Resolve the existing Super Admin and pass that trusted actor to `import_route_list`; do not accept user/house identity from upload fields.
  - Add a `routes` / `import` activity log with the importer report; commit only when the importer succeeds.
  - Emit an explicit error if no Super Admin is available or the importer rejects the workbook.
  - Report processed routes through the existing SSE `complete` event.

- [ ] **Step 4: Run the endpoint tests and verify GREEN**
  - Run: `cd backend && python -m pytest -q tests/test_setup_route_import.py`
  - Expected: both tests pass.

### Task 2: Wizard Routes Step and Bilingual Copy

**Files:**
- Modify: `frontend/src/app/setup/page.tsx`
- Modify: `frontend/src/i18n/translations.ts`

**Interfaces:**
- Consumes: `POST admin/setup/import/routes` from Task 1 using the existing `uploadFile` SSE helper.
- Produces: the wizard sequence `Houses → BTS → Users → Employees → Routes → Retailers`, with Routes optional and included in completion status.

- [ ] **Step 1: Add a Routes import state**
  - Add `routes` state and an input ref, matching the existing import-state pattern.
  - Insert the Routes step and upload configuration immediately before Retailers; keep `STEP_IMPORTS` aligned with step indexes.

- [ ] **Step 2: Add localized labels**
  - Add matching English/Bengali keys for the Routes step and completion summary.
  - Use the translated strings for the new step's title/description and summary label.

- [ ] **Step 3: Wire the Routes step**
  - Post to `admin/setup/import/routes` through `uploadFile`.
  - Update import-step bounds and completion-step index to account for the additional step.
  - Preserve skip/next behavior and include Routes in the final import summary.

- [ ] **Step 4: Verify frontend**
  - Run: `cd frontend && npm run lint`
  - Run: `cd frontend && npx tsc --noEmit`
  - Expected: both complete without errors.

### Final Verification

- [ ] Run: `cd backend && python -m pytest -q`
- [ ] Run: `git diff --check`
- [ ] Confirm the user-provided flow is ordered correctly and that route import remains optional.
