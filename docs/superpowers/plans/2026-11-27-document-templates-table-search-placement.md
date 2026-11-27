# Document Templates Table Search Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Place the existing immediate search field inside the same panel as the document templates table and mobile card list.

**Architecture:** Restructure one existing page component. A single bordered section becomes the table panel: search toolbar, selection bar, and all content states live inside it. The desktop `<table>` and mobile card markup stay unchanged; pagination stays outside the panel as today.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, shadcn `Checkbox`, lucide-react `Search`, existing i18n `useLanguage()`.

**Spec:** `docs/superpowers/specs/2026-11-27-document-templates-table-search-design.md`

## Global Constraints

- No backend, database, schema, migration, permission, or navigation changes.
- Reuse the existing `documents.search` translation key; do not add or rename keys.
- Use existing shadcn/Tailwind primitives; no bespoke select, date, or input component.
- Search keeps the existing 300 ms debounce, `setPage(1)`, and `clearSelection()` behaviour.
- Desktop table and mobile card list must stay responsive at 375 / 768 / 1280 px with no horizontal scroll.
- Text input keeps the default text cursor; all clickable controls keep `cursor-pointer`.
- Frontend verification is lint + typecheck + browser checklist; the project has no frontend test runner.

## Review Focus

- Search visible while loading, on empty result, and on load error — task 1 browser step checks all three states.
- Search stays attached to the mobile card list, not just the desktop table — task 1 browser step checks 375/768 px.
- Selection bar sits inside the same panel as the table — task 1 browser step checks it after selecting a row.
- Bilingual placeholder remains correct — task 1 browser step toggles `en` → `bn`.
- No horizontal overflow at narrow widths — task 1 browser step compares `scrollWidth` to `clientWidth` at 375 px.

Module checklist from AGENTS.md: no new DB model / `house_id` / index, no new permission key or nav item, no new audit log entry, no new i18n key, no new leaf route. Existing content-aware 10-row skeleton is retained inside the panel.

---

### Task 1: Unified templates table panel

**Files:**
- Modify: `frontend/src/app/documents/templates/page.tsx:327-543`

**Interfaces:**
- Consumes: existing `search`, `setSearch`, `setPage`, `clearSelection`, `selectedIds`, `canManage`, `t("documents.search")`, `TemplateSkeleton`, `TemplateDeleteButton`.
- Produces: no new exports; same page behaviour with a single table panel.

- [ ] **Step 1: Replace the standalone search card with one panel wrapper**

In `frontend/src/app/documents/templates/page.tsx`, replace the standalone search `<section>` and the following conditional state branches with one outer `<section>` using the existing `rounded-2xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900` panel styling. Put the existing search `<label>`/`<input>` inside a toolbar row at the top of this section with `px-4 sm:px-6` horizontal padding. Keep the input markup, classes, and `onChange` handler exactly as they are.

- [ ] **Step 2: Move existing content states inside the same panel**

Move the selection bar, skeleton, load error, empty state, desktop table, mobile card list, and pagination into the panel from step 1. Keep every inner branch and its markup unchanged; only the surrounding wrapper changes. Leave `CreateTemplateModal` and `ConfirmationModal` after the panel as they are.

- [ ] **Step 3: Run static verification**

Run: `cd frontend && npm run lint`
Expected: `0 errors` (existing warning baseline is allowed).
Run: `cd frontend && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Verify in browser**

Open `/documents/templates` with the dev server. At 1280 px, confirm the search input and table share one bordered panel. At 375 px and 768 px, confirm the mobile cards are inside that panel and `document.documentElement.scrollWidth === document.documentElement.clientWidth`. Type a query and confirm the debounced list updates and selection clears. Select a row and confirm the selection bar is inside the panel. Toggle `en` → `bn` and confirm the placeholder is translated and no new untranslated text appears. Check that search remains visible during loading, empty result, and load-error states.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/documents/templates/page.tsx
git commit -m "feat: place templates search inside table panel"
```
