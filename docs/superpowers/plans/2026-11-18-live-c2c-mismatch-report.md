# Live C2C Mismatch Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show only the values that block a Live C2C import, export them as `.xlsx`, replace a house's data with a fast delete-plus-bulk-insert, drop soft delete for the module permanently, sync permissions on boot, and store an exactly duplicated transfer row once.

**Architecture:** `prepare_live_c2c_import()` resolves every distinct number, returns only unresolved values (`not_found` / `ambiguous`), and de-duplicates identical transfers after resolution. Preview returns that report; import returns 400 with the same report and writes nothing. A successful import deletes the house's rows and bulk-writes the new ones through asyncpg `COPY` (chunked executemany on SQLite tests) in one transaction.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, asyncpg, pytest (SQLite in-memory), Next.js client component, ExcelJS, existing i18n dictionary.

**Spec:** `docs/superpowers/specs/2026-11-18-live-c2c-mismatch-report-design.md`

## Global Constraints

- House isolation: every query, the delete and the de-dupe stay scoped to `house_id`; never `TRUNCATE` the table.
- Permissions: existing `live_c2c.import` for preview/import; new `live_c2c.export` gates the download button only.
- Bilingual: every new user-visible string needs both `en` and `bn` keys in `frontend/src/i18n/translations.ts`.
- Audit: the import keeps logging `module="live_c2c"`, `action="import"`.
- Schema: `live_c2c` loses its soft-delete columns; no new table and no alembic revision (boot-time `_migrate_*` step).
- Backend tests run on in-memory SQLite — the PostgreSQL `COPY` path needs a portable fallback that the tests exercise.
- Do not add new routes, modules, nav items, or test runners.

## Review Focus

- **A workbook whose numbers repeat across many rows** — the report lists one line per distinct value with a row count, not one line per row.
- **A number that exists in another house** — never a candidate, must resolve as `not_found`.
- **A failed insert after the delete** — the previous data must still be there; delete and insert share one transaction.
- **A 20,000-row clean sheet** — import must not slow down linearly, and the COPY column list must cover every required column.
- **The same transfer twice in one workbook vs two real transfers** — identical `(from, to, modified_on, amount)` collapse; a different amount or time must be stored as two rows.
- **A boot after the soft-delete columns were dropped** — the migration must be idempotent and start-up must not fail on a second run.

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
      summary: dict[str, int]        # total_rows, importable_rows, issue_count,
                                     # affected_rows, duplicate_rows
      duplicate_excel_rows: list[int]
      disabled_retailer_count: int
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
        "total_rows": 3, "importable_rows": 1, "issue_count": 1,
        "affected_rows": 2, "duplicate_rows": 0,
    }
    assert check.rows == []


async def test_preview_check_is_clean_when_every_row_matches(db, house):
    employee, retailer = await _source_entities(db, house)
    rows = [{"_row_number": 3, "from_number": employee.itop_number,
             "to_number": retailer.itop_number, "modified_on": "x", "transfer_mrp": 10}]

    check = await live_c2c_service.prepare_live_c2c_import(db, house_id=house.id, rows=rows)

    assert check.can_import is True
    assert check.issues == []
    assert check.duplicate_excel_rows == []
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
    other_employee, _ = await _source_entities(db, other, suffix="9")
    _, retailer = await _source_entities(db, house)
    rows = [{"_row_number": 3, "from_number": other_employee.itop_number,
             "to_number": retailer.itop_number, "modified_on": "x", "transfer_mrp": 10}]

    check = await live_c2c_service.prepare_live_c2c_import(db, house_id=house.id, rows=rows)

    assert check.can_import is False
    assert check.issues[0].side == "from"
    assert check.issues[0].status == "not_found"
    assert check.issues[0].candidates == []
