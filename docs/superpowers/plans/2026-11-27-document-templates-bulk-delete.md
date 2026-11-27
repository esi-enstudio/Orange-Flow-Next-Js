# Document Templates Bulk Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show 10 templates per page on `/documents/templates`, add shadcn checkboxes with page-level select-all, delete checked templates in one request, and add a "Delete all" action covering every deletable template in the current house scope.

**Architecture:** Two new versioned FastAPI endpoints under the existing documents router (`bulk-delete` and `select-all`) reuse the existing `svc.assert_template_writable` / `svc.delete_template` / `_audit` path, so RBAC, house isolation, soft delete, and per-record audit stay identical to single delete. The client keeps a `Set` of selected IDs, confirms via the existing `ConfirmationModal`, and reloads the current page after success.

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy async / pytest; Next.js App Router / TypeScript / shadcn `Checkbox` / Tailwind / existing i18n store.

**Spec:** `docs/superpowers/specs/2026-11-27-document-templates-bulk-delete-design.md`

## Global Constraints

- API paths: `/api/v1/documents/templates/bulk-delete`, `/api/v1/documents/templates/select-all`; both declared after `POST /templates` and before `GET /templates/{template_id}`.
- Permissions: `documents.templates.manage` for bulk delete; `documents.templates.view` for select-all. No new permission key.
- House context: `X-House-ID` via `get_house_context`; global templates writable only by `is_super_admin_user(user)`.
- `per_page: 10` is a **frontend request value only**; backend default stays 20 (api-conventions).
- Bulk body: `template_ids`, `min_length=1`, `max_length=5000`, deduped preserving order.
- Response shapes: bulk `{ success: true, data: { deleted: int, skipped: int } }`; select-all `{ success: true, data: { ids: int[], total: int } }`.
- Every successfully deleted template gets one `_audit(..., "delete", old_values={"name": ..., "house_id": ...})` entry; single `db.commit()`.
- All new UI text: `translations.ts` `documents.*` keys in **both** `en` and `bn`; no hardcoded strings.
- UI rules: `<td className="px-2 py-1">`, `cursor-pointer` on controls, 44x44 touch targets, shadcn `Checkbox` only, shared page header untouched, content-aware skeleton with 10 rows.
- Module checklist: **N/A** for new DB model/index (existing `DocumentTemplate` already has `house_id`, `is_deleted`, indexes), `permissions.json` (no new key), `navItems` / `DynamicPageTitle` (no new route), `MODULE_LEAF_ROUTES` / `PATH_TO_MODULE` / `LEAF_TO_API_PREFIXES` (new endpoints are under the already-registered `/api/v1/documents/templates` prefix). Skeleton count changes from 20 → 10. Responsive checks 375/768/1280 are mandatory in Task 6.

## Review Focus

These are the failure modes the spec implies but no happy-path test fully covers. Each is pinned to a task below.

- **Cross-house ID sent to bulk-delete:** must be skipped, never soft-deleted → Task 1 `test_bulk_delete_skips_cross_house_and_global_for_non_super_admin`.
- **Global template sent by a non-super-admin:** must be skipped even if the list rendered it → Task 1 same test; select-all must not even return it → Task 2 `test_select_all_excludes_other_houses_and_global_for_tenant`.
- **Duplicate / missing / already-deleted IDs:** `deleted` counts each real template once, `skipped` counts the rest → Task 1 `test_bulk_delete_dedupes_and_skips_missing`.
- **"Delete all" accidentally narrowed by the search box or page number:** select-all accepts no search/page and returns every scoped ID → Task 2 `test_select_all_ignores_search_and_pagination`.
- **Stale selection after page/search change:** selected IDs must not survive navigation → Task 4 manual browser check in Task 6 (frontend has no test runner; do not add one).
- **Missing Bengali key renders a dotted path:** key parity in both languages → Task 3 parity check plus en/bn toggle in Task 6.

---

### Task 1: Bulk delete endpoint

**Files:**
- Modify: `backend/app/routers/documents.py` (imports near lines 20-69; insert endpoints between `POST /templates` at line 1396 and `GET /templates/{template_id}` at line 1399)
- Test: `backend/tests/test_documents_templates.py` (append near `test_soft_delete_hides_template`, line 644)

