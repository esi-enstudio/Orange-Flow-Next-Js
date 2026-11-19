# Live C2C Base RSO Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a house is selected on `/reports/live-c2c`, auto-load the house's active RSOs with their current-month productivity targets from the database.

**Architecture:** One house-scoped read endpoint returns active RSOs joined (in Python) with that month's `rso_targets`; the page fetches it on house selection and renders the same report columns as the generated report (transaction-derived columns show `—`) while no workbook preview report is active. The existing upload/preview flow is untouched.

**Tech Stack:** FastAPI + SQLAlchemy (async), Next.js App Router client page, Tailwind CSS, shadcn/ui conventions, i18n `en`/`bn`.

**Spec:** `docs/superpowers/specs/2026-11-19-live-c2c-base-report-design.md`

## Global Constraints

- Every query is house-scoped (`house_id`) and served only for an accessible `X-House-ID` house.
- Permission: `reports.view` **or** `itopup.view`; never trust the frontend.
- Current month = 1st day of the current **BST** month (`now_naive()`), never UTC.
- All user-visible copy exists in both `en` and `bn`.
- No new test runner/framework; frontend verification is lint + `tsc` + manual responsive check.
- No change to `preview_live_c2c_import`, `/reports/live-c2c/preview`, `/reports/live-c2c/import`, diagnostics, mismatch export, or upload UI.
- Table cell classes follow the project standard (`px-2 py-1` desktop); mobile uses one-at-a-time accordion.
- Touch targets are at least 44x44; no horizontal page scroll at 375px.

## Review Focus

- **House with zero active RSOs** — must show the empty state, never an error or a blank table.
- **Active RSO with no target row for the month** — must still appear, with `0` for both targets.
- **Target row from a previous month** — must be ignored for the current month.
- **House switch while a request is in flight** — the old house's rows must never render for the new house.
- **Missing employee name / DMS code / iTop number** — the row still renders; name falls back to DMS code, and blank cells show `—`.

---

### Task 1: Backend endpoint + plan-module leaf mapping

**Files:**
- Create: `backend/tests/test_live_c2c_base_report.py`
- Modify: `backend/app/routers/reports.py` (insert between `get_live_c2c_rsos` and `get_live_c2c_rows`, around line 516)
- Modify: `backend/config/modules.py:324` (`LEAF_TO_API_PREFIXES["/reports/live-c2c"]`)
- Modify: `backend/tests/test_plan_modules_parity.py:136-138`

**Interfaces:**
- Consumes: `Employee`, `RSOTarget`, `House`, `now_naive`, `require_house_context`, `has_any_permission`, `_assert_house_access` (all already imported/defined in `reports.py`).
- Produces: `GET /api/reports/live-c2c/rsos` ->
  `{"success": true, "data": {"target_date": "YYYY-MM-01", "rows": [{"employee_id": int, "house_code": str, "dms_code": str|null, "rso_name": str, "rso_itop_number": str|null, "productivity_c2c_tgt": float, "productivity_trans_tgt": float}]}}`

- [x] **Step 1: Write the failing tests**

Create `backend/tests/test_live_c2c_base_report.py` (the test folder is not a package, so keep the small client/user helpers local to this file, mirroring `tests/test_live_c2c_rso_list.py`):

