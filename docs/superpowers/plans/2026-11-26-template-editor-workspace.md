# Template Editor Workspace + Multi-Page Resignation Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the template editor into a right-panel/left-preview authoring workspace that can build and generate a 3-page resignation letter with manual or employee-sourced images, then wire the seeded template into the resignation page.

**Architecture:** The AST stays a flat block list; pages are `page_break` boundaries and `Add Page` appends `page_break` + an unfilled image block. AST v2 adds an `image` block (`dynamic` source key or `manual` template asset id) and a root `audience`; a house-scoped resolver embeds images from either private employee scans or a new private `TemplateAsset` table at preview/generation time. A new read-only `preview-ast` endpoint makes unsaved edits visible before saving; the existing immutable-version/PDF/audit pipeline is reused unchanged.

**Tech Stack:** Python/FastAPI + SQLAlchemy + Alembic + Pydantic + pytest (TDD); Next.js 16.4.6 App Router, TypeScript, shadcn/ui, `EntitySelector`, Tailwind 4; no frontend test runner.

**Spec:** `docs/superpowers/specs/2026-11-26-template-editor-workspace-design.md` (supersedes the 2026-11-24 resignation design where they differ). Read both the spec and this plan before starting.

## Global Constraints

- **No commits, merge, or push.** The user revoked self-commit permission. Every task's final step is `git diff --check` with changes left uncommitted; do not run `git commit`.
- Every data model carries `house_id` (NULL only for global scope) and every query is house-scoped; use `X-House-ID` on all new endpoints.
- No new permission key: reuse `documents.templates.view/manage`, `documents.view/create/generate/download`, `employees.resignation_*`. Do not edit `backend/config/permissions.json`.
- Every mutation writes an `ActivityLog` row through `log_activity(..., commit=False)` before commit; preview and reads do not.
- Every user-visible string has `en` and `bn` keys in `frontend/src/i18n/translations.ts`; never render a dotted key path literally.
- Mandated primitives: `EntitySelector` for every new searchable select; shadcn inputs/switch/toggle; content-aware skeleton; right-side filter drawer if filters are added. No hand-built select or date control.
- Page header pattern (breadcrumb, icon/title, `PageGuideModal`, subtitle, divider) stays intact on both edited pages.
- No new module, nav item, sidebar entry, `allowed_modules` entry, `navItems` entry, `DynamicPageTitle` entry, `MODULE_LEAF_ROUTES`, `PATH_TO_MODULE`, or `LEAF_TO_API_PREFIXES` entry — new endpoints sit under the existing `documents` leaf. Prove with `test_plan_modules_parity.py` + `test_module_coverage.py`.
- Responsive: verify 375 / 768 / 1280 px, no horizontal page scroll, 44×44 px touch targets, one column below `lg`; EN/BN toggle verified.
- Read `frontend/node_modules/next/dist/docs/` for any Next.js 16 API used (`frontend/AGENTS.md` is binding).
- Backend changes are TDD: write the failing test first, run it, implement minimally, run it green.
- Verification commands (report actual output): `cd backend && python -m pytest -q`; `cd frontend && npm run lint`; `cd frontend && npx tsc --noEmit`; `git diff --check`. No frontend test runner is installed and none may be added.

## Review Focus

These five inputs/failure modes are the most likely to hurt a real user; each is pinned to a test in its owning task.

1. **Cross-house image leak** — a template used in house A must never embed house B's employee scan or asset → Task 2 `test_resolve_never_reads_other_house`, Task 3 `test_asset_other_house_unresolvable`.
2. **Client-controlled path / unknown asset id** — a forged `storage_path`, data URI, URL, or an asset id from another template must never reach the filesystem or PDF → Task 2 `test_resolve_ignores_client_path`, Task 4 `test_image_block_escapes_fallback`, Task 3 `test_asset_wrong_template_rejected`.
3. **Unsaved draft with an empty `Add Page` page** — live preview must render the placeholder and write no version/audit row; invalid AST must be rejected without crashing the editor → Task 5 `test_preview_ast_no_db_write` and `test_preview_ast_rejects_invalid`.
4. **Missing required image / audience mismatch** — generation must fail with a translated code, consume no document number, write no PDF → Task 6 `test_missing_required_image_no_number` and `test_audience_mismatch_blocked`.
5. **375 px + EN/BN** — the right panel stacks above the preview without horizontal scroll, all new copy translates, and touch targets stay 44×44 → Task 8 static/responsive checklist and Task 9 EN/BN key check.

