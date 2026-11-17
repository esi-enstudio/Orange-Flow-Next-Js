# Live C2C Table and Excel Preview Design

## Intent

Let a user preview rows from an Excel workbook in the existing Live C2C page, using the requested fixed columns and a readable wide-table layout.

## Approaches

- **Browser-only preview (chosen):** Parse the selected workbook with the already-installed ExcelJS dependency, validate the first worksheet's header row, and show its rows in the page. No uploaded data persists after refresh. This is the smallest change consistent with the request, which does not ask for storage, history, or sharing.
- **Server-side import and storage:** Upload to a new API and persist the rows. This supports later access and sharing, but requires backend validation, storage/model decisions, house scoping, permissions, and audit behavior not requested here.

## Design

- Keep the existing page permission gate.
- Provide an `.xlsx` file picker and preview the first worksheet. Treat its first row as the header row; require the 23 requested headers in the requested order (case-insensitive, trim/collapse whitespace) so the repeated `Ach%` and `Remain` columns stay unambiguous. Ignore extra trailing columns.
- An accepted upload replaces the current in-memory preview. No backend request, durable storage, or export is added.
- Render the requested 23 columns in their supplied order in a white, bordered, `whitespace-nowrap` table inside a horizontally scrollable container.
- The displayed column sequence is: `SL #`, `DD Code`, `RSO Name`, `RSO Code`, `RSO Number`, `Check-in time`, `Productivity C2C Tgt`, `C2C today's route`, `C2C other route`, `Total C2C`, `Ach%`, `Remain`, `Gap`, `Today Target`, `Remain`, `Productivity trans.Tgt`, `Todays route trans`, `Other route trans*`, `Ach%`, `Remain`, `Start Time`, `End Time`, `Serving hours`.
- Keep all user-visible text bilingual in the existing translation system.
- Accept `.xlsx` files up to 10 MiB and handle unreadable/invalid workbooks with a localized error; do not silently treat an invalid file as an empty result.

## Constraints and Non-goals

- Use the existing ExcelJS dependency; do not add packages.
- No new API, database table, permission, or persistent upload.
- No report calculations, row editing, or persistence beyond the current page session.

## Verification

Add focused parser tests covering a valid workbook, a missing required column, and a header-only workbook. Run frontend lint and TypeScript checks; inspect the page at 375px, 768px, and 1280px if an authenticated browser session is available.
