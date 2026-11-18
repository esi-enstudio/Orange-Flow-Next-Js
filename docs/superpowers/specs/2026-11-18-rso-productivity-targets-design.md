# RSO Productivity Targets Design

- **Intent:** Store and manage the `Productivity C2C Tgt` and `Productivity trans.Tgt` values on RSO target records, including workbook imports.
- **Why:** RSO target values currently have no dedicated database/API/UI fields, and the unified importer treats unmapped workbook columns as generic extra targets.
- **Approach:** Add two dedicated Float columns to `rso_targets`, defaulting existing and omitted values to zero. Extend the RSO target schemas, Excel import mapping/sample/export, and the existing RSO targets table and edit/create form with bilingual labels.
- **Alternatives considered:** Keep values only in `extra_targets` (does not provide dedicated database columns as requested); add fields only to the frontend/import mapping (cannot persist them as named fields). Dedicated numeric columns are the direct fit.
- **Assumptions / constraints:** The two targets may contain decimal values, so Float is used. Import accepts the displayed Excel header spellings and normalized variants. Existing RSO target behavior and unrelated worktree changes remain untouched.
- **Non-goals:** No productivity calculations, report formula changes, new permissions, or changes to house/employee matching.