```python
import httpx
from datetime import date
from fastapi import FastAPI

from app.models.employee import Employee
from app.models.house import House
from app.models.role import Permission, Role
from app.models.rso_target import RSOTarget
from app.models.user import User
from app.routers import reports
from app.routers.deps import get_current_user, get_db
from app.utils.timezone import now_naive


async def _user_with_permissions(db, house, permissions):
    role = Role(name="Base Report Viewer")
    for name in permissions:
        permission = Permission(name=name)
        db.add(permission)
        await db.flush()
        role.permissions.append(permission)
    user = User(
        username=f"base-report-{len(permissions)}",
        hashed_password="x",
        name="Base Report Tester",
        status="Active",
    )
    user.roles.append(role)
    user.houses.append(house)
    db.add(user)
    await db.commit()
    return user


def _client(db, user):
    app = FastAPI()
    app.include_router(reports.router)

    async def override_db():
        yield db

    async def override_user():
        return user

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = override_user
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
    )


def _current_month() -> date:
    today = now_naive().date()
    return date(today.year, today.month, 1)


def _previous_month() -> date:
    first = _current_month()
    if first.month == 1:
        return date(first.year - 1, 12, 1)
    return date(first.year, first.month - 1, 1)


async def test_base_report_lists_active_rsos_with_current_month_targets(db, house):
    other_house = House(code="C2C-OTHER", name="Other House", email="other@example.com")
    db.add(other_house)
    await db.flush()

    babul = Employee(
        house_id=house.id, employee_name="Babul", dms_code="DMS-01",
        itop_number="01700000001", employee_type="rso", status="Active",
    )
    amina = Employee(
        house_id=house.id, employee_name="Amina", dms_code="DMS-02",
        itop_number="01700000002", employee_type="rso", status="Active",
    )
    db.add_all([
        babul,
        amina,
        Employee(
            house_id=house.id, employee_name=None, dms_code="DMS-03",
            itop_number=None, employee_type="rso", status="Active",
        ),
        Employee(
            house_id=house.id, employee_name="Former", dms_code="DMS-04",
            employee_type="rso", status="Resigned",
        ),
        Employee(
            house_id=house.id, employee_name="BP", dms_code="DMS-BP",
            employee_type="bp", status="Active",
        ),
        Employee(
            house_id=other_house.id, employee_name="Foreign", dms_code="DMS-OTHER",
            employee_type="rso", status="Active",
        ),
    ])
    await db.flush()
    db.add_all([
        RSOTarget(
            house_id=house.id, employee_id=babul.id, target_date=_current_month(),
            productivity_c2c_tgt=120.0, productivity_trans_tgt=60.0,
        ),
        RSOTarget(
            house_id=house.id, employee_id=amina.id, target_date=_previous_month(),
            productivity_c2c_tgt=999.0, productivity_trans_tgt=999.0,
        ),
        RSOTarget(
            house_id=other_house.id, employee_id=amina.id, target_date=_current_month(),
            productivity_c2c_tgt=777.0, productivity_trans_tgt=777.0,
        ),
    ])
    await db.commit()
    user = await _user_with_permissions(db, house, ("reports.view",))

    async with _client(db, user) as client:
        response = await client.get(
            "/api/reports/live-c2c/rsos",
            headers={"X-House-ID": str(house.id)},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["target_date"] == _current_month().isoformat()
    assert body["data"]["rows"] == [
        {
            "employee_id": babul.id,
            "house_code": house.code,
            "dms_code": "DMS-01",
            "rso_name": "Babul",
            "rso_itop_number": "01700000001",
            "productivity_c2c_tgt": 120.0,
            "productivity_trans_tgt": 60.0,
        },
        {
            "employee_id": amina.id,
            "house_code": house.code,
            "dms_code": "DMS-02",
            "rso_name": "Amina",
            "rso_itop_number": "01700000002",
            "productivity_c2c_tgt": 0.0,
            "productivity_trans_tgt": 0.0,
        },
        {
            "employee_id": body["data"]["rows"][2]["employee_id"],
            "house_code": house.code,
            "dms_code": "DMS-03",
            "rso_name": "DMS-03",
            "rso_itop_number": None,
            "productivity_c2c_tgt": 0.0,
            "productivity_trans_tgt": 0.0,
        },
    ]


async def test_base_report_returns_empty_list_for_house_with_no_active_rsos(db, house):
    db.add(Employee(
        house_id=house.id, employee_name="Former", dms_code="DMS-OLD",
        employee_type="rso", status="Resigned",
    ))
    await db.commit()
    user = await _user_with_permissions(db, house, ("reports.view",))

    async with _client(db, user) as client:
        response = await client.get(
            "/api/reports/live-c2c/rsos",
            headers={"X-House-ID": str(house.id)},
        )

    assert response.status_code == 200
    assert response.json()["data"]["rows"] == []


async def test_base_report_keeps_rows_with_missing_identity_fields(db, house):
    employee = Employee(
        house_id=house.id, employee_name=None, dms_code=None,
        itop_number=None, employee_type="rso", status="Active",
    )
    db.add(employee)
    await db.commit()
    user = await _user_with_permissions(db, house, ("reports.view",))

    async with _client(db, user) as client:
        response = await client.get(
            "/api/reports/live-c2c/rsos",
            headers={"X-House-ID": str(house.id)},
        )

    assert response.status_code == 200
    assert response.json()["data"]["rows"] == [
        {
            "employee_id": employee.id,
            "house_code": house.code,
            "dms_code": None,
            "rso_name": "",
            "rso_itop_number": None,
            "productivity_c2c_tgt": 0.0,
            "productivity_trans_tgt": 0.0,
        },
    ]


async def test_base_report_requires_report_permission(db, house):
    user = await _user_with_permissions(db, house, ("todos.view",))

    async with _client(db, user) as client:
        response = await client.get(
            "/api/reports/live-c2c/rsos",
            headers={"X-House-ID": str(house.id)},
        )

    assert response.status_code == 403


async def test_base_report_rejects_unassigned_house(db, house):
    other_house = House(code="C2C-FOREIGN", name="Foreign House", email="foreign@example.com")
    db.add(other_house)
    await db.commit()
    user = await _user_with_permissions(db, house, ("itopup.view",))

    async with _client(db, user) as client:
        response = await client.get(
            "/api/reports/live-c2c/rsos",
            headers={"X-House-ID": str(other_house.id)},
        )

    assert response.status_code == 403
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd backend && python -m pytest -q tests/test_live_c2c_base_report.py`
Expected: FAIL with 404 (route not found) on the first test.

