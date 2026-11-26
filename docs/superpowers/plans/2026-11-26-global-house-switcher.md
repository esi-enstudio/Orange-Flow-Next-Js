# Global House Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user assigned to multiple houses switch the active house from the app shell and have that choice persisted, validated, audited, and honoured by every house-scoped page and the template modal.

**Architecture:** Add a nullable `selected_house_id` to `users` with an Alembic migration and expose it in `/auth/me`. Add an authenticated self-service `PUT /api/auth/selected-house` reusing `require_house_context` for validation and `log_activity` for audit. Expose a `setSelectedHouse` setter in `AuthContext` and render one shared `HouseSwitcher` (existing shadcn Popover) in the desktop header and a mobile row; reactive `selectedHouse` updates drive all existing `X-House-ID` fetches and entitlement checks.

**Tech Stack:** FastAPI + SQLAlchemy async + Alembic + pytest (SQLite in-memory fixture); Next.js App Router client components, React context, Tailwind CSS v4, shadcn Popover, existing typed i18n object.

**Spec:** `docs/superpowers/specs/2026-11-26-global-house-switcher-design.md`

## Global Constraints

- All user-visible copy needs matching `en` and `bn` keys in `frontend/src/i18n/translations.ts`; a missing locale key is a defect.
- House isolation stays deny-by-default: only `require_house_context` decides whether a house id is allowed; never trust a house id sent by the client.
- Every mutation writes an activity log entry; the selection PUT is a mutation (`auth` / `edit`, old + new values).
- `selected_house_id` lives on `users`, a system-level model explicitly exempt from the "every model has `house_id`" rule (`docs/agents/multi-tenancy.md:67`).
- No new permission key, `permissions.json` entry, nav item, `DynamicPageTitle`, `MODULE_LEAF_ROUTES`, `PATH_TO_MODULE`, or `LEAF_TO_API_PREFIXES` change: there is no new module/page, and `/api/auth/` is already mapped to `None` in `backend/config/modules.py:30`.
- Frontend has no test runner and must not get one (`AGENTS.md`); frontend verification = grep + `npm run lint` + `npx tsc --noEmit` + responsive/locale checklist.
- Backend verification uses `backend/.venv/bin/python`; plain `python` is not on PATH in this environment.
- Alembic head to revise: `f2a3b4c5d6e7`.
- Existing super-admin default-house ordering test (`backend/tests/test_auth_default_house.py`) must not change.
- No hard reload on switch; `EntitlementsContext` already refetches on `selectedHouse` change and must keep doing so.

## Review Focus

- **Multi-house tenant picks their second house** — must become the persisted active house and appear in `/auth/me`; pinned by Task 2 "assigned house" test.
- **Tenant sends an unassigned house id** — must get 403 with no DB change, even if the id exists; pinned by Task 2 "unassigned house" test (and the reused `require_house_context` guard tests in Task 5).
- **Stored house is no longer assigned to the user** — frontend must fall back to `houses[0]` instead of showing a disabled/stale workspace; pinned by Task 3 derived-id code + grep/tsc verification, and by Task 2 403 test if the stale id is still sent.
- **Target house has no plan / is inactive** — switching must not bypass `SubscriptionGate`; pinned by Task 5 tenant/billing guard tests and by Task 4 code inspection (switcher only sets context, never grants access).
- **375px viewport, header hidden** — the switcher must still be reachable on mobile with 44x44 targets and no horizontal scroll; pinned by Task 4 mobile placement step and static responsive checklist.
- **Rapid double tap while a PUT is in flight** — no second request; pinned by Task 4 pending-disabled trigger step.

---

### Task 1: Persist the active house on the user

**Files:**
- Modify: `backend/app/models/user.py:23-55`
- Create: `backend/alembic/versions/b6c7d8e9f0a1_add_selected_house_id_to_users.py` (revision `b6c7d8e9f0a1`)
- Modify: `backend/app/schemas/user.py:7-19`
- Test: `backend/tests/test_auth_default_house.py`

