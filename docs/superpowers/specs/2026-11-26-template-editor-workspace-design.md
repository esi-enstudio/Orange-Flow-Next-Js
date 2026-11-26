# Template Editor workspace + multi-page resignation template — design

Date: 2026-11-26
Status: Draft — awaiting approval

## Intent

Redesign `/documents/templates/[id]` into an authoring workspace:

- **Header** stays exactly as today (breadcrumb, icon/title, `PageGuideModal`, subtitle, divider).
- **Below the header**: left side is the full A4 preview; right side is a persistent options panel.
- The panel owns every authoring control: audience (RSO/BP), preview employee, `+ Add Page`, per-page image source (manual upload **or** employee document), block controls, version notes, save/publish, version history.

The concrete acceptance example is a 3-page resignation letter:

1. Page 1 — handwritten resignation scan (manual upload **or** employee's uploaded document).
2. Page 2 — employee NID.
3. Page 3 — dynamic letter with the house letterhead + signature.

This document **supersedes** `2026-11-24-dynamic-image-blocks-resignation-template-design.md` where they differ. That document remains as history; its AST-v2 / source-bound direction is kept, but three of its non-goals are now reversed by explicit user decision.

## Decisions from the user (2026-11-26)

| Question | Answer |
|---|---|
| Scope | Editor-first **full build**: editor + image/page model + selectors + seeded template + resignation page wiring, one round |
| Image source | **Both**: manual upload and employee-uploaded dynamic document |
| Page model | **`page_break`-backed**; no `pages[]` array, no renderer rewrite |
| Editor employee selector | **Preview data only**; never bind an employee into a template |

## Reversals of the 2026-11-24 spec

- Spec said "no upload endpoint / no file input in the editor" → reversed: a dedicated, house-scoped template-asset upload is required.
- Spec said "employee selector in preview toolbar" → reversed: it lives in the right panel.
- Spec had no audience field → reversed: RSO/BP selector at template creation, enforced server-side.
- Spec centred the work on `/employees/resignation-documents` → reversed: the editor is the primary surface; the resignation page is wired in the same round.

Unchanged from that spec: Bangla-first page 3, 18 mm margins, letterhead/signature reuse, no new permission keys for existing endpoints, idempotent global seed, no cross-house image leakage.

## Architecture

```
CreateTemplateModal ──POST templates──▶ DocumentTemplate (scope, audience in AST root)
        │                                      │
        │                                      ▼
Editor workspace ──POST preview-ast──▶ validate_ast → resolve images → render_html → iframe
        │              │                            │
        │              │                            ├─ dynamic: employee resignation/NID scans
        │              └─POST template assets────────┴─ manual: TemplateAsset (private file)
        │
        └─POST version save/publish──▶ immutable version → PDF pipeline (unchanged)

/employees/resignation-documents ──▶ draft → generate → download (saved GeneratedDocument)
```

### 1. AST schema v2

Extend, do not replace, the flat block list:

- `AST_SCHEMA_VERSION = 2`, `SUPPORTED_AST_VERSIONS = (1, 2)`.
- `BLOCK_TYPES` gains `"image"`.
- `IMAGE_SOURCES = ("resignation_letter", "employee_nid")` (dynamic allow-list).
- Root gains `audience: "rso" | "bp" | "all"` (default `"all"`, so every existing v1 template keeps working).
- Image block shape after `_clean_block` normalisation:

```json
{
  "id": "block-...",
  "type": "image",
  "source_kind": "dynamic",
  "source": "employee_nid",
  "asset_id": null,
  "align": "center",
  "max_width_mm": 170,
  "max_height_mm": 110,
  "required": true,
  "fallback_text": "Employee NID"
}
```

Rules:

| Field | Rule |
|---|---|
| `source_kind` | `dynamic` or `manual`; required for an image block |
| dynamic `source` | must be in `IMAGE_SOURCES`; `asset_id` must be null |
| manual `asset_id` | positive int; `source` must be null; asset must belong to the rendered template |
| `align` | existing `ALIGNMENTS`, default `center` |
| `max_width_mm` / `max_height_mm` | clamped 20–190 / 20–260 |
| `required` / `fallback_text` | bool default `true`; plain text ≤ 200 chars, escaped at render |
| `schema` gate | any image block in a v1 AST is rejected; editor bumps root to `2` on first image |
| `audience` | validated enum; unknown value rejected; preserved by `validate_ast` |

New helpers: `collect_image_sources(ast) -> set[str]` (dynamic keys), `collect_asset_ids(ast) -> set[int]`. `collect_variables()` unchanged.

`Add Page` appends a `page_break` block plus an unfilled `image` block whose fallback reads "Select an image source" — that produces a visible blank page immediately and gives the author somewhere to point the source picker.

### 2. Manual image assets

New table `document_template_assets` (Alembic revision on head `b6c7d8e9f0a1`):

- `id`, `template_id` FK, `house_id` FK **nullable** (NULL = global template asset, shared exactly like a global template), `name`, `storage_path`, `content_type`, `size_bytes`, `uploaded_by`, timestamps, soft-delete columns (`is_deleted`, `deleted_at`, `deleted_by`).
- Indexes: `(house_id, template_id, is_deleted)` and `(template_id, is_deleted)`.
- Private storage: `private_uploads/document_template_assets/{house|global}/{template_id}/{uuid}.{ext}`; allow-list JPEG/PNG/WebP, max 2 MB; read through the existing realpath-guarded `_image_data_uri_from_path()`.

Endpoints under `/api/v1/documents/templates/{template_id}/assets` — all guarded by `documents.templates.manage` and by the existing template readability/manageability checks:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/assets` | upload + metadata, audit `create` |
| `GET` | `/assets` | metadata list for the picker (never `storage_path`) |
| `GET` | `/assets/{asset_id}/file` | private stream for editor thumbnail |
| `DELETE` | `/assets/{asset_id}` | soft delete + audit `delete` |

House scope: a house template requires an explicit `X-House-ID` matching its `house_id`; a global template asset requires the existing global-manage privilege. An asset whose `house_id` is neither NULL nor the active house is never resolvable.

### 3. Image resolution

`backend/app/services/document_images.py` (new):

```python
async def resolve_image_sources(
    db, *, house_id: int, template_id: int, employee, ast: dict
) -> tuple[dict[str, str], list[str]]:
    ...
```

- Dynamic keys use the shared NID/letter selection helpers, filtered by `EmployeeDocument.house_id == house_id`.
- Manual ids load `TemplateAsset`, assert `template_id` match + non-deleted + readable scope, then embed via the guarded helper.
- Never accept a path, filename, URL, or data URI from the client.
- Missing entries are reported in a `missing_sources` list.

`render_html(..., images=None)` gains an `image` case: `<figure class="doc-image">` with `max-width`/`max-height` mm, `object-fit: contain`, `break-inside: avoid`; escaped fallback box when absent.

### 4. Live preview of unsaved edits

New read-only endpoint `POST /api/v1/documents/render/preview-ast`:

- Payload: `template_id`, `content_json`, `variables_schema`, optional `employee_id`, existing `letterhead_id`/`signatory_id`/`document_data` behaviour.
- Runs `validate_ast`, resolves images, applies the Bangla-first override for RESIGNATION, calls `render_html(embed_fonts=False)`, returns HTML.
- No DB write, no version row, no audit (read-only), same permission + house guard as `/render/preview`.
- This is what makes `+ Add Page` visibly add a blank page before saving.

The existing `/render/preview` stays unchanged for saved versions and the resignation page.

### 5. Generation guards

In `_render_document_version` (before document-number allocation):

- Resolve images for the saved AST; if a `required` source is missing → `422 {code: "IMAGE_SOURCE_MISSING", sources: [...]}` (manual ids reported as `manual:<id>`). No number consumed, no PDF written.
- For `RESIGNATION`: enforce employee type RSO/BP, status `Resigned`, letter/NID/letterhead presence (reuse existing codes), **and** template `audience` — `rso`/`bp` must match `employee.employee_type`; `all` accepts both. Mismatch → new `AUDIENCE_MISMATCH` code with a translated message.
- Bangla-first print context from `resignation_pdf._base_values()` + `house_letterhead.placeholder_values()`; stored `document_data` untouched.
- `regenerate` re-resolves images, so replacing a scan or asset then regenerating uses the new image.

### 6. Editor workspace UI

File: `frontend/src/app/documents/templates/[id]/page.tsx`.

- Header unchanged. Content area `lg:grid-cols-[minmax(0,1fr)_360px]`; below `lg`, one column with the panel above the preview, 8 px outer gutter, 44×44 targets.
- **Left**: sticky-ish A4 preview in the existing `sandbox=""` iframe; toolbar with "Page N of M" and refresh; renders `/render/preview-ast` on every edit (debounced) or on explicit refresh, and `/render/preview` for the last saved version.
- **Right panel**, sections:
  1. **Audience** — native select consistent with the create modal (`all` / `rso` / `bp`), editable here too.
  2. **Preview employee** — `EntitySelector` (searchable, `single`), items filtered by active house and by audience; preview-only, never persisted into the template.
  3. **Pages** — ordered list derived by splitting blocks on `page_break`; per page: select, move up/down, remove; `+ Add Page` button.
  4. **Image source** for the selected page: toggle `Manual upload` / `Employee document`; manual → asset `EntitySelector` + upload input + delete; dynamic → `resignation_letter` / `employee_nid`; align toggle, mm inputs, required switch, fallback input.
  5. Existing text/signature block controls (unchanged behaviour).
  6. Version notes, Save draft, Publish, version history (unchanged behaviour).
- New select-like UI uses `EntitySelector`; the two/three-option native selects follow the existing modal pattern (recorded ruling).
- Content-aware skeleton while loading template/preview; errors shown inline with field-level and translated general errors.

### 7. Create Template modal

- Add `audience` to the form and to `content_json` root (native select, default `all`); no API/model/DB column change.
- Keep the just-completed house picker and switch-before-POST behaviour untouched.
- All controls remain disabled while `saving` (from the previous task).

### 8. Seeded template + resignation page

- `document_seed.py`: add a second idempotent global `RESIGNATION` template (schema v2, published, `is_default`, `audience: "all"` so both RSO and BP work) with block order:
  `image(resignation_letter, required)` → `page_break` → `image(employee_nid, required)` → `page_break` → heading/paragraphs from `DEFAULT_BODY_TEXT` → `signature(show_image=true)`.
- `/employees/resignation-documents`: keep the upload cards; add template picker (`EntitySelector`, auto-select default), final-document preview, and switch Generate to draft → generate → download. Failed generate keeps the audited draft and shows a retry link. Legacy package endpoint left in place but not surfaced.
- Bring that page's header to the shared standard while editing it.

### 9. Security, tenancy, audit, i18n, responsive

- **Permissions**: reuse `documents.templates.view/manage`, `documents.create/generate/download`, `employees.resignation_*`. No new permission key.
- **Tenancy**: every new model and query is house-scoped; global assets use the same `NULL` scope rule as global templates; employee scans are filtered by house; no client path ever reaches the filesystem.
- **Audit**: asset upload/delete and the existing version save/publish/generate mutations log via `log_activity`; preview and reads do not.
- **Validation**: all new inputs validated server-side; frontend validation is UX only.
- **i18n**: add `en` + `bn` keys for audience labels, page controls, image source labels, asset actions, missing-image/audience errors, preview toolbar, seed description, and resignation-page copy. No dotted key rendered literally; dynamic house/employee values stay backend-provided.
- **Responsive**: 375 / 768 / 1280 verified, no horizontal page scroll, 44×44 touch targets, panel stacks above preview on mobile; iframe scroll stays contained.
- **Next.js 16.4.6**: read the relevant guide under `frontend/node_modules/next/dist/docs/` before writing frontend code (`frontend/AGENTS.md` is binding).

### 10. Tests and verification

Backend TDD (failing test first, then implementation):

1. `test_document_ast_image_block.py` — v1 rejection, v2 normalisation for both source kinds, clamping, unknown source, asset id rules, `audience` validation, `collect_*` helpers.
2. `test_document_images.py` — dynamic scan + manual asset embedding, cross-house leakage blocked, wrong-template asset blocked, missing list.
3. `test_template_assets.py` — permission, house scope, upload validation, stream, soft delete, audit rows.
4. `test_documents_preview_ast.py` — unsaved AST preview returns HTML, writes nothing, rejects invalid AST.
5. `test_documents_resignation_images.py` — 3-page order, per-employee images, regenerate after replacing a scan/asset.
6. `test_resignation_template_seed.py` — one published v2 seed, idempotent, no overwrite.
7. `test_resignation_bangla_parity.py` — Bengali digits/names/designation/proprietor placeholders.
8. Existing suites stay green: `test_resignation_documents.py`, `test_documents_templates.py`, plan guards, tenancy/billing guards.

Commands: `cd backend && python -m pytest -q`; targeted tenancy/billing/plan guards per `AGENTS.md`. Frontend: `cd frontend && npm run lint`, `npx tsc --noEmit`, plus 375/768/1280 and EN/BN checks. No frontend test runner installed.

## Left to the builder

- Exact helper placement (`document_images.py` vs extending `employee_documents.py`), provided no router imports another router.
- Debounce interval for live preview and exact mm defaults within the clamp ranges.
- Whether the create-modal audience select is native or `EntitySelector` (design default: native, matching the modal).
- Whether the generated-document link opens in the same tab or a new tab.

## Approval gate

This document is the gate. Implementation and the detailed plan start only after the user approves it or supplies corrections. No commit, merge, or push without explicit permission.