## File Structure

| File | Responsibility |
|---|---|
| `backend/app/services/document_ast.py` | AST v2 constants, image block normalisation, audience, collectors |
| `backend/app/services/document_images.py` | **New.** Resolve dynamic scans + manual assets to data URIs |
| `backend/app/services/employee_documents.py` | Shared `latest_document` / `latest_nid_documents` with `house_id` filter |
| `backend/app/routers/employees.py` | Delegate NID heuristic to shared helper; behaviour unchanged |
| `backend/app/models/documents.py` | **New `DocumentTemplateAsset`** model with `house_id` + indexes |
| `backend/alembic/versions/<rev>_add_document_template_assets.py` | **New.** Table migration, down_revision `b6c7d8e9f0a1` |
| `backend/app/routers/documents.py` | Asset CRUD/stream, `preview-ast`, image/audience generation guards |
| `backend/app/schemas/documents.py` | `TemplateAssetOut`, `PreviewAstIn` |
| `backend/app/services/document_render.py` | `image` block HTML + print CSS, `images=` parameter |
| `backend/app/services/document_seed.py` | Idempotent published v2 global RESIGNATION template |
| `frontend/src/app/documents/templates/[id]/page.tsx` | Workspace layout, panel sections, live preview, pages |
| `frontend/src/app/documents/templates/[id]/_components/` | **New.** `OptionsPanel.tsx`, `PageList.tsx`, `ImageSourceControls.tsx` |
| `frontend/src/app/documents/templates/_components/CreateTemplateModal.tsx` | Audience field in create payload |
| `frontend/src/app/employees/resignation-documents/page.tsx` | Template picker, final preview, generate flow |
| `frontend/src/i18n/translations.ts` | All new `en` + `bn` copy |
| `backend/tests/test_*.py` | One focused test module per task |

---

### Task 1: AST v2 — image block and audience

**Files:**
- Modify: `backend/app/services/document_ast.py:1-60`, `:175-273`
- Test: `backend/tests/test_document_ast_image_block.py`

**Interfaces:**
- Consumes: existing `validate_ast`, `_clean_block`, `collect_variables`, `schema_from_keys`.
- Produces:
  - `AST_SCHEMA_VERSION = 2`, `SUPPORTED_AST_VERSIONS = (1, 2)`
  - `BLOCK_TYPES` includes `"image"`; `IMAGE_SOURCES = ("resignation_letter", "employee_nid")`
  - `AUDIENCES = ("all", "rso", "bp")`
  - `collect_image_sources(ast: dict) -> set[str]`, `collect_asset_ids(ast: dict) -> set[int]`
  - `validate_ast(payload: dict) -> dict` preserves `schema_version` and `audience`.

- [ ] **Step 1: Write failing tests** in `backend/tests/test_document_ast_image_block.py`

