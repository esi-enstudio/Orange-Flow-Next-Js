# Report Builder — Design Spec

**Date:** 2026-11-17
**Status:** Frozen (design approved; phase 1a in progress)
**Approach:** B — new backend `report_engine` + `/reports/builder` page. The legacy
`ga-report-builder` is *not* extended (its template/column-catalogue pattern is reused as
inspiration only).

---

## 1. Goal

One flexible report builder under **Reports** that can produce any report at all:

- **Metric** — GA Activation, C2C, C2S, Balance, Scratch Card issue
- **Dimension** — RSO, BP, supervisor, retailer, route, date
- **Period** — any month, or any day range
- **Target** — house monthly target, RSO/BP/supervisor monthly target, per-retailer custom
  target, a literal custom number, a percentage of the target, or no target
- **Output** — paginated preview, Excel export, (later) saved templates + scheduled
  WhatsApp/Telegram delivery

Layout: **configuration on the right, live preview on the left.** Metric/dimension/date/filter
changes refresh the preview automatically (400 ms debounce + `AbortController`); there is no
"Apply" for the preview.

---

## 2. Metrics (registry, code — not a DB table)

| key | source table | date column | value | type | target sources |
|---|---|---|---|---|---|
| `ga_activation` | `activations` | `activation_date` | `COUNT(*)` | count | house, custom, none (+ rso/bp/supervisor in 1b) |
| `c2c` | `itopup_details` | `report_date` | `SUM(daily_value)` where `report_type='C2C'` | amount | house, custom, none (+ 1b) |
| `c2s` | `itopup_details` | `report_date` | `SUM(daily_value)` where `report_type='C2S'` | amount | **custom, none only** |
| `balance` | `itopup_details` | `report_date` | `SUM(daily_value)` where `report_type='Balance'` | amount | **custom, none only** |
| `sc_issue` | `scratch_card_issues` | `issue_date` | `SUM(quantity)` | count | house, custom, none (+ 1b) |

**Why `c2s`/`balance` have no stored target:** `house_targets`, `rso_targets`, `bp_targets` and
`supervisor_targets` carry only GA, C2C (`ev_*`), SC and `total_recharge` columns. There is no
C2S or Balance target anywhere in the schema. Requesting `house`/`rso`/`bp`/`supervisor` for
those metrics returns **422 `TARGET_SOURCE_UNAVAILABLE_FOR_METRIC`** (`fields.target.source`),
and `/options` never offers them. Adding such columns is a separate Phase-2 schema change.

House-target column map: `ga_activation → total_ga_target`, `c2c → ev_c2c_target`,
`sc_issue → sc_primary_target`.

**Rule-engine exclusions (DRC/RSP marked retailers) are NOT applied in 1a/1b.** The engine counts
raw rows, exactly like `ga-query`. Legacy GA dashboards exclude those retailers, so their numbers
may differ by a small amount. This is a documented, intentional difference; the exclusion is
added in Phase 4 when the legacy services are migrated onto the engine.

---

## 3. Dimensions (registry, code)

| key | group key | label | sublabel |
|---|---|---|---|
| `rso` | owning employee `retailers.employee_id` | employee name | dms code |
| `bp` | owning employee where `employee_type='bp'`, else null bucket | employee name | dms code |
| `supervisor` | `supervisor_rso_assignments.supervisor_employee_id` of the owner | supervisor name | dms code |
| `retailer` | `retailers.id` | retailer name | retailer code |
| `route` | route code (see below) | route code | route name |
| `date` | date column value | `DD MMM YYYY` | weekday |

- A row whose entity cannot be resolved lands in a **null bucket** (`key: null`,
  `label: "Unassigned"` / `"No BP"` / `"No supervisor"` / `"No route"`). Rows are never dropped,
  so `Σ rows == summary` always holds.
- **Attribution is always `retailers.employee_id`** — the canonical owner maintained by the
  retailer import + the startup self-healing migrations ([domain-rules.md](../../agents/domain-rules.md)).
  The assisted-code priority rule is therefore inherited, never re-implemented.
- **Route** — `activations.route_code` / `scratch_card_issues.route_code` snapshots when the
  metric carries one; otherwise (iTopUp) the retailer's primary `retailer_routes` row resolved at
  `date_to`. A past-month route report on iTopUp metrics therefore reflects the *current* mapping
  → warning `ROUTE_ATTRIBUTION_CURRENT` (UI badge + Excel note row).

