# House-wise Document Letterhead Image — Design

**Date:** 2026-11-25

## Intent

`/documents/letterheads` should become a house-scoped, image-only letterhead manager. A user uploads one letterhead image for the currently selected house; every generated document template renders that image. The page must not expose global scope, organization/contact text fields, per-record letterhead CRUD, or logo uploads.

## Why

The user explicitly wants one house-wise letterhead image as the single source of truth for document output, with no separate logo/branding records on this page.

## Goals

- Upload/replace/delete one letterhead image per house from `/documents/letterheads`.
- Store it in the existing `House.letterhead_image_path` (same asset the house letterhead page uses) — no duplicate storage.
- Every document template, on preview and PDF generation, renders the selected house's image at the top of the document.
- All mutations are permission-checked, house-scoped and audit-logged.
- Bilingual (en/bn) copy, standard page header, content-aware skeleton, responsive 375/768/1280.

## Non-goals

- No new database table or migration.
- No change to `/houses/letterhead` layout editor or signature APIs.
- No template-level letterhead picker (the house image is implicit for every template).
- No removal of the legacy `DocumentLetterhead` CRUD APIs; they stay for API compatibility and old documents.

## Approaches considered

1. **Reuse `House.letterhead_image_path` (chosen).** Add house-scoped image endpoints under `/api/v1/documents/letterheads` guarded by `documents.letterheads.manage`, delegating to `house_letterhead.store_image/delete_image`. Templates read the same field. No duplicate bytes, no new model, no migration.
2. Make `DocumentLetterhead` house-only and image-only. Requires a migration to relax `organization_name`, drops global records and duplicates the already-stored house image. Rejected.
3. Reuse `/api/houses/{id}/letterhead/image` directly. Requires broadening that endpoint's permission or giving page users `houses.letterhead_edit`; weaker separation between the two pages. Rejected.

## Design

### Backend

- New endpoints in `backend/app/routers/documents.py`, registered before the `/letterheads/{letterhead_id}` CRUD routes:
  - `GET /api/v1/documents/letterheads/house-image` → `{ success, data: { house_id, has_image } }`.
  - `GET /api/v1/documents/letterheads/house-image/file` → permission-guarded `FileResponse`.
  - `POST /api/v1/documents/letterheads/house-image` (multipart `file`) → validates/stores via `house_letterhead.store_image`, commits, writes `ActivityLog` (`module="documents"`, `action="edit"`).
  - `DELETE /api/v1/documents/letterheads/house-image` → `house_letterhead.delete_image`, commits, writes `ActivityLog` (`action="delete"`).
- All four use `require_house_context` + `has_permission("documents.letterheads.manage")`.
- `document_render.render_html(..., house_letterhead_path=None)`:
  - when a path is present, emit an `<img class="house-letterhead">` block with a data URI and skip the legacy logo/header and footer;
  - when absent, keep the existing `letterhead_html()`/`footer_html()` behaviour.
- Pass `house.letterhead_image_path` from every render call site (generation, regeneration via `_render_document_version`, and template preview).

### Frontend

- Replace `DocumentAssetsManager` on `/documents/letterheads` with a new focused component: standard breadcrumb + 40×40 icon tile + `<h1>` + `PageGuideModal` + subtitle + divider; house-scoped upload card with image preview, upload/replace, delete, error and skeleton states.
- Every request sends `X-House-ID`; permission `documents.letterheads.manage` gates the page and the buttons.
- Rewrite the `document_letterheads` i18n namespace in both `en` and `bn` (title, subtitle, breadcrumb, fields, validation, toasts, empty/loading/error, guide).

### Security / tenancy / audit

- `X-House-ID` is mandatory for mutations and reads; `require_house_context` rejects cross-house and missing context.
- No `house_id` in request bodies.
- Every mutation writes an append-only `ActivityLog` row with house-identifying `record_identifier`.

### Verification

- `cd backend && python -m pytest -q` (new endpoint + render tests included).
- `cd backend && python -m pytest -q tests/test_entitlement.py tests/test_house_access_guard.py tests/test_tenant_isolation.py`.
- `cd frontend && npm run lint`.
- `cd frontend && npx tsc --noEmit`.

## Open calls made by the builder

- Keep legacy `DocumentLetterhead` APIs intact for compatibility; the page no longer uses them.
- If a house has no image, generated documents keep the previous header/footer behaviour.
- Full-page image is rendered at content width (`width:100%; height:auto`), matching the existing print rule.