```

Add the retailer-side twin, `test_preview_check_lists_unmatched_to_numbers`, asserting `side == "to"`, `status == "not_found"`, and — for the ambiguous variant — candidate keys `{"id", "name", "retailer_code", "itop_number", "enabled"}`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd backend && python -m pytest -q tests/test_live_c2c_import.py -k preview_check`
Expected: FAIL — `PreparedLiveC2CImport` has no `issues`.

- [ ] **Step 3: Implement the dataclasses and rewrite `prepare_live_c2c_import`**

Replace `PreparedLiveC2CImport` with `LiveC2CImportCheck`. Rules:

- Resolve each **distinct** `from_number` / `to_number` once; group workbook rows per value for `row_count` / `excel_rows` (cap `excel_rows` at `MAX_DIAGNOSTIC_ROWS = 20`).
- `not_found` when no same-house match; `ambiguous` when more than one. Employee candidates: `Employee.id, employee_name, employee_name_bn, dms_code, itop_number`; retailer candidates: `Retailer.id, name, retailer_code, itop_number, enabled`.
- Issues in workbook order: all `from` first, then `to`, each ordered by first Excel row.
- `MAX_DIAGNOSTIC_VALUES = 200` per side; when exceeded, cut and set `truncated=True` (and `can_import=False`).
- `summary["importable_rows"]` = rows whose from and to both resolved; `affected_rows` = rows touched by at least one issue; `duplicate_rows` stays `0` and `duplicate_excel_rows` stays `[]` until Task 5.
- `disabled_retailer_count` counts resolved rows whose retailer has `enabled` in `{"n", "no"}`.
- Only compute `on_route` when `can_import` is true (existing route lookup unchanged).

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
- Modify: `backend/tests/test_live_c2c_import.py`

**Interfaces:**
- Consumes: `LiveC2CImportCheck` from Task 1.
- Produces: preview body
  `{"success": true, "data": {"can_import": bool, "summary": {...}, "issues": [{side, value, status, row_count, excel_rows, candidates}], "duplicate_excel_rows": [...], "truncated": bool, "disabled_retailer_count": int}}`
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
Expected: FAIL.

- [ ] **Step 3: Implement the endpoint changes**

- `preview_live_c2c_import`: return 200 with the report and
  `disabled_retailer_count` from the check.
- `import_live_c2c_rows`: `replace_live_c2c_rows` raises
  `LiveC2CImportError("live_c2c_entity_mismatch", diagnostics=check_payload)` when
  `can_import` is false. The router's existing `LiveC2CImportError` handler spreads
  `**error.context` into `detail`, so pass `diagnostics` as a single context key.
- Remove the now-unused single-row error branches from the import path; keep the
  house-not-found 404 branch.

- [ ] **Step 4: Run the whole live C2C test file**

Run: `cd backend && python -m pytest -q tests/test_live_c2c_import.py`
Expected: PASS (rewrite the legacy tests that asserted `live_c2c_employee_not_found` to the new shape).

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/reports.py backend/app/services/live_c2c_service.py backend/tests/test_live_c2c_import.py
git commit -m "feat(live-c2c): return mismatch report from preview and block import"
```

---

### Task 3: Hard replace and soft-delete removal (end to end)

**Files:**
- Modify: `backend/app/models/live_c2c.py` (drop `is_deleted`, `deleted_at`, `deleted_by`, unused imports)
- Modify: `backend/app/services/live_c2c_service.py` (`replace_live_c2c_rows`, drop soft-delete filters)
- Modify: `backend/app/routers/reports.py` (`get_live_c2c_rows` drops its `is_deleted` filter)
- Modify: `backend/app/services/db_service.py` (new `_migrate_live_c2c_drop_soft_delete`, called from `init_db`)
- Modify: `docs/agents/database.md` (Soft Delete Exemptions section)
- Modify: `backend/tests/test_live_c2c_import.py`

**Interfaces:**
- Produces: `async def _migrate_live_c2c_drop_soft_delete() -> None` in `db_service.py`, called by `init_db()` after `create_all`.

- [ ] **Step 1: Write the failing tests**

```python
def test_live_c2c_model_has_no_soft_delete_columns():
    assert {"is_deleted", "deleted_at", "deleted_by"}.isdisjoint(
        LiveC2CRow.__table__.columns.keys()
    )


