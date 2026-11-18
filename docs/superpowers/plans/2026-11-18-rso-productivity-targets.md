# RSO Productivity Targets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Productivity C2C and Productivity trans targets to RSO target storage, editing, display, and Excel import/export.

**Architecture:** Add two Float columns to the existing `rso_targets` table and expose them through the existing Pydantic target schemas. Extend the unified Excel mapper and its RSO sample/export, then surface the values in both existing RSO target views and the create/edit form.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, pandas/openpyxl, Next.js App Router, TypeScript, Zustand translations.

**Spec:** `docs/superpowers/specs/2026-11-18-rso-productivity-targets-design.md`

## Global Constraints

- The new values are dedicated Float columns and may include fractional values.
- Existing and omitted values default to zero.
- Import accepts `Productivity C2C Tgt` and `Productivity trans.Tgt` header spellings after the existing header normalization.
- Add user-visible copy in both English and Bengali.
- Preserve existing RSO target matching, calculation, filtering, and import behavior.
- Preserve unrelated existing worktree changes.

## Review Focus

- Excel headers containing the period in `Productivity trans.Tgt` still map to the right field; test import of both provided header labels with fractional values.
- Re-imports that omit either new column preserve existing target values; test omitted-column upsert behavior.
- Existing rows receive zero for both fields when the additive migration runs; use non-null columns with a zero server default and remove the server default after migration.
- API create/update accept and persist both values; cover schema/API persistence in the backend regression test.
- RSO import/sample and exported workbooks include both named values; assert headers and cell values in workbook round-trip tests.

---

### Task 1: Persist and Import RSO Productivity Targets

**Files:**
- Modify: `backend/app/models/rso_target.py`
- Modify: `backend/app/schemas/rso_target.py`
- Modify: `backend/app/services/Automation/target_excel.py`
- Create: `backend/alembic/versions/<revision>_add_rso_productivity_targets.py`
- Test: `backend/tests/test_rso_productivity_targets.py`

**Interfaces:**
- Consumes: `process_target_excel_unified(file_path, target_date, progress_callback=None)` and the existing RSO column mapping/upsert behavior.
- Produces: `RSOTarget.productivity_c2c_tgt` and `RSOTarget.productivity_trans_tgt` as non-null Float columns with zero defaults, present on create/update/response schemas and import/sample/export workbook data.

- [ ] **Step 1: Write a failing workbook import and round-trip regression test**
  - Import an RSO workbook containing headers `Productivity C2C Tgt` and `Productivity trans.Tgt`; assert fractional values persist in the two named columns.
  - Re-import an RSO workbook without either column and assert existing values remain unchanged.
  - Import a new RSO row without either column and assert both values default to zero.
  - Exercise the existing create/update route functions and assert both values persist through their schemas.
  - Assert the generated sample and exported workbook include both headers and preserve representative values.
- [ ] **Step 2: Run the targeted test and verify RED**
  - Run: `cd backend && .venv/bin/python -m pytest -q tests/test_rso_productivity_targets.py`
  - Expected: FAIL because the fields are not mapped/stored and the sample/export headers are absent.
- [ ] **Step 3: Add model, schema, and additive migration fields**
  - Add `productivity_c2c_tgt` and `productivity_trans_tgt` as `Float`, `nullable=False`, default `0.0`.
  - Add the fields to `RSOTargetCreate`, `RSOTargetUpdate`, and `RSOTargetResponse`.
  - Add both DB columns with a temporary server default of zero, then remove the server default; downgrade drops both columns.
- [ ] **Step 4: Extend the RSO Excel mapping and workbook templates**
  - Map normalized headers `PRODUCTIVITY_C2C_TGT` and `PRODUCTIVITY_TRANS.TGT` to their fields with `clean_float`; also accept normalized `PRODUCTIVITY_TRANS_TGT`.
  - Include both fields in the RSO sample and export workbook headers and values.
- [ ] **Step 5: Run the targeted tests and verify GREEN**
  - Run: `cd backend && .venv/bin/python -m pytest -q tests/test_rso_productivity_targets.py`
  - Expected: all import, omitted-column, create/update, sample, and export assertions pass.
- [ ] **Step 6: Run backend regression tests**
  - Run: `cd backend && .venv/bin/python -m pytest -q`
  - Expected: full suite passes.

### Task 2: Display and Edit Productivity Targets

**Files:**
- Modify: `frontend/src/app/targets/rso/page.tsx`
- Modify: `frontend/src/app/import/rso-targets/page.tsx`
- Modify: `frontend/src/i18n/translations.ts`

**Interfaces:**
- Consumes: The two new numeric fields on the RSO target API response and workbook from Task 1.
- Produces: Bilingual table labels and form fields that read/write the two values through the existing RSO target CRUD API; the RSO import list displays both imported values.

- [ ] **Step 1: Add typed UI fields and translated English/Bengali keys**
  - Add both properties to the RSO record types and form state.
  - Add paired English/Bengali labels for the table headers and input fields.
- [ ] **Step 2: Wire create/edit form state and payload**
  - Initialize both fields to zero on create and from the record on edit.
  - Include both numeric values in the existing create/update payload.
- [ ] **Step 3: Add the table columns**
  - Display both values in `/targets/rso` and the RSO import-record list.
  - Update loading/empty row column spans for the added cells.
- [ ] **Step 4: Verify frontend**
  - Run: `cd frontend && npm run lint`
  - Run: `cd frontend && npx tsc --noEmit`
  - Expected: both commands complete without errors.
- [ ] **Step 5: Verify the full patch**
  - Run: `git -c core.whitespace=cr-at-eol diff --check`
  - Expected: no whitespace errors.

### Final Verification

- [ ] Confirm the migration is a single Alembic head and is additive/reversible.
- [ ] Confirm both new names are present in the DB model, API schemas, importer mapping, sample/export, create/edit form, and both RSO target lists.
