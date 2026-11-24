# Dynamic image blocks for the resignation template — design

Date: 2026-11-24
Status: Review complete — awaiting final approval

## Intent

The user wants to build a 3-page resignation document **from the Document Template Editor**:

1. Page 1 — the user-uploaded handwritten resignation letter image.
2. Page 2 — the selected employee's NID image.
3. Page 3 — the system-generated letter (variables + letterhead + signature).

The main working surface must be `/employees/resignation-documents`. The upload UI and the stored scans that page already owns must feed the template; the editor must not become a second upload system.

Today the editor supports only `heading`, `paragraph`, `spacer`, `divider`, `signature`, and `page_break` (`document_ast.py:45-52`). The existing resignation PDF is a standalone flow (`employees.py:1207-1269`, `resignation_pdf.py:241-254`) and does not create a `GeneratedDocument`. The chosen approach is a **source-bound image block**: the template stores *which* image to place, not the image bytes.

Confirmed with the user after the builder check:

- Deliver **both** the editor capability and a ready-made, seeded 3-page `RESIGNATION` template.
- Page 1/2 use **standard 18mm page margins** (in-flow image blocks), not full-bleed pages.
- Page 3 preserves today's **Bangla-first output**: Bengali digits, Bangla names/house values, and proprietor/POC placeholders.

## Goals

- Add an `image` block to the template AST whose image is resolved at preview/generation time from the selected employee's already-uploaded resignation documents.
- Let an author assemble the exact 3-page structure in the Template Editor using `image`, `page_break`, and existing text/signature blocks.
- Seed a published global `RESIGNATION` template with that exact 3-page structure so the resignation page works immediately and the author still has something to edit.
- Make `/employees/resignation-documents` generate the document through the Document Automation flow, so the result is a saved `GeneratedDocument` with a number, version, PDF history, and audit trail.
- Keep all tenant isolation, permissions, validation, i18n, and audit guarantees.

## Non-goals

- No new upload endpoint and no file input in the Template Editor.
- No static/base64 image embedded in template JSON — that would freeze one employee's NID/letter into every generated document.
- No generic user-supplied image URL in the AST. All image paths are resolved server-side.
- No new `DocumentLetterhead` or `DocumentSignatory` setup for this flow: it reuses the house's existing resignation letterhead image and proprietor signature.
- No full-bleed page layout in v1; image blocks stay inside the AST page margins.
- No new DB table or migration. `content_json` is already JSONB; only the in-JSON schema version changes.
- No change to the existing `/documents/create` draft/PDF flow except that it must keep rendering old templates unchanged.

## Anti-goals

- Cross-house image leakage: a template used in house A must never read an employee document from house B.
- Silent missing images in generated PDFs: generation must fail with a clear, localized error when a `required` image source is absent.
- Breaking the seeded NOC template: schema v1 remains valid and renderable.

## Constraints

- Backend AST is validated in `backend/app/services/document_ast.py`; rendering happens in `document_render.py`; PDF uses Chromium with JS disabled and network blocked (`document_pdf.py` → `resignation_pdf.render_pdf`).
- `document_data` is `Dict[str, str]` and the router rejects unknown/read-only keys (`documents.py:468-509`). Image sources must therefore **not** be represented as `document_data` fields.
- Preview already accepts `employee_id`, `letterhead_id`, `signatory_id`, and `document_data` (`schemas/documents.py:41-48`).
- Generation already resolves `employee`, `house`, `letterhead`, and `signatory`, allocates a document number, renders HTML, stores a PDF, and audits (`documents.py:529-654`).
- Existing resignation image helpers exist: `latest_document()` (`employee_documents.py:401-415`) and `_resignation_nid_scans()` (`employees.py:892-935`).
- Today's resignation PDF uses `resignation_pdf._base_values()` and `house_letterhead.placeholder_values()` for Bangla-first values (`resignation_pdf.py:97-117`, `house_letterhead.py:103-121`). Document automation's default `resolve_context()` prints raw employee/house values, so parity needs an explicit override for RESIGNATION templates.
- The legacy package endpoint enforces RSO/BP, `Resigned`, and express error codes (`employees.py:1217-1234`). The new path must enforce the same rules server-side; frontend disabling is not sufficient.
- Distributor and Manager roles already carry both `employees.resignation_*` and `documents.view/create/edit/generate/download/regenerate/void` (`permissions.json:653-694`, `:757-770`). No new permission key is required.
- Frontend has no test runner. Verification is lint + `tsc --noEmit` + 375/768/1280 browser checks. Backend uses pytest with TDD.

## Approaches considered

### A. Static upload block — rejected

The author uploads a JPG/PNG into the editor and its base64 is stored in `content_json`.

- Simple to render.
- Wrong product behavior: the same handwritten letter/NID would appear for every employee. It also inflates template versions and duplicates storage.