**Interfaces:**
- Consumes: existing `User` ORM model, `UserSchema`, `GET /api/auth/me` (`get_me`), `tests/conftest.py::make_house`.
- Produces: `User.selected_house_id: Optional[int]`, `UserSchema.selected_house_id: Optional[int] = None`, and Alembic revision `b6c7d8e9f0a1` with `down_revision = "f2a3b4c5d6e7"` that adds column `selected_house_id` (Integer, nullable), FK `users.selected_house_id -> houses.id ON DELETE SET NULL`, and index `ix_users_selected_house_id`.

- [ ] **Step 1: Confirm RED**

Run: `cd backend && .venv/bin/python -m pytest -q tests/test_auth_default_house.py`
Expected: PASS (baseline). Then add the new failing test below to the same file.

```python
@pytest.mark.asyncio
async def test_me_returns_selected_house_id_when_set(db):
    house = await make_house(db, code="H010", name="Assigned House")
    role = Role(name="Manager")
    db.add(role)
    await db.flush()
    user = User(
        username="manager", name="Manager", hashed_password="x",
        roles=[role], houses=[house], selected_house_id=house.id,
    )
    db.add(user)
    await db.commit()

    me = await get_me(db=db, current_user=user)

    assert me.selected_house_id == house.id
```

Run: `cd backend && .venv/bin/python -m pytest -q tests/test_auth_default_house.py::test_me_returns_selected_house_id_when_set`
Expected: FAIL — `User` has no `selected_house_id` / `UserSchema` has no field.

- [ ] **Step 2: Implement model, schema, migration**

Add the nullable indexed FK column to `User`; add `selected_house_id: Optional[int] = None` to `UserSchema` (do not reorder existing fields). Write the Alembic revision with the exact `down_revision` above, `upgrade()` adding the column/index/FK and `downgrade()` dropping them. Keep `get_me` unchanged except that the new schema field flows through automatically.

- [ ] **Step 3: Verify GREEN and migration sanity**

Run: `cd backend && .venv/bin/python -m pytest -q tests/test_auth_default_house.py`
Expected: both tests PASS (existing ordering test still passes).
Run: `cd backend && .venv/bin/alembic heads`
Expected: exactly one head, the new revision.

- [ ] **Step 4: Commit**

```bash
git add backend/app/models/user.py backend/app/schemas/user.py backend/alembic/versions/ backend/tests/test_auth_default_house.py
git commit -m "feat: persist selected house on user"
```

### Task 2: Add the validated, audited selection endpoint

**Files:**
- Modify: `backend/app/routers/auth.py` (request model near `:22-28`, endpoint near `/profile` at `:160`)
- Test: `backend/tests/test_selected_house.py` (new)

**Interfaces:**
- Consumes: `User.selected_house_id` (Task 1), `require_house_context` from `app/routers/deps.py`, `log_activity` from `app/utils/activity_logger.py`, `get_current_user`, `get_db`, `SelectedHouseUpdate` defined in this task.
- Produces: `PUT /api/auth/selected-house` accepting `{ "house_id": int | null }`, returning `dict[str, int]` with key `selected_house_id`; callable in tests as `await set_selected_house(payload, request, db, current_user)`.

- [ ] **Step 1: Write failing tests (all in the new file)**

Use `tests/conftest.py` fixtures `db` and `make_house`; create users with `Role(name="Manager")`, `Role(name="Super Admin")` or no role, and `houses=[...]`. Build a Starlette request with `Request({"type": "http", "method": "PUT", "path": "/api/auth/selected-house", "headers": []})`. Import `set_selected_house` and `SelectedHouseUpdate` from `app.routers.auth`; expect `HTTPException` with `status_code == 403` for the unassigned case. Assertions:

