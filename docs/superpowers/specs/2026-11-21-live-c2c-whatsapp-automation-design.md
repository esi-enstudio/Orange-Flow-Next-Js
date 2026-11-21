# MYMVAI02 Live C2C WhatsApp Automation Design

## Intent

Enable the MYMVAI02 house to automatically import matching Live C2C workbooks received in one WhatsApp group and share the generated report with a different WhatsApp group.

## Goals

- Let an authorized user configure the incoming WhatsApp group, outgoing report group, and automation state for the currently selected house.
- Reuse the existing house-scoped automation API, signed webhook, durable inbound-file queue, workbook matching/import, and report delivery.
- Show the latest inbound file's import and delivery status, including failures.
- Keep all UI text bilingual and gate configuration actions with existing `live_c2c.automation_manage` / `live_c2c.automation_view` permissions.

## Non-goals

- Do not hardcode MYMVAI02's WhatsApp group IDs or modify database configuration without selecting and verifying the real groups.
- Do not change the existing webhook, file validation, import, queue, retry, or report-image behavior unless tests reveal a defect directly related to this flow.
- Do not create a new scheduler, permission, or navigation route.

## Approaches

1. **Inline automation card on `/reports/live-c2c` (recommended):** Configure the active house's two WhatsApp groups and enable automation in the existing page. This reuses house selection and existing API/permission behavior.
2. **Dedicated automation page:** Adds navigation, route registration, and additional UX for a configuration already scoped to a house; unnecessary for this task.
3. **Hardcoded one-off configuration:** Avoids a UI but requires verified group identifiers and an operational deployment/database change; it is unsafe to guess and difficult to maintain.

Proceed with approach 1. The user will select the actual source and destination groups from the connected house WhatsApp device's group list; the system must not assume or select a group based on its name.

## Design

- Add a configuration/status card to `/reports/live-c2c` for users with `live_c2c.automation_view` or `live_c2c.automation_manage`.
- Load the configuration and latest inbound file from `GET /api/v1/live-c2c-automation`, and WhatsApp groups from the existing house-scoped `/api/whatsapp/groups` endpoint.
- Allow users with manage permission to select distinct incoming and destination groups, enable/disable automation, and save through `PUT /api/v1/live-c2c-automation`. Explain that choosing WhatsApp replaces Gmail as this house's inbound source.
- Users with view-only permission see the configured routing and latest-file status without editable controls.
- Poll the latest-file status while automation is enabled. Keep errors actionable and bilingual; do not report a save as successful until the API confirms it.
- The backend's existing webhook queues matching Live C2C attachments, and its scheduler processes the queue. Successful imports send the generated report to the configured destination group. The UI explains the existing filename requirements and shows import/delivery outcome.
- Snapshot the delivery group on each queued file so later configuration changes cannot reroute an already received file. Before import or delivery, stop processing if the automation is disabled or its incoming source changed; report a terminal failure rather than send to an unintended route.
- Remove an obsolete WhatsApp webhook only after the new configuration has committed. If external cleanup fails, retain its webhook ID for retry and report the partial save explicitly.
- Configuration is house-scoped to the current selector value; no house code or group ID is trusted from the workbook or hardcoded into the client.

## Constraints

- Use the existing `EntitySelector`, page guide, house context, API routes, and permissions.
- Preserve existing backend authorization, house isolation, audit logging, signed webhook verification, idempotency, and retry behavior.
- Add a nullable, house-scoped queue destination snapshot column with a migration that backfills existing queued files from their current automation configuration.
- Keep the Alembic history deployable by assigning the recently added OAuth-return-path migration a unique revision ID and merging the resulting automation migration branches.
- All user-visible strings must have matching `en` and `bn` translations.
- Verify with the focused automation API/processing tests, backend test suite, frontend lint, and TypeScript check.
