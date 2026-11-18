# Live C2C Upload-Based Productivity Report

## Intent

Generate the Live C2C productivity report from the selected worksheet instead of displaying previously stored transaction rows. The upload is temporary and does not replace or add database transaction records.

## Design

- Keep the page's view and upload permission gates, house selection, worksheet selection, file-size checks, and mismatch diagnostics.
- Accept `.xlsx` and `.xlsb` workbooks up to 10 MiB with the existing required transaction columns: `From Msisdn`, `To Msisdn`, `Modified ON`, and `Transfer Mrp`.
- Parse and resolve uploaded transactions to active RSOs and house retailers. Reject the report when any source number is missing or ambiguous; continue to show the existing mismatch diagnostics.
- Aggregate unique uploaded transfers by active RSO. Identical duplicate transfers are excluded using the existing import deduplication rule.
- Use `Transfer Mrp` totals for C2C values and transaction-row counts for `trans`. Classify a retailer as today's route when it has an active assignment to an active route scheduled for the current BST weekday; all other uploaded retailers count as other route.
- Enrich report rows with the selected house code, RSO DMS/iTop details, and the selected month's `productivity_c2c_tgt` and `productivity_trans_tgt` values. Include active RSOs with no uploaded transactions as zero-achievement rows.
- Calculate achievement percentage as achievement divided by target, multiplied by 100 (zero when target is zero); remaining is target minus achievement, including negative values when the target is exceeded.
- Calculate start/end time from the earliest/latest valid uploaded transaction times and serving hours from their difference. Leave time fields empty when no valid times exist.
- Display these 19 columns in order: `Serial Number`, `House Code`, `Dms Code`, `Rso Name`, `Rso Itop Number`, `Productivity C2C Tgt`, `C2C today's route`, `C2C other route`, `Total C2C`, `Ach%`, `Remain`, `Productivity trans.Tgt`, `Todays route trans`, `Other route trans`, `Ach%`, `Remain`, `Start Time`, `End Time`, `Serving hours`.
- Use a wide horizontally scrollable desktop table and expandable mobile rows. Keep all visible text bilingual through the existing translation system.
- Do not display stored `LiveC2CRow` records, persist the upload, or add an export.

## Constraints

- Preserve the existing import API for other clients; report generation itself does not mutate or store transactions.
- Reuse installed dependencies and keep house-scoped access controls.

## Verification

- Add a focused API regression test for route/other-route totals, transaction counts, achievement math, times, duplicate handling, zero-activity RSOs, and absence of database writes.
- Run the Live C2C backend tests, frontend lint, and TypeScript checks. Inspect the responsive page at 375px, 768px, and 1280px when an authenticated browser session is available.
