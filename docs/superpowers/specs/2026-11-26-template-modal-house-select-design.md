# Create Template Modal — explicit house selection

Date: 2026-11-26

## Intent

When `Scope = House` is selected in the Create Template modal, show a house
selection field. The new template must be created for the chosen house and be
visible/openable there. Today the modal silently uses the shell's active house.

## Goals

- House selector appears only for `scope === "house"`.
- Options are the houses the user can actually access (`user.houses`), sorted by
  name, displayed as `name (code)`. Default is the current active house.
- On submit, the chosen house becomes the active house *before* the POST; the
  existing `X-House-ID` header then carries it.
- If the switch fails, creation is cancelled and a translated error is shown;
  no template is created under the wrong house.
- All new copy in `en` and `bn`.

## Non-goals / anti-goals

- No backend schema change, new endpoint, permission key, module, nav item or
  page header.
- No change to `Global` scope (still super-admin only).
- No house picker for other document screens (letterhead, signatory, create
  document); their behaviour stays as-is.
- No cross-tenant house can be selected — options come from `/auth/me` only.

## Constraints (found in the repo)

- `POST /v1/documents/templates` takes its house only from `X-House-ID`;
  `TemplateCreateIn` has no `house_id`.
- `list_templates` and `assert_template_readable` use the active house context.
  Creating for a different house without switching would leave the new template
  invisible in the list and 403 on its detail page.
- `AuthContext.setSelectedHouse()` already persists the choice via
  `PUT /api/auth/selected-house` and is server-validated.
- No shadcn `Select` primitive exists here; the modal already uses native
  labelled `<select>` fields, so the new field uses the same pattern.

## Approaches

1. **Switch active house, then create (chosen).** Selecting a house in the modal
   updates `form.houseId`; on submit call `setSelectedHouse(form.houseId)` first,
   then POST with that house in `X-House-ID`. List and detail work unchanged.
   Trade-off: the shell's active house changes as part of template creation —
   accepted by the user because the template must show under the chosen house.
2. **Explicit `house_id` in the payload.** Add and validate the field server-side
   without touching the active house. Requires new list/detail house-context
   handling to satisfy "shows under the selected house"; larger blast radius.
3. **Read-only hint of the active house.** Current behaviour; rejected because
   no house can actually be chosen.

## Design (user picked approach 1)

- `CreateTemplateModal` receives `houses: Array<{ id, name, code? }>` from the
  page (derived from `useAuth().user.houses`) plus `selectedHouseId` /
  `selectedHouseName` as today.
- Add `houseId: string` to `FormState`. Initialise/reset it from `selectedHouseId`.
  When `scope === "house"`, render a required labelled `<select>` of accessible
  houses; replace the current static `house_scope_hint` with the chosen house's
  name. `scope === "global"` hides the field entirely.
- Validation: house scope with no `houseId` → `documents.validation_house_required`.
- `submit()`: if the chosen house differs from the active house, await
  `setSelectedHouse(Number(form.houseId))`. On failure show a dedicated
  translated error and stop before POST. On success POST with
  `X-House-ID: form.houseId`; keep all existing payload fields and error handling.
- Page passes `houses`; no other page or component changes.
- i18n: add `documents.select_house` (label/placeholder) and
  `documents.house_switch_failed` in both locales; reuse
  `documents.validation_house_required` and `documents.house_scope_hint`.

## Verification

- `cd frontend && npm run lint`
- `cd frontend && npx tsc --noEmit`
- Responsive check at 375 / 768 / 1280: no horizontal scroll, 44×44 touch
  targets; bilingual copy applies via `t()`.
- Backend untouched, so no backend test run is required for this change.