---

## 4. Target sources

| source | resolves to | 1a |
|---|---|---|
| `house` | `house_targets` row per calendar month | ✅ |
| `none` | no target | ✅ |
| `custom` | literal number from the request | ✅ |
| `rso` / `bp` / `supervisor` | that row's own attributable target | 1b |
| `retailer_custom` | `retailer_targets` row | Phase 2 |

Resolution is **per row from row attribution, never a fixed ID stored in a template.** A template
stores only the *kind*; a different user loading it gets *their* rows' targets. To report one
specific RSO, filter to that RSO — do not add a "specific employee" source.

### Source × group_by matrix

`✅` valid · `❌` → **422 `TARGET_SOURCE_INCOMPATIBLE`** (`fields.group_by`). `/options` only
returns valid combinations.

| source \ group_by | rso | bp | supervisor | retailer | route | date |
|---|---|---|---|---|---|---|
| `house` | ✅ house total on every row | ✅ | ✅ | ✅ | ✅ | ✅ (see §7) |
| `rso` | ✅ row's RSO | ❌ | ❌ | ✅ owner RSO | ✅ route's date-effective RSO | ✅ in-scope sum |
| `bp` | ❌ | ✅ row's BP | ❌ | ✅ assisted-code BP | ❌ | ✅ in-scope sum |
| `supervisor` | ❌ | ❌ | ✅ | ✅ owner → supervisor | ❌ | ✅ in-scope sum |
| `retailer_custom` | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ in-scope sum |
| `custom` | ✅ literal | ✅ | ✅ | ✅ | ✅ | ✅ (see §7) |
| `none` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

"In-scope sum" = the sum of the targets of every entity inside the user's scope that survives
the filters — the same rows the preview shows. No filter is required.

---

## 5. Period & target arithmetic

Let the range be `[date_from, date_to]` and `M` each calendar month it intersects.

- **Proration off (all of 1a):** `target = Σ_M full_month_target(M)`.
- **Proration on (1b):** `target = Σ_M full_month_target(M) × days_in_range(M) ÷ days_in_month(M)`.
  Each month is distributed **separately**, then summed.
- **Missing month row** → that month contributes `0` + warning `TARGET_MISSING_MONTH`
  (count of affected months).
- **Percent (1b):** `adjusted_target = target × percent ÷ 100`. Valid range **0–200**; outside →
  **422 `TARGET_PERCENT_OUT_OF_RANGE`** (`fields.target.percent`, `allowed_range: [0, 200]`).
  Never clamped. Both `target` and `adjusted_target` are returned.
- **`percent_applied` and `proration_factor` are always returned** by the API so the UI preview
  line (`100 → 80% = 80 → 15/30 days = 40`) and the Excel file show identical numbers.
- **Negative literal** → **422 `TARGET_VALUE_INVALID`** (`fields.target.value`).
- **Percent + proration both on** = two independent multiplications, in that order:
  prorated monthly target first, then percent.

### `custom` literal × `group_by=date`

The literal is a **period-level** target, not a monthly one — it never enters the monthly
proration loop.

| proration | date row target | percentage | status |
|---|---|---|---|
| on (1b) | literal split across days with largest-remainder, `Σ rows == literal` | computed | computed |
| off (1a) | **full literal on every row** | `null` | `not_applicable` + UI/Excel note |

Suppressed status is deliberate: comparing one day's achievement against a whole-period target
would mark almost every day "behind". The UI shows
*"Each row shows the full period target — read progress from the summary."*

---

## 6. Rounding (1b — largest remainder / Hamilton)

- Integer count metrics: whole units. Amount metrics: work in **cents (integer)**, never floats.
- Distribution order per month (multi-month ranges are distributed month by month).
- Tie-break: **earlier date first** for date rows; **ascending entity id** for entity rows
  (null id → label ascending). So `100 / 3 days` is always `34, 33, 33` — identical on every run.
- Percentages round **once, at the end**, to 1 dp; amounts to 2 dp; counts stay integers.
- **Entity tie-break is currently unused**: in Phase 1 an entity row never splits a target
  (the literal or monthly target is the same on every row). It exists only for Phase 2's
  `X × date` combinations. Do not write the entity split in 1a/1b.

---

## 7. Status (single source of truth: `report_engine/status.py`)

```
ACHIEVED_MIN_PCT = 100.0
ON_TRACK_MIN_PCT = 70.0
NEEDS_ATTENTION_MIN_PCT = 40.0
```

