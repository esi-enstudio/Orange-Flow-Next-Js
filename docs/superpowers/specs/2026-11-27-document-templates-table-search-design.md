# Design: Document Templates table search placement

## Intent

Move the existing immediate search field for `/documents/templates` into the same visual panel as the table so it reads as the table's toolbar instead of a separate card above it. This is a placement-only change requested after the bulk-delete work.

## Goals

- Search input stays immediately visible and continues to filter the list with the existing 300 ms debounce.
- Search is inside the same rounded container as the desktop table and mobile card list.
- Search remains visible during loading, empty, and error states.
- Selection bar sits inside the same panel, directly under the search toolbar.

## Non-goals

- No new filter drawer, filter fields, sorting, or export.
- No backend, schema, permission, or translation changes.
- No change to search behaviour, page size, or bulk-delete actions.

## Constraints

- Project UI rules: shadcn/Tailwind primitives only; no bespoke controls.
- Reuse the existing `documents.search` translation key in both `en` and `bn`.
- Desktop `lg:` table and mobile accordion/card list must both remain responsive at 375/768/1280 px with no horizontal scroll.
- Text inputs keep the default text cursor; controls keep `cursor-pointer`.

## Approaches

1. **Unified table panel (chosen).** One bordered container holds: search toolbar, selection bar, and the loading/error/empty/list content. The input stays outside the semantic `<table>` but inside the panel header, so screen readers and the mobile card view both work.
2. **Search inside `<thead>`.** Rejected: a form control in a column header breaks table semantics, is awkward on mobile, and forces checkbox/header layout changes.
3. **Keep two cards and glue them visually.** Rejected: relies on negative margins and border matching; it stays two separate components and is fragile across breakpoints.

## Design

- Replace the standalone search `<section>` and the separate conditional cards with one outer `<section>` that has the existing `rounded-2xl border ... bg-white` styling.
- Put the existing `<label>`/`<input>` search block in a toolbar row at the top of that section, with the same `px-4 sm:px-6` padding as the current table area.
- Render the selection bar next, then the existing `loading`, `loadError`, empty, and list branches inside the section. Mobile cards and the desktop table keep their current markup and responsive classes.
- Keep `setSearch`, `setPage(1)`, and `clearSelection()` behaviour unchanged.
- Pagination stays below the panel, as today.

## Left to the builder

- Implement the single-file JSX restructure in `frontend/src/app/documents/templates/page.tsx`.
- Verify with `npm run lint`, `npx tsc --noEmit`, and browser checks at 375/768/1280 px plus an `en`/`bn` toggle.
