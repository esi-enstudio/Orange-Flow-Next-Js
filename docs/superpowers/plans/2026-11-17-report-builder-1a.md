# Report Builder — Phase 1a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working, permission-controlled report builder that produces GA/C2C/C2S/Balance/SC reports grouped by RSO/BP/supervisor/retailer/route/date against a house target, a literal custom target, or no target, with a live-preview page and an Excel export.

**Architecture:** A backend registry-driven engine (`app/services/report_engine/`) turns `(metric, dimension, filters, target)` into one grouped SQL aggregate, computes target/percentage/status in Python over the aggregated rows, then paginates. A single FastAPI router exposes `query`, `options`, `filter-options` and `export`. The frontend page keeps configuration in a right rail and refreshes the preview with a 400 ms debounce plus `AbortController`.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Pydantic v2, openpyxl (write-only), pytest (asyncio, in-memory SQLite); Next.js 16 App Router, axios `apiClient`, Tailwind + shadcn, framer-motion, `EntitySelector`, `DateRangePicker`, `PageGuideModal`.

**Spec:** [`docs/superpowers/specs/2026-11-17-report-builder-design.md`](../specs/2026-11-17-report-builder-design.md)

## Global Constraints

- `house_id` comes from `X-House-ID`/auth only. A `house_id` field in the body → `422 HOUSE_ID_IN_BODY`.
- Every endpoint checks its own permission: `report_builder.view` (query/options/filter-options), `report_builder.export` (export).
- All user-visible text exists in `en` **and** `bn` (`report_builder` namespace in `translations.ts`).
- Activity log entry for the export mutation.
- Dates display as `DD MMM YYYY`; API/DB stay ISO.
- Tables: `<td className="px-2 py-1">`, subtitles `text-[11px]`, `<lg` accordion.
- Right-side drawer standard for the config rail below `xl`; no inline filter card.
- Status enum exactly: `achieved`, `on_track`, `needs_attention`, `behind`, `no_target`, `not_applicable`.
- Phase 1 accepts exactly one `group_by`; `len > 1` → `422 GROUP_BY_MULTI_UNSUPPORTED`.
- Percent/proration are **not** implemented in 1a: non-default values → `422 VALIDATION_ERROR` with `fields.target.percent` / `fields.target.proration`.
- Verification: `cd frontend && npm run lint`, `cd frontend && npx tsc --noEmit`, `cd backend && python -m pytest -q`.

## Review Focus

- A retailer with no owning employee, or an employee with no supervisor: the row must land in a null bucket and totals must still equal the house total.
- Only one `X-House-ID` worth of data ever leaves the API, even when a filter list contains ids from another house.
- A supervisor's report must never show another team's retailers.
- `target = 0` / `target = null` must never produce an exception or `0.0%`.
- Excel cells containing a retailer/RSO name starting with `=` must be escaped, not executed.

---

### Task 1: Status engine

**Files:**
- Create: `backend/app/services/report_engine/__init__.py`
- Create: `backend/app/services/report_engine/status.py`
- Test: `backend/tests/test_report_engine_status.py`

**Interfaces:**
- Produces:
  - `ACHIEVED_MIN_PCT: float = 100.0`, `ON_TRACK_MIN_PCT: float = 70.0`, `NEEDS_ATTENTION_MIN_PCT: float = 40.0`
  - `STATUS_VALUES: tuple[str, ...]`
  - `month_start_of(d: date) -> date`
  - `days_in_month(month_start: date) -> int`
  - `compute_status(*, percentage: float | None, target: float | None, date_from: date, date_to: date, today: date) -> str`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_report_engine_status.py
from datetime import date
from app.services.report_engine.status import compute_status, days_in_month, month_start_of

TODAY = date(2026, 11, 20)