Assert: v1 AST with an image block raises `AstError` matching `schema version 2`; v2 dynamic block normalises to `{id, type:"image", source_kind:"dynamic", source:"resignation_letter", asset_id:None, align:"center", max_width_mm:170, max_height_mm:240, required:True, fallback_text:""}`; manual block with `asset_id: 7` normalises with `source: None`; unknown `source` raises `AstError`; `source_kind:"manual"` with no `asset_id` raises; `asset_id` with `source_kind:"dynamic"` raises; mm values clamp to 20–190 / 20–260; `audience:"manager"` raises and missing `audience` defaults to `"all"`; a v1 text-only AST still validates unchanged; `collect_image_sources` returns `{"resignation_letter","employee_nid"}` and `collect_asset_ids` returns `{7}` from a 3-page AST.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest -q tests/test_document_ast_image_block.py`
Expected: FAIL — `image` is unknown, collectors do not exist.

- [ ] **Step 3: Implement**

In `document_ast.py`: add the constants; change `_clean_block` to accept `schema_version` and add an `image` branch that rejects schema < 2 and validates each field with the existing `_align`, `_number`, `_flag`, `_text` helpers; pass root `audience` through validation with an `"all"` default; add both collectors. Keep v1 text normalisation byte-for-byte unchanged.

- [ ] **Step 4: Run to verify green**

Run: `cd backend && python -m pytest -q tests/test_document_ast_image_block.py`
Expected: PASS.

- [ ] **Step 5: Leave uncommitted**

Run `git diff --check`. Do not commit.

---

### Task 2: House-scoped image source resolver

**Files:**
- Modify: `backend/app/services/employee_documents.py:401-415`
- Create: `backend/app/services/document_images.py`
- Modify: `backend/app/routers/employees.py:892-935`
- Test: `backend/tests/test_document_images.py`

**Interfaces:**
- Consumes: `document_ast.IMAGE_SOURCES`, `document_render._image_data_uri_from_path`, `EmployeeDocument`.
- Produces:
  - `employee_documents.latest_document(db, employee_id, doc_types, *, house_id: Optional[int] = None)`
  - `employee_documents.latest_nid_documents(db, employee_ids: list[int], *, house_id: Optional[int] = None) -> dict[int, EmployeeDocument]`
  - `document_images.resolve_image_sources(db, *, house_id: int, template_id: int, employee, ast: dict) -> tuple[dict[str, str], list[str]]`
  - `employees_router._resignation_nid_scans` delegates to the shared helper with unchanged output.

- [ ] **Step 1: Write failing tests** in `backend/tests/test_document_images.py`

Use the `db` fixture and `tmp_path`; write a real tiny JPEG with PIL at the document's `storage_path` and monkeypatch `document_render.PRIVATE_ROOT` to `tmp_path`. Assert: a resigned employee's uploaded `resignation_letter` and NID return two data URIs keyed by source; `test_resolve_never_reads_other_house` creates a scan with another `house_id` and asserts it lands in `missing_sources`, not the image map; `test_resolve_ignores_client_path` passes an AST image block with `storage_path`/`src`/data-URI extra keys and asserts none are used; a missing file returns a missing source rather than raising.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest -q tests/test_document_images.py`
Expected: FAIL — module/helper missing.

- [ ] **Step 3: Implement**

Extract the NID heuristic from `employees.py` into `latest_nid_documents` and make `_resignation_nid_scans` call it. Add `house_id` filtering to both helpers. Create `resolve_image_sources`: for dynamic keys use those helpers filtered by `house_id`; for manual ids defer to Task 3's `DocumentTemplateAsset` loader (import only the model, never a router); embed through `_image_data_uri_from_path()`; return a `missing_sources` list. Only `source`/`asset_id` from the validated AST may be used.

- [ ] **Step 4: Run to verify green**

Run: `cd backend && python -m pytest -q tests/test_document_images.py tests/test_resignation_documents.py`
Expected: PASS; existing resignation suite unchanged.

- [ ] **Step 5: Leave uncommitted**

`git diff --check`. Do not commit.

---

### Task 3: Template assets — model, migration, endpoints, audit

**Files:**
- Modify: `backend/app/models/documents.py`
- Create: `backend/alembic/versions/<rev>_add_document_template_assets.py`, `backend/app/services/template_assets.py`, `backend/tests/test_template_assets.py`
- Modify: `backend/app/routers/documents.py`, `backend/app/schemas/documents.py`