**Interfaces:**
- Consumes: `svc.get_template`-equivalent lookup via `db.get(DocumentTemplate, id)`, `svc.assert_template_writable(template, house_context, user)`, `svc.delete_template(db, template, house_id=house_context, user=user)`, `_audit(db, request, user, "delete", template, old_values=...)`, `is_super_admin_user`, `get_house_context`, `has_permission`.
- Produces: `POST /api/v1/documents/templates/bulk-delete` accepting `BulkTemplateDeleteIn`, returning `{ success, data: { deleted, skipped } }`.

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_documents_templates.py` (reuse `_user`, `_ast`, `_schema`, `_seed`, `_make_house`, `api` fixture; create templates through `POST /api/v1/documents/templates`):

```python
async def test_bulk_delete_happy_path_writes_audit(api, db):
    # create two house templates, POST /templates/bulk-delete with both ids
    assert body["data"] == {"deleted": 2, "skipped": 0}
    assert both ids absent from GET /templates
    logs = select(ActivityLog).where(ActivityLog.module == "document_template",
                                     ActivityLog.action == "delete")
    assert len((await db.execute(logs)).scalars().all()) == 2

async def test_bulk_delete_dedupes_and_skips_missing(api, db):
    # body: [id, id, 999999]
    assert body["data"] == {"deleted": 1, "skipped": 1}

async def test_bulk_delete_skips_cross_house_and_global_for_non_super_admin(api, db):
    # house A user bulk-deletes [A template, B template, global template]
    assert body["data"]["deleted"] == 1 and body["data"]["skipped"] == 2
    # B and global templates still returned by their own scoped list

async def test_bulk_delete_validates_ids(api, db):
    # body {"template_ids": []} -> 422
    # body {"template_ids": list(range(5001))} -> 422
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest -q tests/test_documents_templates.py -k bulk_delete`
Expected: FAIL (404 for the new route).

- [ ] **Step 3: Implement the endpoint**

In `backend/app/routers/documents.py`: add `from pydantic import BaseModel, Field`; define `class BulkTemplateDeleteIn(BaseModel): template_ids: list[int] = Field(..., min_length=1, max_length=5000)`. Define `async def bulk_delete_templates(data: BulkTemplateDeleteIn, request: Request, db: AsyncSession = Depends(get_db), house_context: Optional[int] = Depends(get_house_context), current_user: User = Depends(has_permission(MANAGE))) -> dict`.

Body rules: `unique_ids = list(dict.fromkeys(data.template_ids))`; for each id load via `db.get`, skip missing/already-deleted, wrap `svc.assert_template_writable(...)` in `try/except HTTPException` → skip on 403, capture `old_values` **before** deleting, call `svc.delete_template`, call `_audit`, collect deleted ids. Commit once at the end; return the response shape above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest -q tests/test_documents_templates.py -k bulk_delete`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/documents.py backend/tests/test_documents_templates.py
git commit -m "feat: add house-scoped bulk delete for document templates"
```

### Task 2: Select-all (Delete all) endpoint

**Files:**
- Modify: `backend/app/routers/documents.py` (immediately after Task 1 endpoint)
- Test: `backend/tests/test_documents_templates.py`

**Interfaces:**
- Consumes: `DocumentTemplate`, `get_house_context`, `has_permission(VIEW)`, `is_super_admin_user`, `db`.
- Produces: `POST /api/v1/documents/templates/select-all` returning `{ success, data: { ids: list[int], total: int } }`; consumed by Task 5.

- [ ] **Step 1: Write failing tests**

```python
async def test_select_all_returns_all_deletable_ids_in_house_scope(api, db):
    # seed 3 templates in house A (names "A1", "A2", "A3")
    # POST /templates/select-all with X-House-ID A
    assert body["data"]["total"] == 3 and set(body["data"]["ids"]) == {ids}

async def test_select_all_excludes_other_houses_and_global_for_tenant(api, db):
    # one template in A, one in B, one global; user scoped to A
    assert body["data"]["ids"] == [a_template_id]
    # super admin with no X-House-ID gets only global ids

