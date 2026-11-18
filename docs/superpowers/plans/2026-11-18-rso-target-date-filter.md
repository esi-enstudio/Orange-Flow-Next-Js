# RSO Target Date and Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display RSO target dates as `DD MMM YYYY` and move existing filters into a staged, right-side drawer.

**Architecture:** Keep the existing monthly API contract and filters. Use the shared YMD formatter for display, and keep applied filters separate from drawer draft state until Apply is clicked.

**Tech Stack:** Next.js App Router, React, TypeScript, framer-motion, lucide-react, existing i18n and date utilities.

**Spec:** `docs/superpowers/specs/2026-11-18-rso-target-date-filter-design.md`

## Global Constraints

- Keep monthly target filtering as an exact `target_date` API query; do not add a date-range API.
- Use the existing date formatter and render `DD MMM YYYY` in English.
- Put all filter controls in the right-side sliding drawer; Apply is staged and closing discards edits.
- Add every new user-visible label to both English and Bengali translations.
- Do not add a frontend test runner; verify with lint, TypeScript, and responsive/browser checks at 375px, 768px, and 1280px.

## Review Focus

- **Invalid or missing date value:** date display falls back to `-`; verify with a malformed or absent value if feasible.
- **Month selection:** Apply sends the selected month as `YYYY-MM-01` and fetches only after Apply.
- **Unapplied edits:** closing by X or backdrop leaves the applied filters and table unchanged.
- **Clear and filter count:** Clear resets draft values; applied-filter badge reflects only active applied filters.
- **Responsive drawer:** 375px uses full viewport width; 768px and 1280px remain usable and scrollable.

---

### Task 1: Update the RSO target date and filter drawer

**Files:**
- Modify: `frontend/src/app/targets/rso/page.tsx`
- Modify: `frontend/src/i18n/translations.ts`

**Interfaces:**
- Consumes: `formatYMD(ymd, "en", fallback)` from `frontend/src/components/date-picker/format.ts`; existing `filters` query state and `/rso-targets` API.
- Produces: `draftFilters` state isolated from applied `filters`; bilingual drawer labels under `rso_targets`.

- [x] **Step 1: Add English and Bengali drawer labels**

Add keys under both `rso_targets` translation objects for the trigger, panel title, House/All Houses, Market Type/All, Target Month, Clear, and Apply.

- [x] **Step 2: Replace locale-dependent date rendering**

Import `formatYMD` from `@/components/date-picker/format` and render the date cell with `formatYMD(r.target_date, "en")`, removing the unused `language` binding if no longer needed.

- [x] **Step 3: Move filters into a staged right-side drawer**

Import `AnimatePresence` and `motion` from `framer-motion`. Keep applied `filters` as the fetch dependency; initialize draft filters from applied filters when opening. Place House, Market Type, and Target Month in a single-column drawer with the standard backdrop, close button, and footer. Apply copies drafts into applied state, resets pagination, then closes. X/backdrop only close; Clear resets draft values. Put the icon-only translated filter trigger directly after search and show a count for active applied filters.

- [x] **Step 4: Run frontend lint and type checking**

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: no lint errors and TypeScript exits successfully.

- [x] **Step 5: Verify the user-visible behavior in the browser**

At 375px, 768px, and 1280px, verify the drawer dimensions and scrolling, English/Bengali labels, `DD MMM YYYY` date display, staged Apply behavior, backdrop/X discard behavior, Clear behavior, and the month query value `YYYY-MM-01`.

