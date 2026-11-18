# Live C2C Mismatch Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show only the rows/values that block a Live C2C import, let the user export them as `.xlsx`, and replace a house's data with a fast delete-plus-bulk-insert on every successful import.

**Architecture:** `prepare_live_c2c_import()` resolves every distinct number and returns a report containing only unresolved values (`not_found` / `ambiguous`). The preview endpoint returns that report instead of a single error; the import endpoint returns 400 with the same report and writes nothing. A successful import deletes the house's rows and bulk-writes the new ones through asyncpg `COPY` (chunked executemany on SQLite tests), inside one transaction.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, asyncpg, pytest (SQLite in-memory), Next.js client component, ExcelJS, existing i18n dictionary.

**Spec:** `docs/superpowers/specs/2026-11-18-live-c2c-mismatch-report-design.md`

## Global Constraints

- House isolation: every query and the delete stay scoped to `house_id`; never `TRUNCATE` the table.
- Permissions: existing `live_c2c.import` for preview/import; new `live_c2c.export` gates the download button only.
- Bilingual: every new user-visible string needs both `en` and `bn` keys in `frontend/src/i18n/translations.ts`.
- Audit: the import keeps logging `module="live_c2c"`, `action="import"`.
- Schema: no migration, no column changes; `is_deleted` stays and new rows always write `False`.
- Backend tests run on in-memory SQLite — the PostgreSQL `COPY` path needs a portable fallback that the tests exercise.
- Do not add new routes, modules, nav items, or test runners.

## Review Focus

- **A workbook whose numbers repeat across many rows** — the report must list one line per distinct value with a row count, not one line per row.
- **A number that exists in another house** — it must never appear as a candidate, and must resolve as `not_found`.
- **A failed insert after the delete** — the previous data must still be there; delete and insert share one transaction.
- **A 20,000-row clean sheet** — import must not slow down linearly with row count or hit the 32,767-bind-parameter limit.
- **A workbook with more than 200 distinct bad numbers** — the response must stay bounded and flag itself as truncated.

---

### Task 1: Diagnostics collection in the service

**Files:**
- Modify: `backend/app/services/live_c2c_service.py` (`prepare_live_c2c_import`, new dataclasses, new `MAX_DIAGNOSTIC_VALUES`/`MAX_DIAGNOSTIC_ROWS` constants near the existing module constants)
- Modify: `backend/tests/test_live_c2c_import.py` (extend imports as the tasks need them: `from decimal import Decimal`, `from sqlalchemy import func, select`, `from conftest import make_house`, `from app.utils.timezone import now_naive`)

**Interfaces:**
- Consumes: existing `_number_candidates`, `_matching_employee_ids`, `_matching_retailer_records`, `_chunks`.
- Produces:
  ```python
  @dataclass(frozen=True)
  class LiveC2CEntityIssue:
      side: str            # "from" | "to"
      value: str
      status: str          # "not_found" | "ambiguous"
      row_count: int
      excel_rows: list[int]
      candidates: list[dict[str, Any]]

  @dataclass(frozen=True)
  class LiveC2CImportCheck:
      rows: list[dict[str, Any]]
      issues: list[LiveC2CEntityIssue]
      summary: dict[str, int]   # total_rows, importable_rows, issue_count, affected_rows
      disabled_retailer_count: int   # resolved retailers with enabled=N (all rows)
      truncated: bool
      can_import: bool

  async def prepare_live_c2c_import(
      db: AsyncSession, *, house_id: int, rows: list[dict[str, Any]]
  ) -> LiveC2CImportCheck
  ```

- [ ] **Step 1: Write the failing tests**

