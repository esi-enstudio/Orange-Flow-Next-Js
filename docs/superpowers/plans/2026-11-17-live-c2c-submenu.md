# Live C2C Submenu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a blank, bilingual `/reports/live-c2c` page linked under Reports.

**Architecture:** Reuse the Reports module, existing `reports.view` / `itopup.view` permissions, and the current iTopUp API ownership for plan-leaf wiring. No endpoint or report behavior is added.

**Tech Stack:** Next.js App Router, TypeScript, Tailwind CSS, FastAPI module catalog, existing i18n and RBAC.

**Spec:** `docs/superpowers/specs/2026-11-17-live-c2c-submenu-design.md`

## Global Constraints

- Keep all user-visible text bilingual in `frontend/src/i18n/translations.ts`.
- Gate the navigation item and page with `reports.view` or `itopup.view`.
- Register `/reports/live-c2c` as a Reports leaf and map it to an API prefix owned by `reports`.
- Do not add a backend endpoint, new permission, report controls, or data fetching.
- Verify frontend lint, TypeScript, module parity, and responsive/locale behavior.

## Review Focus

- User with only `reports.view` sees and can open the submenu; user without either permission cannot: verify the existing OR permission pattern in nav and page guard.
- User with only `itopup.view` sees and can open the submenu: verify against the page guard.
- Strict plan granting only `/reports/live-c2c` retains a valid API ownership mapping: run plan-module parity tests.
- English and Bengali titles and guide use identical key paths: compare both locale blocks and switch language on the route.
- Mobile page has no horizontal overflow and guide trigger remains touch-accessible: check 375px and 768px; desktop at 1280px.

---

### Task 1: Add the Live C2C page and Reports navigation

**Files:**
- Modify: `frontend/src/lib/constants.ts` — add a Reports child for `/reports/live-c2c` with bilingual translation key and `reports.view` / `itopup.view` permissions.
- Modify: `frontend/src/i18n/translations.ts` — add matching navigation and page-guide keys in `en` and `bn`.
- Create: `frontend/src/app/reports/live-c2c/page.tsx` — render the translated page heading and `PageGuideModal`; block users lacking both view permissions; no report content.
- Modify: `backend/config/modules.py` — add `/reports/live-c2c` to `MODULE_LEAF_ROUTES["reports"]` and map it to `("/api/itopup-details",)` in `LEAF_TO_API_PREFIXES`.
- Modify: `backend/tests/test_plan_modules_parity.py` — pin the new leaf's owner and API mapping.

**Interfaces:**
- Consumes: `navItems`, `useAuth`, `useLanguage`, `AccessDenied`, `PageGuideModal`.
- Produces: a protected `/reports/live-c2c` route and a plan-grantable Reports leaf.

- [x] **Step 1: Write the failing plan-wiring test**

  Add `test_live_c2c_leaf_uses_reports_api_scope` asserting `LEAF_OWNER["/reports/live-c2c"] == "reports"` and `LEAF_TO_API_PREFIXES["/reports/live-c2c"] == ("/api/itopup-details",)`.

- [x] **Step 2: Run the test to verify it fails**

  Run: `cd backend && python -m pytest -q tests/test_plan_modules_parity.py::test_live_c2c_leaf_uses_reports_api_scope`
  Expected: FAIL because the new leaf is not registered yet.

- [x] **Step 3: Add the navigation child and paired translations**

  Add `nav.report_live_c2c` with identical key paths in `en` and `bn`. Add a `live_c2c` page namespace with a localized title and the minimum Page Guide keys (`guide.title`, `guide.overview`, `guide.features_title`, and one feature).

- [x] **Step 4: Create the blank protected page**

  Create `frontend/src/app/reports/live-c2c/page.tsx`. Require `reports.view || itopup.view`, return `AccessDenied` otherwise, and render only the translated heading and page guide. Do not fetch report data or add controls.

- [x] **Step 5: Register the Reports leaf and endpoint ownership**

  Add `/reports/live-c2c` to `MODULE_LEAF_ROUTES["reports"]` and map it to `("/api/itopup-details",)` in `LEAF_TO_API_PREFIXES`.

- [x] **Step 6: Verify navigation and plan wiring**

  Run: `cd backend && python -m pytest -q tests/test_plan_modules_parity.py tests/test_module_coverage.py`
  Expected: PASS; the new nav href is cataloged and its API prefix resolves to `reports`.

- [x] **Step 7: Verify frontend types and lint**

  Run: `cd frontend && npm run lint`
  Expected: PASS.

  Run: `cd frontend && npx tsc --noEmit`
  Expected: PASS.

- [x] **Step 8: Check locale and responsive behavior**

  Verified matching English/Bengali navigation and page-guide keys. Source-reviewed the compact title/guide layout (`p-4 sm:p-6`); the browser route compiled with the expected title but redirected to sign-in, so authenticated viewport screenshots at 375px, 768px, and 1280px were unavailable.
