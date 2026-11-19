# Live C2C Inbound Automation Design

## Intent

For each house, automatically recognize an incoming Live C2C spreadsheet, import
its data into the existing Live C2C store, build the existing WhatsApp report,
and deliver it to the house's configured WhatsApp group. This removes manual
upload/share steps while keeping the existing report and import behavior.

## Goals

- Configure one inbound source per house: Gmail or a WhatsApp group.
- For Gmail, connect the house's mailbox with read-only OAuth. Use `House.email`
  as the default account hint and verify the connected mailbox against it.
- For WhatsApp, select the inbound group. Configure the outbound report group
  separately because it may differ from the inbound group.
- Accept only `.xlsx` / `.xlsb` files up to the existing 10 MiB limit whose
  filename contains both `Live` and `C2C`, case-insensitively.
- Resolve the house from its configured mailbox or (WhatsApp device, group),
  never from the filename.
- Durably queue and deduplicate each attachment, reuse the existing importer,
  persist imported rows and audit activity, and send the report only after a
  successful import.
- Enforce tenant scope, backend permissions, safe credential storage, and
  bilingual configuration UI.

## Non-goals

- Other email providers or non-Excel attachments.
- Inferring a house from workbook contents or message text.
- Replacing existing manual import, report generation, or scheduled delivery.
- Sending reports when a file fails validation/import or the destination group
  is not configured.

## Approaches

1. **Chosen — house-scoped connectors and a database-backed inbox.** Each house
   connects its mailbox, while WhatsApp events come through the already
   integrated gateway. Both sources enqueue attachments into one durable,
   idempotent pipeline. Gmail is polled on the existing scheduler cadence.
   This reuses house context and existing import/report code and survives
   process restarts.
2. **One shared Gmail mailbox with sender rules.** This reduces OAuth setup but
   requires a new sender-to-house mapping that the user did not specify and
   risks ambiguous routing when addresses overlap.
3. **Gmail Pub/Sub plus an in-process WhatsApp handler.** Gmail Pub/Sub needs
   additional cloud infrastructure, while in-process WhatsApp processing can
   lose work on restart. Neither is required for the requested initial
   workflow.

## Design

- Add a house-scoped automation configuration with source type, enabled state,
  source group, outbound group, Gmail connection state, and polling cursor.
- Keep OAuth access/refresh tokens encrypted at rest. Use read-only Gmail scope,
  validate OAuth state, and verify the returned mailbox address against the
  house email before enabling the source.
- Poll connected mailboxes for new messages and collect matching spreadsheet
  attachments. Use source message/attachment identifiers for idempotency.
- Select the single worksheet that matches the existing Live C2C workbook
  parser; fail explicitly if no worksheet or multiple worksheets match.
- Extend the WhatsApp gateway's incoming document event to securely relay
  document metadata and bounded file content to the backend. The backend
  authenticates the webhook and maps it using the configured device and group.
- Persist accepted attachment records as a tenant-scoped durable work queue.
  Claim work with database row locking so multiple app workers cannot process
  the same attachment concurrently. Retain the existing file size, extension,
  workbook, transfer-deduplication, and audit checks.
- After successful import, build the existing `live_c2c` report and send it to
  the configured outbound WhatsApp group. Record import and delivery outcomes;
  failures remain visible and are not reported as success.
- Add permission-controlled configuration and connection flows to the existing
  Live C2C page. Include localized labels, validation, loading/error states, and
  responsive layouts. No new navigation module is needed.
- Add backend migrations and focused tests for filename/source validation,
  OAuth state and mailbox matching, webhook authentication, tenant isolation,
  durable/idempotent processing, import failure, and report delivery failure.

## Constraints and open implementation calls

- Source and destination WhatsApp groups are separate settings.
- A house's configured email is the default OAuth account; a mismatch must be
  corrected in `/houses` before the connection can be activated.
- Gmail polling may introduce up to one polling interval of delay.
- Gateway delivery uses the existing webhook mechanism and must reject
  oversized payloads before database processing.
- OAuth client configuration and a public callback URL must be supplied by the
  deployment before Gmail connection can be used.
- House email/group mappings must be unambiguous for enabled automations.
- A workbook's optional house identifiers must match the configured house.
- The database queue is shared across workers; scheduler ownership and
  processing use database coordination rather than process-local state.