```python
async def test_preview_check_lists_only_unmatched_from_numbers(db, house):
    user = await _user_with_permissions(db, house, ("reports.view", "live_c2c.import"))
    employee, retailer = await _source_entities(db, house)
    rows = [
        {"_row_number": 3, "from_number": employee.itop_number,
         "to_number": retailer.itop_number, "modified_on": "x", "transfer_mrp": 10},
        {"_row_number": 4, "from_number": "01799999999",
         "to_number": retailer.itop_number, "modified_on": "x", "transfer_mrp": 10},
        {"_row_number": 5, "from_number": "01799999999",
         "to_number": retailer.itop_number, "modified_on": "x", "transfer_mrp": 10},
    ]

    check = await live_c2c_service.prepare_live_c2c_import(db, house_id=house.id, rows=rows)

    assert check.can_import is False
    assert [(i.side, i.value, i.status) for i in check.issues] == [
        ("from", "01799999999", "not_found")
    ]
    assert check.issues[0].row_count == 2
    assert check.issues[0].excel_rows == [4, 5]
    assert check.issues[0].candidates == []
    assert check.summary == {
        "total_rows": 3, "importable_rows": 1, "issue_count": 1, "affected_rows": 2,
    }
    assert check.rows == []


async def test_preview_check_is_clean_when_every_row_matches(db, house):
    employee, retailer = await _source_entities(db, house)
    rows = [{"_row_number": 3, "from_number": employee.itop_number,
             "to_number": retailer.itop_number, "modified_on": "x", "transfer_mrp": 10}]

    check = await live_c2c_service.prepare_live_c2c_import(db, house_id=house.id, rows=rows)

    assert check.can_import is True
    assert check.issues == []
    assert check.rows[0]["from_msisdn"] == employee.id
    assert check.rows[0]["to_msisdn"] == retailer.id


async def test_preview_check_lists_candidates_for_ambiguous_from_number(db, house):
    first, retailer = await _source_entities(db, house)
    second = Employee(house_id=house.id, employee_type="rso", status="Active",
                      itop_number=first.itop_number, dms_code="RSO-DUP")
    db.add(second)
    await db.flush()
    rows = [{"_row_number": 3, "from_number": first.itop_number,
             "to_number": retailer.itop_number, "modified_on": "x", "transfer_mrp": 10}]

    check = await live_c2c_service.prepare_live_c2c_import(db, house_id=house.id, rows=rows)

    issue = check.issues[0]
    assert (issue.side, issue.status) == ("from", "ambiguous")
    assert {c["dms_code"] for c in issue.candidates} == {first.dms_code, "RSO-DUP"}
    assert set(issue.candidates[0]) == {"id", "name", "name_bn", "dms_code", "itop_number"}


async def test_preview_check_ignores_other_house_entities(db, house):
    other = await make_house(db, code="H999", name="Other", email="o@example.com")
    other_employee, other_retailer = await _source_entities(db, other, suffix="9")
    _, retailer = await _source_entities(db, house)
    rows = [{"_row_number": 3, "from_number": other_employee.itop_number,
             "to_number": retailer.itop_number, "modified_on": "x", "transfer_mrp": 10}]

    check = await live_c2c_service.prepare_live_c2c_import(db, house_id=house.id, rows=rows)

    assert check.can_import is False
    assert check.issues[0].side == "from"
    assert check.issues[0].status == "not_found"
    assert check.issues[0].candidates == []
```

(Retailer side is covered by `test_preview_check_lists_unmatched_to_numbers`, same shape with a bad `to_number`, asserting `side == "to"` and `candidates[0]` keys `{"id", "name", "retailer_code", "itop_number", "enabled"}`.)

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd backend && python -m pytest -q tests/test_live_c2c_import.py -k preview_check`
Expected: FAIL — `AttributeError: 'PreparedLiveC2CImport' object has no attribute 'issues'` / import error for the new names.

- [ ] **Step 3: Implement the dataclasses and rewrite `prepare_live_c2c_import`**

Replace `PreparedLiveC2CImport` with `LiveC2CImportCheck` (`disabled_retailer_count`
is resolved during matching and carried on the result). Rules the implementation must follow:

- Resolve each **distinct** `from_number` / `to_number` once; group workbook rows per value to fill `row_count` and `excel_rows` (cap `excel_rows` at `MAX_DIAGNOSTIC_ROWS = 20`).
- `not_found` when no same-house match; `ambiguous` when more than one. Employee candidates select `Employee.id, employee_name, employee_name_bn, dms_code, itop_number`; retailer candidates select `Retailer.id, name, retailer_code, itop_number, enabled`.
- Build issues in workbook order: all `from` issues first, then `to` issues, each ordered by first Excel row.
- `MAX_DIAGNOSTIC_VALUES = 200` per side; when exceeded, cut and set `truncated=True` (and therefore `can_import=False`).
- `summary["importable_rows"]` = rows whose from and to both resolved; `affected_rows` = rows touched by at least one issue.
- Only compute `on_route` when `can_import` is true (existing route lookup, unchanged).
- Keep raising `LiveC2CImportError("live_c2c_house_not_found")` from the caller as today (house existence is checked by the router).

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd backend && python -m pytest -q tests/test_live_c2c_import.py -k preview_check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/live_c2c_service.py backend/tests/test_live_c2c_import.py
git commit -m "feat(live-c2c): report only mismatched numbers instead of first error"
```

