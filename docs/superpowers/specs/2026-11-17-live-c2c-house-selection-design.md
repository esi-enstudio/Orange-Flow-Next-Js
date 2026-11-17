# Live C2C House Selection Design

## Intent

Allow the Live C2C page to be explicitly associated with one of the user's accessible houses before a workbook preview is shown.

## Approaches

- **Page-local accessible-house selector (chosen):** load only `GET /houses/accessible`, auto-select a user's sole house, and require an explicit choice when multiple houses are available. This gives the requested page-level control and follows existing report-page patterns.
- **Display only the global selected house:** smaller, but does not let the user choose a different house on this page.
- **Persist uploaded data by house:** would add backend storage and import behavior beyond this request and the current temporary-preview flow.

## Design

- Keep the existing report-view permission.
- Fetch assigned houses from `/houses/accessible`; do not use an unrestricted house list.
- With one accessible house, select it automatically and show its name. With multiple houses, present a bilingual selector and require a selection before file upload.
- When changing houses, clear the currently uploaded filename and rows so temporary data cannot be mistaken for another house.
- On house-list fetch error or no available houses, show a localized error/empty state and prevent upload.
- House selection is local to this page; no house data or workbook rows are persisted.

## Constraints and Non-goals

- No new backend endpoint, model, permission, or persistent upload.
- Preserve the existing Excel workbook parser and 23-column table.
- Use the existing `/houses/accessible` endpoint and current UI/i18n conventions.

## Verification

Run frontend lint and TypeScript checks; test one-house auto-selection, multi-house selection gating, and clearing preview on house change when an authenticated browser session is available.
