# House Access Policy (Subscription Gate)

> Detail spec referenced from [AGENTS.md](../../AGENTS.md). Rules here are binding; they are not optional guidance.

## House Access Policy — Deny-by-Default (Subscription Gate)

### Principle

Access to the product is **deny-by-default**. A house may only be used when it has an
explicitly entitled subscription. This is the industry-standard behaviour for a
multi-tenant SaaS: a tenant with no contract, or an expired one, is blocked; the
only reachable surfaces are authentication, billing, plans and profile so the
tenant can pay or an administrator can assign a plan.

**A house with no plan is NOT a "legacy free pass".** That was the old fail-open
policy and it leaked the product for every newly created house.

### Access states (single source of truth)

`backend/app/services/entitlement.py` → `house_access_state(house, sub)` returns
`None` (allowed) or one of:

| Code | When | Suggested action |
|------|------|------------------|
| `SUBSCRIPTION_REQUIRED` | House has **no subscription record at all** — or a subscription row with `package_id IS NULL` (data defect) | `select_plan` |
| `SUBSCRIPTION_EXPIRED` | Subscription is not entitled (expired / cancelled / paused / past grace) | `renew` |
| `HOUSE_INACTIVE` | `houses.is_active = False` (manual deactivation) | `contact_admin` |

Order matters: **entitlement is checked before `is_active`**, because
`house_lifecycle` flips `is_active` off when a plan expires. An expired plan must
say "renew", not the generic "contact your administrator".

A `package_id IS NULL` subscription is **never** an implicit free pass. It is
denied as `SUBSCRIPTION_REQUIRED` and the startup migration attaches the explicit
`legacy-unlimited` plan so its historical meaning is preserved intentionally,
auditably and with an expiry date.

### Expiry boundary (canonical)

- A billing period covers the half-open interval `[start, end)` — at exactly
  `current_period_end` the paid period is **over**.
- Grace covers `[end, end + BILLING_GRACE_DAYS)` and reports `past_due`
  (still entitled). At exactly `end + BILLING_GRACE_DAYS` the house is `expired`.
- Trial covers `[trial_start, trial_end)`.
- All comparisons use naive **Bangladesh Standard Time** (`utils/timezone.now_naive()`).
  Never mix a UTC value with a BST value in an expiry check, or the plan expires
  6 hours early/late.

### Who is blocked

| Role | Product access | Billing/plans |
|------|----------------|---------------|
| Super Admin | Always allowed (platform owner) | Yes |
| Admin / Manager / House Manager | Blocked when the house is blocked | Yes (can self-serve) |
| Every other employee | Blocked when the house is blocked | Read-only status |

Bypass rules live in `backend/app/middleware/plan_module_guard.py`:
**only `is_super_admin_user` bypasses** (logged as `billing_event=super_admin_bypass`).
A tenant `admin` / `manager` / `house manager` passes **both** the house gate and
the plan-module gate — they are tenants of the plan they bought. Hiding a menu is
never authorization; the middleware is.

### Tenant isolation (deny-by-default)

Every `/api` data request is scoped by the authenticated user's houses:

- `get_house_context()` / `require_house_context()` (`app/routers/deps.py`) accept
  `X-House-ID` only when the user belongs to that house.
- Only the **super admin** may name a house they are not a member of.
- A tenant `admin` / `manager` role is **not** a platform role: it cannot read
  another house's data by sending that house's ID.
- `TENANT_STRICT_HOUSE_ISOLATION=true` (default) enforces this. `false` restores
  the old platform-wide admin bypass and is only valid for a single-company
  deployment.

### Enforcement layers (never remove one)

1. **Backend middleware** — `PlanModuleGuard.dispatch()` runs on every
   authenticated `/api` request and 403s the blocked house before the endpoint.
   Response body is self-explanatory:
   `{ "error": { "code", "message", "action", "house_id", "house_name", "plan_name", "plan_status", "plan_end_date", "days_remaining", "request_id" } }`
   and the `X-Request-ID` header is echoed for correlation.
2. **Per-route dependencies** — `require_subscription()` / `require_feature()` /
   `require_plan_module()` in `entitlement.py` for defense in depth.
3. **Frontend gate** — `EntitlementsContext.accessBlock` (proactive, from
   `GET /api/v1/subscription/entitlements`) + the `house-access-blocked` window
   event raised by `lib/api.ts` (reactive). `SubscriptionGate` renders a blocking
   overlay naming the house, the plan and the expiry, with the correct CTA.
