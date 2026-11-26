# Create Template Modal — Explicit House Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline execution was chosen by the user). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `Scope = House` is chosen in the Create Template modal, let the user pick an accessible house. Create the template under that house and make it visible/openable there, with a failed house switch cancelling creation safely.

**Architecture:** The backend already derives template ownership from `X-House-ID` only (`TemplateCreateIn` has no `house_id`), and both `list_templates` and `assert_template_readable` use that same active-house context. Therefore the modal picks a house from `user.houses`, calls the existing persisted `AuthContext.setSelectedHouse()` before POSTing, and sends the chosen id in `X-House-ID`. No backend change: the switch endpoint is already validated (membership), audited and exposed through `/auth/me`.

**Tech Stack:** Next.js App Router client component, React context, typed i18n object in `translations.ts`, native labelled `<select>` (matches the modal's existing fields and the repo's select standard), Tailwind CSS v4.

**Spec:** `docs/superpowers/specs/2026-11-26-template-modal-house-select-design.md`

## Global Constraints

- **Do not commit.** The user revoked self-commit permission; leave all changes uncommitted in the working tree.
- All user-visible copy requires matching `en` and `bn` keys in `frontend/src/i18n/translations.ts`; a missing locale key is a defect (`docs/agents/i18n.md`).
- House options come **only** from `user.houses` (`/auth/me`); never accept a raw house id from UI state without the server-side switch validation. A house outside the accessible set must not be selectable.
- Never trust frontend data: `PUT /api/auth/selected-house` remains the authority for membership validation; this plan reuses it unchanged.
- Audit: the switch is a mutation already logged by that endpoint (`module="auth"`, `action="edit"`). No new mutation is introduced, so no new audit entry is needed.
- Permissions: no new permission key, `permissions.json` entry, button-level permission, nav item, or route guard — this is a field inside an already permission-controlled modal (`documents.templates.manage`).
- Module wiring: no new module/page/route, so `navItems`, `DynamicPageTitle`, `MODULE_LEAF_ROUTES`, `PATH_TO_MODULE`, `LEAF_TO_API_PREFIXES`, and `allowed_modules` are **N/A** and must stay untouched.
- Database: no new model, no new column, no migration, no `house_id` addition — `users.selected_house_id` and its index already exist from the house-switcher work.
- Skeleton state: unchanged — the templates page already has `TemplateSkeleton`; no new async view is added.
- Responsive: verify 375 / 768 / 1280 with no horizontal scroll and 44×44 touch targets (`docs/agents/responsive.md`). The new select reuses `fieldClass` (`min-h-11`) and the existing single-column → `sm:grid-cols-2` layout.
- Follow user instruction in `frontend/AGENTS.md`: before editing UI code, check `frontend/node_modules/next/dist/docs/` for a relevant guide (client components / forms / hooks). This change uses only APIs already present in the file, so no new API surface is expected.
- Frontend has no test runner and must not get one; verification is lint + typecheck + static checks only (`AGENTS.md`).

## Review Focus

- **House scope with a second house selected** — the POST must carry that house in `X-House-ID`, and the created template must appear in the list and open on its detail page; pinned by Task 3 (switch before POST, header from `form.houseId`) and Task 2 (options from `user.houses`).
- **Switch fails (403/network)** — creation must be cancelled with a translated error; no POST, no template under the wrong house; pinned by Task 3's dedicated switch try/catch and `documents.house_switch_failed` key.
- **Global scope** — no house field, no switch, no `X-House-ID` header; pinned by Task 2 conditional render and Task 3 conditional switch/header.
- **User with one house / no active house** — default stays the active house, and the existing `validation_house_required` message appears if none exists; pinned by Task 2 initialisation and validation.
- **Locale switch to `bn`** — new labels/errors must not show dotted key paths; pinned by Task 1 and the Task 5 locale grep.
- **375px viewport** — the extra select must not cause horizontal scroll; long house names wrap; pinned by Task 5 checklist.

---

### Task 1: Add bilingual copy for the house field and switch failure

**Files:**
- Modify: `frontend/src/i18n/translations.ts` (en documents block near line 1767; bn documents block near line 9272)

**Interfaces:**
- Consumes: typed `translations` object with matching `en`/`bn` key paths.
- Produces: `documents.select_house` (label + placeholder) and `documents.house_switch_failed` in both locales. Reuse existing `documents.house_scope_hint` and `documents.validation_house_required`; do not duplicate them.

