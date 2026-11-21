# Report Delivery Empty Channel State

## Intent

Make the delivery modal’s no-channel state concise and avoid presenting controls that cannot be used until an app is connected.

## Scope and constraints

- Replace the no-channel hint with generic wording that does not name a provider, in English and Bangla.
- Keep the existing no-app title and permission-controlled Connections action.
- Hide the new/edit delivery form whenever no delivery channel is available, including while channel state is unresolved.
- Hide Active schedules and Delivery history whenever no delivery channel is available.
- Remove the amber missing-requirements block completely; retain validation for disabling save/send actions when the form is available.

## Approaches

- **Keep the channel empty state and hide the delivery form, schedules, and history (selected):** retains the connection CTA while removing all content users cannot access until a channel is connected.
- Hide the whole modal body when no channel is connected: rejected because it would remove the connection CTA.
- Leave the form, schedules, and history visible but disabled: rejected because the user explicitly asked not to show these sections.

The user clarified that saved schedules and delivery history should also be hidden when no channel is available.