async def test_import_hard_deletes_only_the_selected_house_rows(db, house):
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
        listing = await client.get(
            "/api/reports/live-c2c", headers={"X-House-ID": str(house.id)}
        )

    assert response.status_code == 200
    saved = (await db.execute(select(LiveC2CRow).order_by(LiveC2CRow.id))).scalars().all()
    assert [(r.house_id, r.source_filename) for r in saved] == [
        (other.id, "other.xlsx"), (house.id, "live-c2c.xlsx"),
    ]
    assert listing.json()["pagination"]["total"] == 1
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd backend && python -m pytest -q tests/test_live_c2c_import.py -k "no_soft_delete_columns or hard_deletes"`
Expected: FAIL.

- [ ] **Step 3: Implement**

- Model: delete the three columns and the `Boolean` import if it becomes unused.
- `replace_live_c2c_rows`: replace the soft-delete `update(...)` with
  `await db.execute(delete(LiveC2CRow).where(LiveC2CRow.house_id == house_id))`
  after reading `previous_count`; keep the single transaction and the activity log.
- `get_live_c2c_rows`: drop the `is_deleted` predicate from `filters`.
- `db_service.py`: add `_migrate_live_c2c_drop_soft_delete()` — guard with an
  `information_schema.columns` lookup, then `DROP INDEX IF EXISTS
  ix_live_c2c_is_deleted` and `ALTER TABLE live_c2c DROP COLUMN IF EXISTS` for
  `deleted_by`, `deleted_at`, `is_deleted`; call it in `init_db()` after
  `_migrate_supervisor_member_rename()` (before `create_all` is fine, but keep it
  grouped with the other `_migrate_*` calls after `create_all`).
- `docs/agents/database.md`: add a `## Soft Delete Exemptions` section naming
  `live_c2c` as a replace-all snapshot table and stating why soft delete does not
  apply; reference it from the Soft Delete Convention rules line.

- [ ] **Step 4: Run the file**

Run: `cd backend && python -m pytest -q tests/test_live_c2c_import.py`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/live_c2c.py backend/app/services/live_c2c_service.py backend/app/routers/reports.py backend/app/services/db_service.py docs/agents/database.md backend/tests/test_live_c2c_import.py
git commit -m "refactor(live-c2c): hard replace rows and drop soft delete permanently"
```

---

### Task 4: Fast bulk insert (COPY with chunked fallback)

**Files:**
- Modify: `backend/app/services/live_c2c_service.py` (new `_raw_pg_connection`, `_bulk_insert_live_c2c_rows`, `COPY_COLUMNS`, `DB_INSERT_BATCH_SIZE = 5000`)
- Modify: `backend/tests/test_live_c2c_import.py`

**Interfaces:**
- Produces: `async def _bulk_insert_live_c2c_rows(db: AsyncSession, rows: list[dict[str, Any]]) -> None` and `COPY_COLUMNS: tuple[str, ...]`, used only by `replace_live_c2c_rows`.

- [ ] **Step 1: Write the failing tests**

```python
def test_copy_columns_cover_every_required_model_column():
    required = {
        column.name
        for column in LiveC2CRow.__table__.columns
        if not column.nullable and not column.primary_key
        and column.default is None and column.server_default is None
    }
    assert required <= set(live_c2c_service.COPY_COLUMNS)
    assert set(live_c2c_service.COPY_COLUMNS) <= set(LiveC2CRow.__table__.columns.keys())