async def test_select_all_ignores_search_and_pagination(api, db):
    # POST /templates/select-all?search=nomatch&page=9&per_page=1
    assert body["data"]["total"] == 3
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest -q tests/test_documents_templates.py -k select_all`
Expected: FAIL (404).

- [ ] **Step 3: Implement the endpoint**

Define `async def select_all_deletable_templates(db: AsyncSession = Depends(get_db), house_context: Optional[int] = Depends(get_house_context), current_user: User = Depends(has_permission(VIEW))) -> dict`. Query `select(DocumentTemplate.id).where(is_deleted.is_(False), is_active.is_(True))`; when `house_context is None` restrict to `house_id.is_(None)`, else `(house_id.is_(None)) | (house_id == house_context)`. If `not is_super_admin_user(current_user)`, add `house_id.is_not(None)`. No search, no offset/limit. Return ids and `total` in the shape above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest -q tests/test_documents_templates.py -k select_all`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/documents.py backend/tests/test_documents_templates.py
git commit -m "feat: add scoped select-all ids for document templates"
```

### Task 3: Bilingual copy

**Files:**
- Modify: `frontend/src/i18n/translations.ts` — `en.documents` near line 1784, `bn.documents` near line 9390 (add identical key paths in both blocks)

**Interfaces:**
- Consumes: nothing.
- Produces: keys `documents.select_all_page`, `documents.select_template`, `documents.selected_count`, `documents.clear_selection`, `documents.delete_selected`, `documents.delete_selected_title`, `documents.delete_selected_message`, `documents.delete_all`, `documents.delete_all_title`, `documents.delete_all_message`, `documents.delete_all_none`, `documents.bulk_delete_success`, `documents.bulk_delete_error`.

- [ ] **Step 1: Add `en` keys**

Exact English copy: `Select all on this page`; `Select {name}`; `{count} selected`; `Clear selection`; `Delete selected`; `Delete {count} template(s)?`; `Delete the {count} selected template(s)? Generated documents and PDFs are kept. This cannot be undone.`; `Delete all`; `Delete all templates?`; `Delete {count} template(s) in this house scope, including other pages? Generated documents and PDFs are kept. This cannot be undone.`; `No templates to delete in this house scope.`; `Deleted {count} template(s).`; `Could not delete the selected templates.`

- [ ] **Step 2: Add matching `bn` keys**

Supply natural Bengali translations with the same `{count}` / `{name}` placeholders; never leave an English value in the `bn` block.

- [ ] **Step 3: Verify key parity**

Run: `cd frontend && npx tsc --noEmit`
Expected: exits 0. Then manually confirm each listed key exists in both blocks (no dotted key can render).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/i18n/translations.ts
git commit -m "feat: add bilingual copy for template bulk actions"
```

### Task 4: Page size, skeleton, checkboxes, selection bar

**Files:**
- Modify: `frontend/src/app/documents/templates/page.tsx` (imports lines 1-13; skeleton lines 45-56; `loadTemplates` lines 90-109; table lines 243-285; card list lines 287-328)

**Interfaces:**
- Consumes: `Checkbox` from `@/components/ui/checkbox`, translation keys from Task 3, `Template` interface already in the file.
- Produces: `selectedIds: Set<number>`, `eligibleIds: number[]`, `toggleTemplate(id)`, `toggleAllOnPage()`, `clearSelection()` used by Task 5.

- [ ] **Step 1: Change page size and skeleton**

Set `per_page: 10` in the `apiClient.get("v1/documents/templates", ...)` params; change skeleton array from `length: 20` to `length: 10`. Keep the existing skeleton styling.

- [ ] **Step 2: Add selection state**

Add `const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())`; derive `eligibleIds = templates.filter((item) => canManage && (item.scope !== "global" || canCreateGlobal)).map((item) => item.id)`. Clear selection in the handlers that change `page` or `search`.

- [ ] **Step 3: Add checkboxes to both views**

Desktop: new leading `<th className="px-2 py-1">` with a `Checkbox`; new leading `<td className="px-2 py-1">` per row. Header state is `true` when all `eligibleIds` are selected, `"indeterminate"` when some are, `false` otherwise; disabled when `eligibleIds.length === 0`. Mobile: a `label` with `min-h-11 cursor-pointer` wrapping the checkbox and template name in each card. Give every checkbox a translated `aria-label` via `documents.select_template`.

