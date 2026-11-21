# WhatsApp Card Disconnected State

## Intent

After WhatsApp is disconnected, show that it is not set up and offer a way to connect again instead of opening connection management.

## Scope and constraints

- Map WhatsApp `disconnected` state to the existing localized `not_configured` label.
- Show `Manage connection` only while the connection is connected.
- For a disconnected connection, show the existing `Connect` action only to users with `whatsapp.connect`; use the existing QR setup flow.
- Preserve existing management actions and permission checks while connected.
- No backend state or API changes.

## Approaches

- **Use the existing state and connect flow (selected):** map the card presentation from existing API status and route disconnected users to the existing connection setup flow.
- Add a new “setup again” action or backend status: rejected because the UI and backend already provide the required connect flow and status.