Time-based rule from [ui-components.md](../../agents/ui-components.md):

- **Period already finished** (`date_to < today`) → raw thresholds:
  `≥100 achieved`, `≥70 on_track`, `≥40 needs_attention`, else `behind`.
- **Period still running** → `time_pct = days_elapsed / days_in_month × 100` of the month
  containing `min(today, date_to)`; `achieved` at `≥100`, `on_track` at `≥time_pct`,
  `needs_attention` at `≥time_pct × 0.5`, else `behind`.
- `target <= 0` → `percentage: null`, `status: "no_target"`. Never divide by zero.
- `not_applicable` → no meaningful per-row comparison (no target chosen, or a date row with
  proration off).
- Enum, complete: `achieved`, `on_track`, `needs_attention`, `behind`, `no_target`, `not_applicable`.
- Frontend renders the status the API sends; it never re-derives it.

---

## 8. Scope, tenancy, filters

```
in_scope = user data-permission scope ∩ house (X-House-ID) ∩ applied filters
```

The **same scope** is used for achievement, target sum, summary and export.

| role | retailer scope |
|---|---|
| admin / manager / house manager | all retailers of the active house |
| supervisor | retailers owned by members of `supervisor_rso_assignments` |
| RSO / BP (has `employee_profile`) | retailers owned by that employee |
| retailer user | that retailer only |
| no match | empty result (fail-closed) |

- `house_id` **always** comes from `X-House-ID` / auth context, never from the body →
  body field present = **422 `HOUSE_ID_IN_BODY`**. `X-House-ID` is required.
- Same-house but out-of-scope ID in a filter → result intersects to empty +
  warning **`FILTER_IDS_OUT_OF_SCOPE`**; **not** a 403.
- Other-house ID in a filter or template import → **403 `CROSS_HOUSE_REFERENCE`**.

---

## 9. API

Base prefix: **`/api/v1/report-builder`** (module-named so `PATH_TO_MODULE` maps 1:1 to the new
`report_builder` plan module; the earlier draft said `/api/v1/reports/query`, which would sit
inside the existing `reports` module).

```
POST /api/v1/report-builder/query      # permission report_builder.view
GET  /api/v1/report-builder/options    # permission report_builder.view
POST /api/v1/report-builder/export     # permission report_builder.export
```

Query body:

```json
{
  "metric": "ga_activation",
  "date_from": "2026-11-01",
  "date_to": "2026-11-17",
  "group_by": ["rso"],
  "filters": {
    "retailer_ids": [], "employee_ids": [], "route_codes": [], "supervisor_ids": []
  },
  "target": { "source": "house", "value": null, "percent": null, "proration": false },
  "sort": { "field": "achievement", "order": "desc" },
  "page": 1,
  "per_page": 50
}
```

- `group_by` stays an **array** (forward compatible). Phase 1 accepts exactly one element;
  `len > 1` → **422 `GROUP_BY_MULTI_UNSUPPORTED`**; `len == 0` → `VALIDATION_ERROR`
  (`fields.group_by`). Multi-dimension (`X × date`) is Phase 2.
- Filters are AND-combined; empty/absent list = no filter.
- `per_page` 1–200 (default 50), `page ≥ 1`.

Response:

```json
{
  "success": true,
  "data": [{
    "key": "12", "label": "Rahim Uddin", "sublabel": "RS058703",
    "achievement": 85, "target": 100, "adjusted_target": 100,
    "percent_applied": null, "proration_factor": null,
    "percentage": 85.0, "remaining": 15, "status": "on_track"
  }],
  "summary": {
    "achievement": 320, "target": 400, "adjusted_target": 400,
    "percent_applied": null, "proration_factor": null,
    "percentage": 80.0, "remaining": 80, "status": "on_track", "row_count": 5
  },
  "pagination": { "page": 1, "per_page": 50, "total": 5, "total_pages": 1, "has_next": false, "has_prev": false },
  "meta": {
    "metric": "ga_activation", "metric_label_en": "GA Activation", "metric_label_bn": "জিএ অ্যাক্টিভেশন",
    "group_by": "rso", "dimension_label_en": "RSO", "dimension_label_bn": "আরএসও",
    "date_from": "2026-11-01", "date_to": "2026-11-17",
    "target_source": "house", "value_type": "count",
    "target_is_period_level": true, "row_comparison_suppressed": false
  },
  "warnings": [{ "code": "TARGET_MISSING_MONTH", "message": "Target missing for 1 month", "count": 1 }]
}
```

