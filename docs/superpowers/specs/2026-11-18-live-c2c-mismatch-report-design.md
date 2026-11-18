# Live C2C Entity Match Report Design

## Intent

Today a Live C2C import stops at the **first** row whose `From Msisdn` does not
match an active RSO in the selected house, and the UI shows one generic message
(`The From Msisdn value does not match an active RSO in this house.`). The user
fixes one row, re-uploads, and discovers the next failure. They asked to see
**only the mismatched values**, to **export those mismatches**, to make the
replace-on-import path fast (delete + bulk insert), to drop soft delete for this
module permanently, to sync permissions automatically on boot, and to store an
**exactly duplicated** transfer row only once.

The import stays all-or-nothing: nothing is written while any row cannot be
resolved.

## Approaches

- **Collect-all diagnostics, block, export from the response (chosen).**
  Resolve every distinct `From Msisdn` and `To Msisdn` in the workbook, keep only
  the unresolved ones (`not_found` / `ambiguous`), and refuse the write when the
  list is non-empty. The report is small by construction, so the UI can render
  it and download it as `.xlsx` without a second server round-trip.
- **Fix one error at a time, better message only.** Smallest change, but keeps
  the upload/fix/re-upload loop the user is complaining about.
- **Partial import.** Write the rows that resolve and skip the rest. Rejected:
  a half-imported C2C sheet silently changes report totals.
- **Server-side mismatch export endpoint.** Re-parses the workbook, needs its own
  permission gate and doubles the upload cost. Rejected: the report is already
  produced under `live_c2c.import`, and the repo already exports report payloads
  in the browser (`src/lib/export-*.ts`).

## Design

### Backend — resolution result

`app/services/live_c2c_service.py`

`prepare_live_c2c_import()` stops raising on match failures and returns a result
that lists **only problem values**:

```python
@dataclass(frozen=True)
class LiveC2CEntityIssue:
    side: str                  # "from" (RSO) | "to" (retailer)
    value: str                 # the msisdn text from the workbook
    status: str                # "not_found" | "ambiguous"
    row_count: int             # workbook rows using this value
    excel_rows: list[int]      # capped preview of those row numbers
    candidates: list[dict]     # ambiguous only: RSO id, name, name_bn, dms_code,
                               # itop_number; retailer id, name, retailer_code,
                               # itop_number, enabled

@dataclass(frozen=True)
class LiveC2CImportCheck:
    rows: list[dict]           # resolved, de-duplicated rows; empty when blocked
    issues: list[LiveC2CEntityIssue]
    summary: dict              # total_rows, importable_rows, issue_count,
                               # affected_rows, duplicate_rows
    duplicate_excel_rows: list[int]   # capped preview of skipped duplicates
    disabled_retailer_count: int
    truncated: bool
    can_import: bool           # issues == [] (and not truncated)
```

- Resolution keys off distinct values, not rows, so a 5,000-row sheet with 20
  numbers produces at most 20 issue lines.
- `not_found` has no candidates; `ambiguous` lists every active same-house RSO
  (or same-house retailer) sharing the number. No new matching rule is
  introduced — the existing exact and `0`-prefix candidates stay.
- `MAX_DIAGNOSTIC_VALUES = 200` per side; beyond that the list is cut and
  `truncated` is set (and `can_import` stays False). `excel_rows` keeps at most
  20 entries per value.
- `on_route` / route lookup only runs when `can_import` is true.
- The house-not-found guard stays a hard 404 error.

### Backend — exactly duplicated rows are stored once

Two workbook rows are the **same transfer** when the resolved
`(from_employee_id, to_retailer_id, modified_on, transfer_mrp)` are identical.
Resolution happens first, so `017…` and `17…` text forms of the same RSO count as
the same transfer. The first occurrence (lowest Excel row) is kept; later ones
are dropped and reported.

- A different amount or a different `Modified ON` is **not** a duplicate: an RSO
  paying a retailer 1000 in the morning and 500 in the evening stores two rows.
