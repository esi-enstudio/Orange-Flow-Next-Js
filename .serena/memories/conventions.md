# Cross-project coding conventions

- Read root `AGENTS.md` and the nearest module-level instructions (notably `frontend/AGENTS.md`) before implementation; they are more detailed than these notes. Make minimal, scoped changes and follow local patterns.
- Security: backend authorization is mandatory; house isolation, validation, structured errors, permission checks, and plan-module enforcement must not be bypassed. Do not trust client-supplied tenant identifiers.
- Data changes should follow established soft-delete/audit conventions. Tenant business records generally require `house_id`; use centralized BST helpers for timestamps.
- UI is bilingual BN/EN, responsive, accessible, permission-aware, and uses existing shared components. Display dates as `DD MMM YYYY`; keep API/storage formats unchanged.
- Prefer existing helpers/components, strict types, explicit error handling, focused tests. Do not add broad catches, silent fallback behavior, packages, or unrelated refactors.
- Frontend Next.js-specific instructions and established UI patterns: `mem:frontend/core`. Backend authorization/data/test patterns: `mem:backend/core`.