async def test_bulk_insert_writes_every_row(db, house):
    user = await _user_with_permissions(db, house, ("reports.view", "live_c2c.import"))
    employee, retailer = await _source_entities(db, house)
    rows = [
        {"house_id": house.id, "from_msisdn": employee.id, "to_msisdn": retailer.id,
         "modified_on": None, "transfer_mrp": Decimal("1.00"), "on_route": "N",
         "source_filename": "bulk.xlsx", "source_sheet": "C2C",
         "created_by": user.id, "created_at": now_naive()}
        for _ in range(5000)
    ]

    await live_c2c_service._bulk_insert_live_c2c_rows(db, rows)

    assert await db.scalar(select(func.count(LiveC2CRow.id))) == 5000
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd backend && python -m pytest -q tests/test_live_c2c_import.py -k "copy_columns or bulk_insert_writes"`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `_raw_pg_connection(db)`: the 6-line helper copied from
  `app/services/inventory_service.py`, with a comment pointing at that sibling.
- `COPY_COLUMNS = ("house_id", "from_msisdn", "to_msisdn", "modified_on",
  "on_route", "transfer_mrp", "source_filename", "source_sheet", "created_by",
  "created_at")`.
- `_bulk_insert_live_c2c_rows`: with a raw PG connection, one
  `await pg.copy_records_to_table("live_c2c", records=[tuple(row[column] for
  column in COPY_COLUMNS) for row in rows], columns=list(COPY_COLUMNS))`; without
  one, loop `_chunks(rows, DB_INSERT_BATCH_SIZE)` and
  `await db.execute(insert(LiveC2CRow), chunk)`.
- `replace_live_c2c_rows` calls it instead of the inline batched insert.

- [ ] **Step 4: Run the file and the isolation guard suite**

Run: `cd backend && python -m pytest -q tests/test_live_c2c_import.py tests/test_tenant_isolation.py`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/live_c2c_service.py backend/tests/test_live_c2c_import.py
git commit -m "perf(live-c2c): bulk insert through COPY with chunked fallback"
```

---

### Task 5: Store an exactly duplicated transfer once

**Files:**
- Modify: `backend/app/services/live_c2c_service.py` (`prepare_live_c2c_import`, `replace_live_c2c_rows` activity log)
- Modify: `backend/app/routers/reports.py` (import response adds `duplicate_rows`)
- Modify: `backend/tests/test_live_c2c_import.py`

**Interfaces:**
- Consumes: `LiveC2CImportCheck.summary["duplicate_rows"]`, `.duplicate_excel_rows` (declared in Task 1).
- Produces: import success body `{"success": true, "data": {"imported_rows": int, "duplicate_rows": int, "disabled_retailer_count": int}}`.

- [ ] **Step 1: Write the failing tests**

```python
async def test_same_transfer_twice_is_stored_once(db, house):
    employee, retailer = await _source_entities(db, house)
    row = {"_row_number": 3, "from_number": employee.itop_number,
           "to_number": retailer.itop_number, "modified_on": "2026-11-17 10:30",
           "transfer_mrp": Decimal("1000.00")}
    duplicate = {**row, "_row_number": 4}

    check = await live_c2c_service.prepare_live_c2c_import(
        db, house_id=house.id, rows=[row, duplicate]
    )

    assert check.can_import is True
    assert len(check.rows) == 1
    assert check.summary["duplicate_rows"] == 1
    assert check.duplicate_excel_rows == [4]


async def test_two_real_transfers_are_both_stored(db, house):
    employee, retailer = await _source_entities(db, house)

    check = await live_c2c_service.prepare_live_c2c_import(
        db,
        house_id=house.id,
        rows=[
            {"_row_number": 3, "from_number": employee.itop_number,
             "to_number": retailer.itop_number, "modified_on": "2026-11-17 09:00",
             "transfer_mrp": Decimal("1000.00")},
            {"_row_number": 4, "from_number": employee.itop_number,
             "to_number": retailer.itop_number, "modified_on": "2026-11-17 17:00",
             "transfer_mrp": Decimal("500.00")},
        ],
    )

    assert check.can_import is True
    assert [row["transfer_mrp"] for row in check.rows] == [
        Decimal("1000.00"), Decimal("500.00"),
    ]
    assert check.summary["duplicate_rows"] == 0


async def test_dedupe_uses_resolved_entities_not_raw_text(db, house):
    employee, retailer = await _source_entities(db, house)

    check = await live_c2c_service.prepare_live_c2c_import(
        db,
        house_id=house.id,
        rows=[
            {"_row_number": 3, "from_number": employee.itop_number,
             "to_number": retailer.itop_number, "modified_on": "2026-11-17 10:30",
             "transfer_mrp": Decimal("1000.00")},
            {"_row_number": 4, "from_number": employee.itop_number.lstrip("0"),
             "to_number": retailer.itop_number, "modified_on": "2026-11-17 10:30",
             "transfer_mrp": Decimal("1000.00")},
        ],
    )

    assert len(check.rows) == 1
    assert check.summary["duplicate_rows"] == 1
```