- `summary["duplicate_rows"]` counts the dropped rows, `duplicate_excel_rows`
  carries their row numbers (capped at 20).
- The import response and the activity log carry `duplicate_rows` so the count is
  never silent.

### Backend — import replaces by house, fast

`replace_live_c2c_rows()`

- **Delete then insert, same transaction.** The house's rows are removed with
  `DELETE FROM live_c2c WHERE house_id = :house_id` before the new rows go in.
  `TRUNCATE` cannot be scoped to a house, and wiping the table would drop other
  tenants' data — house isolation is non-negotiable, so the per-house delete is
  the truncate equivalent here.
- Delete + insert run in the request session's single transaction: if the insert
  fails, the delete rolls back and the previous data survives.
- **Fast bulk insert.** On PostgreSQL, write with asyncpg `COPY`
  (`copy_records_to_table`) through the pattern already used in
  `app/services/inventory_service.py` (`_raw_pg_connection`). One COPY statement
  for the whole sheet. Tests run on SQLite, so a portable fallback batches
  `insert()` executemany in chunks of `DB_INSERT_BATCH_SIZE = 5000`.
- COPY column list: `house_id, from_msisdn, to_msisdn, modified_on, on_route,
  transfer_mrp, source_filename, source_sheet, created_by, created_at`.
- Activity log: `module="live_c2c"`, `action="import"`,
  `old_values={"active_rows": previous_count}`,
  `new_values={file_name, sheet_name, imported_rows, duplicate_rows,
  disabled_retailers}`.

### Backend — soft delete is removed for this module, permanently

Live C2C is a replace-all snapshot: every successful import replaces the house's
entire dataset, so row-level soft delete has no meaning. This is recorded as a
binding exemption, not an undocumented exception.

- `docs/agents/database.md` gains a **Soft Delete Exemptions** section naming
  `live_c2c` and the reason. That file owns the rule; `AGENTS.md` stays a summary.
- `app/models/live_c2c.py` drops `is_deleted`, `deleted_at`, `deleted_by`; the
  read endpoint drops its `is_deleted` filter.
- A startup migration `_migrate_live_c2c_drop_soft_delete()` drops the three
  columns and the `ix_live_c2c_is_deleted` index on existing databases
  (idempotent `information_schema` guard, same shape as the other
  `_migrate_*` steps in `app/services/db_service.py`). No alembic revision —
  alembic is not part of this project's boot path.

### Backend — automatic permission sync

- The body of `POST /sync-permissions` moves to
  `app/services/permission_sync.py` as
  `sync_permissions_from_config(db) -> dict` (`total_permissions`,
  `permissions_added`, `roles_updated`). It only adds missing permissions and
  grants configured defaults — never removes anything.
- `init_db()` calls it after `create_all` on every boot, on a short-lived
  session, taking a PostgreSQL advisory lock so parallel workers cannot race.
- The admin endpoint delegates to the same function and keeps its audit-log entry;
  the boot-time run logs a summary line and does not write an activity entry
  (there is no user to attribute it to). A failure there is logged with a full
  traceback and does not abort the boot.

### Backend — endpoints

`app/routers/reports.py`

| Endpoint | Change |
|---|---|
| `POST /reports/live-c2c/preview` | Always 200. Returns `data: { can_import, summary, issues, duplicate_excel_rows, truncated, disabled_retailer_count }`. |
| `POST /reports/live-c2c/import` | If `can_import` is false: HTTP 400 with `code: "LIVE_C2C_IMPORT_ERROR"`, `error_code: "live_c2c_entity_mismatch"` and the same report under `detail.diagnostics`. No row is deleted or inserted. Success body adds `duplicate_rows`. |

Both keep `live_c2c.import` permission, `X-House-ID` scoping and
`_assert_house_access`. No new route, module or table.

The old `live_c2c_employee_not_found` / `_ambiguous` / `live_c2c_retailer_*`
codes are no longer raised by the import path; their translations stay for the
parsing errors that still use that shape.