- **Summary is over the full filtered set**, never the current page, and is computed from the
  same grouped list (so `summary.achievement == Σ row.achievement`).
- Sorting happens **before** pagination, server-side, over the fully computed rows.
  Sortable: `key, label, achievement, target, adjusted_target, percentage, remaining, status`.
  Default `achievement desc`. Ties broken by key ascending, then label ascending — deterministic.
- Because grouping happens in SQL and only aggregated rows are computed in Python, the working
  set is bounded by entities (or days), never by raw rows.

`/options` returns the metric list, the dimension list, the per-metric target sources, and the
source × group_by matrix already filtered to what the caller may pick.

---

## 10. Errors and warnings

**422** `TARGET_SOURCE_INCOMPATIBLE`, `TARGET_SOURCE_UNAVAILABLE_FOR_METRIC`,
`GROUP_BY_MULTI_UNSUPPORTED`, `TARGET_PERCENT_OUT_OF_RANGE`, `TARGET_VALUE_INVALID`,
`HOUSE_ID_IN_BODY`, `TEMPLATE_VALIDATION_FAILED`, `TEMPLATE_SCHEMA_OUTDATED`,
`TEMPLATE_SCHEMA_UNKNOWN`, `EXPORT_TOO_LARGE`, `VALIDATION_ERROR`
**409** `TEMPLATE_NAME_EXISTS`
**403** `CROSS_HOUSE_REFERENCE`
**410** `EXPORT_EXPIRED`

**warnings[]** `ROUTE_ATTRIBUTION_CURRENT`, `ROUTE_OWNER_CHANGED` (1b),
`TARGET_MISSING_MONTH`, `FILTER_IDS_OUT_OF_SCOPE`, `TEMPLATE_FILTER_IDS_MISSING`

Error body shape (project standard): `{"error": {"code", "message", "fields"}}`.

---

## 11. Excel export

- Same engine, same scope, **no pagination**: every grouped row.
- Streaming write-only workbook (openpyxl `write_only`).
- Header block: metric, dimension, period, target source (+ value/percent/proration),
  filter description, generated by/at, then **one row per warning**.
- Columns: label, sublabel, achievement, target, adjusted_target, percent_applied,
  proration_factor, percentage, remaining, status.
- Row guard: `REPORT_EXPORT_SYNC_MAX_ROWS` (env, default 20000) over the **grouped** row count.
  Above it → **422 `EXPORT_TOO_LARGE`** telling the user to narrow the range.
  *(Deviation from the earlier draft: a 202 + background-job path is deferred to 1b because the
  codebase has no generic job runner; grouped rows rarely approach the limit.)*
- **Formula injection:** every string cell starting with `= + - @ \t \r` gets a `'` prefix
  (labels, names, filter descriptions, warning text).
- Export writes an activity log entry (`report_builder.export`).

---

## 12. Frontend (`/reports/builder`)

- Desktop ≥1280: two columns — preview left, fixed config rail right (`lg:grid-cols-[minmax(0,1fr)_360px]`).
- <1280 / mobile: rail becomes the standard right-side slide-in drawer (§ui-ux filter drawer
  rules: backdrop blur, one column, staged apply only for filters).
- Preview: 4 summary cards (Achievement, Target, % of target, Remaining) + table; `<lg` becomes
  the accordion list. Skeleton mirrors the real table (5 rows, same column count).
- Config: metric select, dimension select, `DateRangePicker`, filters (`EntitySelector` for
  retailer/RSO/route), target source select, custom value / percent input, sort.
  Selecting an invalid metric/dimension pair is impossible — options come from `/options`.
- Live refresh: 400 ms debounce + `AbortController` cancelling the in-flight request; stale
  responses never overwrite newer ones. Aborting is silent (no error toast).
- Target breakdown line under the target control:
  `100 → 80% = 80 → 15/30 days = 40` (rendered only when percent/proration apply).
- Notices: `TARGET_MISSING_MONTH`, `ROUTE_ATTRIBUTION_CURRENT`, `FILTER_IDS_OUT_OF_SCOPE`
  render as inline badges/notes above the table, and the same text lands in Excel.
