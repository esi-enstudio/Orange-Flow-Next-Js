# Live C2C House Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a house selector to the Live C2C page so workbook previews are associated with one accessible house.

**Architecture:** Fetch assigned houses from the existing `/houses/accessible` endpoint. Auto-select one house, require an explicit choice when several are available, and clear the temporary workbook preview when selection changes.

**Tech Stack:** Next.js App Router, TypeScript, existing API client, Tailwind CSS, Node 24 built-in `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-17-live-c2c-house-selection-design.md`

## Global Constraints

- House options come only from `/houses/accessible`; never use an unrestricted house list.
- Keep the existing report-view permission; do not add backend APIs, models, or permissions.
- A selected house is page-local; workbook rows remain temporary and are cleared on house change.
- All user-visible selector, loading, no-house, and fetch-error text must be bilingual.
- Keep the Excel preview at 23 columns and preserve its existing validations.

## Review Focus

- A user with one accessible house gets that house selected automatically: test the initial selection helper.
- A user with multiple accessible houses has no implicit house selected: test the helper and verify upload remains disabled.
- House changes clear file name, rows, and upload error: inspect the change handler.
- Fetch failure and no houses are explicit and cannot enable upload: inspect both states.
- A user never sees unassigned houses: verify source is strictly `/houses/accessible`.

---

### Task 1: Add accessible-house selection

**Files:**
- Create: `frontend/src/lib/live-c2c-house-selection.ts` — single-house initialization helper.
- Create: `frontend/src/lib/live-c2c-house-selection.test.mjs` — Node built-in tests for zero, one, and multiple houses.
- Modify: `frontend/src/app/reports/live-c2c/page.tsx` — fetch accessible houses, show a bilingual selector/selected-house label, require house before upload, clear preview when it changes, and handle loading/error/no-house states.
- Modify: `frontend/src/i18n/translations.ts` — bilingual house labels and states; update page guide.

**Interfaces:**
- Produces `initialLiveC2CHouseId(houses: readonly { id: number }[]): number | null`; returns the sole house ID only when exactly one house is available.
- Page consumes the helper and `apiClient.get<AccessibleHouse[]>("/houses/accessible")`.

- [ ] **Step 1: Write failing helper tests**

  Test `initialLiveC2CHouseId` returns `null` for zero houses, the ID for exactly one, and `null` for multiple houses.

- [ ] **Step 2: Run the helper tests and confirm failure**

  Run: `cd frontend && node --experimental-transform-types --test src/lib/live-c2c-house-selection.test.mjs`
  Expected: FAIL because the helper module/export is not present.

- [ ] **Step 3: Implement the house initialization helper**

  Add `initialLiveC2CHouseId(houses)` to return the only house ID if and only if `houses.length === 1`; otherwise return `null`.

- [ ] **Step 4: Add accessible house loading and selector UI**

  Fetch `/houses/accessible` after authorized page load. Auto-select a sole result, render its name, and render a labeled native `<select>` for multiple houses with a blank initial option. On selection change, clear current rows, filename, and upload error. Disable upload until a house is selected; keep it disabled while houses load or the request fails.

- [ ] **Step 5: Add localized states and guide copy**

  Add matching English/Bengali strings for house label, selection placeholder, loading, no accessible houses, and fetch error. Update the Page Guide to mention choosing a house and previewing an `.xlsx` file.

- [ ] **Step 6: Verify tests, lint, and types**

  Run: `cd frontend && node --experimental-transform-types --test src/lib/live-c2c-house-selection.test.mjs`
  Expected: 3 tests PASS.

  Run: `cd frontend && npm run lint`
  Expected: exit 0.

  Run: `cd frontend && npx tsc --noEmit`
  Expected: exit 0.

- [ ] **Step 7: Check responsive behavior**

  At 375px, 768px, and 1280px where authenticated browser access is available, check that the selector fits and the table remains horizontally scrollable without page-level overflow.