**Interfaces:**
- Consumes: `get_house_context`, `has_permission`, `log_activity`, `document_assets` storage conventions.
- Produces:
  - `DocumentTemplateAsset` with `house_id` nullable, `template_id`, `storage_path`, `content_type`, `size_bytes`, soft-delete columns, `Index("ix_document_template_assets_scope","house_id","template_id","is_deleted")`.
  - `template_assets.store(db, *, template, house_id, file, user) -> DocumentTemplateAsset`
  - `template_assets.load_for_render(db, *, template_id, asset_id, house_id) -> Optional[DocumentTemplateAsset]`
  - `TemplateAssetOut` schema (never exposes `storage_path`).
  - Endpoints: `POST/GET /api/v1/documents/templates/{template_id}/assets`, `GET .../assets/{asset_id}/file`, `DELETE .../assets/{asset_id}`.

- [ ] **Step 1: Write failing tests** in `backend/tests/test_template_assets.py`

Using the `api` fixture pattern from `test_documents_templates.py` (`get_db` + `get_current_user` overrides, `DOC_PERMISSIONS`), assert: upload stores a private file, returns metadata without `storage_path`, and writes one `ActivityLog` row with `module="documents"`, `action="create"`; `GET /assets` lists only non-deleted assets for that template; stream returns `FileResponse` with `Cache-Control: private, no-store`; delete soft-deletes and logs `action="delete"`; a user without `documents.templates.manage` gets 403; `test_asset_other_house_unresolvable` and `test_asset_wrong_template_rejected` assert `load_for_render` returns None for a foreign-house or foreign-template asset; oversized/non-image upload returns 422 with a structured code.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest -q tests/test_template_assets.py`
Expected: FAIL — model/endpoints missing.

- [ ] **Step 3: Implement**

Add the model + Alembic revision (down_revision `b6c7d8e9f0a1`, upgrade/downgrade both sides). Add `template_assets.py` using JPEG/PNG/WebP allow-list, 2 MB cap, uuid filename under `private_uploads/document_template_assets/{house|global}/{template_id}/`. Add the endpoints with `documents.templates.manage` and existing template manageability checks; audit before commit; soft delete only. Wire manual asset resolution into `resolve_image_sources` from Task 2 using `load_for_render`.

- [ ] **Step 4: Run to verify green**

Run: `cd backend && python -m pytest -q tests/test_template_assets.py tests/test_document_images.py`
Expected: PASS. Also run `cd backend && alembic heads` → single head including the new revision.

- [ ] **Step 5: Leave uncommitted**

`git diff --check`. Do not commit.

---

### Task 4: Renderer image block

**Files:**
- Modify: `backend/app/services/document_render.py:192-217`, `:270-348`
- Test: `backend/tests/test_document_render_image.py`

**Interfaces:**
- Consumes: validated AST, `images: Optional[dict[str, str]]`.
- Produces: `render_html(..., images: Optional[dict[str, str]] = None) -> str` with an `image` block case.

- [ ] **Step 1: Write failing tests** in `backend/tests/test_document_render_image.py`

Assert: `images["employee_nid"]` produces `<figure class="doc-image">` containing `<img src="data:image/...` with the block's `max-width`/`max-height` mm; a missing source renders an escaped fallback (`<script>alert(1)</script>` appears as text, never as a tag); `test_image_block_escapes_fallback` covers this; a v1 template with no image blocks renders byte-identically to before.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest -q tests/test_document_render_image.py`
Expected: FAIL — no `image` case.

- [ ] **Step 3: Implement**

Add the `image` branch to `_block_html` and add print CSS (`break-inside: avoid`, `max-width: 100%`, small margin). Add `images=None` to `render_html` and pass it through; default keeps every existing caller working.

- [ ] **Step 4: Run to verify green**

Run: `cd backend && python -m pytest -q tests/test_document_render_image.py tests/test_documents_templates.py`
Expected: PASS.

- [ ] **Step 5: Leave uncommitted**

`git diff --check`. Do not commit.