```python
# assigned: tenant switches to second assigned house
result = await set_selected_house(
    SelectedHouseUpdate(house_id=second.id), request, db, tenant
)
assert result == {"selected_house_id": second.id}
assert tenant.selected_house_id == second.id
me = await get_me(db=db, current_user=tenant)
assert me.selected_house_id == second.id

# unassigned: 403 and no DB change
with pytest.raises(HTTPException) as exc:
    await set_selected_house(
        SelectedHouseUpdate(house_id=foreign.id), request, db, tenant
    )
assert exc.value.status_code == 403
assert tenant.selected_house_id == first.id
```
Also assert: a super admin can select a house with no pivot rows; `SelectedHouseUpdate(house_id=None)` resets to the first active house by id (the pivot has no guaranteed order, so assert by literal id, not by list position); an `ActivityLog` row exists with `module == "auth"`, `action == "edit"`, `record_id == second.id`, `old_values == {"selected_house_id": first.id}`, `new_values == {"selected_house_id": second.id}` (query with `select(ActivityLog)`); an unknown id raises `HTTPException` with `status_code == 403` for a tenant (the `require_house_context` deny path) or 400 for a super admin (existence check), and leaves the stored id unchanged.

- [ ] **Step 2: Confirm RED**

Run: `cd backend && .venv/bin/python -m pytest -q tests/test_selected_house.py`
Expected: FAIL on import (`cannot import name 'set_selected_house'`).

- [ ] **Step 3: Implement endpoint**