- [x] **Step 3: Implement the endpoint in `backend/app/routers/reports.py`**

Insert immediately before `@router.get("/reports/live-c2c")`:

```python
@router.get("/reports/live-c2c/rsos")
async def get_live_c2c_base_report(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_any_permission(["reports.view", "itopup.view"])),
    house_id: int = Depends(require_house_context),
):
    _assert_house_access(current_user, house_id)
    house = await db.scalar(select(House).where(House.id == house_id))
    if house is None:
        raise HTTPException(status_code=404, detail="live_c2c_house_not_found")

    today = now_naive().date()
    target_date = date(today.year, today.month, 1)

    rso_result = await db.execute(
        select(Employee)
        .where(
            Employee.house_id == house_id,
            Employee.employee_type == "rso",
            Employee.status == "Active",
        )
        .order_by(Employee.dms_code, Employee.id)
    )
    rsos = rso_result.scalars().all()

    target_result = await db.execute(
        select(RSOTarget).where(
            RSOTarget.house_id == house_id,
            RSOTarget.target_date == target_date,
        )
    )
    targets = {
        target.employee_id: (
            float(target.productivity_c2c_tgt or 0.0),
            float(target.productivity_trans_tgt or 0.0),
        )
        for target in target_result.scalars().all()
    }

    return {
        "success": True,
        "data": {
            "target_date": target_date.isoformat(),
            "rows": [
                {
                    "employee_id": employee.id,
                    "house_code": house.code,
                    "dms_code": employee.dms_code,
                    "rso_name": employee.employee_name or employee.dms_code or "",
                    "rso_itop_number": employee.itop_number,
                    "productivity_c2c_tgt": targets.get(employee.id, (0.0, 0.0))[0],
                    "productivity_trans_tgt": targets.get(employee.id, (0.0, 0.0))[1],
                }
                for employee in rsos
            ],
        },
    }
```

- [x] **Step 4: Map the new path to the Live C2C plan leaf**

In `backend/config/modules.py`, change the leaf prefix tuple (line ~324):

```python
"/reports/live-c2c": ("/api/itopup-details", "/api/reports/live-c2c"),
```

Update the existing assertion in `backend/tests/test_plan_modules_parity.py`:

```python
def test_live_c2c_leaf_uses_reports_api_scope():
    assert LEAF_OWNER["/reports/live-c2c"] == "reports"
    assert LEAF_TO_API_PREFIXES["/reports/live-c2c"] == (
        "/api/itopup-details",
        "/api/reports/live-c2c",
    )
```