And an endpoint test asserting the import response carries `duplicate_rows == 1`
for a workbook containing the same row twice.

- [ ] **Step 2: Run to confirm failure**

Run: `cd backend && python -m pytest -q tests/test_live_c2c_import.py -k "stored_once or both_stored or resolved_entities"`
Expected: FAIL.

- [ ] **Step 3: Implement**

After resolution, walk the rows in Excel order with a `seen: set[tuple]` keyed on
`(employee_id, retailer_id, modified_on, transfer_mrp)`; keep the first, push later
row numbers into `duplicate_excel_rows` (cap 20) and count them into
`summary["duplicate_rows"]`. Build `rows` from the kept entries only. Add
`duplicate_rows` to the activity log `new_values` and to the import response.

- [ ] **Step 4: Run the file**

Run: `cd backend && python -m pytest -q tests/test_live_c2c_import.py`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/live_c2c_service.py backend/app/routers/reports.py backend/tests/test_live_c2c_import.py
git commit -m "feat(live-c2c): skip exactly duplicated transfer rows"
```

---

### Task 6: Automatic permission sync on boot

**Files:**
- Create: `backend/app/services/permission_sync.py`
- Modify: `backend/app/routers/admin_controller.py` (`sync_permissions` delegates)
- Modify: `backend/app/services/db_service.py` (`init_db` calls the sync)
- Create: `backend/tests/test_permission_sync.py`

**Interfaces:**
- Produces:
  ```python
  async def sync_permissions_from_config(
      db: AsyncSession, *, grant_all_defaults: bool = False
  ) -> dict[str, Any]
  # {"total_permissions": int, "permissions_added": list[str], "roles_updated": list[str]}
  ```

- [ ] **Step 1: Write the failing tests**

```python
import json
from pathlib import Path

from app.models.role import Role
from app.services.permission_sync import sync_permissions_from_config

CONFIG = json.loads(
    (Path(__file__).resolve().parents[1] / "config" / "permissions.json").read_text()
)


async def test_sync_permissions_seeds_missing_permission_and_is_idempotent(db):
    first = await sync_permissions_from_config(db)

    assert first["total_permissions"] == sum(
        len(module["permissions"]) for module in CONFIG["modules"].values()
    )
    assert first["permissions_added"]

    second = await sync_permissions_from_config(db)
    assert second["permissions_added"] == []
    assert second["roles_updated"] == []


