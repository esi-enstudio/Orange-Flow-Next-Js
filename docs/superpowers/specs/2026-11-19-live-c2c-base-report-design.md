# Live C2C — Base RSO Report (DB only) — Design

Date: 2026-11-19
Status: Approved and implemented

## Intent

On `/reports/live-c2c`, when a house is selected, show the house's report base
immediately from the database instead of waiting for an Excel upload. The base
report lists every **active RSO** of the selected house with their identity
columns and the **current month's** productivity targets. Transaction totals
will be layered on later (next request) from the uploaded workbook.

## Goals

- Selected house -> automatic, DB-backed report table (no upload needed).
- Columns: the same column set as the generated report (Serial Number, House
  Code, DMS Code, RSO Name, RSO iTop Number, Productivity C2C Tgt, route/total/
  achievement/remaining columns, Productivity trans.Tgt, trans route columns,
  start/end time, serving hours). Transaction-derived columns have no base data
  yet and render `—` until an upload preview is generated.
- Current month = 1st day of the current BST month, matching the existing
  `RSOTarget.target_date` convention.
- Active RSOs with no target row for the month still appear, with `0` targets.
- House scoped (`X-House-ID`) and permission controlled like the rest of the
  page (`reports.view` or `itopup.view`).
- Bilingual (`en` + `bn`), responsive (375 / 768 / 1280), content-aware
  skeleton, empty and error states.
- Preview/upload flow stays exactly as it is.

## Non-goals

- No change to `preview_live_c2c_import`, `/reports/live-c2c/preview`,
  `/reports/live-c2c/import`, diagnostics, mismatch export, or the uploaded
  workbook flow.
- No new transaction counts, trans achievement/remaining, times or serving
  hours. The C2C side is DB-backed: route-wise `transfer_mrp` sums from the
  `live_c2c` table (on_route `Y` -> today's route, `N` -> other route), with
  Total C2C, Ach% (against `productivity_c2c_tgt`) and Remain derived from them.
- No new module, permission key, nav item, or route.
- No pagination for this report (matches the existing preview report, which
  returns all active RSOs in one response).

## Approaches considered

- **A — Auto-load on house selection (chosen).** One small house-scoped GET
  endpoint; the page fetches on house change and renders a base table. Matches
  the "report as soon as house is selected" intent.
- **B — Explicit "Load report" button.** Extra click, no benefit, rejected.
- **C — Merge into the existing upload/preview response.** Requires a file
  before any report exists, which is exactly what we are removing; rejected.

## Backend

New endpoint in `backend/app/routers/reports.py`:

`GET /api/reports/live-c2c/rsos`

- Dependencies: `has_any_permission(["reports.view", "itopup.view"])`,
  `require_house_context`, `get_db`; then `_assert_house_access`.
- `target_date = date(today.year, today.month, 1)` using `now_naive()` (BST).
- House: fetch `House` by `house_id`; 404 `live_c2c_house_not_found` if gone.
- RSOs: `Employee.house_id == house_id`, `employee_type == "rso"`,
  `status == "Active"`, ordered by `dms_code, id`.
- Targets: `RSOTarget.house_id == house_id`,
  `RSOTarget.target_date == target_date`, mapped by `employee_id`.
- Response:

```json
{
  "success": true,
  "data": {
    "target_date": "2026-11-01",
    "rows": [
      {
        "employee_id": 1,
        "house_code": "DH01",
        "dms_code": "DMS-01",
        "rso_name": "Amina",
        "rso_itop_number": "01700000001",
        "productivity_c2c_tgt": 100.0,
        "productivity_trans_tgt": 50.0
      }
    ]
  }
}
```

- `rso_name` falls back to `dms_code` then `""`, matching
  `build_live_c2c_productivity_report`.
- Missing `RSOTarget` row -> `0.0` for both targets.
- Serial number stays a presentation concern (row index), same as the existing
  report export.

## Frontend

`frontend/src/app/reports/live-c2c/page.tsx`:

- Add `baseRows`, `baseLoading`, `baseError` state.
- Fetch on `selectedHouseId` change (and initial default house) with
  `X-House-ID`; abort the in-flight request on change/unmount; ignore stale
  responses.
- Rendering of the report region:
  - `reportRows` / `matchReport` present -> existing preview behaviour wins.
  - Otherwise, only when a house is selected and houses have loaded -> base
    table (skeleton while loading, error message, empty "no active RSOs" state).
    With no house selected the region stays hidden so the page never claims an
    unselected house has no RSOs.
- Desktop table: the existing full report column set, `border` cells, existing
  `px-2 py-1` standard. Columns without base data render `—`.
- Mobile: accordion rows. Collapsed line shows serial + RSO name; subtitle shows
  DMS code and iTop; expanded details show every report column (values without
  base data render `—`). One row expanded at a time.
- Reuse existing labels `live_c2c.report_columns.*`; add new keys for the base
  report loading/error copy in both languages.
- Update the page guide copy so it no longer claims the page shows only
  uploaded data.

## Constraints and risks

- `RSOTarget` is unique per `(employee_id, target_date)`; no duplicate risk.
- House isolation: every query filters by `house_id`; inaccessible house -> 403
  from `require_house_context` / `_assert_house_access`.
- Report size equals active RSO count per house (same set the preview already
  returns), so no pagination is introduced.

## Testing

- Backend test file `tests/test_live_c2c_base_report.py`:
  - only active RSOs of the selected house, sorted by DMS code;
  - resigned RSO, other employee types, and other houses excluded;
  - current-month targets returned; other-month target ignored (including when
    the same employee also has a current-month row);
  - RSO without a target row returns zeros;
  - `reports.view` and `itopup.view` both grant access, other permissions 403;
  - inaccessible house returns 403; missing house returns 404;
  - the BST clock is frozen in tests so a month rollover cannot flake the run.
- Run: `cd backend && python -m pytest -q`,
  plus plan-module parity/coverage tests (new route added).
- Frontend: `cd frontend && npm run lint && npx tsc --noEmit`.
- Responsive check at 375 / 768 / 1280.

## Open decisions (resolved by approval)

- Column order: existing report order (Serial, House Code, DMS, RSO Name, iTop,
  C2C Tgt, Trans Tgt) rather than the order they were listed in the request.
- Base report occupies the report region only while no preview report exists.