### Permissions

`backend/config/permissions.json`

- Add `live_c2c.export` to the `live_c2c` module and to every `default_roles`
  entry that already lists `live_c2c.import`. The boot-time sync seeds it into
  the database, so no manual `POST /sync-permissions` is needed.
- The export is a browser download of a payload the server already returned
  under `live_c2c.import`; the permission gates the UI action, and no new data
  is exposed by it.

### Frontend

`frontend/src/app/reports/live-c2c/page.tsx`

- `handlePreviewAndConfirm()` stores the preview report in state
  (`matchReport`). When `can_import` is false it shows the report and does
  **not** call `/import` and does **not** show the disabled-retailer confirm.
- Report panel sits directly below the upload/sheet card, `role="region"`,
  `aria-live="polite"`: heading, summary counts (`total rows`, `rows blocked`,
  `problem values`), then one list of **mismatched values only**:
  - value, side (`From Msisdn (RSO)` / `To Msisdn (Retailer)`), status badge
    (`Not found` / `Multiple matches`), affected row count and first Excel row
    numbers;
  - for `ambiguous`, the candidate list (`name — dms_code` / `name —
    retailer_code`).
- When `can_import` is true and duplicates were skipped, a neutral info line
  states `{count} duplicate row(s) will be skipped` before the confirm prompt.
  The success message also reports the skipped count.
- Export button (`Download` icon, `live_c2c.diagnostics.export`) in the panel
  header, rendered only when `hasPermission("live_c2c.export")` and
  `issues.length > 0`; downloads `live_c2c_mismatches_<house code>_<date>.xlsx`
  built by `frontend/src/lib/export-live-c2c-mismatches.ts` (ExcelJS, same shape
  as `export-activations.ts`). Sheet columns: `Side`, `Msisdn`, `Status`,
  `Affected Rows`, `Excel Rows`, `Candidates`.
- Responsive: card list below `lg`, table at `lg` and up, matching the existing
  page pattern; 44×44 targets, no horizontal scroll at 375px.
- Clearing/changing the file or house resets `matchReport`.
- New i18n keys under `live_c2c.diagnostics.*` and `live_c2c.duplicates.*` in
  **both** `en` and `bn`; `live_c2c.errors.live_c2c_entity_mismatch` stays as the
  generic fallback.

## Non-goals

- No partial import, no row editing in the UI, no persistence of the report.
- No change to the matching rules or the replace-all semantics.
- No new backend route, module, nav item, or nav permission.
- No alembic revision; the schema change is a boot-time `_migrate_*` step.
- The `init_db()` loud-failure hardening (chosen approach: schema failures fatal,
  legacy migration warnings traced) is a separate plan and is not part of this
  one.

## Verification

Backend (`cd backend && python -m pytest -q`), tests in
`tests/test_live_c2c_import.py`:

- preview reports an unmatched From Msisdn as `not_found` with row numbers and
  `can_import` false, HTTP 200
- preview lists only problem values (a fully matched workbook returns `issues: []`)
- ambiguous From Msisdn lists both candidates
- symmetric coverage for retailer `To Msisdn`
- another house's RSO with the same number is not offered as a candidate
- import with any mismatch → 400 `live_c2c_entity_mismatch` and the previous
  rows are still present (delete rolled back)
- successful import replaces: previous rows are gone (hard delete), other
  houses' rows untouched, new rows written in bulk
- duplicate rows (same from/to/modified_on/amount) store once, report
  `duplicate_rows`
- different amount or different `Modified ON` stores both rows
- clean workbook still imports exactly as before
- `live_c2c` model/metadata has no soft-delete columns
- `sync_permissions_from_config` adds a missing permission from the config and
  reports it, and is idempotent on a second run

Frontend (`npm run lint`, `npx tsc --noEmit`) plus a visual check at 375, 768 and
1280 px with a workbook containing a matched, an unmatched and an ambiguous
number, plus a duplicated row, in both languages, including the exported file.