Define `SelectedHouseUpdate(BaseModel)` with `house_id: Optional[int] = None`. Implement `async def set_selected_house(payload: SelectedHouseUpdate, request: Request, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict[str, int]` decorated `@router.put("/selected-house")`. For an explicit id, resolve with `await require_house_context(x_house_id=payload.house_id, current_user=current_user)` (403 for an unassigned id). For `None`, pick deterministically from `current_user.houses` sorted by `(not h.is_active, h.id)` — do **not** rely on `houses[0]` (the pivot is unordered) or on `require_house_context` (its fallback skips super admins). Verify the resolved id exists with `select(House).where(House.id == resolved)` (400 if missing; this also covers a super admin's arbitrary id) and use that row's `name` for the audit record. Capture `old_values`, set `current_user.selected_house_id = resolved`, then call `log_activity(db, current_user.id, current_user.name, "auth", "edit", record_id=resolved, record_identifier=house_name, old_values=..., new_values=..., request=request)` and return `{"selected_house_id": resolved}`. Keep the response shape identical for every case.

- [ ] **Step 4: Verify GREEN**

Run: `cd backend && .venv/bin/python -m pytest -q tests/test_selected_house.py tests/test_auth_default_house.py`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/auth.py backend/tests/test_selected_house.py
git commit -m "feat: add validated audited house selection endpoint"
```

### Task 3: Wire the persisted selection into the frontend context

**Files:**
- Modify: `frontend/src/context/AuthContext.tsx:40-50,128-130,172-187`
- Modify: `frontend/src/app/retailers/routes/page.tsx:409-437`

**Interfaces:**
- Consumes: `PUT auth/selected-house` returning `{ selected_house_id: number | null }` (Task 2); `User.houses?: { id: number; name: string; code: string }[]`.
- Produces: `AuthContextType.setSelectedHouse(houseId: number | null): Promise<void>`; `selectedHouse` derived from a valid stored id or `houses[0]`.

- [ ] **Step 1: Confirm RED**

Run: `grep -n 'setSelectedHouse' frontend/src/context/AuthContext.tsx frontend/src/app/retailers/routes/page.tsx`
Expected: no output.

- [ ] **Step 2: Add the setter and safe derived id**

Add `setSelectedHouse` to `AuthContextType`. Implement it as: `const response = await apiClient.put("auth/selected-house", { house_id: houseId }); updateUser({ selected_house_id: response.data.selected_house_id });` (let errors reject so callers can toast). Provide it in the provider value. Replace the `selectedHouse:` expression at `:182-186` with a derived `activeHouseId`: use `user.selected_house_id` only when it appears in `user.houses`, otherwise `user.houses[0]?.id`, otherwise `null`. Keep the return type `{ id: number } | null`.

- [ ] **Step 3: Persist retailer-import switches**

At `retailers/routes/page.tsx:426`, replace `updateUser({ selected_house_id: importedHouseId })` with `await setSelectedHouse(importedHouseId)` and pull `setSelectedHouse` from `useAuth()`. Keep the surrounding import flow and `fetchRoutes({ id: importedHouseId })` unchanged.

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run lint > /tmp/opencode/house-switcher-context-lint.log 2>&1 && npx tsc --noEmit && tail -n 3 /tmp/opencode/house-switcher-context-lint.log && grep -n 'setSelectedHouse' src/context/AuthContext.tsx src/app/retailers/routes/page.tsx`
Expected: lint exit 0 with only the pre-existing warning baseline, tsc silent, grep shows the setter declared, provided, and used by the import flow.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/context/AuthContext.tsx frontend/src/app/retailers/routes/page.tsx
git commit -m "feat: persist active house in auth context"
```

### Task 4: Add bilingual copy and the shell switcher

**Files:**
- Modify: `frontend/src/i18n/translations.ts` (`common` in `en` ~:29 and `bn` ~:7506)
- Create: `frontend/src/components/houses/HouseSwitcher.tsx`
- Modify: `frontend/src/components/layout/DashboardLayout.tsx:99-112,114-120`

**Interfaces:**
- Consumes: `setSelectedHouse` and `selectedHouse` from `useAuth()` (Task 3); `useLanguage().t()`; existing shadcn `Popover`, `PopoverTrigger`, `PopoverContent` from `@/components/ui/popover`; `GET houses/accessible` returning `{ id, name, code, display_name }[]`.
- Produces: a zero-prop `HouseSwitcher` component hidden when fewer than two accessible houses; renders in desktop header and a mobile row.

- [ ] **Step 1: Confirm RED**

Run: `grep -nE 'house_switcher_|HouseSwitcher' frontend/src/i18n/translations.ts frontend/src/components/layout/DashboardLayout.tsx`
Expected: no output.

- [ ] **Step 2: Add bilingual keys**

Insert next to `access_blocked_house` in both `common` blocks (once per locale):
- `en`: `house_switcher_label: "Active house"`, `house_switcher_switching: "Switching house…"`, `house_switcher_error: "Could not switch house. Try again."`, `house_switcher_no_houses: "No houses available"`, `house_switcher_open: "Switch house"`.
- `bn`: `house_switcher_label: "সক্রিয় হাউস"`, `house_switcher_switching: "হাউস বদল করা হচ্ছে…"`, `house_switcher_error: "হাউস বদল করা যায়নি। আবার চেষ্টা করুন।"`, `house_switcher_no_houses: "কোনো হাউস পাওয়া যায়নি"`, `house_switcher_open: "হাউস বদল করুন"`.
Run: `grep -c 'house_switcher_' frontend/src/i18n/translations.ts`
Expected: 10 (five keys × two locales).

- [ ] **Step 3: Build the component**

Create `HouseSwitcher.tsx` ("use client"): read `user`, `selectedHouse`, `setSelectedHouse` from `useAuth()` and `t` from `useLanguage()`. On mount (dependency `user?.id`), fetch `apiClient.get("houses/accessible")` and store `items` as `{ id, name, code }[]`; on failure keep `items = []`. Render `null` until `items.length > 1` (single-house users see nothing). Trigger: `cursor-pointer`, `min-h-11`, `Building2` icon plus truncated active house name and chevron, `aria-label={t("common.house_switcher_open")}`. Content: one column of buttons (`min-h-11`, `w-full`, `text-left`, `truncate`, check icon for the active id), each calling `await setSelectedHouse(id)`; set a local `pending` id before the call and clear it in `finally`; disable all option buttons while `pending`; on error show the existing toast error with `t("common.house_switcher_error")` and leave the active house unchanged. Do not add a new select/date control or new color scale.

- [ ] **Step 4: Place it in the shell**

In `DashboardLayout.tsx`, render `<HouseSwitcher />` in the desktop header's right-hand control group next to `<LanguageSwitcher />` (inside the `hidden md:flex` group at `:100-109`), and render it again in a compact `md:hidden` row above `<main>` using the existing page gutter (`px-2`), without adding a page header or changing `<main>` padding. Accept that the same component instance appears twice; keep one component definition.

- [ ] **Step 5: Verify**

Run: `cd frontend && npm run lint > /tmp/opencode/house-switcher-lint.log 2>&1 && npx tsc --noEmit && tail -n 3 /tmp/opencode/house-switcher-lint.log && grep -nE 'house_switcher_|HouseSwitcher' src/i18n/translations.ts src/components/layout/DashboardLayout.tsx`
Expected: lint exit 0 (pre-existing warning baseline only), tsc silent, grep shows five keys per locale and both shell placements.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/i18n/translations.ts frontend/src/components/houses/HouseSwitcher.tsx frontend/src/components/layout/DashboardLayout.tsx
git commit -m "feat: add global house switcher to app shell"
```

### Task 5: Full verification and guard checks

**Files:** none (verification only)

**Interfaces:**
- Consumes: all prior tasks.

- [ ] **Step 1: Backend suite**

Run: `cd backend && .venv/bin/python -m pytest -q`
Expected: all tests pass, 0 failures.

- [ ] **Step 2: Tenancy / billing / plan-module guard suite**

Run: `cd backend && .venv/bin/python -m pytest -q tests/test_entitlement.py tests/test_house_access_guard.py tests/test_tenant_isolation.py tests/test_plan_modules_parity.py tests/test_module_coverage.py`
Expected: all pass; confirms the new auth route does not break module mapping and that a selected house still obeys the subscription gate.

- [ ] **Step 3: Frontend checks and locale/responsive checklist**

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: lint exit 0 with only the pre-existing warning baseline; tsc silent.
Verify by inspection: all switcher strings via `t()` with both locales present; at 375px the mobile row control is `min-h-11` and does not overflow; at 768px/1280px the header control sits beside `LanguageSwitcher`; the switcher is absent for a single-house user; no new page header, nav item, or permission key was introduced.

- [ ] **Step 4: Diff hygiene**

Run: `git diff --check <base-sha>..HEAD`
Expected: clean (CRLF-only lines on `DashboardLayout.tsx` are a pre-existing repo pattern; verify no added line has real trailing spaces).

## Post-review corrections (final implementation)

A fresh whole-branch review found two issues; the plan above was corrected as follows so the checked-in code and the plan agree:

1. `/auth/me` must expose exactly the same house set as `GET /houses/accessible`. Previously a super admin **with** pivot rows saw only those pivot houses from `/auth/me` while the switcher offered every house, so selecting a non-pivot house succeeded on the server but was silently rejected by the UI. `auth.py` now imports the single `_sees_all_houses` helper from `houses.py` (also used by `reports.py`) and reassigns `current_user.houses` from that shared rule. The query runs before the assignment so autoflush cannot persist pivot rows from a GET, and `get_db` closes without committing. `null` resolution uses the same helper, which also fixes reset for a zero-pivot super admin. Added tests: super admin with pivot rows, zero-pivot reset, and null-with-inactive preference.
2. A failed `setSelectedHouse` during retailer import no longer falls into the import `catch`. It has its own `try/catch` with `routes.import_house_switch_failed` (en+bn) and `fetchRoutes({ id: importedHouseId })` always runs, so a successful import cannot be misreported as failed.
3. The switcher reads `user.houses` from `/auth/me` instead of fetching `houses/accessible`; both shell placements now share one authoritative list with no duplicate request. Options are sorted by name and labelled `name (code)`; the trigger uses the same label so identically named houses remain distinguishable. The auth-context fallback sorts active houses first then by id, matching the backend's `null` default.