### B. Rich-text image block — rejected

Reuse the house-letterhead `RichTextEditor` data-URI pattern inside a paragraph.

- Familiar editor behavior.
- Still static, harder to sanitize, and mixes image layout with text variables. It does not express "this page is the employee's NID".

### C. Source-bound image block — chosen

The AST stores `source: "resignation_letter" | "employee_nid"`. At preview/generation time the backend resolves that source from the selected employee using the existing private, house-scoped document records and embeds a data URI.

- Per-employee images, no duplicate upload flow.
- No new permissions or tables.
- Preview can show a placeholder until an employee is selected, then show the real scan.
- Requires an AST schema bump and a small resolver/render change.

## Design

### 1. AST schema v2

- `AST_SCHEMA_VERSION = 2`; `SUPPORTED_AST_VERSIONS = (1, 2)`.
- `BLOCK_TYPES` gains `"image"`.
- New `IMAGE_SOURCES = ("resignation_letter", "employee_nid")`. The registry is intentionally small; more sources can be added later without another schema bump.
- New helper `collect_image_sources(ast) -> set[str]` scans image blocks so routers know what to resolve.

Image block shape (normalized by `_clean_block`):

```json
{
  "id": "block-...",
  "type": "image",
  "source": "resignation_letter",
  "align": "center",
  "max_width_mm": 170,
  "max_height_mm": 240,
  "required": true,
  "fallback_text": "Handwritten resignation letter"
}
```

Rules:

| Field | Rule |
|---|---|
| `source` | Must be in `IMAGE_SOURCES`. Unknown source → `AstError`. |
| `align` | Existing `ALIGNMENTS` enum. Default `center`. |
| `max_width_mm` | Number clamped to 20–190. Default 170. |
| `max_height_mm` | Number clamped to 20–260. Default 240. |
| `required` | Bool, default `true`. |
| `fallback_text` | Plain text, max 200 chars, HTML-escaped at render. Used in preview only. |
| schema gate | An `image` block in a `schema_version: 1` AST is rejected with a clear error. The editor upgrades the root to `2` when the first image block is added. |

`collect_variables()` is unchanged: fallback text is literal, not a variable token. Old v1 templates keep their exact normalization.

### 2. Image resolution service