async def test_sync_permissions_grants_default_role_permissions(db):
    role_config = next(role for role in CONFIG["default_roles"] if role.get("permissions"))
    role = Role(name=role_config["name"])
    db.add(role)
    await db.commit()

    report = await sync_permissions_from_config(db)

    await db.refresh(role, attribute_names=["permissions"])
    granted = {permission.name for permission in role.permissions}
    assert set(role_config["permissions"]) <= granted
    assert role_config["name"] in report["roles_updated"]
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd backend && python -m pytest -q tests/test_permission_sync.py`
Expected: FAIL — `ModuleNotFoundError: app.services.permission_sync`.

- [ ] **Step 3: Implement**

- Move the body of `sync_permissions` into `sync_permissions_from_config`, returning
  the report instead of an HTTP body and committing only the permission rows
  (`await db.flush()`; the caller owns the commit). Take
  `SELECT pg_advisory_xact_lock(:key)` when `db.bind.dialect.name == "postgresql"`
  with a module constant key, like `_BILLING_MIGRATION_LOCK_KEY` in `db_service.py`.
  It must only add: never remove a permission or a role grant. In boot mode
  (`grant_all_defaults=False`) a role only receives permission keys created by
  that run, so a restart never restores a permission an admin revoked in the
  Roles UI; the endpoint passes `grant_all_defaults=True` for the full top-up.
- `admin_controller.sync_permissions`: call the service, `await db.commit()`, keep
  `log_activity`, and return the report.
- `init_db()`: after `create_all` and the `_migrate_*` chain, run the sync on a
  short-lived `async_session()`, commit, and log
  `"Permissions synced: %d added, roles: %s"` when anything changed. Wrap it in
  `try/except Exception: logger.exception("Could not sync permissions from config")`
  — loud, with a traceback, and non-fatal for the boot.

- [ ] **Step 4: Run the file plus the module guard suites**

Run: `cd backend && python -m pytest -q tests/test_permission_sync.py tests/test_plan_modules_parity.py tests/test_module_coverage.py`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/permission_sync.py backend/app/routers/admin_controller.py backend/app/services/db_service.py backend/tests/test_permission_sync.py
git commit -m "feat(permissions): sync permissions from config on every boot"
```

---

### Task 7: `live_c2c.export` permission

**Files:**
- Modify: `backend/config/permissions.json` (`modules.live_c2c.permissions`, every `default_roles[].permissions` entry that already contains `"live_c2c.import"`)

**Interfaces:**
- Produces: permission key `live_c2c.export`, consumed by Task 9's button gate. Task 6's boot sync seeds it into the database automatically.

- [ ] **Step 1: Add the key**

Add `"live_c2c.export"` immediately after `"live_c2c.import"` in the `live_c2c`
module block and in each `default_roles` array where `"live_c2c.import"` appears
(`grep -n '"live_c2c.import"' backend/config/permissions.json`). Admin roles
receive every permission automatically.

- [ ] **Step 2: Run the parity suites**

Run: `cd backend && python -m pytest -q tests/test_plan_modules_parity.py tests/test_module_coverage.py`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/config/permissions.json
git commit -m "feat(permissions): add live_c2c.export"
```

---

### Task 8: Mismatch panel in the page (bilingual)

**Files:**
- Modify: `frontend/src/app/reports/live-c2c/page.tsx`
- Modify: `frontend/src/i18n/translations.ts` (`live_c2c` namespace in both `en` and `bn`)

**Interfaces:**
- Consumes: preview body from Task 2 (`can_import`, `summary`, `issues`, `duplicate_excel_rows`, `truncated`).
- Produces: exported types used by Task 9:
  ```ts
  export interface LiveC2CEntityIssue {
    side: "from" | "to";
    value: string;
    status: "not_found" | "ambiguous";
    row_count: number;
    excel_rows: number[];
    candidates: {
      id: number; name: string | null; name_bn?: string | null;
      dms_code?: string | null; retailer_code?: string | null;
      itop_number: string | null; enabled?: string | null;
    }[];
  }
  export interface LiveC2CMatchReport {
    can_import: boolean;
    summary: { total_rows: number; importable_rows: number; issue_count: number;
               affected_rows: number; duplicate_rows: number };
    issues: LiveC2CEntityIssue[];
    duplicate_excel_rows: number[];
    truncated: boolean;
  }
  ```

- [ ] **Step 1: Add the i18n keys** under `live_c2c` in both languages:
  `diagnostics: { title, blocked, total_rows, issue_count, affected_rows, side_from, side_to, status_not_found, status_ambiguous, row_count, excel_rows, candidates, export, exporting, export_error, truncated, empty }`
  and `duplicates: { will_skip, imported_with_duplicates }`; Bengali values are real
  Bengali text.

- [ ] **Step 2: Render the panel**

`handlePreviewAndConfirm` stores `matchReport`; if `can_import` is false it stops
(no confirm dialog, no `/import`). Reset in `handleFileChange` and
`handleHouseChange`. Render below the upload/sheet card: `<section role="region"
aria-live="polite">` with the heading, three counters, and one list of issues only —
value, side label, status badge, `row_count`, `excel_rows`, and for `ambiguous` the
candidates joined as `name — dms_code` / `name — retailer_code`. When `can_import`
is true and `summary.duplicate_rows > 0`, show the neutral `duplicates.will_skip`
line before the confirm prompt. Add the `truncated` note when set.

- [ ] **Step 3: Verify**

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/reports/live-c2c/page.tsx frontend/src/i18n/translations.ts
git commit -m "feat(live-c2c): show only mismatched numbers after preview"
```

