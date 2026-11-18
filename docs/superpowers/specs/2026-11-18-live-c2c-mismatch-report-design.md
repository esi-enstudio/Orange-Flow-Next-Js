# Live C2C Entity Match Report Design

## Intent

Today a Live C2C import stops at the **first** row whose `From Msisdn` does not
match an active RSO in the selected house, and the UI shows one generic message
(`The From Msisdn value does not match an active RSO in this house.`). The user
fixes one row, re-uploads, and discovers the next failure. They asked to see
clearly **which values matched which RSO and which did not**, so a whole
workbook can be corrected in one pass.

The import stays all-or-nothing: nothing is written while any row cannot be
resolved.

## Approaches

- **Collect-all diagnostics, block the import (chosen).** Resolve every distinct
  `From Msisdn` and `To Msisdn` in the workbook, return a per-value report
  (`matched` / `not_found` / `ambiguous` plus the matched RSO/retailer), and
  refuse the write when any value is unresolved. The preview already resolves
  every row before writing, so this is the same code path with the early `raise`
  replaced by collection.
- **Fix one error at a time, better message only.** Smallest change, but keeps
  the upload/fix/re-upload loop the user is complaining about.
- **Partial import.** Write the rows that resolve and skip the rest. Rejected:
  a half-imported C2C sheet silently changes report totals, and the existing
  replace-all semantics (soft-delete previous rows, insert new) would make the
  skipped rows look deleted.

## Design

### Backend — resolution result

`app/services/live_c2c_service.py`

`prepare_live_c2c_import()` stops raising on match failures and returns a result:

```python
@dataclass(frozen=True)
class LiveC2CEntityCheck:
    value: str                 # the msisdn text from the workbook
    status: str                # "matched" | "not_found" | "ambiguous"
    row_count: int             # workbook rows using this value
    excel_rows: list[int]      # capped preview of those row numbers
    candidates: list[dict]     # RSO: id, name, name_bn, dms_code, itop_number
                               # retailer: id, name, retailer_code, itop_number, enabled

@dataclass(frozen=True)
class LiveC2CImportCheck:
    rows: list[dict]           # resolved rows, empty when can_import is False
    from_checks: list[LiveC2CEntityCheck]
    to_checks: list[LiveC2CEntityCheck]
    summary: dict              # total_rows, matched_rows, rows_with_issues,
                               # from_matched/not_found/ambiguous counts, same for to
    truncated: bool
    can_import: bool
```

- Resolution keys off distinct values, not rows, so a 5,000-row sheet with 20
  numbers produces a 20-line report.
- `candidates` is filled for `matched` (one entry) and `ambiguous` (all of them)
  so the UI can name the RSO in both cases; `not_found` has an empty list.
- Ambiguity keeps its current rule: more than one active same-house RSO sharing
  the number. No new matching rule is introduced — the existing exact and
  `0`-prefix candidates stay.
- `MAX_DIAGNOSTIC_VALUES = 200` per side; beyond that the list is cut and
  `truncated` is set, so a pathological sheet cannot produce a huge response.
  `excel_rows` keeps at most 20 entries per value.
- `on_route` / route lookup only runs when `can_import` is true.
- The house-not-found guard stays a hard 404 error.

### Backend — endpoints

`app/routers/reports.py`

| Endpoint | Change |
|---|---|
| `POST /reports/live-c2c/preview` | Always 200. Returns `data: { can_import, summary, from_checks, to_checks, truncated, disabled_retailer_count }`. |
| `POST /reports/live-c2c/import` | If `can_import` is false: HTTP 400 with `code: "VALIDATION_ERROR"`, `error_code: "live_c2c_entity_mismatch"` and the same report under `detail.diagnostics`. No row is soft-deleted or inserted. |

Both keep `live_c2c.import` permission, `X-House-ID` scoping and
`_assert_house_access`. No new permission key, route, module or table.

The old `live_c2c_employee_not_found` / `live_c2c_employee_ambiguous` /
`live_c2c_retailer_not_found` / `live_c2c_retailer_ambiguous` codes are no longer
raised by the import path; their translations stay for the parsing errors that
still use that shape.

### Frontend

`frontend/src/app/reports/live-c2c/page.tsx`

- `handlePreviewAndConfirm()` stores the preview report in state
  (`matchReport`). When `can_import` is false it shows the report and does
  **not** call `/import` and does **not** show the disabled-retailer confirm.
- Report panel sits directly below the upload/sheet card, `role="region"`,
  `aria-live="polite"`, heading + summary counts, then two sections:
  - **RSO (From Msisdn)** and **Retailer (To Msisdn)**
  - each value: msisdn, status badge (`Matched` / `Not found` / `Multiple
    matches`), and the matched entity (`name — dms_code` / `name —
    retailer_code`); for `ambiguous`, the candidate list; row count and the
    first Excel row numbers.
- Only values with issues are expanded by default; matched values are listed
  below so "which ones matched" is equally visible. If `truncated`, a note says
  how many values were omitted.
- Responsive: card list below `lg`, table at `lg` and up, matching the existing
  page pattern; 44×44 targets, no horizontal scroll at 375px.
- Clearing/changing the file or house resets `matchReport`.
- New i18n keys under `live_c2c.diagnostics.*` in **both** `en` and `bn`; the
  generic `live_c2c.errors.live_c2c_entity_mismatch` is used only as a fallback
  when the panel has no data.

## Non-goals

- No partial import, no row editing in the UI, no download/export of the report.
- No change to the matching rules, the table schema, or the replace-all import.
- No new permission, module, nav item, or API route.

## Verification

Backend (`cd backend && python -m pytest -q`), tests added/updated in
`tests/test_live_c2c_import.py`:

- preview reports a matched From Msisdn with the RSO name and DMS code
- unmatched From Msisdn → `not_found`, `can_import` false, HTTP 200
- ambiguous From Msisdn → both candidates listed
- symmetric coverage for retailer `To Msisdn`
- another house's RSO with the same number is not offered as a candidate
- import with any mismatch → 400 `live_c2c_entity_mismatch`, previous rows stay
  active and no new rows are written
- clean workbook still imports exactly as before

Frontend (`npm run lint`, `npx tsc --noEmit`) plus a visual check at 375, 768 and
1280 px with a workbook containing matched, unmatched and ambiguous numbers in
both languages.
