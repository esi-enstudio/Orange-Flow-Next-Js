# Template Modal House Hint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the active house name in the Create Template modal when scope is `house`, so the implicit `X-House-ID` target is visible before submit.

**Architecture:** Pass the name from the templates page (which already has `user.houses` and `selectedHouseId`) into the presentational modal as one optional prop; render a single localized hint under the Scope field. No house selection, payload, header, API, or database change.

**Tech Stack:** Next.js App Router client component, React, Tailwind CSS, existing `useLanguage().t()` translation object.

**Spec:** `docs/superpowers/specs/2026-11-26-template-modal-house-hint-design.md`

## Global Constraints

- All user-visible copy has `en` and `bn` keys in `frontend/src/i18n/translations.ts`; a key missing in either locale is a defect.
- House isolation stays via `X-House-ID`; the modal must not introduce another way to choose a house.
- No API, database, permission, audit, navigation, or page-header change.
- The frontend has no test runner and must not get one (`AGENTS.md`); verification is grep + `npm run lint` + `npx tsc --noEmit`.
- Use existing muted hint styling (`text-xs text-gray-500 dark:text-gray-400`); no new component or bespoke control.

## Review Focus

- Multiple-house user: the hint names the house actually used by `X-House-ID` (`selected_house_id`), not the first house — pinned in Task 2 lookup step.
- No resolvable house name: no raw dotted key, `"undefined"`, or empty hint line — pinned in Task 2 conditional render and typecheck.
- `global` scope: house hint hidden; only the existing `global_hint` remains — pinned in Task 2 render condition.
- Bangla locale: the hint resolves through `t()` in both locales — pinned by Task 1 grep and Task 2 key usage.
- Modal reopen after active house changes: the hint follows the current prop, not stale form state — pinned in Task 2 (prop read outside `form`).

---

### Task 1: Add bilingual hint copy

**Files:**
- Modify: `frontend/src/i18n/translations.ts` (`documents` block, `en` ~1760 and `bn` ~9258)

**Interfaces:**
- Consumes: existing `translations.en.documents` / `translations.bn.documents` objects.
- Produces: `documents.house_scope_hint` with `{house}` placeholder, present exactly once per locale.

- [ ] **Step 1: Confirm RED**

Run: `grep -n 'house_scope_hint' frontend/src/i18n/translations.ts`
Expected: no output.

- [ ] **Step 2: Add the key in both locales**

Insert next to `global_hint` in each `documents` block:
- `en`: `house_scope_hint: "This template will be created for {house}."`
- `bn`: `house_scope_hint: "এই টেমপ্লেটটি {house}-এর জন্য তৈরি হবে।"`

- [ ] **Step 3: Verify both locales**

Run: `grep -n 'house_scope_hint' frontend/src/i18n/translations.ts`
Expected: exactly two lines, one in the `en` block and one in the `bn` block, with the copy above.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/i18n/translations.ts
git commit -m "feat: add bilingual house hint copy for template modal"
```

### Task 2: Pass house name and render the hint

**Files:**
- Modify: `frontend/src/app/documents/templates/page.tsx:61-62,357-364`
- Modify: `frontend/src/app/documents/templates/_components/CreateTemplateModal.tsx:18-25,43-50,263-298`

**Interfaces:**
- Consumes: `documents.house_scope_hint` from Task 1; `User.houses?: { id: number; name: string; code: string }[]` and `selectedHouseId: number | undefined` from `page.tsx`.
- Produces: `CreateTemplateModalProps.selectedHouseName?: string`; rendered hint only when `form.scope === "house"` and `selectedHouseName` is truthy.

- [ ] **Step 1: Confirm RED**

Run: `grep -nE 'selectedHouseName|house_scope_hint' frontend/src/app/documents/templates/page.tsx frontend/src/app/documents/templates/_components/CreateTemplateModal.tsx`
Expected: no output.

- [ ] **Step 2: Resolve the active house name in `page.tsx`**

Add a local derived value next to `selectedHouseId` (`:62`) that finds the house with `id === selectedHouseId` in `user?.houses` and takes its `name`. Pass it as `selectedHouseName` to `<CreateTemplateModal>` at `:357-364`. Use the active id, not `houses[0]`.

- [ ] **Step 3: Add the prop and render the hint**

In `CreateTemplateModal.tsx`, add `selectedHouseName?: string` to `CreateTemplateModalProps` and destructure it. Immediately after the Scope field block (before the Template mode label), render a single `<p>` only when `form.scope === "house" && selectedHouseName`, with `t('documents.house_scope_hint', { house: selectedHouseName })` and the muted `text-xs text-gray-500 dark:text-gray-400` style. Do not change the form state, validation, submit body, or headers.

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run lint > /tmp/opencode/template-hint-lint.log 2>&1 && npx tsc --noEmit && tail -n 3 /tmp/opencode/template-hint-lint.log && grep -nE 'selectedHouseName|house_scope_hint' src/app/documents/templates/page.tsx src/app/documents/templates/_components/CreateTemplateModal.tsx`
Expected: lint output ends with the pre-existing warning baseline and 0 errors, typecheck silent, grep shows the prop passed and the key rendered.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/documents/templates/page.tsx frontend/src/app/documents/templates/_components/CreateTemplateModal.tsx
git commit -m "feat: show active house in template create modal"
```