---

### Task 5: Live preview of unsaved AST

**Files:**
- Modify: `backend/app/schemas/documents.py:41-48`, `backend/app/routers/documents.py:1546-1612`
- Test: `backend/tests/test_documents_preview_ast.py`

**Interfaces:**
- Consumes: `validate_ast`, `resolve_image_sources`, `render_html`, `assert_template_readable`.
- Produces: `PreviewAstIn` (`template_id`, `content_json`, `variables_schema`, `employee_id?`, `letterhead_id?`, `signatory_id?`, `document_data?`) and `POST /api/v1/documents/render/preview-ast`.

- [ ] **Step 1: Write failing tests** in `backend/tests/test_documents_preview_ast.py`

Using the same `api` fixture pattern, assert: a valid draft AST with an unfilled `Add Page` image block returns HTML containing the escaped fallback; `test_preview_ast_no_db_write` asserts no `DocumentTemplateVersion` and no `ActivityLog` row was added; `test_preview_ast_rejects_invalid` sends an unknown block type and gets 422; a foreign-house employee id is rejected; the route requires `documents.templates.view`.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest -q tests/test_documents_preview_ast.py`
Expected: FAIL — 404.

- [ ] **Step 3: Implement**

Add `PreviewAstIn`; add the route beside `/render/preview`, reusing its permission/letterhead/signatory/employee resolution and Bangla-first override, but calling `validate_ast` on the posted body and `resolve_image_sources` with `template_id` from the URL. Never write to DB or audit. Keep `/render/preview` unchanged.

- [ ] **Step 4: Run to verify green**

Run: `cd backend && python -m pytest -q tests/test_documents_preview_ast.py`
Expected: PASS.

- [ ] **Step 5: Leave uncommitted**

`git diff --check`. Do not commit.

---

### Task 6: Generation guards (required image, audience, Bangla parity)

**Files:**
- Modify: `backend/app/routers/documents.py:573-699`, `backend/app/services/document_render.py:67-124`
- Test: `backend/tests/test_documents_resignation_images.py`, `backend/tests/test_resignation_bangla_parity.py`

**Interfaces:**
- Consumes: `collect_image_sources`, `collect_asset_ids`, `resolve_image_sources`, `employee.employee_type`, `resignation_pdf._base_values`, `house_letterhead.placeholder_values`.
- Produces: `IMAGE_SOURCE_MISSING` and `AUDIENCE_MISMATCH` error codes from generation.

- [ ] **Step 1: Write failing tests**

In `test_documents_resignation_images.py`: a required NID source missing → 422 `IMAGE_SOURCE_MISSING` with `sources` containing `employee_nid`, `test_missing_required_image_no_number` asserts no document number consumed and no `DocumentVersion` row; a valid employee generates HTML with page-1 image, `page_break`, page-2 image, `page_break`, page-3 text; replacing the scan then regenerating embeds the new file; manual asset id from another template is rejected. In `test_resignation_bangla_parity.py`: audience `rso` with a `bp` employee → 422 `AUDIENCE_MISMATCH` (`test_audience_mismatch_blocked`); audience `all` accepts both; printed context uses Bengali digits for dates/NID, Bangla-first names, `DESIGNATIONS`, proprietor/POC placeholders while stored `document_data` remains unchanged.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest -q tests/test_documents_resignation_images.py tests/test_resignation_bangla_parity.py`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `_render_document_version`, resolve images **before** `allocate_document_number`; fail with the structured codes when a required source is missing. Enforce RESIGNATION guards (RSO/BP, `Resigned`, letter/NID/letterhead) and root `audience` before rendering. Add the Bangla-first context override for RESIGNATION in `resolve_context` while leaving stored data untouched. Re-resolution on regenerate comes for free from this path.

- [ ] **Step 4: Run to verify green**

Run: `cd backend && python -m pytest -q tests/test_documents_resignation_images.py tests/test_resignation_bangla_parity.py tests/test_resignation_documents.py`
Expected: PASS.