- [ ] **Step 4: Add selection bar**

When `selectedIds.size > 0`, render one bar above both views with `documents.selected_count` (`{count: selectedIds.size}`), a clear button (`documents.clear_selection`), and a `documents.delete_selected` button visible only when `canManage`. Buttons use `min-h-11` and `cursor-pointer`.

- [ ] **Step 5: Verify**

Run: `cd frontend && npm run lint` then `cd frontend && npx tsc --noEmit`
Expected: both exit 0. Then check 375/768/1280 in Task 6.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/documents/templates/page.tsx
git commit -m "feat: add template selection checkboxes and 10-row page"
```

### Task 5: Wire delete-selected and delete-all actions

**Files:**
- Modify: `frontend/src/app/documents/templates/page.tsx` (toolbar after line 198; handlers after `handleTemplateDeleted`; add one `ConfirmationModal` near the existing `CreateTemplateModal`)

**Interfaces:**
- Consumes: `selectedIds` / `clearSelection` from Task 4; `POST v1/documents/templates/bulk-delete` (Task 1) and `POST v1/documents/templates/select-all` (Task 2); `ConfirmationModal`, `getDocumentErrorMessage`, `toast`.
- Produces: `handleDeleteSelected()`, `handleDeleteAll()`, one confirm modal driven by `{ ids, title, message }`.

- [ ] **Step 1: Add shared bulk-delete handler**

Define `runBulkDelete(ids: number[])`: POST `v1/documents/templates/bulk-delete` with `{ template_ids: ids }` and `houseHeaders`; on success toast `documents.bulk_delete_success` with `{count: ids.length}`, clear selection, close confirm; if the current page becomes empty and `pagination?.has_prev`, call `setPage((p) => p - 1)`, otherwise `await loadTemplates(page, search)`. On failure toast `getDocumentErrorMessage(error, t("documents.bulk_delete_error"))`. Guard with a `bulkDeleting` flag bound to modal `loading`.

- [ ] **Step 2: Add delete-selected and delete-all triggers**

`handleDeleteSelected()` opens the confirm with `documents.delete_selected_title` / `documents.delete_selected_message` and `Array.from(selectedIds)`. `handleDeleteAll()` POSTs `v1/documents/templates/select-all` with house headers; if `total === 0`, toast `documents.delete_all_none`; otherwise open the confirm with `documents.delete_all_title` / `documents.delete_all_message` and the returned ids. Render the `Delete all` toolbar button only when `canManage`.

- [ ] **Step 3: Add confirmation modal**

One `ConfirmationModal` with `type="danger"`, `confirmText={t("documents.delete_confirm")}`, dynamic title/message from state, `onConfirm={() => void runBulkDelete(target.ids)}`.

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run lint` then `cd frontend && npx tsc --noEmit`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/documents/templates/page.tsx
git commit -m "feat: wire template bulk delete and delete all confirmation"
```

### Task 6: Full verification and responsive/locale check

**Files:** none (verification only)

- [ ] **Step 1: Backend regression suite**

Run: `cd backend && python -m pytest -q tests/test_documents_templates.py` then `cd backend && python -m pytest -q`
Expected: both exit 0, no failures.

- [ ] **Step 2: Frontend static checks**

Run: `cd frontend && npm run lint` then `cd frontend && npx tsc --noEmit`
Expected: both exit 0.

- [ ] **Step 3: Browser checks at 375 / 768 / 1280**

Confirm: exactly 10 rows per page, header select-all toggles only deletable rows, indeterminate state appears, mobile cards have ≥44px checkbox targets, no horizontal scroll, selection clears on page/search change, confirm modal is readable at 375px.

- [ ] **Step 4: Locale checks**

Toggle `en` → `bn`: all new labels/messages translated, no dotted key text, `<html lang>` flips, `Delete all` ignores the search box but respects the house scope.

- [ ] **Step 5: Commit any fixes found**

```bash
git add -A && git commit -m "fix: verification findings for template bulk actions"
```

Skip this step if no fixes were needed.
