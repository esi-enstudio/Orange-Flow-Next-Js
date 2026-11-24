# Dynamic Image Blocks for Resignation Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a source-bound `image` block to the document template system, seed a ready 3-page Bangla-first RESIGNATION template, and make `/employees/resignation-documents` generate it as a saved, audited document.

**Architecture:** AST v2 adds an `image` block whose `source` is an allow-listed key. A resolver reads the selected employee's already-uploaded private resignation scans, embeds them as data URIs at preview/generation time, and the existing PDF/version/audit pipeline stores the result. The resignation page reuses house letterhead/signature assets and existing permissions; no new table, upload endpoint, permission, or route is introduced.

**Tech Stack:** Python/FastAPI + SQLAlchemy, Pydantic schemas, pytest; Next.js App Router, TypeScript, shadcn/ui, `EntitySelector`, Tailwind v4, `apiClient`, i18n `en`/`bn`.

**Spec:** `docs/superpowers/specs/2026-11-24-dynamic-image-blocks-resignation-template-design.md`

## Global Constraints

- Backend AST schema v2: `AST_SCHEMA_VERSION = 2`, `SUPPORTED_AST_VERSIONS = (1, 2)`; v1 templates must keep rendering unchanged.
- `validate_ast()` must preserve the incoming `schema_version` in its return value, not replace it with `AST_SCHEMA_VERSION`.
- `IMAGE_SOURCES = ("resignation_letter", "employee_nid")` only. No URL, path, filename, or data URI may come from the client.
- Image block limits: `max_width_mm` 20–190 default 170; `max_height_mm` 20–260 default 240; `fallback_text` max 200 chars; `align` from existing `ALIGNMENTS`; `required` default `true`.
- Page 1/2 use standard AST margins (18mm default), not full-bleed pages. `page_break` blocks remain explicit.
- Page 3 Bangla-first parity: Bengali digits for dates/NID, Bangla-first employee/house names, `DESIGNATIONS` for designation, proprietor/POC placeholders from `house_letterhead.placeholder_values()`.
- Reuse house letterhead image + proprietor signature. Do not require `DocumentLetterhead` or `DocumentSignatory` setup for this flow.
- Backend must enforce RSO/BP, `Resigned`, and the existing error codes `RESIGNATION_LETTER_MISSING`, `NID_MISSING`, `LETTERHEAD_NOT_CONFIGURED`, `RESIGNATION_FILE_MISSING`.
- No new permission key. Roles already have `employees.resignation_*` and `documents.view/create/edit/generate/download/regenerate/void` (`backend/config/permissions.json:653-694`, `:757-770`).
- Every query touching employee scans must filter by both employee and house. `X-House-ID` remains the only house-context source.
- Every mutation already has an audit hook: template version save, document create/generate, resignation upload/delete. Do not add an unaudited mutation.
- Every user-visible string needs `en` and `bn` keys in `frontend/src/i18n/translations.ts`.
- Mandated UI primitives win over style-skill suggestions: `EntitySelector`, shadcn inputs/buttons/switch, skeleton, right-side filter drawer if filters are added. No hand-built select/multi-select.
- Frontend has no test runner per AGENTS.md. Frontend tasks verify with `npm run lint`, `npx tsc --noEmit`, and 375/768/1280 browser checks.
- Before writing frontend code, read the relevant guide under `frontend/node_modules/next/dist/docs/` per `frontend/AGENTS.md`.
- Do not stage unrelated pre-existing uncommitted files.

## Review Focus

