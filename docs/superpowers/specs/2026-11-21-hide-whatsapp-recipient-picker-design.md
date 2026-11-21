# Hide WhatsApp Recipient Picker When Disconnected

## Intent

Do not show the WhatsApp recipient picker when WhatsApp is disconnected, so users do not see unusable group/contact tabs or search controls.

## Scope and constraints

- Hide the complete picker only when the selected channel is WhatsApp and `whatsappReady` is false.
- Keep current connection state, channel selection, and schedule validation behavior unchanged.
- Telegram behavior is out of scope.

## Approaches

- **Hide the entire picker using the existing `whatsappReady` state (selected):** meets the requested behavior with one conditional at the render site.
- Hide only the empty-groups message: rejected because the tabs and search controls would remain visible.

The user approved the selected approach.
