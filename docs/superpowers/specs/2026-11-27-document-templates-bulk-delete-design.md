# Document Templates — 10-row page, select-all checkbox, bulk delete

## Intent / why

`/documents/templates` currently loads 20 templates per page and only supports deleting one
template at a time. The user wants a denser, modern table workflow: 10 records by default,
checkboxes for selecting rows, a select-all control, one action to delete every checked
template, and a separate "Delete all" action for every template in the current house scope.

## Goals

- Default page size 10 (API request, skeleton rows, and view all agree).
- shadcn `Checkbox` in the desktop table and the mobile card list.
- Header "select all" for the current page, with indeterminate state.
- A "Delete all" action that deletes every deletable template in the **current house scope**
  (global + selected house), ignoring search and pagination.
- Checked templates deletable in one confirmed action, with correct RBAC, house scoping,
  audit trail, and bilingual copy.

## Non-goals

- No new permission key (existing `documents.templates.manage` already governs template deletion).
- No change to the template editor, versioning, or single-delete button.
- The header checkbox still covers only the current page; the explicit "Delete all" action
  is the only cross-page operation.
- No cross-house wipe. "Delete all" never touches another house's templates.

## Anti-goals

- No client-side fan-out of single DELETE requests (partial failure, no per-item result).
- No hand-built checkbox; use the existing shadcn `Checkbox`.
- No inline filter redesign — the existing toolbar search stays as-is.

## Constraints (from AGENTS.md and docs/agents/)

- Every mutation: authentication, permission check, validation, and audit entry.
- Every query/mutation scoped to `X-House-ID`; global templates super-admin-only.
- All user-visible strings in `translations.ts` under both `en` and `bn`.
- Shared page header pattern, content-aware skeleton, `<td className="px-2 py-1">`,
  `cursor-pointer` on controls, 44x44 touch targets, 375/768/1280 layouts.
- API versioned under `/api/v1`; bulk action follows `rule-config/bulk-delete` shape.

## Approaches

- **A — dedicated bulk endpoint (chosen):** one POST with `{ template_ids }`; server dedups,
  validates, house-scopes, soft-deletes, audits each item, returns `{ deleted, skipped }`.
  One request, consistent with `rule_config.py`, explicit partial-failure reporting.
- **B — frontend loop over `DELETE /templates/{id}`:** no backend change, but N requests,
  no atomic commit, and partial failures cannot be reported as one result. Rejected.

## Design

### Backend (`backend/app/routers/documents.py`)

- `POST /api/v1/documents/templates/bulk-delete`, declared **before** `/templates/{template_id}`
  so path-parameter routes cannot shadow it.
- `POST /api/v1/documents/templates/select-all`, declared before `/templates/{template_id}`.
  Mirrors `POST /v1/scratch-card-serials/select-all` but accepts **no search parameter**: it
  returns every deletable template ID in the current house scope (global + selected house),
  active/non-deleted only, with no pagination. Response
  `{ "success": true, "data": { "ids": [...], "total": n } }`. Permission
  `documents.templates.view`, `X-House-ID` scope. Global templates are excluded for
  non-super-admins so the reported count matches what bulk-delete can delete.
- Request body for bulk delete: `BulkTemplateDeleteIn` with `template_ids: list[int]`,
  `min_length=1`, `max_length=5000`; FastAPI returns 422 for empty/oversized lists.
- Dependencies: `has_permission("documents.templates.manage")`, `get_db`,
  `get_house_context`, `Request` (for audit).
- Dedup ids preserving order. For each id: load via `db.get`; skip missing/already-deleted;
  reuse `svc.assert_template_writable(...)` (403 → skip, same behaviour as `rule-config`
  skipping inaccessible rows); otherwise `svc.delete_template(...)` and `_audit(..., "delete",
  old_values={"name": ..., "house_id": ...})`.
- Single `db.commit()`; response `{ "success": true, "data": { "deleted": n, "skipped": m } }`.
- Add API tests to `backend/tests/test_documents_templates.py`: bulk happy path, dedup, house
  isolation, global template skipped for non-super-admin, audit entries, validation; plus
  `select-all` scope tests (ignores search/page, excludes other houses, excludes global for
  non-super-admins).

### Frontend (`frontend/src/app/documents/templates/page.tsx`)

- `per_page: 10` in `loadTemplates`; skeleton `Array.from({ length: 10 })`.
- `selectedIds: Set<number>`, cleared whenever page, search, or loaded data changes.
- Checkbox eligibility mirrors `TemplateDeleteButton`:
  `canManage && (scope !== "global" || canCreateGlobal)`. Ineligible rows have no checkbox.
- Desktop: new leading `<th className="px-2 py-1">` with select-all `Checkbox`; per-row
  checkbox in a leading `<td className="px-2 py-1">`. Header checked when all eligible rows
  on the page are selected, indeterminate when some are.
- Mobile cards: same checkbox in a `min-h-11 cursor-pointer` label so the touch target is
  ≥44px; no layout overflow at 375px.
- Selection bar (shown only when `selectedIds.size > 0`): translated "N selected", clear
  button, and permission-gated "Delete selected" button. One bar shared by both views.
- Confirm via existing `ConfirmationModal`; on confirm POST to
  `v1/documents/templates/bulk-delete` with `{ template_ids: [...] }` and `X-House-ID`
  headers, toast success/error via `getDocumentErrorMessage`, clear selection, then reload
  (step back one page if the page becomes empty and `has_prev`).
- "Delete all" toolbar button, visible only with `canManage`: calls `select-all` to get the
  full scoped ID list, opens a dedicated confirmation showing the count, then calls the same
  bulk-delete endpoint. Zero matches → localized "no templates to delete" toast. Search
  text does not narrow this action.
- i18n: add `documents.*` keys in **both** `en` and `bn` for select-all, selected count,
  delete-selected, delete-all, confirm title/message, success, error, clear, no-matches;
  reuse `common.select_all`.

## Left to the builder

- Exact test fixtures/helpers to reuse from `backend/tests/test_documents_templates.py`.
- Minor class-name choices for the selection bar as long as the touch-target and cursor rules hold.
- Verification commands from AGENTS.md: backend pytest, frontend lint, `npx tsc --noEmit`,
  plus manual 375/768/1280 and en/bn checks.
