# Design — Show active house in Create Template modal

Date: 2026-11-26

## Intent / why

On `/documents/templates`, selecting scope `house` in the Create Template modal does not say which house will own the template. The house is determined implicitly by `X-House-ID`, so a user with multiple houses can submit without confirming the target.

## Goals

- Show a short, localized hint under the Scope field when `scope === "house"` naming the active house.
- Keep the existing implicit house selection semantics unchanged: no house dropdown, no payload/header change, no backend change.

## Non-goals / anti-goals

- Do not let the modal choose a different house — that would need house-context validation and permission work beyond this change.
- Do not change the `global` flow, list/table, editor, or API.

## Constraints

- `AGENTS.md`: all user-visible copy needs `en` + `bn` keys in `translations.ts`; house isolation stays via `X-House-ID`.
- `AuthContext.selectedHouse` carries only `{ id }`; `user.houses[]` carries `{ id, name, code }`.
- Modal is a portal-rendered client component; hint must keep the existing text style and not add a new component.

## Approaches

1. **Pass house name from the page as a prop (chosen).** `page.tsx` resolves the name from `user.houses` and passes `selectedHouseName` to the modal. Modal stays presentational; no new auth coupling. Cost: one extra prop.
2. Modal reads `useAuth()` directly. Fewer props, but couples a reusable dialog to the auth context and duplicates lookup logic. Rejected.
3. Add a house picker inside the modal. More explicit, but changes backend scope semantics and needs house/permission validation. Rejected as out of scope.

## How it will be built

- Add `selectedHouseName?: string` to `CreateTemplateModalProps`; pass it from `page.tsx` using `user?.houses?.find(h => h.id === selectedHouseId)?.name`.
- Under the Scope field, when `scope === "house"` and a name is available, render one muted text line using a new key `documents.house_scope_hint` with `{house}` placeholder, in both locales.
- If no name can be resolved, render no hint — the existing validation/backend guard still blocks a missing house.
- Verification: `cd frontend && npm run lint`, `cd frontend && npx tsc --noEmit`; grep the new key appears once per locale.

## Left to the builder

Nothing beyond the details above; this is a small change.
