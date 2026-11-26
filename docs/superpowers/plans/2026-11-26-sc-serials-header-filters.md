# SC Serials Header and Filter Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `/import/sc-serials` header into the project breadcrumb/icon/title/subtitle/divider standard and move all filters into a right-side staged drawer with `DateRangePicker` and `SearchableSelect`.

**Architecture:** Page-local refactor only: no new component, no API/DB change. Applied filter state stays the single source for list fetch, `selectAllMatching` and export; drawer edits live in a draft state until Apply. Existing permission gates and today-only default are preserved.

**Tech Stack:** Next.js App Router client page, TypeScript, Tailwind CSS, framer-motion, lucide-react, shared `PageGuideModal`, `SearchableSelect`, `DateRangePicker`.

**Spec:** `docs/superpowers/specs/2026-11-26-sc-serials-header-filters-design.md`

## Global Constraints

- `docs/agents/ui-ux.md`: standard header = breadcrumb (`nav` + `aria-label`, `aria-current="page"`), 40×40 primary icon tile, `<h1>`, `PageGuideModal` immediately after heading, subtitle, bottom divider.
- `docs/agents/ui-ux.md`: no inline filter section; right drawer uses `AnimatePresence` + `motion.aside` with `initial/exit x: "100%"`, `transition={{ type: "spring", damping: 25, stiffness: 200 }}`, `fixed inset-y-0 right-0 z-[101] w-full sm:max-w-md`, blurred `z-[100]` backdrop, one-column body, staged Apply.
- `docs/agents/ui-ux.md`: dates only through shared `DateRangePicker`; select-like fields through `EntitySelector`/`SearchableSelect`, never hand-built.
- `docs/agents/i18n.md`: every user-visible string in `en` and `bn`; `docs/agents/responsive.md`: 8px mobile gutter, 44×44 touch targets, no horizontal scroll at 375/768/1280.
- Existing permissions `scratch_card_serials.view/create/export/delete` unchanged; actions remain permission-gated.
- Frontend verification only: `cd frontend && npm run lint`, `cd frontend && npx tsc --noEmit`. No frontend test runner exists; do not add one.
- N/A module checklist: no DB model/`house_id`/migration, no permissions.json change, no audit-log change, no `navItems`/`DynamicPageTitle`/leaf-route change (route already registered), no new skeleton work (existing table skeleton retained).

## Review Focus

- **Draft vs applied:** closing the drawer via X/backdrop must not change the list; only Apply commits. Task 3 verification step.
- **Search interaction:** typing in toolbar search clears competing filters as before, and drawer draft cannot resurrect them. Task 3 interface + verification step.
- **Today default:** no explicit date keeps the current today-only window. Task 3 fetch steps.
- **Mobile:** drawer full-width and scrollable at 375px; header actions stack without horizontal overflow. Task 2 + Task 3 responsive checklist.
- **Localization:** new drawer labels resolve in both `en` and `bn` (no raw key shown). Task 1 verification step.

---

### Task 1: Bilingual copy for header and filter drawer

**Files:**
- Modify: `frontend/src/i18n/translations.ts` (`en.scratch_card_serials` near line 4592; `bn.scratch_card_serials` near line 12076)

**Interfaces:**
- Consumes: existing namespace structure and `t()` dot-key lookup.
- Produces: keys `scratch_card_serials.breadcrumb_label`, `.breadcrumb_home`, `.breadcrumb_import`, `.filter_open`, `.filter_title`, `.filter_apply`, `.filter_date_range`, `.filter_amount`, `.filter_amount_search`, `.filter_status`, `.filter_status_search`.

- [ ] **Step 1: Add the same ten keys to both language objects**

Do not translate by machine; use natural copy, e.g. `filter_open: "Refine filters"` / `"ফিল্টার খুঁজুন"`, `filter_apply: "Apply filters"` / `"ফিল্টার প্রয়োগ করুন"`, `breadcrumb_import` matching `nav.data_import` ("Data Import" / "ডাটা ইম্পোর্ট").

- [ ] **Step 2: Verify both locales and no duplicates**

Run: `grep -nE 'breadcrumb_import|filter_amount_search' frontend/src/i18n/translations.ts`
Expected: exactly two hits per key (one in each language object).

---

### Task 2: Standard page header

**Files:**
- Modify: `frontend/src/app/import/sc-serials/page.tsx:1-10` (imports), `:597-643` (header JSX)

**Interfaces:**
- Consumes: Task 1 keys; `PageGuideModal pageKey="scratch_card_serials"`; `useAuth().hasPermission`.
- Produces: standard `<header>` with breadcrumb, title row, subtitle, divider; action buttons unchanged in behaviour.

- [ ] **Step 1: Add imports**

