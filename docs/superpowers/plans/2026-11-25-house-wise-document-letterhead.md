# House-wise Document Letterhead Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/documents/letterheads` an image-only, house-scoped letterhead manager whose image is rendered by every document template.

**Architecture:** Reuse `House.letterhead_image_path` as the single stored asset. Add `documents.letterheads.manage`-guarded image endpoints under `/api/v1/documents/letterheads` that delegate to `house_letterhead` validation/storage, and inject the house image into `document_render.render_html` at all preview/generation call sites. Replace the frontend asset-manager page with a focused upload UI and rewrite its bilingual copy.

**Tech Stack:** Python/FastAPI + SQLAlchemy + pytest; Next.js App Router + TypeScript + Tailwind + sonner.

**Spec:** `docs/superpowers/specs/2026-11-25-house-wise-document-letterhead-design.md`

## Global Constraints

- Permission `documents.letterheads.manage` on every new endpoint and every UI action.
- `X-House-ID` mandatory; use `require_house_context`; never trust `house_id` from a request body.
- Every mutation writes `ActivityLog` with `module="documents"`.
- Every user-visible string in `en` and `bn`; no hardcoded UI copy.
- Standard page header (breadcrumb, 40×40 icon tile, title, `PageGuideModal`, subtitle, divider), skeleton loading, 375/768/1280 responsive.
- No new table, migration, nav item, permission key or leaf route.

## Review Focus

- Missing `X-House-ID` on upload/delete → must be 400, never write to a guessed house.
- Cross-house `X-House-ID` for a tenant user → must be 403.
- Non-image / oversized upload → must be 422 with a structured code, no partial file write.
- House with no image → existing document header/footer behaviour unchanged.
- Template preview and PDF generation both use the image, not just one path.

---

### Task 1: House-scoped image API

**Files:**
- Modify: `backend/app/routers/documents.py` (new routes before `/letterheads/{letterhead_id}` CRUD)
- Test: `backend/tests/test_document_letterhead_image.py`

**Interfaces:**
- Produces: `GET/POST/DELETE /api/v1/documents/letterheads/house-image`, `GET .../house-image/file`; response `data: { house_id, has_image }`.

- [ ] **Step 1: Write failing tests** for GET status, upload stores the house image and writes an audit log, delete clears it and writes an audit log, missing house header returns 400, cross-house header returns 403, invalid upload returns 422, and the stream endpoint serves bytes.
- [ ] **Step 2:** Run `cd backend && python -m pytest -q tests/test_document_letterhead_image.py`; confirm each fails because the endpoint is missing.
- [ ] **Step 3:** Implement the four endpoints using `require_house_context`, `has_permission("documents.letterheads.manage")`, `house_letterhead.store_image/delete_image/image_fs_path`, and `log_activity`.
- [ ] **Step 4:** Run the test file; all tests pass.
- [ ] **Step 5:** Commit.

### Task 2: Render the house image in every template

**Files:**
- Modify: `backend/app/services/document_render.py`
- Modify: `backend/app/routers/documents.py` (`_render_document_version`, preview call site)
- Test: `backend/tests/test_document_letterhead_image.py`

**Interfaces:**
- Consumes: `House.letterhead_image_path`.
- Produces: `render_html(..., house_letterhead_path: Optional[str] = None)`.

- [ ] **Step 1: Write failing tests** asserting the rendered HTML contains the image data URI when a path is given, omits the legacy organization name in that case, and still renders the legacy header when no path is given. Add an API preview test proving a template-preview response contains the image.
- [ ] **Step 2:** Run the test file; confirm the new assertions fail.
- [ ] **Step 3:** Implement `house_letterhead_html(path)` + CSS, wire the optional kwarg into `render_html`, and pass the path from both call sites.
- [ ] **Step 4:** Run the test file; all tests pass.
- [ ] **Step 5:** Commit.

### Task 3: Frontend image-only page

**Files:**
- Modify: `frontend/src/app/documents/letterheads/page.tsx`
- Create: `frontend/src/app/documents/letterheads/_components/HouseLetterheadImageManager.tsx`
- Modify: `frontend/src/i18n/translations.ts` (`en.document_letterheads`, `bn.document_letterheads`)

**Interfaces:**
- Consumes: the four Task 1 endpoints with `X-House-ID`.

- [ ] **Step 1:** Rewrite both i18n namespaces with the image-only keys (title, breadcrumb, subtitle, upload/replace/delete, hint, validation, toasts, loading/error/empty, guide) — identical key paths in `en` and `bn`.
- [ ] **Step 2:** Implement the page component: permission gate, standard header, skeleton, image preview, file input with frontend type/size validation, upload/replace/delete actions with `sonner` toasts, `X-House-ID` on every request.
- [ ] **Step 3:** Replace `DocumentAssetsManager` in `page.tsx` with the new component.
- [ ] **Step 4:** Run `cd frontend && npm run lint` and `cd frontend && npx tsc --noEmit`; fix until clean.
- [ ] **Step 5:** Commit.

### Task 4: Full verification

- [ ] **Step 1:** `cd backend && python -m pytest -q` — all tests pass.
- [ ] **Step 2:** `cd backend && python -m pytest -q tests/test_entitlement.py tests/test_house_access_guard.py tests/test_tenant_isolation.py` — all pass.
- [ ] **Step 3:** `cd frontend && npm run lint` and `cd frontend && npx tsc --noEmit` — clean.
- [ ] **Step 4:** Report exact command output; do not claim success from code reading.