---

### Task 9: Export the mismatches as `.xlsx`

**Files:**
- Create: `frontend/src/lib/export-live-c2c-mismatches.ts`
- Modify: `frontend/src/app/reports/live-c2c/page.tsx`

**Interfaces:**
- Consumes: `LiveC2CEntityIssue` from Task 8.
- Produces: `exportLiveC2CMismatches({ issues, houseName, houseCode, t }): Promise<void>` writing `live_c2c_mismatches_<houseCode>_<YYYY-MM-DD>.xlsx`.

- [ ] **Step 1: Write the helper**

Follow `frontend/src/lib/export-activations.ts`: `new ExcelJS.Workbook()`, sheet
`Mismatches`, columns `["Side", "Msisdn", "Status", "Affected Rows", "Excel Rows",
"Candidates"]`, one row per issue (`side` localized via `t`, `excel_rows.join(", ")`,
candidates joined as `name — code`), bold header row, then
`workbook.xlsx.writeBuffer()` → `Blob` → temporary `<a download>`.

- [ ] **Step 2: Wire the button**

Panel header `Download` icon button, only when `hasPermission("live_c2c.export") &&
matchReport?.issues.length`; `aria-label`/`title` from
`t("live_c2c.diagnostics.export")`, 44×44 minimum, `disabled` while exporting, set
`uploadError = "export_failed"` on failure.

- [ ] **Step 3: Verify**

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/export-live-c2c-mismatches.ts frontend/src/app/reports/live-c2c/page.tsx
git commit -m "feat(live-c2c): export mismatched numbers as xlsx"
```

---

### Task 10: `init_db()` failures stop being silent

**Files:**
- Modify: `backend/app/services/db_service.py` (`STARTUP_MIGRATION_WARNINGS`, `_migration_warning`, `_startup_fatal`, `init_db` outer handler, every `logger.warning(f"Migration warning (...)")` call site)
- Create: `backend/tests/test_startup_failures.py`

**Interfaces:**
- Produces:
  ```python
  STARTUP_MIGRATION_WARNINGS: list[str]          # "<step name>: <error>" per failed _migrate_*
  def _migration_warning(name: str, error: Exception) -> None   # logger.exception + record
  def _startup_fatal(message: str, error: Exception) -> None    # logger.critical + STARTUP_FATAL_ERRORS
  ```
  `main.py` already refuses to start when `STARTUP_FATAL_ERRORS` is non-empty — no change there.

- [ ] **Step 1: Write the failing tests**

```python
import logging

from app.services import db_service


