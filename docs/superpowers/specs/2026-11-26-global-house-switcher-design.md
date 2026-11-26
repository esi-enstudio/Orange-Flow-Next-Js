# Design — Global house switcher for multi-house users

Date: 2026-11-26

## Intent / why

A user assigned to several houses can only ever work in the first house. `AuthContext.selectedHouse` falls back to `houses[0]`, and there is no house switcher in the header or sidebar, even though `docs/agents/multi-tenancy.md:210` mandates one. The new template-modal house hint made this visible: it names the active house but offers no way to change it. This change adds the mandated switcher so the user can switch house and then create a template (or use any other house-scoped page) for each assigned house.

## Recon findings (binding constraints)

- Backend `User` has **no** `selected_house_id` column; `UserSchema` does not expose it, and `GET /api/auth/me` returns only `houses[]`. The frontend field is written only locally (`retailers/routes/page.tsx:426`) and is lost on reload.
- `DashboardLayout` header is desktop-only (`hidden md:flex`); `MobileNav`/`MoreSheet` contain no house control.
- `deps.get_house_context` already validates `X-House-ID` against `current_user.houses` (super admin excepted). A forged header cannot leak cross-tenant data, so the switcher only needs to choose a legitimate value.
- `EntitlementsContext` refetches whenever `selectedHouse` changes; `SubscriptionGate` follows it. A switch must therefore be reactive, not a hard reload.
- `GET /api/houses/accessible` is the authoritative option source (assigned houses; super admin sees all, active houses ordered first in `/auth/me`).
- Current Alembic head: `f2a3b4c5d6e7`. Backend virtualenv is `backend/.venv` (`python` is not on PATH in this shell).

## Goals

- Users with more than one accessible house get a switcher in the app shell (desktop header + mobile), showing the active house and allowing a one-tap change.
- The choice persists across reloads and devices and is returned by `/auth/me`.
- Every house-scoped page and the template modal follow the new active house; entitlements re-evaluate automatically.
- Single-house users see no switcher (their only house stays auto-selected).

## Non-goals / anti-goals

- No per-template house picker; the template modal keeps its single implicit `X-House-ID`.
- No change to authorization rules: a user still cannot select a house they are not assigned to.
- No new page, nav item, module key, permission key, or page header.
- No bulk "create templates for all houses" workflow.

## Approach decision

**Chosen: server-persisted active house + shared shell switcher.** Add a nullable `selected_house_id` to `users`, expose it in `/auth/me`, add a self-service endpoint to set it, and render one shared `HouseSwitcher` in the shell.

Alternative rejected: client-only cookie/localStorage state. Fewer files, but the active house would be per-device, invisible to `/auth/me`, and the retailer-import flow would stay inconsistent; server persistence matches the existing "auth/me is the user's workspace truth" model.

## How it will be built

### Backend

1. **Model + migration** — `User.selected_house_id = Column(Integer, ForeignKey("houses.id", ondelete="SET NULL"), nullable=True, index=True)`. New Alembic revision with `down_revision = "f2a3b4c5d6e7"` adds the column, FK and index; downgrade drops them.
2. **Schema** — add `selected_house_id: Optional[int] = None` to `UserSchema` so `/auth/me` returns it. Keep the existing active-first house ordering test (`tests/test_auth_default_house.py`) untouched.
3. **Endpoint** — `PUT /api/auth/selected-house`, body `{ "house_id": int | null }`, authenticated via `get_current_user`. Resolve/validate the target by reusing `await require_house_context(x_house_id=payload.house_id, current_user=current_user)` (403 on a house the user cannot use; `null` resets to `current_user.houses[0].id` because `require_house_context` supplies that fallback, unlike `get_house_context`). Persist, then write an activity log via `log_activity` (`module="auth"`, `action="edit"`, `old_values`/`new_values` = previous/new `selected_house_id`, `record_identifier` = house name). Return `{ "selected_house_id": <resolved> }`.
4. **Validation / errors** — 400 for an unknown house id (not resolvable), 403 for a house outside the user's scope, 401 unauthenticated. Existing `deps` helpers are the single source of the membership rule.
5. **Permission / module mapping ruling** — no new permission key: this endpoint mutates only the caller's own preference, like `/auth/profile`. It lives under the existing unversioned `/api/auth/` prefix, which `backend/config/modules.py` already maps to `None` (platform path). Ruling: `api-conventions.md`'s `/api/v1/...` rule is for module APIs; adding a parallel `v1/auth` prefix would split the auth family and break `test_module_coverage.py` parity, so repo precedent wins per `AGENTS.md` precedence.