| Input / condition | Expected behavior | Test that pins it |
|---|---|---|
| Employee scan belongs to another house | Never selected; source reported missing | `test_other_house_scan_is_never_selected` in Task 2 |
| Required image absent at generation | 422 `IMAGE_SOURCE_MISSING`, no number consumed, no PDF | `test_generate_missing_required_image_does_not_consume_number` in Task 4 |
| Unknown or v1 image block | AST rejected with clear error; old v1 blocks still accepted | `test_image_block_requires_schema_v2` and `test_v1_text_template_still_validates` in Task 1 |
| Bangla-first values | Bengali digits/names in preview and generated HTML | `test_resignation_context_values_are_bangla_first` in Task 3 |
| Regeneration after scan replacement | New scan embedded in new version | `test_regenerate_uses_replacement_scan` in Task 4 |

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/app/services/document_ast.py` | AST v2 block validation and image-source collection |
| `backend/app/services/employee_documents.py` | House-scoped latest-document/NID lookup helpers |
| `backend/app/services/document_images.py` | Resolve allow-listed image sources to private data URIs |
| `backend/app/services/document_render.py` | Render image blocks and Bangla-first resignation context |
| `backend/app/routers/documents.py` | Preview/generate/resignation guards wiring |
| `backend/app/routers/employees.py` | Reuse extracted NID helper; behavior unchanged |
| `backend/app/services/document_seed.py` | Seed published v2 RESIGNATION template |
| `frontend/src/app/documents/templates/[id]/page.tsx` | Add image block authoring + employee-aware preview |
| `frontend/src/app/employees/resignation-documents/page.tsx` | Template selection, preview, document automation generation |
| `frontend/src/i18n/translations.ts` | `en`/`bn` keys for all new copy |
| `backend/tests/test_document_ast_image_block.py` | AST v2 tests |
| `backend/tests/test_document_images.py` | Resolver and tenancy tests |
| `backend/tests/test_documents_resignation_images.py` | Preview/generate/regenerate tests |
| `backend/tests/test_resignation_template_seed.py` | Seed tests |

---

### Task 1: AST v2 image block

**Files:**
- Modify: `backend/app/services/document_ast.py:42-60`, `:175-256`, `:263-273`
- Test: `backend/tests/test_document_ast_image_block.py`

**Interfaces:**
- Consumes: none.
- Produces:
  - `AST_SCHEMA_VERSION: int = 2`
  - `SUPPORTED_AST_VERSIONS = (1, 2)`
  - `BLOCK_TYPES` includes `"image"`
  - `IMAGE_SOURCES = ("resignation_letter", "employee_nid")`
  - `_clean_block(raw: dict, schema_version: int) -> Optional[dict]`
  - `collect_image_sources(ast: dict) -> set[str]`
  - `validate_ast(payload: dict) -> dict` preserving `payload["schema_version"]`

- [ ] **Step 1: Write the failing tests**

```python
def test_image_block_requires_schema_v2():
    ast = {
        "schema_version": 1,
        "page": {"orientation": "portrait"},
        "blocks": [{"type": "image", "source": "employee_nid"}],
    }
    with pytest.raises(AstError, match="schema version 2"):
        document_ast.validate_ast(ast)


def test_v2_image_block_normalizes_defaults():
    ast = document_ast.validate_ast({
        "schema_version": 2,
        "page": {"orientation": "portrait"},
        "blocks": [{"type": "image", "source": "resignation_letter"}],
    })
    assert ast["schema_version"] == 2
    assert ast["blocks"][0] == {
        "id": ast["blocks"][0]["id"],
        "type": "image",
        "source": "resignation_letter",
        "align": "center",
        "max_width_mm": 170,
        "max_height_mm": 240,
        "required": True,
        "fallback_text": "",
    }


def test_unknown_image_source_is_rejected():
    ast = {
        "schema_version": 2,
        "page": {"orientation": "portrait"},
        "blocks": [{"type": "image", "source": "passport"}],
    }
    with pytest.raises(AstError, match="Unknown image source"):
        document_ast.validate_ast(ast)


def test_v1_text_template_still_validates():
    ast = document_ast.validate_ast({
        "schema_version": 1,
        "page": {"orientation": "portrait"},
        "blocks": [{"type": "paragraph", "text": "Hello {{ employee_name }}"}],
    })
    assert ast["schema_version"] == 1
    assert ast["blocks"][0]["type"] == "paragraph"