Add `backend/app/services/document_images.py` (or extend `employee_documents.py` if imports stay cleaner — builder's call).

Public behavior:

```python
async def resolve_image_sources(
    db, *, house_id: int, employee, sources: set[str]
) -> tuple[dict[str, str], list[str]]:
    ...
```

- Returns `{source: "data:image/webp;base64,..."}` and `missing_sources`.
- For `resignation_letter`: `latest_document(db, employee.id, ("resignation_letter",))`.
- For `employee_nid`: reuse the NID selection heuristic currently in `_resignation_nid_scans`. Extract that helper into a shared module so the employees router and this resolver use one implementation.
- Query additionally filters `EmployeeDocument.house_id == house_id` as defense in depth. The employee is already house-validated by `_employee_for_house` / `_assert_house_access` before this runs.
- Read the stored file through `document_render._image_data_uri_from_path()`, which already blocks `../` traversal and missing files.
- No path, filename, or data URI is accepted from the client.
- For resignation sources, require the house letterhead image to be configured, matching today's `LETTERHEAD_NOT_CONFIGURED` business rule.

The employees router keeps its existing upload/delete/package endpoints. This change extracts a helper; it does not alter those endpoints' permissions or storage layout.

### 3. Renderer and PDF

- `document_render.render_html(..., images: Optional[dict[str, str]] = None)` — default keeps all current callers working.
- `_block_html()` gains an `image` case:
  - If `images[source]` exists: emit `<figure class="doc-image" style="text-align:..."><img src="data:..." style="max-width:...mm;max-height:...mm;object-fit:contain"></figure>`.
  - If missing: emit an escaped fallback box in preview. Generation will have failed earlier for `required` sources, so this is preview-only in practice.
- Add print CSS: `break-inside: avoid`, small margin, `max-width: 100%`. Page breaks remain explicit `page_break` blocks, so no automatic flow magic is introduced.
- Existing letterhead/footer/signature rendering is unchanged. Page 3 is just ordinary text/signature blocks plus the already-resolved letterhead.

### 4. Router behavior

**Preview** (`POST /api/v1/documents/render/preview`):

- After selecting the template version, call `collect_image_sources(version.content_json)` and resolve them with the payload's `employee_id` and `house_context`.
- Missing images do **not** fail preview; the placeholder renders.
- Pass `images=` into `render_html`.

**Generate / regenerate** (`_render_document_version`):

- Resolve image sources before `allocate_document_number`.
- If a `required` source is missing, raise `422` with:

```json
{
  "detail": {
    "code": "IMAGE_SOURCE_MISSING",
    "message": "A required image is missing",
    "sources": ["employee_nid"]
  }
}
```

- For documents whose type is `RESIGNATION`, run the existing business guards before rendering: employee type must be RSO/BP, status must be `Resigned`, and the same `RESIGNATION_LETTER_MISSING` / `NID_MISSING` / `LETTERHEAD_NOT_CONFIGURED` codes are reused where applicable.
- For `RESIGNATION`, override the printable context with a Bangla-first resolver built from `resignation_pdf._base_values()` and `house_letterhead.placeholder_values()`: Bengali digits for dates/NID, Bangla-first employee and house names, `DESIGNATIONS` for designation, and proprietor/POC placeholders. This affects printed variables only; stored `document_data` stays unchanged.
- No document number is consumed and no PDF is written on validation failure.
- `regenerate` re-resolves images at regeneration time, so replacing a scan then regenerating produces the updated page.
- No `document_data` contract change; no unknown-key risk.
- Preview applies the same Bangla-first override so the author sees the final text.

### 5. Template Editor UI

File: `frontend/src/app/documents/templates/[id]/page.tsx`

- `BlockType` union gains `"image"`; add an **Image** button beside the existing block buttons.
- `makeBlock("image")` returns the defaults above. The add-block handler sets AST root `schema_version = 2` when an image block is added.
- Inline block controls, using existing shadcn/project primitives (use `EntitySelector` for the source rather than a hand-built select):
  - Source: `resignation_letter` / `employee_nid`, with bilingual labels.
  - Align: `ToggleGroup` (left/center/right).
  - Max width / max height: numeric inputs in mm with min/max hints.
  - Required: `Switch`.
  - Fallback text: `Input`.
- Preview toolbar gains an optional **Preview employee** `EntitySelector`. It sends `employee_id` to the existing preview endpoint. With no employee, image blocks show their fallback placeholder.
- Add block descriptions in the editor sidebar so the author understands: source images come from the employee's resignation uploads, not from the editor.
- The previously added New Template modal keeps posting `content_json: { blocks: [] }`; the editor upgrades to v2 when the author adds an image. No API payload change needed there.

Authoring the requested template:

```text
[image: resignation_letter, required, max 170×240mm]   ← page 1
[page_break]
[image: employee_nid, required, max 170×110mm]         ← page 2
[page_break]
[heading: পদত্যাগপত্র / Resignation Letter]
[paragraph: {{ employee_name }}, {{ designation }}, {{ resigned_date }}, …]
[signature: show_image = true]                         ← page 3
```

The author publishes a version from the editor as today.

### 6. `/employees/resignation-documents` integration

File: `frontend/src/app/employees/resignation-documents/page.tsx`

- Keep the existing upload/replace/delete cards for handwritten letter, NID, and letterhead. They are the source of truth for the image blocks.
- Add a **Document template** card above the Generate action:
  - Load published, active templates for document type `RESIGNATION` via `GET /api/v1/documents/templates?document_type_id=...&per_page=100`, same filtering pattern as `/documents/create`.
  - Select via `EntitySelector`; auto-select the default template when present.
  - Empty state when no published resignation template exists: short explanation + link to `/documents/templates`.
- The seeded template uses only auto-resolved variables, so no new form is needed for the default path. If a selected template declares editable schema fields, render a compact dynamic field group from `variables_schema` (same field renderer pattern as `/documents/create`) and submit only those non-readonly keys through `document_data`; unknown/read-only keys are never sent.
- Add **Preview final document**: calls `POST /api/v1/documents/render/preview` with selected `template_id`, current `employee_id`, and the typed editable values; renders the returned HTML in the existing safe iframe pattern (`sandbox=""`).
- Replace the primary Generate button's action with the Document Automation sequence:

```text
POST /api/v1/documents            → draft record (documents.create)
POST /api/v1/documents/{id}/generate → saved version + PDF (documents.generate)
GET  /api/v1/documents/{id}/versions/{v}/download → download (documents.download)
```

  All calls send `X-House-ID`; page-level guard stays `employees.resignation_view` and the button also checks `employees.resignation_generate` plus the three `documents.*` permissions.
- On success, auto-download the generated PDF and also show a link to `/documents`, because the generated document now has history there.
- A create succeeds before generate runs. If generate fails, keep the `DRAFT` record and show the structured error plus a "Retry from Documents" link; do not silently delete an audited record.
- Keep `POST /api/employees/{id}/resignation-package` as a backward-compatible endpoint, but it is no longer the primary UI action. Builder may expose it as a secondary "Legacy PDF" action only if that is trivial; otherwise leave it unexposed.
- Bring this page's header into the shared standard while it is being edited: breadcrumb, 40×40 icon tile, `<h1>`, `PageGuideModal` immediately after the heading, subtitle, divider.

### 6a. Seeded 3-page template

Add a second seeded global template in `backend/app/services/document_seed.py`, alongside the existing NOC template:

- Document type: `RESIGNATION` (`code = "RESIGNATION"`, already seeded at `document_seed.py:29-37`).
- `schema_version: 2`, published version, `is_default = true` for this type.
- Blocks in order:

```text
image(source=resignation_letter, required=true)   ← page 1
page_break
image(source=employee_nid, required=true)         ← page 2
page_break
heading / paragraphs built from house_letterhead.DEFAULT_BODY_TEXT
signature(show_image=true)                        ← page 3
```

- `variables_schema.fields` covers the tokens used in the body (`application_date`, `house_name`, `house_address`, `employee_name`, `fathers_name`, `nid`, `joining_date`, `resigned_date`, `designation`, `proprietor_name`, `proprietor_contact`). All are auto-resolved/read-only, so the resignation page needs no new data-entry form.
- Seeding must be idempotent: create only when absent, never overwrite an operator's edited template.
- Global scope means the template definition is shared; letterhead, signature, and employee scans are still resolved from the current house and selected employee.

### 7. Permissions, tenancy, audit

- No new permission keys. Backend endpoints remain guarded by their current `has_permission(...)` checks; the resignation page keeps its existing guards.
- No new model: `GeneratedDocument` already has `house_id`, indexes, versions, and audit hooks.
- Template reading remains governed by `assert_template_readable`; global templates are usable across houses but image resolution is always in the current house and selected employee.
- New mutations are only template version save and generated-document create/generate — both already audited. Upload/delete/package audit rows stay unchanged.
- Preview is read-only; no audit row.

### 8. i18n and responsive

- Add `en` and `bn` keys for: image block label/source labels/field labels, missing-image error, template card, preview action, empty state, and the new header subtitle. All UI strings go through `t()`; no dotted key may render literally.
- Keep the existing one-column mobile layout below `sm`; template controls and the new cards stack. Controls keep 44×44px touch targets. The iframe preview keeps contained horizontal scrolling only if the generated HTML needs it; the page itself must not scroll horizontally at 375px.
- Follow the project's mandated primitives: `EntitySelector`, shadcn inputs/buttons/switch/toggle group, skeleton, right-side filter drawer if filters are ever added. `frontend-design` suggestions may adjust spacing/hierarchy but may not replace these primitives.

### 9. Tests (TDD, backend)

Write failing tests first, then minimal code:

1. `test_document_ast_image_block.py`
   - v2 image block accepted and normalized with defaults/clamps.
   - image block in v1 AST rejected.
   - unknown `source` rejected.
   - `collect_image_sources()` returns both sources from a 3-page AST.
2. `test_document_render_image.py`
   - image data URI renders into `<img>`, fallback text is escaped.
   - missing required source fails generation with `IMAGE_SOURCE_MISSING` and no number consumed.
3. `test_documents_resignation_images.py`
   - preview resolves the uploaded letter and NID for the selected employee only.
   - employee document from another house is never selected.
   - generated HTML has page-1 image, `page_break`, page-2 image, `page_break`, page-3 text.
   - replacing a scan and regenerating uses the new scan.
4. `test_resignation_template_seed.py`
   - Seed creates one published v2 `RESIGNATION` template with the exact block order above.
   - Re-running seed does not duplicate or overwrite edits.
5. `test_resignation_bangla_parity.py`
   - Preview/generation context prints Bengali digits for dates/NID, Bangla-first employee/house names, `DESIGNATIONS`, and proprietor/POC placeholders.
6. Existing `test_resignation_documents.py`, `test_documents_templates.py`, and plan/tenancy guard tests must stay green.

Frontend verification: `npm run lint`, `npx tsc --noEmit`, browser checks at 375/768/1280 plus EN/BN toggle and validation.

## Left to the builder

- Exact helper placement (`document_images.py` vs extending `employee_documents.py`) as long as no router imports another router.
- Exact mm defaults within the documented clamp ranges, CSS micro-spacing, and i18n key names.
- Whether to expose the legacy PDF action as a secondary button; the design's default is not to expose it in v1.
- Whether the generated-document link opens `/documents` in the same tab or a new tab.

## Decisions recorded from conversation and builder check

- The user chose **Approach C** and confirmed the work is centered on `/employees/resignation-documents`.
- The user chose a seeded ready template, standard margins, and Bangla-first parity.
- Settled without further user input: house letterhead/signature assets are reused; backend enforces RSO/BP + `Resigned` + express error codes; editable schema fields get a compact dynamic form when present; success auto-downloads and links to `/documents`; failed generation keeps the audited draft with a retry link.

This document is the approval gate. Implementation and the detailed plan start only after the user approves it (or supplies corrections).