def test_finished_period_uses_raw_thresholds():
    assert compute_status(percentage=100.0, target=10, date_from=date(2026,10,1), date_to=date(2026,10,31), today=TODAY) == "achieved"
    assert compute_status(percentage=99.9, target=10, ...
    # 99.9 -> on_track, 70.0 -> on_track, 69.9 -> needs_attention, 40.0 -> needs_attention, 39.9 -> behind

def test_running_period_first_seven_days_uses_raw_thresholds():
    # date_to = 2026-11-20 but "today" 2026-11-05 => reference day 5 => raw
    ...

def test_running_period_uses_pace():
    # today 2026-11-20, date_to 2026-11-30 -> time_pct 66.67
    # 80 -> on_track, 40 -> needs_attention (>= 33.3), 20 -> behind

def test_none_and_zero_targets():
    assert compute_status(percentage=None, target=None, ...) == "not_applicable"
    assert compute_status(percentage=50.0, target=0, ...) == "no_target"

def test_month_helpers():
    assert month_start_of(date(2026, 2, 17)) == date(2026, 2, 1)
    assert days_in_month(date(2024, 2, 1)) == 29
    assert days_in_month(date(2026, 2, 1)) == 28
```

- [ ] **Step 2: Run** `cd backend && python -m pytest -q tests/test_report_engine_status.py` — expect ImportError.
- [ ] **Step 3: Implement `status.py`** — if `target is None` → `not_applicable`; `target <= 0` → `no_target`; `percentage is None` → `not_applicable`; if `date_to < today` or `min(today, date_to).day <= 7` → raw thresholds; otherwise `time_pct = day / days_in_month * 100`, `>=100` achieved, `>=time_pct` on_track, `>=time_pct/2` needs_attention, else behind.
- [ ] **Step 4: Run the test file** — expect PASS.
- [ ] **Step 5: Commit** `feat(report-engine): add status resolver`

---

### Task 2: Metric and dimension registries

**Files:**
- Create: `backend/app/services/report_engine/metrics.py`
- Create: `backend/app/services/report_engine/dimensions.py`
- Test: `backend/tests/test_report_engine_registry.py`

**Interfaces:**
- Produces in `metrics.py`:

```python
@dataclass(frozen=True)
class MetricDefinition:
    key: str
    label_en: str
    label_bn: str
    model: type
    date_column: str
    value_type: str                 # "count" | "amount"
    sum_column: str | None          # None => COUNT(*)
    row_filters: tuple[tuple[str, str], ...]   # e.g. (("report_type", "C2C"),)
    target_columns: Mapping[str, str]          # source kind -> column name

METRICS: dict[str, MetricDefinition]
def get_metric(key: str) -> MetricDefinition | None
def supports_target_source(metric_key: str, source: str) -> bool
```

Metric rows (exact): `ga_activation` (Activation, `activation_date`, count, target house → `total_ga_target`), `c2c` (ITopUpDetail, `report_date`, amount, `daily_value`, filter `report_type=C2C`, house → `ev_c2c_target`), `c2s` (same table, `report_type=C2S`, no house target), `balance` (`report_type=Balance`, no house target), `sc_issue` (ScratchCardIssue, `issue_date`, `quantity`, count, house → `sc_primary_target`).

- Produces in `dimensions.py`:

```python
@dataclass(frozen=True)
class DimensionDefinition:
    key: str
    label_en: str
    label_bn: str
    requires_retailer: bool

DIMENSIONS: dict[str, DimensionDefinition]   # rso, bp, supervisor, retailer, route, date
def get_dimension(key: str) -> DimensionDefinition | None
def valid_group_by(source: str, dimension: str) -> bool   # the spec §4 matrix
```

`valid_group_by` returns: `house`/`custom`/`none` → all six; `rso` → rso, retailer, route, date; `bp` → bp, retailer, date; `supervisor` → supervisor, retailer, date; `retailer_custom` → retailer, date.

- [ ] **Step 1: Write failing tests**

```python
def test_every_metric_has_consistent_labels_and_types(): ...
def test_metric_target_availability(): 
    # c2s/balance have no "house" column; ga/c2c/sc do
def test_matrix(): 
    # ("rso","bp") False, ("house","route") True, ("supervisor","rso") False, ("custom", d) True for all d
```

- [ ] **Step 2: Run** → FAIL (module missing).
- [ ] **Step 3: Implement both registries** (plain dicts/dataclasses; no DB, no SQL).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(report-engine): add metric and dimension registries`

---

### Task 3: Period target resolution

**Files:**
- Create: `backend/app/services/report_engine/targets.py`
- Test: `backend/tests/test_report_engine_targets.py`

**Interfaces:**
- Produces:

```python
@dataclass(frozen=True)
class PeriodTarget:
    target: float | None
    adjusted_target: float | None
    percent_applied: float | None
    proration_factor: float | None
    missing_months: int

async def resolve_period_target(
    db: AsyncSession, *, source: str, metric_key: str, house_id: int,
    date_from: date, date_to: date, custom_value: float | None,
) -> PeriodTarget
```

- `none` → all `None`, `missing_months=0`.
- `custom` → `target=custom_value`, `adjusted_target=custom_value`; `custom_value is None` → `ValueError("TARGET_VALUE_REQUIRED")`; negative → `ValueError("TARGET_VALUE_INVALID")`.
- `house` → `Σ` of the house target column for every calendar month intersecting the range; a month with no row adds 0 and increments `missing_months`. Metric without a house column → `ValueError("TARGET_SOURCE_UNAVAILABLE_FOR_METRIC")`.
- `rso`/`bp`/`supervisor`/`retailer_custom` → `ValueError("TARGET_SOURCE_NOT_AVAILABLE")` (1b/2).

- [ ] **Step 1: Write failing tests** — full month equals the row value; `2026-10-01..2026-11-30` equals the sum of both months; missing November row → target = October only + `missing_months == 1`; `c2s + house` raises; `custom -1` raises; `custom None` raises; `none` returns `None`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** using `HouseTarget` + `month_start_of`/`days_in_month` from `status.py`; iterate months with a `while` loop rather than arithmetic on day numbers.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(report-engine): resolve house/custom/none period targets`

---

### Task 4: Data-permission scope

**Files:**
- Create: `backend/app/services/report_engine/scope.py`
- Test: `backend/tests/test_report_engine_scope.py`

**Interfaces:**
- Produces:

```python
@dataclass(frozen=True)
class DataScope:
    unrestricted: bool          # admin / manager / house manager
    condition: object | None    # SQLAlchemy condition on Retailer, None when unrestricted
    warning: str | None         # None in 1a

async def resolve_data_scope(db: AsyncSession, user, house_id: int) -> DataScope
```

- admin/manager/house_manager → `unrestricted=True`.
- user with `employee_profile` and a supervisor-ish role → `Retailer.employee_id.in_(select(SupervisorRSOAssignment.member_employee_id).where(supervisor_employee_id == emp.id))`.
- user with `employee_profile` (RSO/BP/other) → `Retailer.employee_id == emp.id`.
- user matching a retailer by `contact_no == user.phone_number` → `Retailer.id == retailer.id`.
- otherwise → fail-closed `Retailer.id.is_(None)`.

- [ ] **Step 1: Write failing tests** — build house/employees/retailers, then assert: manager sees 4 retailers; supervisor scope condition selects only their members' retailers; RSO scope selects only own; unknown user selects none.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (mirror `app/utils/access_control.py` semantics, async version; do not import the sync `AccessControl`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(report-engine): add async data-permission scope`

---

### Task 5: Query engine

**Files:**
- Create: `backend/app/services/report_engine/engine.py`
- Test: `backend/tests/test_report_engine_query.py`

**Interfaces:**
- Consumes: `METRICS`, `DIMENSIONS`, `resolve_period_target`, `resolve_data_scope`, `compute_status`.
- Produces:

```python
@dataclass(frozen=True)
class ReportFilter:
    retailer_ids: tuple[int, ...] = ()
    employee_ids: tuple[int, ...] = ()
    route_codes: tuple[str, ...] = ()

@dataclass(frozen=True)
class ReportRequest:
    metric: str
    date_from: date
    date_to: date
    group_by: str
    filters: ReportFilter
    target_source: str
    custom_value: float | None
    sort_field: str
    sort_order: str
    page: int
    per_page: int

async def run_report(db: AsyncSession, *, user, house_id: int, req: ReportRequest) -> dict
```

Return shape: `{"data": [...], "summary": {...}, "pagination": {...}, "meta": {...}, "warnings": [...], "all_rows": [...]}` where `all_rows` is the unpaginated list (consumed by the Excel task).

Rules:
- Grouped SQL: `select(key_expr, label_expr, sublabel_expr, agg)` over the metric model, `outerjoin(Retailer, Retailer.id == model.retailer_id)`, dimension joins, `WHERE house_id AND date range AND metric row_filters AND scope.condition AND filters`, `GROUP BY` the three expressions.
- `date` dimension: group by the date column, label formatted `%d %b %Y` in Python.
- `bp` dimension: key/label are `CASE WHEN Employee.employee_type = 'bp' THEN Employee.id END`; `rso` uses the owner id; `supervisor` joins `SupervisorRSOAssignment` (member) then the supervisor employee; `route` uses `model.route_code` when the metric model has the attribute, else `RetailerRoute` (primary, active, effective at `date_to`) + `Route`.
- `is_null_bucket` is `key is None`.
- Amounts `round(x, 2)`; counts `int`.
- Target: one `resolve_period_target` call per request; `None` source → `target=None`, `percentage=None`, `status="not_applicable"`.
- `percentage = round(achievement / adjusted_target * 100, 1)` when `adjusted_target` truthy; `remaining = max(adjusted_target - achievement, 0)`.
- **Date dimension + proration off** (the only 1a combination): each row keeps the full period target and gets `percentage=None`, `status="not_applicable"`; `meta.row_comparison_suppressed=True`.
- Summary: `achievement = Σ rows`, target = period target, `status = compute_status(...)`, `row_count = len(rows)`.
- Sort before slicing with total ordering on `(key_is_null, sort_field, key, label)`.
- `filter_unknown_house_ids` (used by the router): out-of-scope ids do not error, they narrow to empty and add warning `FILTER_IDS_OUT_OF_SCOPE`; ids from another house raise `ValueError("CROSS_HOUSE_REFERENCE")`.

- [ ] **Step 1: Write failing tests** — seed one house, 2 RSOs, 1 BP, 3 retailers, activations + itopup rows + scratch card rows:
  - each of the 5 metrics grouped by `rso` returns the expected amounts;
  - `date` grouping returns one row per day and `summary.achievement == Σ data.achievement`;
  - retailer without owner appears as `key=None`, `is_null_bucket=True`;
  - `house` target full month → row target equals the seeded `total_ga_target`;
  - custom × date → every row target equals the literal, `percentage is None`, `status == "not_applicable"`;
  - target 0 → `percentage is None`, `status == "no_target"`;
  - pagination slices after sorting (`per_page=2` page 2 holds the third row);
  - run the same request twice → identical JSON.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `engine.py`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(report-engine): add grouped query engine`

---

### Task 6: API router, options, filter options, registration

**Files:**
- Create: `backend/app/schemas/report_engine.py`
- Create: `backend/app/routers/report_builder.py`
- Modify: `backend/main.py` (import + `app.include_router(report_builder_router)`)
- Modify: `backend/config/permissions.json`
- Modify: `backend/config/modules.py`
- Test: `backend/tests/test_report_builder_api.py`

**Interfaces:**
- Schemas: `ReportQueryRequest`, `ReportExportRequest`, `ReportTargetConfig`, `ReportFilterConfig`, `ReportSortConfig` with `model_config = ConfigDict(extra="forbid")` and an explicit `house_id: int | None = None`.
- Router prefix `/api/v1/report-builder`:
  - `POST /query` (`report_builder.view`) → `run_report` result without `all_rows`.
  - `GET /options` (`report_builder.view`) → metrics, dimensions, `matrix`, `statuses`, `export_sync_max_rows`.
  - `GET /filter-options?type=retailer|employee|supervisor|route&search=` (`report_builder.view`) → `[{id|code, label, sublabel}]`, house-scoped, `limit=20`.
  - `POST /export` (`report_builder.export`) — Task 7.
- Error mapping: `TARGET_SOURCE_INCOMPATIBLE` (422, `fields.group_by`), `TARGET_SOURCE_UNAVAILABLE_FOR_METRIC` (422, `fields.target.source`), `GROUP_BY_MULTI_UNSUPPORTED` (422), `TARGET_VALUE_INVALID`/`TARGET_VALUE_REQUIRED` (422), `HOUSE_ID_IN_BODY` (422), `CROSS_HOUSE_REFERENCE` (403). Body shape `{"error": {"code", "message", "fields"}}`.
- Permissions: add module `report_builder` with `view/create/edit/delete/export/send/target.manage`; default role grants — admin/manager: view, export, create, edit, delete; supervisor/rso: view.
- Modules: `PATH_TO_MODULE` entry `("/api/v1/report-builder", "report_builder")` placed **before** nothing conflicting (verify with the coverage test), `"report_builder"` in `MODULE_KEYS`, `MODULE_LEAF_ROUTES["report_builder"] = ("/reports/builder",)`, `LEAF_TO_API_PREFIXES["/reports/builder"] = ("/api/v1/report-builder",)`.

- [ ] **Step 1: Write failing API tests** using `httpx.AsyncClient` + dependency overrides for `get_db`, `get_current_user`, `require_house_context` (follow an existing API test in `backend/tests/` that already overrides those dependencies).
  - valid query → 200 and the documented keys;
  - `house_id` in the body → 422 `HOUSE_ID_IN_BODY`;
  - `group_by: ["rso","date"]` → 422 `GROUP_BY_MULTI_UNSUPPORTED`;
  - `group_by: []` → 422 `VALIDATION_ERROR`;
  - `metric: "c2s"`, `target.source: "house"` → 422 `TARGET_SOURCE_UNAVAILABLE_FOR_METRIC`;
  - `target.percent: 50` in 1a → 422 `VALIDATION_ERROR` with `fields.target.percent`;
  - unknown metric → 422 with `fields.metric`;
  - a filter id belonging to another house → 403 `CROSS_HOUSE_REFERENCE`;
  - `/options` never lists an invalid source×dimension pair.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement schemas + router + registration.**
- [ ] **Step 4: Run** `python -m pytest -q tests/test_report_builder_api.py tests/test_module_coverage.py tests/test_plan_modules_parity.py` → PASS.
- [ ] **Step 5: Commit** `feat(report-builder): add query/options API and module registration`

---

### Task 7: Excel export

**Files:**
- Create: `backend/app/services/report_engine/excel.py`
- Test: `backend/tests/test_report_engine_excel.py`

**Interfaces:**
- Produces: `build_report_workbook(*, meta: dict, rows: list[dict], summary: dict, warnings: list[dict], filters_text: str, generated_by: str) -> bytes`
- `POST /api/v1/report-builder/export` → `Response(media_type=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, headers={"Content-Disposition": 'attachment; filename="report_builder_{metric}_{date_from}_{date_to}.xlsx"'})`, plus `log_activity(module="report_builder", action="export")`.
- Row guard: `settings.REPORT_EXPORT_SYNC_MAX_ROWS` (new settings field, default `20000`); `len(all_rows) > limit` → 422 `EXPORT_TOO_LARGE`.
- Formula-injection escape for every string cell.
- Header block then column header row: Label, Sublabel, Achievement, Target, Adjusted target, Percent applied, Proration factor, Percentage, Remaining, Status.

- [ ] **Step 1: Write failing tests** — load the workbook with `openpyxl.load_workbook(io.BytesIO(...))`:
  - header block contains the metric label, period and target source;
  - one row per warning exists;
  - a retailer named `=HYPERLINK("http://x")` is written as `'=HYPERLINK(...)`;
  - row count equals grouped rows + header height;
  - limit exceeded → 422 `EXPORT_TOO_LARGE` (call the router with a monkeypatched limit of 1).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `excel.py` (write-only workbook) + the export endpoint.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(report-builder): add excel export`

---

### Task 8: Nav, sheet, i18n

**Files:**
- Modify: `frontend/src/lib/constants.ts`
- Modify: `frontend/src/components/layout/ReportsSheet.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`
- Modify: `frontend/src/i18n/translations.ts`

**Interfaces:**
- `NavItem` children gain `badge?: string` on both child levels.
- Reports children become: existing ten items unchanged, plus
  `{ title: "Report Builder", translationKey: "nav.report_builder", href: "/reports/builder", icon: SlidersHorizontal, permission: "report_builder.view" }`
  and a nested group
  `{ title: "Legacy", translationKey: "nav.report_legacy", icon: History, children: [ { title: "GA Report Builder", translationKey: "nav.report_ga_builder", href: "/reports/ga-report-builder", permission: "ga_report_builder.view", badge: "nav.report_ga_builder_legacy_badge" } ] }`.
- Badge renders as `<span title={t(badge)} className="... text-[10px]">` with `t("nav.legacy_replaced_short")` visible; full text `t("nav.report_ga_builder_legacy_badge")` = "Replaced by Report Builder" / "রিপোর্ট বিল্ডার দিয়ে প্রতিস্থাপিত" in `title` and `aria-label`, and as the visible label in `ReportsSheet` (full width there).
- `ReportsSheet` builds its list from `navItems` (flatten the Reports group, unwrap the Legacy group) instead of the hard-coded array; `itopup-details` disappears from it because it is not a nav item.
- `translations.ts` adds `nav.report_builder`, `nav.report_legacy`, `nav.legacy_replaced_short`, `nav.report_ga_builder_legacy_badge`, plus the `report_builder` namespace (keys below) in **both** `en` and `bn`.

- [ ] **Step 1:** Edit `constants.ts` (nav + type).
- [ ] **Step 2:** Rewrite `ReportsSheet.tsx` to derive from `navItems`, keeping icons/permissions/`hasPage` filtering.
- [ ] **Step 3:** Render badges in `Sidebar.tsx` (3rd-level link) and `ReportsSheet.tsx`.
- [ ] **Step 4:** Add translations (en + bn, identical key paths).
- [ ] **Step 5:** Run `npm run lint` and `npx tsc --noEmit` → clean.
- [ ] **Step 6: Commit** `feat(nav): register report builder and move GA builder to legacy`

---

### Task 9: Report builder page

**Files:**
- Create: `frontend/src/app/reports/builder/page.tsx`
- Create: `frontend/src/app/reports/builder/_components/ConfigPanel.tsx`
- Create: `frontend/src/app/reports/builder/_components/PreviewPanel.tsx`

**Interfaces:**
- `page.tsx` owns state and fetching: `useAuth()` (selected house, permissions), `useLanguage()`.
- `ConfigPanel` props: `{ options, value: ConfigState, onChange: (patch: Partial<ConfigState>) => void, filterOptions, onFilterSearch, onExport, canExport, exporting }`.
- `PreviewPanel` props: `{ result: QueryResult | null, loading, error, config, sort, onSort, page, onPage }`.
- Fetch: `POST v1/report-builder/query` with `{ headers: { "X-House-ID": houseId }, signal }`; 400 ms `setTimeout` + `AbortController.abort()` on change/unmount; aborted requests are silent.
- On metric change, if the current dimension/source is invalid for the new metric → reset to the first valid option from `/options`.
- Summary cards: Achievement, Target, % of target, Remaining + status badge.
- Table (`hidden lg:block`) + accordion (`lg:hidden`), skeleton with 5 rows, empty state, pagination window of 5.
- Notices rendered for each `warnings[]` entry (`FILTER_IDS_OUT_OF_SCOPE`, `TARGET_MISSING_MONTH`, `ROUTE_ATTRIBUTION_CURRENT`).
- Target preview line when `percent_applied` or `proration_factor` is present.
- Mobile: config rail is the standard right-side drawer (`fixed inset-y-0 right-0 z-[101] w-full sm:max-w-md`, backdrop blur, one column); desktop `xl:grid xl:grid-cols-[minmax(0,1fr)_360px]`.
- `PageGuideModal pageKey="report_builder"` next to the `<h1>`.
- `AccessDenied` when `!hasPermission("report_builder.view")`.

- [ ] **Step 1:** Build `ConfigPanel.tsx`.
- [ ] **Step 2:** Build `PreviewPanel.tsx` (summary + table + accordion + skeleton).
- [ ] **Step 3:** Build `page.tsx` (state, debounce/abort, options load, export, layout).
- [ ] **Step 4:** `npm run lint` + `npx tsc --noEmit` → clean.
- [ ] **Step 5: Commit** `feat(report-builder): add /reports/builder page`

---

### Task 10: Phase gate

- [ ] `cd frontend && npm run lint` → no errors.
- [ ] `cd frontend && npx tsc --noEmit` → no errors.
- [ ] `cd backend && python -m pytest -q` → all pass.
- [ ] `cd backend && python -m pytest -q tests/test_module_coverage.py tests/test_plan_modules_parity.py tests/test_entitlement.py tests/test_tenant_isolation.py` → all pass.
- [ ] Manual 375 / 768 / 1280 checks; language toggle en↔bn; `<html lang>` flips.
- [ ] Commit `chore(report-builder): phase 1a verification`.

---

## Phase 1b (separate plan after the gate)

`rso`/`bp`/`supervisor` target resolution, percent + proration + largest-remainder (month-by-month, deterministic tie-break), `saved_templates` table + CRUD/share/duplicate/import/export with `schema_version`, `TEMPLATE_FILTER_IDS_MISSING`, async export job with scope re-check + 24 h retention + `EXPORT_EXPIRED`. Written as `2026-11-17-report-builder-1b.md` once Task 10 is green.