- [x] **Step 1: Add the two keys to `en.documents`**

Near `house_scope_hint` / `validation_house_required` add:

```ts
select_house: "Select House",
house_switch_failed: "Could not switch to the selected house. The template was not created.",
```

- [x] **Step 2: Add the same two paths to `bn.documents`**

Near the matching bn keys add Bengali translations, e.g.:

```ts
select_house: "হাউস নির্বাচন করুন",
house_switch_failed: "নির্বাচিত হাউসে প্রবেশ করা যায়নি। টেমপ্লেট তৈরি করা হয়নি।",
```

(Write idiomatic Bengali in the file — the example only shows the expected key paths. UI strings stay in the translation file, not in Banglish.)

- [x] **Step 3: Confirm both key paths exist exactly once per locale**

Run: `grep -n "select_house:\|house_switch_failed:" frontend/src/i18n/translations.ts`
Expected: four total matches for the new keys (2 en, 2 bn), in addition to unrelated `select_house` keys in other namespaces.

---

### Task 2: Render the house field and validate it

**Files:**
- Modify: `frontend/src/app/documents/templates/_components/CreateTemplateModal.tsx`

**Interfaces:**
- Consumes: new prop `houses: Array<{ id: number; name: string; code?: string }>`; existing `useAuth()`, `selectedHouseId`, `selectedHouseName`, `canCreateGlobal`, `fieldClass`, `t()` and `setField()`.
- Produces: `houseId: string` in `FormState`; a required native `<select>` rendered only when `form.scope === "house"`; validation error keyed on `houseId`.

- [x] **Step 1: Check the Next.js guide**

Read the relevant file(s) under `frontend/node_modules/next/dist/docs/` for client components/forms as instructed by `frontend/AGENTS.md`. Expected outcome: no new API needed because the file already uses `"use client"`, `useState`, `useEffect` and native form controls.

- [x] **Step 2: Extend props and form state**