- [x] **Step 5: Run the backend tests**

Run: `cd backend && python -m pytest -q tests/test_live_c2c_base_report.py tests/test_plan_modules_parity.py tests/test_module_coverage.py tests/test_live_c2c_rso_list.py`
Expected: all PASS.

- [x] **Step 6: Commit**

```bash
git add backend/tests/test_live_c2c_base_report.py backend/app/routers/reports.py backend/config/modules.py backend/tests/test_plan_modules_parity.py
git commit -m "feat(live-c2c): expose active RSO base report with month targets"
```

---

### Task 2: Frontend auto-loaded base report

**Files:**
- Modify: `frontend/src/app/reports/live-c2c/page.tsx`
- Modify: `frontend/src/i18n/translations.ts` (both `live_c2c` blocks: en ~line 6867, bn ~line 13989)

**Interfaces:**
- Consumes: `GET /reports/live-c2c/rsos` from Task 1.
- Produces: nothing consumed by later tasks.

- [x] **Step 1: Add the base report types, validator, state, and fetch effect**

Near the existing `LiveC2CProductivityRow` interface, add:

```tsx
interface LiveC2CBaseReportRow {
  employee_id: number;
  house_code: string;
  dms_code: string | null;
  rso_name: string;
  rso_itop_number: string | null;
  productivity_c2c_tgt: number;
  productivity_trans_tgt: number;
}

const BASE_REPORT_COLUMNS = [
  "serial_number",
  "house_code",
  "dms_code",
  "rso_name",
  "rso_itop_number",
  "productivity_c2c_tgt",
  "productivity_trans_tgt",
] as const;

function isBaseReportRow(value: unknown): value is LiveC2CBaseReportRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.employee_id === "number"
    && typeof row.house_code === "string"
    && (typeof row.dms_code === "string" || row.dms_code === null)
    && typeof row.rso_name === "string"
    && (typeof row.rso_itop_number === "string" || row.rso_itop_number === null)
    && typeof row.productivity_c2c_tgt === "number"
    && Number.isFinite(row.productivity_c2c_tgt)
    && typeof row.productivity_trans_tgt === "number"
    && Number.isFinite(row.productivity_trans_tgt)
  );
}

function baseReportCellText(
  column: (typeof BASE_REPORT_COLUMNS)[number],
  row: LiveC2CBaseReportRow,
  index: number,
  formatNumber: (value: number) => string,
): string {
  switch (column) {
    case "serial_number":
      return formatNumber(index + 1);
    case "house_code":
      return row.house_code || "—";
    case "dms_code":
      return row.dms_code || "—";
    case "rso_name":
      return row.rso_name || "—";
    case "rso_itop_number":
      return row.rso_itop_number || "—";
    case "productivity_c2c_tgt":
      return formatNumber(row.productivity_c2c_tgt);
    case "productivity_trans_tgt":
      return formatNumber(row.productivity_trans_tgt);
  }
}
```

Add state beside `reportRows`:

```tsx
const [baseRows, setBaseRows] = useState<LiveC2CBaseReportRow[] | null>(null);
const [baseLoading, setBaseLoading] = useState(false);
const [baseError, setBaseError] = useState(false);
const hasPreviewReport = previewing || matchReport !== null || reportRows !== null;
```

Add the effect after the houses-loading effect:

```tsx
useEffect(() => {
  if (authLoading || !canView || selectedHouseId === null) {
    setBaseRows(null);
    setBaseLoading(false);
    setBaseError(false);
    return;
  }

  const controller = new AbortController();
  setBaseRows(null);
  setBaseLoading(true);
  setBaseError(false);

  apiClient.get<{
    success: boolean;
    data: { target_date: string; rows: unknown };
  }>("/reports/live-c2c/rsos", {
    headers: { "X-House-ID": String(selectedHouseId) },
    signal: controller.signal,
  }).then(({ data }) => {
    const rows = data?.data?.rows;
    if (!Array.isArray(rows) || !rows.every(isBaseReportRow)) {
      throw new Error("invalid_base_report");
    }
    setBaseRows(rows);
  }).catch(() => {
    if (!controller.signal.aborted) setBaseError(true);
  }).finally(() => {
    if (!controller.signal.aborted) setBaseLoading(false);
  });

  return () => controller.abort();
}, [authLoading, canView, selectedHouseId]);
```

