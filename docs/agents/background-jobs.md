# Large-Volume Operations - Background Queue

> Detail spec referenced from [AGENTS.md](../../AGENTS.md). Rules here are binding; they are not optional guidance.

## Large-Volume Operations — Background Queue

When a user submits or permanently deletes a large number of records (for example, bulk serial entry/deletion), do not make them wait for the full database operation in the HTTP request.

### Rules

1. Define a sensible, workload-based threshold and enqueue operations above it. Keep small operations synchronous when that gives a better experience.
2. Return an immediate accepted response with a job identifier; do not report success until the background operation has actually completed.
3. Execute the full operation in the background with correct transaction boundaries. Preserve validation, duplicate checks, audit logging, and all-or-nothing behavior where required.
4. Provide an authenticated job-status endpoint and a bilingual frontend status surface that communicates queued, running, completed, and failed states. Poll or subscribe while jobs are active, refresh affected data after completion, and surface actionable errors.
5. Re-check permission and house/tenant scope when accepting work and ensure job-status results are visible only to the owner or authorized administrators for that house. Never trust a client-supplied owner or house identifier.
6. Prevent duplicate execution/submission where applicable, and ensure failures do not leave partial or success-shaped results.
7. Use a durable/shared queue when the deployment can run multiple workers or restart during jobs; an in-process task store is acceptable only when the deployment is explicitly single-process and its restart-loss behavior is understood.
8. Add tests for immediate acceptance, job completion/failure, permission and house isolation, and safe handling of records that cannot be deleted.

Reference implementation: `frontend/src/app/inventory/receiving/page.tsx` and `backend/app/routers/inventory.py` (large receiving and draft-receiving deletion jobs).