- [ ] **Step 5: Leave uncommitted**

`git diff --check`. Do not commit.

---

### Task 7: Seed the 3-page RESIGNATION template

**Files:**
- Modify: `backend/app/services/document_seed.py:39-107`, `:109-...`
- Test: `backend/tests/test_resignation_template_seed.py`

**Interfaces:**
- Consumes: `document_ast.validate_ast`, `schema_from_keys`, `DEFAULT_BODY_TEXT`.
- Produces: `RESIGNATION_TEMPLATE_NAME`, `build_resignation_ast() -> dict`, `resignation_template_payload() -> tuple`; `seed_documents_module` creates it idempotently.

- [ ] **Step 1: Write failing tests** in `backend/tests/test_resignation_template_seed.py`

Assert: seed creates exactly one global `RESIGNATION` template with one published version, `is_default=True`, `audience="all"`, `schema_version=2`; block order is `image(resignation_letter)`, `page_break`, `image(employee_nid)`, `page_break`, heading/paragraphs, `signature(show_image=True)`; running seed twice does not duplicate or overwrite an edited template; the existing NOC template remains v1 and renders.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python -m pytest -q tests/test_resignation_template_seed.py`
Expected: FAIL — helper missing.

- [ ] **Step 3: Implement**

Add the helpers beside the NOC equivalents and an idempotent insert in `seed_documents_module` (match by global name, never overwrite). Reuse the existing advisory lock.

- [ ] **Step 4: Run to verify green**

Run: `cd backend && python -m pytest -q tests/test_resignation_template_seed.py tests/test_documents_templates.py`
Expected: PASS.

- [ ] **Step 5: Leave uncommitted**

`git diff --check`. Do not commit.

---

### Task 8: Editor workspace UI

**Files:**
- Modify: `frontend/src/app/documents/templates/[id]/page.tsx`
- Create: `frontend/src/app/documents/templates/[id]/_components/OptionsPanel.tsx`, `PageList.tsx`, `ImageSourceControls.tsx`
- Modify: `frontend/src/i18n/translations.ts`

**Interfaces:**
- Consumes: `POST v1/documents/render/preview-ast`, `POST v1/documents/templates/{id}/versions`, asset endpoints, `EntitySelector`, existing `TemplateDeleteButton`/`PageGuideModal`.
- Produces: panel props `{template, ast, fields, employees, assets, audience, onAstChange, onSave, onPublish, onUploadAsset}` and page-splitting helper `splitPages(blocks: AstBlock[]): AstBlock[][]`.

- [ ] **Step 1: Add i18n keys (en + bn)** for panel title, audience label/options, preview employee, add/remove/move page, page counter, source kind labels, manual/dynamic labels, asset picker/upload/delete, align, mm hints, required, fallback, save/publish, preview refresh, and load/validation errors. Confirm no dotted key is rendered.

- [ ] **Step 2: Build the layout** — keep the current header unchanged; below it use `lg:grid-cols-[minmax(0,1fr)_360px]`, one column below `lg` with panel above preview. Left: existing `sandbox=""` iframe + toolbar with `Page N of M`; right: `<OptionsPanel>`. Add content-aware skeletons for template and preview. All controls `min-h-11`, `cursor-pointer`.

- [ ] **Step 3: Implement `PageList`** — derive pages via `splitPages` on `page_break`; `+ Add Page` appends `page_break` + unfilled `image` block (schema bump to 2); per-page select, move up/down, remove; removing the last page keeps one page.

- [ ] **Step 4: Implement `ImageSourceControls`** — `EntitySelector` for preview employee (single, house-filtered, audience-filtered, preview-only) and for manual assets; native toggle for `manual`/`dynamic`; file input for upload (2 MB, JPEG/PNG/WebP) + delete dynamic source `resignation_letter` / `employee_nid`; align toggle, mm inputs, required switch, fallback input. All writes go through `onAstChange`.

- [ ] **Step 5: Wire live preview** — debounce `preview-ast` with the current AST + selected employee; show the returned HTML in the iframe; keep `/render/preview` for the saved version; show translated errors inline; disable all controls while saving (per the previous task's ruling).

- [ ] **Step 6: Verify frontend**

Run: `cd frontend && npm run lint` → 0 errors, warnings no higher than baseline (currently 278). Run `cd frontend && npx tsc --noEmit` → silent. Static 375/768/1280 check: no page-level horizontal scroll, panel stacks above preview below `lg`, 44×44 targets, EN/BN toggle. Do not add a frontend test runner.

- [ ] **Step 7: Leave uncommitted**

`git diff --check`. Do not commit.

---

### Task 9: Create-modal audience + resignation page wiring + final verification

**Files:**
- Modify: `frontend/src/app/documents/templates/_components/CreateTemplateModal.tsx`, `frontend/src/app/employees/resignation-documents/page.tsx`
- Modify: `frontend/src/i18n/translations.ts`
- No backend model/permission/module change.

**Interfaces:**
- Consumes: `TemplateCreateIn` (audience goes inside `content_json`), `GET /v1/documents/templates?document_type_id=RESIGNATION`, draft/generate/download endpoints.
- Produces: audience field in create payload; resignation page template picker + final preview + generate flow.

- [ ] **Step 1: Add audience to the create modal** as a native select (`all`/`rso`/`bp`, default `all`), validated and posted in `content_json.audience`; keep the existing house picker, switch-before-POST ordering, and all controls disabled while saving unchanged.

- [ ] **Step 2: Add the resignation page template card** — load published active RESIGNATION templates with `EntitySelector` (auto-select default), empty state with a link to `/documents/templates`; keep existing upload cards as the source of truth.

- [ ] **Step 3: Wire generate** — final preview via `render/preview`; primary action posts draft → generate → download with `X-House-ID`; on generate failure keep the audited draft and show a translated error + retry link; bring the page header to the shared standard while editing it.

- [ ] **Step 4: Add/adjust en+bn keys** for the card, preview action, empty state, audience field, error codes and subtitle; verify both locale files parse and no dotted key renders.

- [ ] **Step 5: Full verification** — `cd backend && python -m pytest -q`; `cd backend && python -m pytest -q tests/test_entitlement.py tests/test_house_access_guard.py tests/test_tenant_isolation.py`; `cd backend && python -m pytest -q tests/test_plan_modules_parity.py tests/test_module_coverage.py`; `cd frontend && npm run lint`; `cd frontend && npx tsc --noEmit`; `git diff --check`. Confirm `permissions.json`, `modules.py`, nav files, and existing Alembic revisions were not modified except the one new revision. Report actual output.

- [ ] **Step 6: Leave uncommitted** — no commit, merge, or push. Record any deviation in the SDD progress ledger.

---

## Self-Review

- **Spec coverage:** AST v2 → Task 1; manual assets + migration + endpoints + audit → Task 3; dynamic resolver + tenancy → Task 2; renderer → Task 4; live unsaved preview → Task 5; generation guards + Bangla parity → Task 6; seed → Task 7; editor workspace/content-aware skeleton/responsive → Task 8; create-modal audience + resignation page + i18n → Task 9. No spec section is unowned.
- **Type consistency:** `resolve_image_sources(db, *, house_id, template_id, employee, ast)` is identical in Tasks 2, 3, 5, 6; `DocumentTemplateAsset` and `load_for_render` appear only in Task 3 and are consumed through `resolve_image_sources`; `PreviewAstIn` is defined in Task 5 and used in Task 8; `splitPages` is local to the editor.
- **Review Focus:** all five lines have named tests in their owning tasks.
- **Proportion:** the plan pins signatures, exact values and assertions; bodies stay with the implementer.
- **User constraint:** every commit step from the skill template was replaced by an uncommitted `git diff --check` step.