---

### Task 2: Preview returns the report, import blocks with it

**Files:**
- Modify: `backend/app/routers/reports.py` (`preview_live_c2c_import`, `import_live_c2c_rows`)
- Modify: `backend/app/services/live_c2c_service.py` (`replace_live_c2c_rows` guard)
- Test: `backend/tests/test_live_c2c_import.py`

**Interfaces:**
- Consumes: `LiveC2CImportCheck` from Task 1.
- Produces: preview body
  `{"success": true, "data": {"can_import": bool, "summary": {...}, "issues": [{side, value, status, row_count, excel_rows, candidates}], "truncated": bool, "disabled_retailer_count": int}}`
  and import failure body
  `{"detail": {"code": "LIVE_C2C_IMPORT_ERROR", "error_code": "live_c2c_entity_mismatch", "message": "live_c2c_entity_mismatch", "diagnostics": {can_import, summary, issues, truncated}}}`.

- [ ] **Step 1: Write the failing tests**

```python
async def test_preview_returns_issues_with_http_200(db, house):
    user = await _user_with_permissions(db, house, ("reports.view", "live_c2c.import"))
    _, retailer = await _source_entities(db, house)
    workbook = _workbook_bytes(
        headers=["From Msisdn", "To Msisdn", "Modified ON", "Transfer Mrp"],
        rows=[["01799999999", retailer.itop_number, "2026-11-17 10:30", "25.50"]],
    )
    async with _client(db, user) as client:
        response = await client.post(
            "/api/reports/live-c2c/preview",
            headers={"X-House-ID": str(house.id)},
            data={"sheet_name": "C2C Data"},
            files={"file": ("live-c2c.xlsx", workbook, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["can_import"] is False
    assert data["issues"] == [{
        "side": "from", "value": "01799999999", "status": "not_found",
        "row_count": 1, "excel_rows": [3], "candidates": [],
    }]
    assert data["summary"]["issue_count"] == 1


async def test_import_blocks_on_mismatch_and_keeps_existing_rows(db, house):
    user = await _user_with_permissions(db, house, ("reports.view", "live_c2c.import"))
    employee, retailer = await _source_entities(db, house)
    existing = LiveC2CRow(
        house_id=house.id, from_msisdn=employee.id, to_msisdn=retailer.id,
        modified_on=None, transfer_mrp=10, on_route="N",
        source_filename="existing.xlsx", source_sheet="C2C", created_by=user.id,
    )
    db.add(existing)
    await db.commit()
    workbook = _workbook_bytes(
        headers=["From Msisdn", "To Msisdn", "Modified ON", "Transfer Mrp"],
        rows=[["01799999999", retailer.itop_number, "2026-11-17 10:30", "25.50"]],
    )
    async with _client(db, user) as client:
        response = await client.post(
            "/api/reports/live-c2c/import",
            headers={"X-House-ID": str(house.id)},
            data={"sheet_name": "C2C Data"},
            files={"file": ("live-c2c.xlsx", workbook, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["error_code"] == "live_c2c_entity_mismatch"
    assert detail["diagnostics"]["issues"][0]["value"] == "01799999999"
    remaining = (await db.execute(select(LiveC2CRow))).scalars().all()
    assert [row.id for row in remaining] == [existing.id]
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd backend && python -m pytest -q tests/test_live_c2c_import.py -k "preview_returns or blocks_on_mismatch"`
Expected: FAIL (old `disabled_retailer_count`-only body / old `live_c2c_employee_not_found`).