Add a local `SelectableHouse` interface and the `houses` prop. Add `houseId: string` to `FormState`. Initialise it in **both** the `useState` initializer and the `open` reset effect to `selectedHouseId ? String(selectedHouseId) : ""`. Do **not** add `houses` to the effect dependency array (the page passes a fresh `[]` fallback, and re-running the reset on every render would erase the user's choice); keep the existing deps `[open, selectedHouseId, canCreateGlobal]`.

- [x] **Step 3: Render the field**

Inside the scope cell (after the scope `<select>` and its error), add a block shown only when `form.scope === "house"`:

- `<label>` with text `t("documents.select_house")`, required `*`, and the `<select>` using `fieldClass`.
- Options: `houses` sorted by name, value `String(house.id)`, label `house.code ? \`${house.name} (${house.code})\` : house.name`.
- `aria-invalid` / `aria-describedby` pointing to `create-template-house-error` and the existing `create-template-scope-hint`.
- Field error span with `role="alert"`, id `create-template-house-error`.
- Replace the static hint body with `t("documents.house_scope_hint", { house: chosenHouseName })` where `chosenHouseName` is derived from `houses.find(h => String(h.id) === form.houseId)?.name ?? selectedHouseName`. Keep `break-words` and the existing hint id.
- When `scope === "global"`, neither the house select nor the hint renders (the hint id is already conditional; extend that condition to require `form.scope === "house"` — it is, but re-check after editing).

- [x] **Step 4: Validate the chosen house**

In `validate()`, replace the old `if (form.scope === "house" && !selectedHouseId) next.scope = ...` with `if (form.scope === "house" && !form.houseId) next.houseId = t("documents.validation_house_required")`.

- [x] **Step 5: Static check**

Run: `grep -n "houseId\|select_house\|house_scope_hint" frontend/src/app/documents/templates/_components/CreateTemplateModal.tsx`
Expected: the field, validation, hint and header (next task) all reference `form.houseId`, not the shell's `selectedHouseId` for the POST.

---

### Task 3: Switch active house before creating, with isolated failure

**Files:**
- Modify: `frontend/src/app/documents/templates/_components/CreateTemplateModal.tsx`

**Interfaces:**
- Consumes: `useAuth().setSelectedHouse(houseId: number | null): Promise<void>` (throws on HTTP failure; resolves with an updated `selected_house_id` in `/auth/me`), `selectedHouseId`, existing `apiClient.post`, `getDocumentErrorMessage`, `getDocumentFieldErrors`.
- Produces: a two-phase `submit()` — switch, then POST — with a dedicated translated error for switch failure.

- [x] **Step 1: Import the setter**

Import `useAuth` from `@/context/AuthContext` and call `const { setSelectedHouse } = useAuth();` inside the component.

- [x] **Step 2: Add the switch phase**

In `submit()`, after validation passes and `setSaving(true)`, wrap the switch in its **own** `try/catch` *before* the POST:

```ts
if (form.scope === "house" && form.houseId && Number(form.houseId) !== selectedHouseId) {
  try {
    await setSelectedHouse(Number(form.houseId));
  } catch {
    setSubmitError(t("documents.house_switch_failed"));
    setSaving(false);
    return;
  }
}
```

No POST runs on switch failure, so no template can land in the wrong house. Do not clear field errors here; the form remains open for correction.

- [x] **Step 3: Use the chosen house in the POST header**

Change the existing header from `selectedHouseId` to `form.houseId`:

```ts
headers: form.scope === "house" && form.houseId ? { "X-House-ID": form.houseId } : {},
```

Read the header from `form.houseId` directly — do not wait for the page to re-render with the new `selectedHouseId`. Keep the payload, `createdId` validation, `onCreated(createdId)`, and the existing POST catch/finally unchanged.

- [x] **Step 4: Confirm sequencing**

Read the final `submit()` and verify order: `validate()` → `setSaving(true)` → switch (isolated catch) → POST (existing catch) → `onCreated` → `setSaving(false)` in `finally`. Verify `Global` scope skips both the switch and the header.

---

### Task 4: Feed accessible houses from the templates page

**Files:**
- Modify: `frontend/src/app/documents/templates/page.tsx` (JSX near line 358)

**Interfaces:**
- Consumes: existing `useAuth().user.houses` (`House[]` from `/auth/me`).
- Produces: `houses={user?.houses ?? []}` passed to `CreateTemplateModal`.

- [x] **Step 1: Pass the prop**

Add `houses={user?.houses ?? []}` to the `<CreateTemplateModal ... />` invocation alongside `selectedHouseId` / `selectedHouseName`. No other page logic changes: list fetching already keys off `selectedHouseId`, which updates after the switch.

- [x] **Step 2: Static check**

Run: `grep -n -A9 "<CreateTemplateModal" frontend/src/app/documents/templates/page.tsx`
Expected: `houses`, `selectedHouseId`, `selectedHouseName`, `canCreateGlobal`, `onCreated` all present.

---

### Task 5: Verify (lint, types, locales, responsive)

**Files:** none (verification only)

- [x] **Step 1: Frontend lint**

Run: `cd frontend && npm run lint`
Expected: exit 0, no **new** errors or warnings introduced by this change (the repo has pre-existing warnings).

- [x] **Step 2: Frontend types**

Run: `cd frontend && npx tsc --noEmit`
Expected: silent, exit 0. Fixes type issues in the new prop/form fields if any appear.

- [x] **Step 3: Locale parity**

Run: `grep -n "select_house:\|house_switch_failed:\|house_scope_hint:\|validation_house_required:" frontend/src/i18n/translations.ts`
Expected: all four paths present in both `en.documents` and `bn.documents`.

- [x] **Step 4: Confirm no backend / module drift**

Run: `git status --short` and `git diff --check`
Expected: only the three frontend files plus the spec/plan docs are modified, no trailing whitespace, nothing committed. `git diff --name-only` must not contain `backend/`, `permissions.json`, `navItems`, `modules.py`, or an Alembic version file.

- [x] **Step 5: Responsive / UX checklist (static)**

Confirm: new select uses `fieldClass` (`min-h-11`, 44px), sits in the existing one-column-on-mobile / two-column-on-`sm` grid, native select keeps pointer cursor, long house names use `break-words` in the hint, no horizontal overflow at 375 / 768 / 1280, `en`/`bn` copy renders via `t()` with no dotted key path, Escape/focus/body-scroll behaviour of the modal unchanged. If a browser is available, open the modal at each width and check visually; otherwise state that this was a static check.

- [x] **Step 6: Report honestly**

Report lint/typecheck output and the responsive check result. Say explicitly that no backend tests were run because no backend file changed, and that nothing was committed.