- [x] **Step 2: Render the base report in the mobile region**

In the `lg:hidden` region, replace the `reportRows === null ? ...` branch so that, when there is no preview report, it shows base loading / error / empty / rows:

```tsx
) : reportRows === null ? (
  matchReport ? null : baseLoading ? (
    Array.from({ length: 5 }, (_, index) => (
      <div key={`base-skeleton-${index}`} aria-hidden="true"
        className="h-16 animate-pulse rounded-xl border border-gray-200 bg-gray-100 dark:border-slate-700 dark:bg-slate-800" />
    ))
  ) : baseError ? (
    <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
      {t("live_c2c.base_report_error")}
    </p>
  ) : baseRows === null || baseRows.length === 0 ? (
    <p role="status" className="rounded-xl border border-gray-200 bg-white px-3 py-4 text-center text-sm text-gray-500 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-400">
      {t("live_c2c.no_active_rsos")}
    </p>
  ) : (
    baseRows.map((row, index) => {
      const isExpanded = expandedRowId === row.employee_id;
      return (
        <article key={row.employee_id}
          className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <button type="button" aria-expanded={isExpanded}
            aria-label={t(isExpanded ? "live_c2c.hide_details" : "live_c2c.show_details")}
            onClick={() => setExpandedRowId(isExpanded ? null : row.employee_id)}
            className="flex min-h-11 w-full items-center justify-between gap-3 p-3 text-left cursor-pointer">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                {formatNumber(index + 1)}. {row.rso_name || "—"}
              </span>
              <span className="mt-1 block truncate text-xs text-gray-500 dark:text-gray-400">
                {row.dms_code ?? "—"} · {row.rso_itop_number ?? "—"}
              </span>
            </span>
            <ChevronDown aria-hidden="true"
              className={`size-4 shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
          </button>
          {isExpanded && (
            <dl className="grid grid-cols-1 gap-3 border-t border-gray-200 px-3 py-3 text-sm sm:grid-cols-2 dark:border-slate-700">
              {["house_code", "productivity_c2c_tgt", "productivity_trans_tgt"].map((column) => (
                <div key={column} className="min-w-0">
                  <dt className="text-xs text-gray-500 dark:text-gray-400">
                    {t(`live_c2c.report_columns.${column}`)}
                  </dt>
                  <dd className="mt-1 break-words text-gray-900 dark:text-gray-100">
                    {baseReportCellText(column as (typeof BASE_REPORT_COLUMNS)[number], row, index, formatNumber)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </article>
      );
    })
  )
) : (
```

Leave the existing `reportRows.length === 0` and `reportRows.map(...)` branches unchanged after this.

- [x] **Step 3: Render the base report in the desktop table**

In the `lg:block` table, replace the `reportRows === null ? ...` body branch similarly. Use `BASE_REPORT_COLUMNS` for the base table header/body, while the preview table keeps `REPORT_COLUMNS`:

```tsx
{previewing ? (
  // existing skeleton rows keyed off REPORT_COLUMNS
) : reportRows === null ? (
  matchReport ? (
    // unchanged empty row
  ) : baseLoading ? (
    Array.from({ length: 5 }, (_, rowIndex) => (
      <tr key={`base-skeleton-${rowIndex}`} aria-hidden="true">
        {BASE_REPORT_COLUMNS.map((column) => (
          <td key={column} className="border border-gray-200 px-2 py-1 dark:border-slate-700">
            <div className="h-4 w-4/5 animate-pulse rounded bg-gray-100 dark:bg-slate-800" />
          </td>
        ))}
      </tr>
    ))
  ) : baseError ? (
    <tr>
      <td colSpan={BASE_REPORT_COLUMNS.length}
        className="border border-gray-200 px-2 py-1 text-center text-red-600 dark:border-slate-700 dark:text-red-300">
        {t("live_c2c.base_report_error")}
      </td>
    </tr>
  ) : baseRows === null || baseRows.length === 0 ? (
    // existing "no active RSOs" row, colSpan={BASE_REPORT_COLUMNS.length}
  ) : (
    baseRows.map((row, index) => (
      <tr key={row.employee_id} className="even:bg-gray-50 dark:even:bg-slate-800/50">
        {BASE_REPORT_COLUMNS.map((column) => (
          <td key={column} className="whitespace-nowrap border border-gray-200 px-2 py-1 dark:border-slate-700">
            {baseReportCellText(column, row, index, formatNumber)}
          </td>
        ))}
      </tr>
    ))
  )
) : (
  // existing reportRows empty/table branches unchanged
)}
```

Make the table header pick the matching column list (preview, preview skeleton, and a generated report all use the full list; only the base state uses the short list):

```tsx
{(hasPreviewReport ? REPORT_COLUMNS : BASE_REPORT_COLUMNS).map((column) => (
  // existing <th> markup
))}
```

Keep `min-w-[2100px]` only for the preview table; use `min-w-[900px]` for the base table so the 7 columns do not force excessive horizontal scroll.

```tsx
<table className={`w-full ${hasPreviewReport ? "min-w-[2100px]" : "min-w-[900px]"} border-collapse ...`}>
```

Delete the now-unused `report_prompt` render branches (the key can stay in translations for compatibility).

> **Final implementation note (superseded the 7-column sketch above):** the
> original request was for the base table to keep the *same* columns as the
> generated report, so the shipped table maps `REPORT_COLUMNS` in every state
> (header, skeleton, empty state, rows), uses `min-w-[2100px]` for both, and
> `baseReportCellText` returns `—` for transaction-derived columns until an
> upload preview exists. `BASE_REPORT_COLUMNS` was removed. `report_prompt`
> was deleted from both locales because it became dead copy.

- [x] **Step 4: Add bilingual copy and update the page guide**

In the `en` `live_c2c` block add:

```ts
base_report_error: "The RSO report could not be loaded. Please try again.",
```

In the `bn` `live_c2c` block add:

```ts
base_report_error: "RSO রিপোর্ট লোড করা যায়নি। আবার চেষ্টা করুন।",
```

Update the English guide copy (~line 6977) to:

```ts
overview: "View the selected house's active RSOs and their current-month productivity targets from the database, then generate a temporary productivity report from an uploaded Live C2C workbook.",
notes: {
  n1: { title: "Database base report", desc: "RSO details and current-month targets come from the database. The uploaded workbook only supplies transaction data for the generated report, which is not stored." },
},
```

Apply the equivalent Bangla update in the `bn` guide block.

- [x] **Step 5: Run frontend verification**

Run: `cd frontend && npm run lint`
Expected: 0 errors (pre-existing warnings allowed).

Run: `cd frontend && npx tsc --noEmit`
Expected: no output (clean).

- [x] **Step 6: Manual responsive and behaviour check**

- 375px: base table renders as accordion, one row expands at a time, no horizontal page scroll, 44px touch targets.
- 768px / 1280px: desktop table shows the 7 columns with `px-2 py-1` cells.
- Switch houses quickly: the previous house's rows never appear for the new house.
- After a workbook preview succeeds, the existing full report replaces the base table; diagnostics still show on mismatch.

- [x] **Step 7: Commit**

```bash
git add frontend/src/app/reports/live-c2c/page.tsx frontend/src/i18n/translations.ts
git commit -m "feat(live-c2c): auto-load active RSO base report for selected house"
```

---

### Task 3: Full verification

**Files:** none (verification only)

- [x] **Step 1: Run the backend suite**

Run: `cd backend && python -m pytest -q`
Expected: all tests PASS.

- [x] **Step 2: Run the guard tests**

Run: `cd backend && python -m pytest -q tests/test_entitlement.py tests/test_house_access_guard.py tests/test_tenant_isolation.py tests/test_plan_modules_parity.py tests/test_module_coverage.py`
Expected: all PASS.

- [x] **Step 3: Re-run frontend verification**

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: 0 lint errors, clean types.
