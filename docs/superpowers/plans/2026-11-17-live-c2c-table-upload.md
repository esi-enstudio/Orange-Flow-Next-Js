# Live C2C Table and Excel Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preview valid uploaded Live C2C `.xlsx` rows in the specified no-wrap table.

**Architecture:** Parse the first worksheet in the browser with existing ExcelJS, validate the fixed ordered headers, and retain rows only in page state. Keep the existing route permission and add no API or persistence.

**Tech Stack:** Next.js App Router, TypeScript, ExcelJS 4.4.0, Node 24 built-in `node:test`, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-11-17-live-c2c-table-upload-design.md`

## Global Constraints

- Use the already-installed ExcelJS dependency; do not add packages or a test runner.
- The first worksheet's first row must contain the 23 specified headers in order, compared case-insensitively with trimmed/collapsed whitespace.
- Duplicate `Ach%` and `Remain` headings are disambiguated by position; extra trailing columns are ignored.
- Accept `.xlsx` files up to 10 MiB; uploaded rows are in-memory only.
- Render a white bordered `whitespace-nowrap` table inside a horizontally scrollable container.
- All user-visible upload, error, and empty-state text must be bilingual.
- Do not add a backend endpoint, persistence, or a new permission.

## Review Focus

- Invalid or corrupt workbook must show a localized error, not clear the previous valid rows: test parser invalid-header/corrupt cases and inspect handler state update order.
- Duplicate headers must remain mapped to their intended columns: assert identical `Ach%`/`Remain` fields remain distinct by their positions.
- Header-only workbook is valid but yields no table data: test that it returns an empty row list and inspect localized empty state.
- Oversized or non-`.xlsx` files must not be parsed: inspect UI validation at 10 MiB boundary.
- A wide table must not force page-level horizontal overflow: verify scroll container and `whitespace-nowrap` classes in implementation.

---

### Task 1: Add a validated Excel preview table

**Files:**
- Create: `frontend/src/lib/live-c2c-import.ts` — fixed header list and ExcelJS workbook parser.
- Create: `frontend/src/lib/live-c2c-import.test.mjs` — Node built-in parser tests with in-memory workbooks.
- Modify: `frontend/src/app/reports/live-c2c/page.tsx` — file selection, limits/errors, preview state, bordered table.
- Modify: `frontend/src/i18n/translations.ts` — bilingual labels for upload, validation, row count, and empty/error states.

**Interfaces:**
- Produces `LIVE_C2C_HEADERS: readonly string[]`.
- Produces `parseLiveC2CWorkbook(data: ArrayBuffer): Promise<string[][]>`; throws `LiveC2CWorkbookError` with a localized-key-safe error code on invalid content.
- Page consumes this parser and shows rows as parsed cell display text.

- [ ] **Step 1: Write failing parser tests**

  Add Node `node:test` cases for: a correctly ordered workbook with two duplicate labels (`Ach%`, `Remain`) parsed into distinct positions; a missing/reordered required header rejected with the invalid-header code; an unreadable workbook rejected; and a header-only workbook returning `[]`.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `cd frontend && node --experimental-transform-types --test src/lib/live-c2c-import.test.mjs`
  Expected: FAIL because the parser module/export does not exist yet.

- [ ] **Step 3: Implement the fixed header parser**

  Add the exact 23 headers from the spec. Load the first worksheet with ExcelJS, normalize only case and whitespace for comparison, reject a mismatch, ignore trailing columns, filter fully blank data rows, and convert each cell's display text to a string.

- [ ] **Step 4: Run the parser tests**

  Run: `cd frontend && node --experimental-transform-types --test src/lib/live-c2c-import.test.mjs`
  Expected: all four parser tests PASS.

- [ ] **Step 5: Add localized upload and preview UI**

  Add `.xlsx` file selection with a 10 MiB limit, parse on selection, preserve any previous rows on validation/parse failure, and render upload action/status/error/empty state in English and Bengali. Render all 23 header cells and row values in order with borders, white background, `whitespace-nowrap`, and an overflow-x-auto wrapper.

- [ ] **Step 6: Verify frontend lint and types**

  Run: `cd frontend && npm run lint`
  Expected: exit 0.

  Run: `cd frontend && npx tsc --noEmit`
  Expected: exit 0.

- [ ] **Step 7: Check responsive layout**

  Inspect 375px, 768px, and 1280px behavior if an authenticated browser session is available. The outer page must not horizontally overflow; the table wrapper must scroll horizontally.