def test_collect_image_sources_returns_allow_list_members():
    ast = document_ast.validate_ast({
        "schema_version": 2,
        "page": {"orientation": "portrait"},
        "blocks": [
            {"type": "image", "source": "resignation_letter"},
            {"type": "page_break"},
            {"type": "image", "source": "employee_nid"},
        ],
    })
    assert document_ast.collect_image_sources(ast) == {
        "resignation_letter", "employee_nid",
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest -q tests/test_document_ast_image_block.py`
Expected: FAIL — `image` is an unknown block type and `collect_image_sources` does not exist.

- [ ] **Step 3: Implement the AST changes**

In `backend/app/services/document_ast.py`:
- Add the constants from Interfaces.
- Change `_clean_block` to `_clean_block(raw, schema_version)` and add the `image` branch using `_align`, `_number`, `_flag`, and `_text(..., 200)`; reject `schema_version < 2` with message containing `"schema version 2"`.
- Pass `schema_version` from `validate_ast()` into every `_clean_block` call and return that same `schema_version`.
- Add `collect_image_sources(ast)` returning `{block["source"] for block in ast.get("blocks", []) if block.get("type") == "image"}`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest -q tests/test_document_ast_image_block.py`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/document_ast.py backend/tests/test_document_ast_image_block.py
git commit -m "feat: add v2 image block to document AST"
```

---

### Task 2: House-scoped image source resolver

**Files:**
- Modify: `backend/app/services/employee_documents.py:401-415`
- Create: `backend/app/services/document_images.py`
- Modify: `backend/app/routers/employees.py:892-935`
- Test: `backend/tests/test_document_images.py`

**Interfaces:**
- Consumes: `document_ast.IMAGE_SOURCES`, `document_render._image_data_uri_from_path`.
- Produces:
  - `employee_documents.latest_document(db, employee_id, doc_types, *, house_id: Optional[int] = None) -> Optional[EmployeeDocument]`
  - `employee_documents.latest_nid_documents(db, employee_ids: list[int], *, house_id: Optional[int] = None) -> dict[int, EmployeeDocument]`
  - `document_images.resolve_image_sources(db, *, house_id: int, employee, sources: set[str]) -> tuple[dict[str, str], list[str]]`
  - `employees_router._resignation_nid_scans(db, emp_ids)` delegates to `latest_nid_documents(db, emp_ids)` with unchanged behavior

- [ ] **Step 1: Write the failing tests**

```python
@pytest.mark.asyncio
async def test_resolve_image_sources_embeds_uploaded_scan(db, tmp_path, monkeypatch):
    # Create house + resigned employee + resignation_letter EmployeeDocument.
    # Write a tiny real JPEG to tmp_path at the document's storage_path.
    # monkeypatch document_render.PRIVATE_ROOT to str(tmp_path).
    uris, missing = await document_images.resolve_image_sources(
        db, house_id=house.id, employee=employee, sources={"resignation_letter"},
    )
    assert missing == []
    assert uris["resignation_letter"].startswith("data:image/")
    assert "base64," in uris["resignation_letter"]


@pytest.mark.asyncio
async def test_other_house_scan_is_never_selected(db, tmp_path, monkeypatch):
    # Same employee id, but the only letter row has house_id=other_house.id.
    uris, missing = await document_images.resolve_image_sources(
        db, house_id=house.id, employee=employee, sources={"resignation_letter"},
    )
    assert uris == {}
    assert missing == ["resignation_letter"]


@pytest.mark.asyncio
async def test_missing_source_is_reported(db):
    uris, missing = await document_images.resolve_image_sources(
        db, house_id=house.id, employee=employee, sources={"employee_nid"},
    )
    assert uris == {}
    assert missing == ["employee_nid"]
```

Also assert in `backend/tests/test_resignation_documents.py` that the existing NID fallback cases still pass after the helper extraction.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest -q tests/test_document_images.py tests/test_resignation_documents.py`
Expected: FAIL — the new module/functions do not exist.

- [ ] **Step 3: Implement resolver and helper extraction**

- In `employee_documents.py`, add optional `house_id` filtering to `latest_document()` and move the body of `employees.py:_resignation_nid_scans` into `latest_nid_documents(db, employee_ids, *, house_id=None)`, preserving typed-NID → hinted-untyped → single-untyped precedence.
- In `employees.py`, replace the old body with a thin delegation to `latest_nid_documents(db, emp_ids)`.
- In `document_images.py`, implement `resolve_image_sources()`:
  - Ignore sources outside `document_ast.IMAGE_SOURCES`.
  - Use `latest_document(..., ("resignation_letter",), house_id=house_id)` for `resignation_letter`.
  - Use `latest_nid_documents(..., house_id=house_id)` for `employee_nid`.
  - Convert `document_file_path(doc)` through `document_render._image_data_uri_from_path()`.
  - Return sorted `missing` keys.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest -q tests/test_document_images.py tests/test_resignation_documents.py`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/employee_documents.py backend/app/services/document_images.py backend/app/routers/employees.py backend/tests/test_document_images.py backend/tests/test_resignation_documents.py
git commit -m "feat: resolve resignation images with house scoping"
```

---

### Task 3: Renderer, preview, and Bangla-first context

**Files:**
- Modify: `backend/app/services/document_render.py:192-217`, `:262-333`
- Modify: `backend/app/routers/documents.py:58-64`, `:1370-1435`
- Test: `backend/tests/test_documents_resignation_images.py`

**Interfaces:**
- Consumes: `document_images.resolve_image_sources`, `document_ast.collect_image_sources`.
- Produces:
  - `document_render.render_html(..., images: Optional[dict[str, str]] = None) -> str`
  - `document_render._block_html(block, context, signatory, images=None) -> str`
  - `document_render.resignation_context_values(house, employee, document_date: str) -> dict[str, str]`
  - `render_preview` embeds resolved images and applies the Bangla override when `template.document_type_id` is RESIGNATION
  - No schema change is needed: `backend/app/schemas/documents.py:47` already accepts `TemplatePreviewIn.employee_id`

- [ ] **Step 1: Write the failing tests**

```python
def test_render_html_embeds_image_and_escapes_fallback():
    html = document_render.render_html(
        document_ast.validate_ast({
            "schema_version": 2,
            "page": {"orientation": "portrait"},
            "blocks": [
                {"type": "image", "source": "employee_nid",
                 "fallback_text": "<script>x</script>"},
            ],
        }),
        {},
        images={"employee_nid": "data:image/webp;base64,AAAA"},
        embed_fonts=False,
    )
    assert 'src="data:image/webp;base64,AAAA"' in html
    assert "&lt;script&gt;" not in html  # fallback is not used when image exists


def test_fallback_text_is_escaped_when_image_is_missing():
    html = document_render.render_html(ast, {}, embed_fonts=False)
    assert "&lt;script&gt;x&lt;/script&gt;" in html
    assert "<script>" not in html


def test_resignation_context_values_are_bangla_first():
    values = document_render.resignation_context_values(
        house, employee, "2026-06-30",
    )
    assert values["application_date"] == "৩০ জুন ২০২৬"
    assert values["document_date"] == "৩০ জুন ২০২৬"
    assert values["nid"].isdigit() is False or all(
        "০" <= ch <= "৯" for ch in values["nid"]
    )
    assert values["house_name"] == house.name_bn or house.name
    assert values["proprietor_name"] == house.proprietor_name_bn or house.proprietor_name
```

Add an API test in the same file using the existing `api` fixture: publish a v2 template with an image block, upload a real scan for the employee, call `POST /api/v1/documents/render/preview`, and assert the returned HTML contains `data:image/`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest -q tests/test_documents_resignation_images.py`
Expected: FAIL — `render_html()` has no `images` parameter and `resignation_context_values()` does not exist.

- [ ] **Step 3: Implement renderer and preview wiring**

- In `document_render.py`:
  - Add `images` parameter to `_block_html()` and `render_html()` with default `None`.
  - Add an image case that emits `<figure class="doc-image" ...><img src="{uri}" ...></figure>` when a URI exists, otherwise an escaped `<div class="doc-image-fallback">`.
  - Add `.doc-image`, `.doc-image img`, `.doc-image-fallback` CSS to `_page_css()` with `max-width:100%`, `break-inside:avoid`, and small margin. No full-bleed positioning.
  - Add `resignation_context_values(house, employee, document_date)` using `resignation_pdf._base_values()` and `house_letterhead.placeholder_values()`; set both `application_date` and `document_date` to the Bangla-formatted date.
- In `documents.py`, import `document_images`; in `render_preview()` resolve sources for the selected version and employee, then pass `images=` and the Bangla override into `render_html()`. Missing images must not fail preview.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest -q tests/test_documents_resignation_images.py tests/test_documents_templates.py`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/document_render.py backend/app/routers/documents.py backend/tests/test_documents_resignation_images.py
git commit -m "feat: render source-bound images in document preview"
```

---

### Task 4: Generation guards, number safety, and regeneration

**Files:**
- Modify: `backend/app/routers/documents.py:529-654`
- Test: `backend/tests/test_documents_resignation_images.py`

**Interfaces:**
- Consumes: Task 2 resolver, Task 3 renderer/context helpers.
- Produces:
  - `_assert_resignation_document_ready(employee, house, sources, missing) -> None` in `documents.py`
  - `422` detail for missing required image: `{"code": "IMAGE_SOURCE_MISSING", "message": "A required image is missing", "sources": [...]}`
  - `generate_document()` and `regenerate_document()` resolve images and apply Bangla context

- [ ] **Step 1: Write the failing tests**

```python
@pytest.mark.asyncio
async def test_generate_missing_required_image_does_not_consume_number(api, db):
    # Draft a RESIGNATION document with v2 template requiring employee_nid.
    # Upload only the handwritten letter.
    response = await api.post(f"/api/v1/documents/{draft.id}/generate", headers=house_headers)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "IMAGE_SOURCE_MISSING"
    assert response.json()["detail"]["sources"] == ["employee_nid"]
    assert draft.document_number.startswith("DRAFT-")


@pytest.mark.asyncio
async def test_generate_resignation_embeds_letter_nid_and_bangla_context(api, db):
    # Upload both scans, create draft, generate.
    assert version.html_snapshot.count("data:image/") == 2
    assert "৩০ জুন ২০২৬" in version.html_snapshot
    assert response.json()["data"]["document"]["status"] == "GENERATED"


@pytest.mark.asyncio
async def test_generate_resignation_rejects_non_resigned_employee(api, db):
    response = await api.post(f"/api/v1/documents/{draft.id}/generate", headers=house_headers)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "EMPLOYEE_NOT_RESIGNED"


@pytest.mark.asyncio
async def test_regenerate_uses_replacement_scan(api, db):
    # Generate, replace NID upload, regenerate, assert new image bytes hash differs.
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest -q tests/test_documents_resignation_images.py`
Expected: FAIL — generation does not resolve images or enforce resignation guards.

- [ ] **Step 3: Implement generation wiring**

In `documents.py`:
- Add `_assert_resignation_document_ready(employee, house, sources, missing)`:
  - Reject non-RSO/BP and non-`Resigned` with the existing error codes.
  - Reject missing letter/NID/letterhead with `RESIGNATION_LETTER_MISSING`, `NID_MISSING`, `LETTERHEAD_NOT_CONFIGURED`, or `RESIGNATION_FILE_MISSING`.
  - Raise `IMAGE_SOURCE_MISSING` for any `required` source that the resolver could not load.
- In `_render_document_version()`, before `allocate_document_number`:
  - Collect image sources from `template_version.content_json`.
  - Resolve with `document.employee_id`, `document.house_id`.
  - Run `_assert_resignation_document_ready()` when `document_type.code == "RESIGNATION"`; load the employee with the existing `_employee_for_house(db, document.employee_id, document.house_id)` helper and load the house with `db.get(House, document.house_id)`.
  - After `resolve_context()`, apply `document_render.resignation_context_values()` for RESIGNATION.
  - Pass `images=` into `render_html()`.
- Leave `document_data` and all permissions unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest -q tests/test_documents_resignation_images.py tests/test_documents_templates.py`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/documents.py backend/tests/test_documents_resignation_images.py
git commit -m "feat: generate resignation documents from source images"
```

---

### Task 5: Seed the ready 3-page RESIGNATION template

**Files:**
- Modify: `backend/app/services/document_seed.py:39-106`, `:109-210`
- Test: `backend/tests/test_resignation_template_seed.py`

**Interfaces:**
- Consumes: AST v2 constants and `build_noc_ast()` helpers.
- Produces:
  - `RESIGNATION_TEMPLATE_NAME = "Banglalink Distribution House - Resignation Standard"`
  - `build_resignation_ast() -> dict`
  - `resignation_template_payload() -> tuple[dict, dict]`
  - `seed_documents_module()` seeds a published v2 template for `RESIGNATION`

- [ ] **Step 1: Write the failing tests**

```python
@pytest.mark.asyncio
async def test_resignation_seed_creates_v2_template_with_expected_blocks(db):
    await document_seed.seed_documents_module(db)
    template = await _template_by_name(db, document_seed.RESIGNATION_TEMPLATE_NAME)
    version = template.latest_version
    assert version.content_json["schema_version"] == 2
    assert [b["type"] for b in version.content_json["blocks"][:5]] == [
        "image", "page_break", "image", "page_break", "heading",
    ]
    assert version.content_json["blocks"][0]["source"] == "resignation_letter"
    assert version.content_json["blocks"][2]["source"] == "employee_nid"
    assert version.is_published is True
    assert template.is_default is True
    assert template.house_id is None


@pytest.mark.asyncio
async def test_resignation_seed_is_idempotent(db):
    await document_seed.seed_documents_module(db)
    first = await _template_by_name(db, document_seed.RESIGNATION_TEMPLATE_NAME)
    await document_seed.seed_documents_module(db)
    second = await _template_by_name(db, document_seed.RESIGNATION_TEMPLATE_NAME)
    assert second.id == first.id
    assert second.latest_version.version_number == first.latest_version.version_number
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest -q tests/test_resignation_template_seed.py`
Expected: FAIL — the template name and builder do not exist.

- [ ] **Step 3: Implement the seed**

- Extract the NOC body loop from `build_noc_ast()` into `_letterhead_body_blocks() -> list[dict]`; keep `build_noc_ast()` behavior identical.
- Add `build_resignation_ast()` returning v2 AST with:
  - `image(source="resignation_letter", align="center", max_width_mm=170, max_height_mm=240, required=True, fallback_text="Handwritten resignation letter")`
  - `page_break`
  - `image(source="employee_nid", align="center", max_width_mm=170, max_height_mm=110, required=True, fallback_text="Employee NID")`
  - `page_break`
  - `_letterhead_body_blocks()` from `DEFAULT_BODY_TEXT`
- Add `resignation_template_payload()` mirroring `noc_template_payload()`.
- In `seed_documents_module()`, add a second idempotent block for the RESIGNATION type, matching the NOC pattern: create only if absent, add version 1 only if absent, never overwrite edits.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest -q tests/test_resignation_template_seed.py tests/test_documents_templates.py`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/document_seed.py backend/tests/test_resignation_template_seed.py
git commit -m "feat: seed three-page resignation template"
```

---

### Task 6: Template Editor image block authoring

**Files:**
- Modify: `frontend/src/app/documents/templates/[id]/page.tsx:14`, `:82-95`, `:213-217`, `:287-300`, `:352-406`, `:440-449`
- Modify: `frontend/src/i18n/translations.ts` (`document_template_editor` namespace, `en` and `bn`)

**Interfaces:**
- Consumes: backend AST v2 validation and preview endpoint.
- Produces:
  - `BlockType` includes `"image"`
  - `makeBlock("image")` returns the v2 image defaults
  - `addBlock("image")` sets `ast.schema_version = 2`
  - Preview sends optional `employee_id`

> AGENTS.md rule precedence: the frontend has no test runner, so TDD red/green is replaced here by lint + typecheck + browser verification. Do not install a test runner or invoke a frontend TDD skill.

- [ ] **Step 1: Add `en`/`bn` keys**

Add these keys under `document_template_editor` in both languages: `image`, `image_source`, `source_resignation_letter`, `source_employee_nid`, `max_width_mm`, `max_height_mm`, `image_required`, `fallback_text`, `image_source_hint`, `preview_employee`.

Run: `cd frontend && npm run lint`
Expected: no missing-key regressions in touched files.

- [ ] **Step 2: Implement image block authoring**

- Extend `BlockType`, `EMPTY_AST` handling, and `makeBlock()` with the exact image defaults from Task 1.
- In `addBlock()`, when `type === "image"`, set `schema_version: 2` on the AST.
- Add `"image"` to `addOptions`.
- In the block card, render:
  - source selector via project `EntitySelector` with the two `IMAGE_SOURCES`;
  - align `select`, two number inputs (20–190 / 20–260), required checkbox, fallback text input;
  - a short hint that images come from the employee's resignation uploads.
- Keep all controls disabled when `!editable`, and preserve 44×44px touch targets.

- [ ] **Step 3: Add employee-aware preview**

- Add `previewEmployeeId` state.
- Add an `EntitySelector` in the preview panel to choose an employee (reuse the existing employee search endpoint used elsewhere in this file if available; otherwise use `v1/documents/employees/search`).
- Add `employee_id: previewEmployeeId || undefined` to the `POST v1/documents/render/preview` payload.
- Keep `sandbox=""` on the iframe.

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run lint`
Expected: 0 errors.

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0.

Browser: at 375/768/1280, add an image block, change source/size/required/fallback, save a draft version, preview with and without an employee, toggle EN/BN. Expected: no horizontal scroll, 44px targets, no literal dotted keys, backend accepts version with `schema_version: 2`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/documents/templates/[id]/page.tsx frontend/src/i18n/translations.ts
git commit -m "feat: author source-bound image blocks in template editor"
```

---

### Task 7: Resignation page uses the seeded template

**Files:**
- Modify: `frontend/src/app/employees/resignation-documents/page.tsx:90-115`, `:211-262`, `:584-601`
- Modify: `frontend/src/i18n/translations.ts` (`resignation_docs` namespace, `en` and `bn`)

**Interfaces:**
- Consumes: `POST v1/documents/render/preview`, `POST v1/documents`, `POST v1/documents/{id}/generate`, `GET v1/documents/{id}/versions/{v}/download`.
- Produces: template selector state, editable field values, and `generateTemplateDocument()` replacing `generatePdf()` as the primary action.

> Same frontend verification rule as Task 6: no frontend test runner; lint + typecheck + browser checklist replace TDD.

- [ ] **Step 1: Add i18n keys**

Under `resignation_docs` in both languages add: `template_card_title`, `template_card_subtitle`, `template_label`, `template_empty`, `template_preview`, `template_preview_empty`, `template_fields`, `generate_success_link`, `error_image_missing`, `error_not_rso_bp`, `header_subtitle`. Reuse existing error keys for all other codes.

- [ ] **Step 2: Load the RESIGNATION template and schema**

- Add `selectedHouse` from `useAuth()` and build `headers` with `X-House-ID`.
- Load `v1/documents/types`, find `code === "RESIGNATION"`, then load `v1/documents/templates?document_type_id=...&per_page=100`; filter with the same published check as `/documents/create` (`is_active && (latest_version?.is_published || latest_version?.published_version)`).
- Add a template `EntitySelector`, auto-select the default template, and show `template_empty` with a link to `/documents/templates` when none exists.
- Load `v1/documents/templates/{id}/schema`; keep only `!readonly` fields in a `documentValues` state object. Seed `document_date` with `todayInBangladesh()` when present.

- [ ] **Step 3: Add preview and generation**

- `previewTemplateDocument()` posts `{template_id, employee_id: empId, document_data: documentValues}` to `v1/documents/render/preview` with `headers`; render the returned HTML in an iframe with `sandbox=""`.
- `generateTemplateDocument()`:
  - Guard with `employees.resignation_generate && documents.create && documents.generate && documents.download`.
  - `POST v1/documents` with `{template_id, employee_id: empId, document_data: documentValues, document_title: template.name}`.
  - `POST v1/documents/{draftId}/generate`.
  - `GET v1/documents/{draftId}/versions/{versionNumber}/download` as a blob and trigger the existing download helper.
  - On success, toast and show `/documents` link. On `IMAGE_SOURCE_MISSING`, map `detail.sources` to `error_image_missing`; keep the draft and show "Retry from Documents".
- Keep the existing upload/delete cards unchanged as image sources.

- [ ] **Step 4: Bring header into compliance**

Replace the current employee-detail header with: breadcrumb (`Home → Employees → Resignation Documents`), 40×40 primary-tinted icon tile, `<h1>`, `PageGuideModal` immediately after the heading, localized subtitle, and a divider. Use existing shared classes/patterns; do not add a custom breadcrumb component.

- [ ] **Step 5: Verify**

Run: `cd frontend && npm run lint` → 0 errors.
Run: `cd frontend && npx tsc --noEmit` → exit 0.
Browser with a resigned RSO/BP employee and uploaded scans: at 375/768/1280, preview shows 3 pages, generate downloads a PDF, `/documents` shows the record, missing NID shows the structured error, EN/BN toggle is clean, no horizontal scroll, 44px touch targets.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/employees/resignation-documents/page.tsx frontend/src/i18n/translations.ts
git commit -m "feat: generate resignation documents from seeded template"
```

---

### Task 8: Full regression and compliance gate

**Files:** none (verification only)

- [ ] **Step 1: Run backend suite**

Run: `cd backend && python -m pytest -q`
Expected: PASS, with no failures in existing resignation, template, tenancy, or billing tests.

- [ ] **Step 2: Run focused guard suites**

Run: `cd backend && python -m pytest -q tests/test_entitlement.py tests/test_house_access_guard.py tests/test_tenant_isolation.py`
Expected: PASS.

Run: `cd backend && python -m pytest -q tests/test_plan_modules_parity.py tests/test_module_coverage.py`
Expected: PASS.

- [ ] **Step 3: Run frontend checks**

Run: `cd frontend && npm run lint` → 0 errors.
Run: `cd frontend && npx tsc --noEmit` → exit 0.

- [ ] **Step 4: Module checklist sign-off**

Record in the final report:
- DB model + `house_id` + index: reused `GeneratedDocument` and `EmployeeDocument`; no new model.
- `permissions.json`: no new key; existing roles already covered.
- Audit: template version save, document create/generate, resignation upload/delete already audited.
- i18n: every new string has `en` + `bn`.
- `navItems` / `DynamicPageTitle` / `MODULE_LEAF_ROUTES` / `PATH_TO_MODULE` / `LEAF_TO_API_PREFIXES`: no new route, nav item, or module key; parity tests pass.
- Skeleton: existing editor/page skeleton retained.
- Responsive: 375 / 768 / 1280 verified with no horizontal scroll and 44×44px touch targets.

- [ ] **Step 5: Commit (only if the final report file is added)**

```bash
# No code changes expected in this task. If a verification report is written:
git add docs/superpowers/plans/2026-11-24-dynamic-image-blocks-resignation-template.md
git commit -m "docs: verify resignation image block implementation"
```

---

## Self-Review Notes

- Spec coverage: AST v2 → Task 1; resolver/tenancy → Task 2; renderer/preview/Bangla → Task 3; generate guards/number/regenerate → Task 4; seeded template → Task 5; editor UI → Task 6; resignation page → Task 7; full verification → Task 8.
- Type consistency: `resolve_image_sources` returns `(dict[str, str], list[str])` and is consumed unchanged in Tasks 3 and 4. `render_html(..., images=...)` is introduced in Task 3 and consumed in Task 4. `collect_image_sources` is introduced in Task 1 and consumed in Tasks 3 and 4.
- Frontend TDD exception is explicit and justified by AGENTS.md; no test runner installed.
- No new permission, model, route, nav item, or module key; this is recorded in Task 8 and verified by the mandated parity/tenancy suites.