- Nav: `Reports → Report Builder` leaf. `GA Report Builder` moves under
  `Reports → Legacy` with a **"Replaced by Report Builder"** badge.
  `ReportsSheet.tsx` is rewritten to derive its items from `navItems` (the duplicate list is
  already out of sync — `itopup-details` exists in one and not the other).
- Bilingual `en` + `bn` namespace `report_builder`, `PageGuideModal pageKey="report_builder"`,
  `DynamicPageTitle` via nav registration, 375/768/1280 checks.

---

## 13. Permissions & plan modules

New permission module `report_builder`:
`report_builder.view`, `.create`, `.edit`, `.delete`, `.export`, `.send`, `.target.manage`
(each enforced on its own endpoint; hiding a button is never the enforcement).

Registration:
- `backend/config/permissions.json` → module + default role grants (view/export for
  admin/manager, view for supervisor/RSO).
- `backend/config/modules.py` → `PATH_TO_MODULE` `("/api/v1/report-builder", "report_builder")`,
  `MODULE_KEYS`, `MODULE_LEAF_ROUTES["report_builder"] = ("/reports/builder",)`,
  `LEAF_TO_API_PREFIXES`.
- `frontend/src/lib/constants.ts` → nav entry (drives plan modal + `DynamicPageTitle`).

---

## 14. Phases

| Phase | Content |
|---|---|
| **1a** | engine registries (5 metrics, 6 dimensions) + `POST /query` + `/options` + `/reports/builder` page + Excel. Target sources: `house`, `none`, `custom`. |
| **1b** | `rso`/`bp`/`supervisor` target resolution, percent + proration + largest-remainder, `saved_templates` (save/load/share/duplicate/import/export, `schema_version`), background export job. |
| **2** | `retailer_targets` table + sheet import + `retailer_custom` source; `X × date` grouping. |
| **3** | schedules + WhatsApp/Telegram delivery (`template_id`). |
| **4** | migrate `target_achievement_service`, `activation_report_service`, `recharge_report_service`, `ga_live_service` onto the engine; add rule-engine exclusions + full status parity. |

**Gate:** no phase starts until `cd frontend && npm run lint`, `cd frontend && npx tsc --noEmit`
and `cd backend && python -m pytest -q` are all green.

---

## 15. Tests (backend)

| Area | Test |
|---|---|
| metric × dimension | one test per metric (5) covering rso/date grouping and the summary==Σ rows invariant |
| null buckets | retailer without owner → null-bucket row, no data loss |
| source × group_by | incompatible pair → 422 `TARGET_SOURCE_INCOMPATIBLE` |
| metric × source | `c2s` + `house` → 422 `TARGET_SOURCE_UNAVAILABLE_FOR_METRIC` |
| group_by | `["rso","date"]` → 422 `GROUP_BY_MULTI_UNSUPPORTED`; `[]` → 422 validation |
| house target | full month = target row; multi-month = Σ months; missing month → 0 + warning |
| custom × date, proration off (1a) | every row shows the full literal, `percentage: null`, `status: not_applicable`; `summary.target == literal == any row.target` |
| target 0 | `percentage: null`, `status: no_target` |
| status | boundary 100.0/99.9/70.0/69.9/40.0/39.9 + finished-period branch |
| scope | supervisor sees only team retailers; out-of-scope filter → empty + `FILTER_IDS_OUT_OF_SCOPE`; other-house → 403 |
| tenancy | `house_id` in body → 422; cross-house filter id → 403 |
| export | header block + warning rows; formula-injection prefix; `EXPORT_TOO_LARGE` |
| determinism | same input twice → identical order and values |

Phase 1b adds: multi-month proration, `100/3` largest-remainder invariant, percent arithmetic
and range rejection, template validation/oversize/schema versions, template sharing and
`TEMPLATE_FILTER_IDS_MISSING`, export-job scope re-check and 24 h retention (`EXPORT_EXPIRED`).

---

## 16. Known risks

1. **Route drift** on iTopUp metrics — no route snapshot in `itopup_details`; warning only.
2. **BP attribution** is fragile (`assisted_retailer_code` + iTopUp SR). The engine never
   re-implements it; it reads `retailers.employee_id`, which the self-healing migrations keep
   correct. Phase 1b validates BP targets against the sanity query in `domain-rules.md`.
3. **Two builders coexist** until Phase 4 — mitigated by the `Reports → Legacy` group + badge.
4. **Rule-engine exclusions not applied** (see §2) — numbers can differ slightly from legacy
   dashboards; parity arrives in Phase 4.