def test_migration_warning_is_recorded_and_logged_with_traceback(caplog):
    db_service.STARTUP_MIGRATION_WARNINGS.clear()
    with caplog.at_level(logging.ERROR, logger="app.services.db_service"):
        try:
            raise RuntimeError("boom")
        except RuntimeError as error:
            db_service._migration_warning("retailer_filters.tag_id", error)

    assert db_service.STARTUP_MIGRATION_WARNINGS == ["retailer_filters.tag_id: boom"]
    assert caplog.records[0].levelno == logging.ERROR
    assert caplog.records[0].exc_info is not None


async def test_init_db_marks_a_schema_failure_as_fatal(monkeypatch):
    db_service.STARTUP_FATAL_ERRORS.clear()

    class FailingEngine:
        def begin(self):
            raise RuntimeError("permission denied for schema public")

    monkeypatch.setattr(db_service, "engine", FailingEngine())
    await db_service.init_db()

    assert any(
        "permission denied for schema public" in message
        for message in db_service.STARTUP_FATAL_ERRORS
    )


def test_no_migration_step_still_logs_a_bare_warning():
    from pathlib import Path

    source = Path(db_service.__file__).read_text(encoding="utf-8")
    assert 'logger.warning(f"Migration warning' not in source
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd backend && python -m pytest -q tests/test_startup_failures.py`
Expected: FAIL — `_migration_warning` / `STARTUP_MIGRATION_WARNINGS` missing, and `init_db` swallows the schema error.

- [ ] **Step 3: Implement**

- Add `STARTUP_MIGRATION_WARNINGS`, `_migration_warning` and `_startup_fatal` next to
  `STARTUP_FATAL_ERRORS`.
- Replace every `logger.warning(f"Migration warning ({name}): {e}")` with
  `_migration_warning("{name}", e)` (about 67 call sites; keep the same step names —
  `grep -c 'Migration warning' app/services/db_service.py` before and after to prove
  none were missed).
- `init_db`: the `except` block no longer ends in
  `logger.warning("Table sync error (non-critical)")`. The `already exists` recovery
  path stays, but if its retry raises anything other than the known
  `ix_sales_house_date` conflict, call `_startup_fatal(...)` instead of `raise`/pass.
  Every other exception calls `_startup_fatal(f"database initialisation failed:
  {e}", e)` — no re-raise, so `main()` can inspect `STARTUP_FATAL_ERRORS` and exit.
- After the `try/except`, log one summary line when
  `STARTUP_MIGRATION_WARNINGS` is non-empty:
  `"Startup finished with %d migration warning(s): %s"`.

- [ ] **Step 4: Run the new file plus the whole suite**

Run: `cd backend && python -m pytest -q tests/test_startup_failures.py` then `cd backend && python -m pytest -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/db_service.py backend/tests/test_startup_failures.py
git commit -m "fix(startup): never swallow init_db failures silently"
```

---

### Task 11: Full verification

- [ ] **Step 1: Backend**

Run: `cd backend && python -m pytest -q`
Expected: all tests pass.

- [ ] **Step 2: Tenancy/billing guard suite**

Run: `cd backend && python -m pytest -q tests/test_entitlement.py tests/test_house_access_guard.py tests/test_tenant_isolation.py`
Expected: all pass.

- [ ] **Step 3: Frontend**

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Boot check (real PostgreSQL)**

Rebuild if needed and restart the backend, then confirm in the log:
`live_c2c soft-delete columns` migration line (first boot only),
`Permissions synced: ...` (first boot only), and `DB Connected Successfully!`.
Confirm the table has no soft-delete columns:
`docker exec orange_flow_db psql -U <user> -d <db> -c "\d live_c2c"`.

- [ ] **Step 5: Manual responsive + locale check**

375 / 768 / 1280 px with a workbook holding one matched, one unmatched, one
ambiguous number and one exactly duplicated row, in both `en` and `bn`: no
horizontal scroll, 44×44 targets, panel readable as cards on mobile and as a table
from `lg` up, exported file opens with six columns and one row per bad value.

- [ ] **Step 6: Commit any leftovers**

```bash
git status --short
git add -A && git commit -m "chore(live-c2c): finish mismatch report verification"
```