4. **Frontend menus** — `EntitlementsContext.hasModule()` / `hasPage()` mirror the
   backend: only the super admin bypasses, so the UI never offers a module the
   API would 403.

`GET /api/v1/subscription/entitlements` must stay readable by **any**
authenticated house member (not just billing roles) — it is what the gate reads
on page load. It only ever exposes the caller's own house.

### Module coverage (fail-closed)

- `PlanModuleGuard` resolves the request path through
  `config/modules.py → PATH_TO_MODULE`.
- Inside a leaf-gated module, an unmapped page owner is **denied**.
- A path that is **not in `PATH_TO_MODULE` at all** is denied for strict plans
  as `PLAN_MODULE_UNMAPPED` (never silently allowed) and logged.
  Add the prefix to `PATH_TO_MODULE` when you add an endpoint — the build-time
  guard `backend/tests/test_module_coverage.py` fails otherwise.
- Deliberately platform-wide helpers (auth, billing, webhooks, admin setup,
  settings, shifts) are listed with an explicit `None` module in
  `PATH_TO_MODULE` or in the middleware's exempt prefixes.

### Configuration

| Setting | Default | Purpose |
|---------|---------|---------|
| `ENVIRONMENT` | `development` | `production` activates the fail-fast safety checks below |
| `BILLING_REQUIRE_PLAN` | `true` | `false` restores the legacy fail-open behaviour (staged rollout escape hatch only — refuses to start in production) |
| `BILLING_LEGACY_BACKFILL` | `true` | On startup, houses with no subscription get the legacy-unlimited plan instead of a lockout |
| `BILLING_LEGACY_BACKFILL_DRY_RUN` | `false` | Report-only migration pass: logs who would be granted/repaired, writes nothing |
| `BILLING_LEGACY_PLAN_SLUG` | `legacy-unlimited` | Slug of that plan (created on demand, `allowed_modules = NULL`) |
| `BILLING_DEFAULT_PLAN_SLUG` | `""` | Plan auto-assigned by `POST /api/houses`. Empty = new house starts unsubscribed |
| `TENANT_STRICT_HOUSE_ISOLATION` | `true` | Non-super-admin users must belong to `X-House-ID`. `false` = single-company deployment only |
| `CASH_PAYMENTS_ENABLED` | `true` | Offline payment recording is the only payment path (no hosted gateway) |
| `BILLING_ENABLED` | `true` | `false` in production aborts startup |

### Production fail-fast guard

`config/settings.py → enforce_production_billing_safety` runs at import time.
When `ENVIRONMENT=production`, the app **refuses to start** if any of these is
set to a dangerous value:

- `BILLING_REQUIRE_PLAN=false` (would restore fail-open)
- `BILLING_ENABLED=false` (billing turned off)

This makes it impossible to ship the fail-open switch to production by accident.

### Rollout safety (do not skip)

`_migrate_billing_fail_closed()` in `backend/app/services/db_service.py` is
idempotent and registered in `init_db()`. It:

1. **Audits** every package-less, non-deleted subscription and logs it at
   `CRITICAL` (the only remaining implicit free pass).
2. **Repairs** those rows by attaching the explicit `legacy-unlimited` plan.
3. **Grants** the legacy plan (10 years) to active houses with **no**
   subscription row, and logs them by name so operators can replace it.
4. **Never touches** a house that already has any subscription row (even an
   expired one — that house correctly reports "renew").

Concurrency & failure semantics:

- The whole pass runs in one transaction under a PostgreSQL
  transaction-scoped **advisory lock** (`_BILLING_MIGRATION_LOCK_KEY`), so N
  workers booting simultaneously serialize instead of each inserting a row.
- The plan insert uses `ON CONFLICT DO NOTHING`; the subscription insert is
  `INSERT … SELECT … WHERE NOT EXISTS`, so re-runs are no-ops.
- `BILLING_LEGACY_BACKFILL_DRY_RUN=true` produces a plan report and writes
  nothing (use it for the staging dry-run).
- In production, a migration exception is appended to `STARTUP_FATAL_ERRORS` and
  `main.py` calls `sys.exit(1)` — a half-migrated fleet must not serve traffic
  while deny-by-default is on. In other environments it logs and continues.

Without this migration, deploying the strict guard locks out every plan-less
tenant at once.

### `allowed_modules` semantics (do not regress)

- `NULL` → plan intentionally grants every module (unlimited / legacy).
- `[...]` → strict plan; only these keys/leaf routes + always-on base modules.
- `[]` → **no grants at all** (base modules only, then the house gate normally
  blocks it earlier). An explicit empty list is **never** "unlimited".