### Frontend

1. **AuthContext** — expose `setSelectedHouse(houseId: number | null): Promise<void>` which PUTs to `auth/selected-house` and then `updateUser({ selected_house_id: response.data.selected_house_id })`. Derive `selectedHouse` as: a stored id that is present in `user.houses`; otherwise `houses[0]`; otherwise `null`. This makes stale ids harmless after house reassignment.
2. **Retailer import** — replace the local `updateUser({ selected_house_id: importedHouseId })` at `retailers/routes/page.tsx:426` with `await setSelectedHouse(importedHouseId)` so the imported house becomes the persisted workspace too.
3. **HouseSwitcher component** — `frontend/src/components/houses/HouseSwitcher.tsx`: uses existing shadcn `Popover` primitives (no new select control, no new component library), a `cursor-pointer` trigger showing `Building2` + truncated current house name + chevron, and a one-column list of houses from `GET houses/accessible` with a check on the active one. Hidden when fewer than two options. 44x44 touch targets, `text-xs/sm` truncation, dark-mode classes from the existing design system, all strings via `t()` in `en` and `bn`. On failure: keep the old house and show an existing toast-style error.
4. **Placement** — render the same component in `DashboardLayout`'s desktop header beside `LanguageSwitcher`, and in a compact `md:hidden` row above `<main>` for mobile. No page-header change; no second guide control.
5. **Reactivity** — no `router.refresh()`; house-scoped fetches already depend on `selectedHouse`, and `EntitlementsContext` refetches entitlements for the new `X-House-ID`. The `SubscriptionGate` overlay must reflect the newly selected house without a manual reload.

### i18n

New `common.*` keys in both locales: switcher label/aria, "switching", "switched", "failed", "no houses". No hard-coded user-visible English/Bangla in the component.

### Tests / verification

- New backend test file (`tests/test_selected_house.py`), TDD red→green: assigned house accepted and returned by `/auth/me`; unassigned house 403 with no DB change; super admin may pick any accessible house; `null` resets to first assigned house; audit row written with old/new values; stale stored id falls back in `AuthContext` (frontend static check via lint/typecheck, no test runner).
- `cd backend && .venv/bin/python -m pytest -q` (full suite).
- Guard tests because `X-House-ID`/house scoping and a new auth route are touched: `.venv/bin/python -m pytest -q tests/test_entitlement.py tests/test_house_access_guard.py tests/test_tenant_isolation.py tests/test_plan_modules_parity.py tests/test_module_coverage.py`.
- Frontend: `cd frontend && npm run lint`, `cd frontend && npx tsc --noEmit`; no frontend test runner may be added (`AGENTS.md`).
- Responsive checklist by static inspection at 375/768/1280 (no horizontal scroll, 44x44 targets, one-column mobile); i18n grep confirms one key per locale.

## Risks / edge cases

- **House removed from user while stored as active** — `AuthContext` derives a fallback to `houses[0]`; backend still refuses the stale id if it is sent before refresh.
- **Inactive/unpaid target house** — `houses/accessible` may still list it; `EntitlementsContext`/`SubscriptionGate` blocks the workspace with the correct CTA, exactly as today. The switcher does not bypass the plan gate.
- **Race: two rapid switches** — disable the trigger while a PUT is in flight; last committed value wins, UI follows the response.
- **Super admin with no pivot rows** — `/auth/me` supplies all houses active-first; selecting any of them is allowed by `get_house_context`.
- **Retailer import** — switching via the import flow now goes through the same persisted setter; if it fails, the import still succeeds but the workspace stays on the previous house and shows an error.

## Left to the builder

Nothing beyond the details above; the execution plan will split backend persistence, frontend shell switcher, and verification into separate tasks.