- [ ] **Step 3: Implement the endpoint changes**

- `preview_live_c2c_import`: call the new `prepare_live_c2c_import`, return 200 with the report and `disabled_retailer_count` taken from the check.
- `import_live_c2c_rows`: `replace_live_c2c_rows` raises
  `LiveC2CImportError("live_c2c_entity_mismatch", diagnostics=check_payload)` when
  `can_import` is false; the router's existing `LiveC2CImportError` handler already
  spreads `**error.context` into `detail`, so pass `diagnostics` as one context key.
- Delete the now-unused single-row error branches in the import path; keep the
  house-not-found 404 branch.

- [ ] **Step 4: Run the whole live C2C test file**

Run: `cd backend && python -m pytest -q tests/test_live_c2c_import.py`
Expected: PASS (update the legacy tests that asserted `live_c2c_employee_not_found` to assert the new shape).

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/reports.py backend/app/services/live_c2c_service.py backend/tests/test_live_c2c_import.py
git commit -m "feat(live-c2c): return mismatch report from preview and block import"
```

---

### Task 3: Replace a house's rows with delete + bulk insert

**Files:**
- Modify: `backend/app/services/live_c2c_service.py` (`replace_live_c2c_rows`, new `_bulk_insert_live_c2c_rows`, `_raw_pg_connection`, import `delete`)
- Modify: `backend/tests/test_live_c2c_import.py`

**Interfaces:**
- Consumes: `LiveC2CImportCheck` (Task 1), `LiveC2CImportError("live_c2c_entity_mismatch", diagnostics=...)` (Task 2).
- Produces: `async def _bulk_insert_live_c2c_rows(db: AsyncSession, rows: list[dict[str, Any]]) -> None` used only by `replace_live_c2c_rows`.

- [ ] **Step 1: Write the failing tests**

```python
async def test_import_hard_replaces_only_the_selected_house(db, house):
    other = await make_house(db, code="H777", name="Other", email="o2@example.com")
    user = await _user_with_permissions(db, house, ("reports.view", "live_c2c.import"))
    employee, retailer = await _source_entities(db, house)
    other_employee, other_retailer = await _source_entities(db, other, suffix="7")
    db.add_all([
        LiveC2CRow(house_id=house.id, from_msisdn=employee.id, to_msisdn=retailer.id,
                   modified_on=None, transfer_mrp=10, on_route="N",
                   source_filename="old.xlsx", source_sheet="Old", created_by=user.id),
        LiveC2CRow(house_id=other.id, from_msisdn=other_employee.id,
                   to_msisdn=other_retailer.id, modified_on=None, transfer_mrp=12,
                   on_route="N", source_filename="other.xlsx", source_sheet="Old",
                   created_by=user.id),
    ])
    await db.commit()
    workbook = _workbook_bytes(
        headers=["From Msisdn", "To Msisdn", "Modified ON", "Transfer Mrp"],
        rows=[[employee.itop_number, retailer.itop_number, "2026-11-17 10:30", "25.50"]],
    )
    async with _client(db, user) as client:
        response = await client.post(
            "/api/reports/live-c2c/import",
            headers={"X-House-ID": str(house.id)},
            data={"sheet_name": "C2C Data"},
            files={"file": ("live-c2c.xlsx", workbook, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )

    assert response.status_code == 200
    saved = (await db.execute(select(LiveC2CRow).order_by(LiveC2CRow.id))).scalars().all()
    assert [(r.house_id, r.is_deleted) for r in saved] == [(other.id, False), (house.id, False)]
    assert saved[-1].source_filename == "live-c2c.xlsx"


async def test_bulk_insert_writes_every_row_in_one_call(db, house):
    user = await _user_with_permissions(db, house, ("reports.view", "live_c2c.import"))
    employee, retailer = await _source_entities(db, house)
    rows = [
        {"house_id": house.id, "from_msisdn": employee.id, "to_msisdn": retailer.id,
         "modified_on": None, "transfer_mrp": Decimal("1.00"), "on_route": "N",
         "source_filename": "bulk.xlsx", "source_sheet": "C2C",
         "is_deleted": False, "created_by": user.id, "created_at": now_naive()}
        for _ in range(5000)
    ]

    await live_c2c_service._bulk_insert_live_c2c_rows(db, rows)

    count = await db.scalar(select(func.count(LiveC2CRow.id)))
    assert count == 5000
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd backend && python -m pytest -q tests/test_live_c2c_import.py -k "hard_replaces or bulk_insert_writes"`
Expected: FAIL — the old import soft-deletes (so `saved` contains a deleted row) and `_bulk_insert_live_c2c_rows` does not exist.

- [ ] **Step 3: Implement**

- `_raw_pg_connection(db)`: copy the 6-line helper from
  `app/services/inventory_service.py` (module-local, with a comment pointing at the
  sibling implementation).
- `_bulk_insert_live_c2c_rows`: if the raw connection is available, one
  `await pg.copy_records_to_table("live_c2c", records=[tuple for each row in
  COPY_COLUMNS order], columns=COPY_COLUMNS)` with
  `COPY_COLUMNS = ["house_id", "from_msisdn", "to_msisdn", "modified_on",
  "on_route", "transfer_mrp", "source_filename", "source_sheet", "is_deleted",
  "created_by", "created_at"]`; otherwise loop `_chunks(rows,
  DB_INSERT_BATCH_SIZE)` and `await db.execute(insert(LiveC2CRow), chunk)`, with
  `DB_INSERT_BATCH_SIZE = 5000`.
- `replace_live_c2c_rows`: after `prepare_live_c2c_import`, raise
  `LiveC2CImportError("live_c2c_entity_mismatch", diagnostics=serialized_check)`
  when `can_import` is false (no delete, no insert); otherwise, inside the existing
  transaction, `await db.execute(delete(LiveC2CRow).where(LiveC2CRow.house_id ==
  house_id))`, then `_bulk_insert_live_c2c_rows` with `created_at=now_naive()` and
  `updated_by=None`, then the unchanged `log_activity` call.

- [ ] **Step 4: Run the file and the tenancy guard suite**

Run: `cd backend && python -m pytest -q tests/test_live_c2c_import.py tests/test_tenant_isolation.py`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/live_c2c_service.py backend/tests/test_live_c2c_import.py
git commit -m "perf(live-c2c): hard-replace house rows with COPY bulk insert"
```

---

### Task 4: `live_c2c.export` permission

**Files:**
- Modify: `backend/config/permissions.json` (`modules.live_c2c.permissions`, every `default_roles[].permissions` entry that already contains `"live_c2c.import"`)

**Interfaces:**
- Produces: permission key `live_c2c.export`, consumed by Task 6's button gate.

- [ ] **Step 1: Add the key**

Add `"live_c2c.export"` immediately after `"live_c2c.import"` in the `live_c2c`
module block and in each `default_roles` array where `"live_c2c.import"` appears
(`grep -n '"live_c2c.import"' backend/config/permissions.json` lists them all;
admin roles receive every permission automatically and need no edit).

- [ ] **Step 2: Run the module/plan parity suites**

Run: `cd backend && python -m pytest -q tests/test_plan_modules_parity.py tests/test_module_coverage.py`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/config/permissions.json
git commit -m "feat(permissions): add live_c2c.export"
```

---

### Task 5: Mismatch panel in the page (bilingual)

**Files:**
- Modify: `frontend/src/app/reports/live-c2c/page.tsx`
- Modify: `frontend/src/i18n/translations.ts` (`live_c2c` namespace in both `en` and `bn`)

**Interfaces:**
- Consumes: preview body from Task 2 (`can_import`, `summary`, `issues`, `truncated`).
- Produces: state `matchReport: LiveC2CMatchReport | null` where
  `LiveC2CMatchReport = { can_import: boolean; summary: { total_rows: number; importable_rows: number; issue_count: number; affected_rows: number }; issues: LiveC2CEntityIssue[]; truncated: boolean }`,
  and `LiveC2CEntityIssue = { side: "from" | "to"; value: string; status: "not_found" | "ambiguous"; row_count: number; excel_rows: number[]; candidates: { id: number; name: string | null; name_bn?: string | null; dms_code?: string | null; retailer_code?: string | null; itop_number: string | null; enabled?: string | null }[] }`
  (exported so Task 6 can reuse it).

- [ ] **Step 1: Add the i18n keys** under `live_c2c` in both languages, e.g. `diagnostics: { title, blocked, total_rows, issue_count, affected_rows, side_from, side_to, status_not_found, status_ambiguous, row_count, excel_rows, candidates, export, exporting, export_error, truncated }`; Bengali values are real Bengali text (the file already holds Bengali strings).

- [ ] **Step 2: Render the panel**

`handlePreviewAndConfirm` stores `matchReport` from the preview response; if
`can_import` is false it stops there (no confirm dialog, no `/import` call).
Reset `matchReport` in `handleFileChange` and `handleHouseChange`. Render below the
upload/sheet card: `<section role="region" aria-live="polite">` with the heading,
three summary counters, and one list of issues only — each with value, side label,
status badge, `row_count`, `excel_rows`, and for `ambiguous` the candidates joined
as `name — dms_code` / `name — retailer_code`. Add `truncated` note when set.

- [ ] **Step 3: Verify**

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/reports/live-c2c/page.tsx frontend/src/i18n/translations.ts
git commit -m "feat(live-c2c): show only mismatched numbers after preview"
```

---

### Task 6: Export the mismatches as `.xlsx`

**Files:**
- Create: `frontend/src/lib/export-live-c2c-mismatches.ts`
- Modify: `frontend/src/app/reports/live-c2c/page.tsx` (export button, `hasPermission("live_c2c.export")`)
- Modify: `frontend/src/i18n/translations.ts` (`live_c2c.diagnostics.export*` in both languages — added in Task 5, reuse)

**Interfaces:**
- Consumes: `LiveC2CEntityIssue` from Task 5.
- Produces: `exportLiveC2CMismatches({ issues, houseName, houseCode, language }): Promise<void>` writing
  `live_c2c_mismatches_<houseCode>_<YYYY-MM-DD>.xlsx`.

- [ ] **Step 1: Write the helper**

Follow `frontend/src/lib/export-activations.ts`: `new ExcelJS.Workbook()`, one
worksheet `Mismatches`, columns `["Side", "Msisdn", "Status", "Affected Rows",
"Excel Rows", "Candidates"]`, one row per issue (`side` localized via the `t`
function passed in, `excel_rows.join(", ")`, candidates joined as `name — code`),
header row bold, then `workbook.xlsx.writeBuffer()` → `Blob` → temporary `<a download>`.

- [ ] **Step 2: Wire the button**

In the panel header, render the `Download` icon button only when
`hasPermission("live_c2c.export") && matchReport?.issues.length`; `aria-label` and
`title` from `t("live_c2c.diagnostics.export")`, 44×44 minimum, `disabled` while
exporting, and set `uploadError = "export_failed"` on a thrown error.

- [ ] **Step 3: Verify**

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/export-live-c2c-mismatches.ts frontend/src/app/reports/live-c2c/page.tsx frontend/src/i18n/translations.ts
git commit -m "feat(live-c2c): export mismatched numbers as xlsx"
```

---

### Task 7: Full verification

- [ ] **Step 1: Backend**

Run: `cd backend && python -m pytest -q`
Expected: all tests pass.

- [ ] **Step 2: Tenancy/billing guard suite (touched house scoping)**

Run: `cd backend && python -m pytest -q tests/test_entitlement.py tests/test_house_access_guard.py tests/test_tenant_isolation.py`
Expected: all pass.

- [ ] **Step 3: Frontend**

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Manual responsive + locale check**

375 / 768 / 1280 px with a workbook holding one matched, one unmatched and one
ambiguous number, in both `en` and `bn`: no horizontal scroll, 44×44 targets, panel
readable as cards on mobile and as a table from `lg` up, exported file opens with
six columns and one row per bad value.

- [ ] **Step 5: Commit any leftovers**

```bash
git status --short
git add -A && git commit -m "chore(live-c2c): finish mismatch report verification"
```