- A plan-less / package-less subscription also yields `[]`, and
  `house_access_state()` blocks the house as `SUBSCRIPTION_REQUIRED`.
- `SubscriptionPackage.allowed_modules` column default is `NULL`, never `[]`.

### Observability (searchable by house / event / request id)

Structured log lines carry `billing_event=<name>` plus `house_id`, `user_id` and
`request_id` (client `X-Request-ID` or generated; echoed in the 403 response):

| Event | Meaning |
|-------|---------|
| `house_access_blocked` | A request was refused by the deny-by-default gate (deduped per minute) |
| `house_access_denied` | Caller named a house they do not belong to |
| `plan_module_denied` | Plan does not include the module/page |
| `plan_module_unmapped_denied` | Unmapped endpoint refused for a strict plan |
| `super_admin_bypass` | Platform super admin bypassed billing gates |

State changes (renewal, activation, plan change, cancel) are persisted in
`subscription_change_logs`.

### Payments are manual only

There is no hosted payment gateway in this deployment (SSLCommerz was removed).
Money is received offline and recorded by an authorised admin via
`POST /api/v1/admin/invoices/{id}/mark-paid` or
`POST /api/v1/admin/subscriptions/{id}/cash-payment`
(`billing.cash_payment` / `billing.manage`). The recorded payment is the only
thing that activates or renews a plan — there is no webhook and no callback to
trust. `payments.gateway` now stores the manual channel (`cash`, `manual`,
`bank`, ...). The obsolete `payment_attempts` / `webhook_events` tables are
dropped by `_migrate_remove_payment_gateway_artifacts()` in `init_db()`.

#### Free tier and approval-based paid periods

- **Free tier is the default validity** — selecting a plan starts the
  subscription on the plan's `trial_days` (`current_period_end == trial_end`).
  A plan never starts with a free paid month/year. After the free tier ends
  without an approved payment the subscription expires (no payment grace on a
  free tier).
- **Tenant payment requests** — `POST /api/v1/billing/payments/request`
  (`billing.request_payment`, multipart: `invoice_id`, `method`, `amount`,
  `reference`, `note`, `proof`) stores a `Payment(status="pending")` under
  `backend/app/services/payment_requests.py`. Nothing is activated.
- **Admin approval** — `POST /api/v1/admin/payments/{id}/approve`
  (`billing.approve_payment`) marks the invoice paid and activates the plan for
  **one interval starting at the approval time** (monthly = 1 month, yearly =
  1 year). A session renewal extends the existing `current_period_end` instead,
  so early payments never lose paid time. `POST .../reject`
  (`billing.reject_payment`) marks the request failed and keeps the invoice open.
- Paid proof files live under `private_uploads/payment_proofs/{house_id}/` and
  are streamed only through the authenticated proof endpoints.

When a manual payment completes, the invoice PDF is rendered and stored under
`private_uploads/invoices/` (`app/services/invoice_pdf.py`, path kept on
`invoices.pdf_path`). Download it from the billing page or via
`GET /api/v1/billing/invoices/{id}/pdf` / `GET /api/v1/admin/invoices/{id}/pdf`;
a missing stored file is re-rendered on demand.

### Legacy audit surface

`GET /api/v1/admin/legacy-subscriptions` (permission `subscription.manage`)
returns every non-deleted subscription with `package_id IS NULL`. In a healthy
deployment it is empty. Each row is blocked at runtime and must be repaired with
`PATCH /api/v1/admin/subscriptions/{id}` (attach a real plan).

### Regression tests — coverage notes

Commands live in [AGENTS.md → Verification Commands](../../AGENTS.md#verification-commands); this list is the inventory of what must stay green and what each file covers.

- `backend/tests/test_entitlement.py` — access-state matrix, payload, no-plan grants, exclusive expiry/trial/grace boundaries, BST helper.
- `backend/tests/test_house_access_guard.py` — resolution + fail-closed blocking.
- `backend/tests/test_plan_guard_dispatch.py` — middleware 403 codes.
- `backend/tests/test_plan_modules.py` — `allowed_modules` semantics (`NULL` vs `[]`, package-less denial).
- `backend/tests/test_billing_migration.py` — migration idempotency, dry-run, package-less repair, no duplicate grants, legacy audit endpoint.
- `backend/tests/test_tenant_isolation.py` — cross-house 403 for every tenant role, super-admin bypass only.
- `backend/tests/test_module_coverage.py` — every `/api` route mapped or exempt (static AST scan).
- `backend/tests/test_plan_modules_parity.py` — nav/module/leaf parity (requires the repo root, not just `backend/`).
