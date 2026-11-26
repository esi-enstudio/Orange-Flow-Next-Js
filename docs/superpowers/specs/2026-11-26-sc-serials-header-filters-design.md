---
date: 2026-11-26
topic: sc-serials-header-and-filters
status: approved
---

# SC Serials — Standard Header and Filter Drawer

## Intent

`/import/sc-serials`-এর header কে project-standard breadcrumb + icon/title/guide + subtitle + divider pattern-এ আনা, এবং inline 5-filter grid কে right-side staged filter drawer-এ রূপান্তর করা (`docs/agents/ui-ux.md`, reference: `frontend/src/app/reports/ga-query/page.tsx`, `frontend/src/app/reports/live-c2c/page.tsx`)।

## Goals / Non-goals / Anti-goals

- **Goals:** standard header, toolbar search + filter trigger, drawer with staged Apply, DateRangePicker, localized en/bn copy, no horizontal overflow, permission-safe actions.
- **Non-goals:** API/DB/model/permission changes; table/pagination/modal rewrites; new reusable component.
- **Anti-goals:** inline filter section, hand-built select, hardcoded user-visible English, draft filters applying without Apply.

## Constraints

- Existing backend semantics: exact serial search; mrp/status/date ignored when search present; serial range ignores search; house filter skipped for search/serial-range. Current page already clears competing filters — preserve that.
- Default list window is "today"; preserve by defaulting the date range to today in the drawer and at fetch time.
- Existing permissions (`scratch_card_serials.view/create/export/delete`) unchanged.
- Frontend verification: `npm run lint` + `npx tsc --noEmit`; no frontend test runner.

## Approaches

1. **Scoped page refactor (chosen)** — edit only `frontend/src/app/import/sc-serials/page.tsx` plus en/bn keys. Keeps the reusable modal untouched and avoids affecting other import pages.
2. Global shared filter component — rejected: over-engineering for one page and would risk unrelated routes.
3. Keep inline filters, restyle only — rejected: violates mandatory right-drawer standard.

## Design

- Header: `<nav aria-label>` with Home link + ChevronRight + non-routable "Data Import" text + `aria-current` page; 40×40 primary-tinted icon tile; `<h1 className="text-2xl ...">` followed by `PageGuideModal`; subtitle; bottom divider. Action buttons stay permission-gated, stack full-width below `sm`.
- Toolbar immediately under header: immediate debounced search input, then icon-only `SlidersHorizontal` trigger with active-filter count badge.
- Drawer: `AnimatePresence` + `motion.aside` slide from right, blurred backdrop, one column, staged `draft` state, Apply commits + closes, X/backdrop discards. Fields: serial from/to text inputs, `SearchableSelect` for MRP and Status, `DateRangePicker` defaulting to today.
- Applied filters are the single source for `fetchData`, `selectAllMatching` and export. Typing search clears competing filters (and vice versa) as before.
- New translation keys in both `en.scratch_card_serials` and `bn.scratch_card_serials`: `breadcrumb_label`, `breadcrumb_home`, `breadcrumb_import`, `filter_open`, `filter_title`, `filter_apply`, `filter_date_range`, `filter_amount`, `filter_all_amounts`, `filter_search_hint`, `filter_search_placeholder` where needed. Reuse `common.close`.

## Left to builder

- Follow the approved approach and the AGENTS.md verification commands; report actual command output.