Add `Link` from `next/link`; `Home`, `ChevronRight` to the existing lucide import; change root wrapper to `min-w-0 p-2 sm:p-6 pb-8 space-y-5`.

- [ ] **Step 2: Replace the header block**

Implement `<header className="mb-4 border-b border-gray-200 pb-4 dark:border-slate-700">`: `<nav aria-label={t("scratch_card_serials.breadcrumb_label")}>` with Home `Link href="/"` (Home icon, `t("...breadcrumb_home")`), `ChevronRight` separators, plain-text `t("...breadcrumb_import")`, `aria-current="page"` `t("scratch_card_serials.title")`; then a `flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between` row with the 40×40 `bg-primary-50` icon tile (`Database`), `text-2xl` `<h1>`, `PageGuideModal`, subtitle `t("scratch_card_serials.description")`, and the three permission-gated action buttons (full-width below `sm`, `min-h-[44px]`, `cursor-pointer`).

- [ ] **Step 3: Verify header compiles and renders no raw keys**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output. Grep the page for `t("scratch_card_serials.breadcrumb` — all four keys exist in Task 1.

---

### Task 3: Staged filter drawer and applied-filter wiring

**Files:**
- Modify: `frontend/src/app/import/sc-serials/page.tsx:2-10` (imports), `:57-82`, `:171-198`, `:228-267`, `:403-425`, `:695-766` (filter state, fetch, hooks, select-all, toolbar/drawer JSX)

**Interfaces:**
- Consumes: Task 1 keys; `SearchableSelect` (`@/components/filters/SearchableSelect`) with props `label/items/value/onChange/placeholder/searchPlaceholder/emptyMessage/noResultsMessage`; `DateRangePicker` (`@/components/date-picker`) with `value: {from,to}` and `onChange`; `motion`/`AnimatePresence`.
- Produces: `interface SerialFilters { serialFrom, serialTo, mrp, status, dateFrom, dateTo: string }`; `defaultFilters(): SerialFilters`; state `filters`, `draftFilters`, `filtersOpen`; all consumers read `filters` only.

- [ ] **Step 1: Replace filter state**

Delete the serial debounce state/effects. Add `defaultFilters()` returning empty strings except `dateFrom`/`dateTo` set to today in `YYYY-MM-DD` (reuse the existing `todayDateRange()` logic). Add `filters`, `draftFilters` (both `useState<SerialFilters>(defaultFilters)`), `filtersOpen`. Keep `search`/`debouncedSearch` and its 500ms debounce.

- [ ] **Step 2: Rewire `fetchData`, effects and `selectAllMatching`**

`fetchData`: build params from `filters`; send `search` when present, otherwise `serial_from`/`serial_to`/`mrp`/`status`; send `date_from`/`date_to` only when neither search nor serial range is present (preserves today default and backend semantics). Dependencies: `[page, debouncedSearch, filters, selectedHouse?.id, t]`. Keep the `fetchDataRequest` race guard and the single effect gated on `search.trim() === debouncedSearch`. Remove the old reset-page effect; call `setPage(1)` on Apply and on search change. Rewrite `selectAllMatching` to use `filters` and the same date rule. `handleExport` keeps using `filters.mrp`.

- [ ] **Step 3: Build toolbar + drawer**

Replace the inline five-column filter grid with: (a) toolbar row containing the immediate search input (`cursor-text`) then an icon-only `SlidersHorizontal` button with `title`/`aria-label` `t("scratch_card_serials.filter_open")` and an active-count badge; (b) `AnimatePresence` drawer per Global Constraints. Drawer body one column: labelled serial-from/serial-to inputs, `SearchableSelect` for amount using `mrpOptions` (id = `String(mrp)`, label = `"{mrp} Tk"`) and status (available/used/allocated), and `DateRangePicker value={{ from: draftFilters.dateFrom || null, to: draftFilters.dateTo || null }}`. Footer Apply button commits `setFilters(draftFilters)`, `setPage(1)`, closes. Backdrop/X close without commit. Opening copies `filters` into `draftFilters`. Typing search clears `filters`/`draftFilters` to `defaultFilters()` and vice versa when Apply commits a serial range.

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run lint` → 0 errors (pre-existing warnings allowed). Run: `cd frontend && npx tsc --noEmit` → no output. Manual check at 375/768/1280: drawer full-width mobile, no inline filters, no horizontal scroll, Apply required before list changes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/i18n/translations.ts frontend/src/app/import/sc-serials/page.tsx docs/superpowers/specs/2026-11-26-sc-serials-header-filters-design.md docs/superpowers/plans/2026-11-26-sc-serials-header-filters.md
git commit -m "feat: standardize SC serials header and filter drawer"
```
