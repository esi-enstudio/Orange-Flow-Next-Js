# AGENTS.md

Project rules and instructions for AI coding agents working in this repository.

## Project Overview

A professional Management System for a Banglalink Distribution House.

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router) |
| UI | shadcn/ui + Tailwind CSS |
| Backend | Python FastAPI |
| Database | PostgreSQL |
| Auth | Role & Permission Based Access Control (RBAC) |

The agent must follow every rule in this file, and in the detail docs it points to, for every task: modules, components, APIs, database models, forms and UI.

## How This File Is Organised

This file holds only what applies to **every** task: precedence, language, skills, principles, the completion checklist and verification commands. Detailed specs live in [`docs/agents/`](docs/agents/). **Before touching an area, read its doc.** The docs are binding, not optional background.

| If the task touches... | Read first |
|---|---|
| Permissions, roles, sidebar/menu, route guards | [permissions.md](docs/agents/permissions.md) |
| New module / page registration, `allowed_modules` | [plan-modules.md](docs/agents/plan-modules.md) |
| Any data model, `house_id`, `X-House-ID`, query scoping | [multi-tenancy.md](docs/agents/multi-tenancy.md) |
| Subscription / expiry / billing gate | [house-access-policy.md](docs/agents/house-access-policy.md) |
| API routes, versioning, pagination, error shapes | [api-conventions.md](docs/agents/api-conventions.md) |
| Forms, input types, validation, error handling | [forms-validation.md](docs/agents/forms-validation.md) |
| Tables, models, migrations, soft delete | [database.md](docs/agents/database.md) |
| Mutations, activity log | [audit-log.md](docs/agents/audit-log.md) |
| Any UI: page headers, selects, filters, tables, titles, skeletons | [ui-ux.md](docs/agents/ui-ux.md) |
| Mobile / tablet / desktop behaviour | [responsive.md](docs/agents/responsive.md) |
| Page Guide, time-based status, table accordion | [ui-components.md](docs/agents/ui-components.md) |
| Any user-visible text (bn/en) | [i18n.md](docs/agents/i18n.md) |
| Dates, times, timezones | [timezone.md](docs/agents/timezone.md) |
| Excel/CSV import or export | [import-export.md](docs/agents/import-export.md) |
| Retailer-Employee attribution, supervisor handoff | [domain-rules.md](docs/agents/domain-rules.md) |
| WhatsApp/Telegram reports | [report-delivery.md](docs/agents/report-delivery.md) |
| Bulk or long-running operations | [background-jobs.md](docs/agents/background-jobs.md) |

## Non-Negotiables

These five apply to almost every change. Details are in the linked docs.

1. **Permissions** - every endpoint, button, menu item and route is permission controlled. Never trust frontend data. ([permissions.md](docs/agents/permissions.md))
2. **House isolation** - every data model carries `house_id`; every query is house-scoped. ([multi-tenancy.md](docs/agents/multi-tenancy.md))
3. **Bilingual** - every user-visible string has `en` and `bn` keys. ([i18n.md](docs/agents/i18n.md))
4. **Audit** - every mutation writes an activity log entry. ([audit-log.md](docs/agents/audit-log.md))
5. **Page headers** - every page follows the shared breadcrumb, icon/title, and subtitle pattern. ([ui-ux.md](docs/agents/ui-ux.md))


---

## Rule Precedence — AGENTS.md vs Skills vs Tools

Two independent rule sources are loaded in every session: **this file** (project rules) and **agent skills** (process techniques). They do not carry equal weight. When they disagree, resolve in this order:

| Priority | Source | What it decides |
|---|---|---|
| 1 | **This AGENTS.md** | *What* gets built — UI components and design, permissions, house isolation, validation, error shapes, i18n, reply language |
| 2 | **Repo decisions** — `opencode.json`, config, existing code patterns, migrations, tests | Capabilities and established conventions |
| 3 | **Skills** (superpowers + frontend skills) | *How* the work is sequenced. Never *what* the product looks like or which project rule applies |

### Conflict rulings

- **`frontend-design` / `web-design-guidelines`** — may suggest layout, spacing and visual hierarchy. They may **not** introduce bespoke components, custom select/date controls, new colour scales or "distinctive" styling. The mandated primitives win: `EntitySelector`, `DateRangePicker`, shadcn components, the right-side filter drawer, and the table-cell rules in this file. Reference page: `frontend/src/app/reports/ga-query/page.tsx`.
- **`shadcn` / `shadcn-ui`** — component discovery and installation help only. Never hand-build a select or multi-select; use `EntitySelector`.
- **`test-driven-development`** — mandatory for backend logic and any module already covered by `backend/tests/`. The frontend has **no test runner**; do not install one. Frontend verification = lint + typecheck + the responsive/locale checklist in this file.
- **`writing-plans`** — its task/verification shape is used, but every plan must additionally carry this file's module checklist: DB model + `house_id` + index, `permissions.json`, audit log entry, i18n `en`+`bn` keys, `navItems` / `DynamicPageTitle`, `MODULE_LEAF_ROUTES` + `PATH_TO_MODULE` + `LEAF_TO_API_PREFIXES`, skeleton state, and 375/768/1280 responsive checks.
- **`verification-before-completion`** — run the commands in [Verification Commands](#verification-commands). Never claim "done" from reading code alone.
- **Language** — skills, code, comments and commits stay English (see [Communication Language](#communication-language-banglish)); replies to the user stay Banglish.

When a skill is skipped because of a rule above, say which skill was skipped and why.

---

## Communication Language (Banglish)

### Rule

AI agent সবসময় **Banglish**-এ উত্তর দিবে — অর্থাৎ বাংলা ভাষা English/Roman অক্ষরে (যেমন: "চলো ঠিক করি", "এটা real bug ছিল")।

**Hard rule:** উত্তর সবসময় **Roman script**-এ হবে। কোনো বাংলা অক্ষর (বাংলা script) ব্যবহার করা যাবে না — Banglish মানে বাংলা ভাষা, কিন্তু লেখা English/Roman অক্ষরে।

এই preference সব session-এ প্রযোজ্য।

### Scope

Banglish শুধু **agent-এর ব্যবহারকারীর সাথে কথোপকথনে** প্রযোজ্য। নিচের জিনিস সবসময় **English**-এ থাকবে:

- Code, variable ও function name
- Code comment ও docstring
- File name, directory name, commit message
- Log message, error message, API response
- Database table/column name, permission key
- UI string ও translation file (i18n rule অনুযায়ী en/bn দুটোই আলাদা)

Banglish ব্যবহার করলে মূল technical term (permission, endpoint, migration, validation ইত্যাদি) English-এই রাখা উচিত — সেটাই স্বাভাবিক Banglish ভাষা।

---

## Mandatory Skills Usage

Always use these skills for this project:

- nextjs-app-router-patterns
- frontend-design
- shadcn
- shadcn-ui
- tailwind-4-docs
- tailwind-css-patterns
- web-design-guidelines

These skills must be considered before creating or modifying:
- Pages
- Layouts
- Components
- Forms
- Tables
- Dashboards
- Navigation
- UI Elements
- Responsive Designs

Scope is bounded by [Rule Precedence](#rule-precedence--agentsmd-vs-skills-vs-tools): these skills guide *how* the UI is composed, they never override the mandated components, design system, permissions or house-isolation rules in this file.

---

## Core Development Principles

Every implementation must be:

- Secure
- Scalable
- Maintainable
- Production-ready
- Modular
- Permission controlled
- Fully validated
- Type-safe
- User friendly

Never create quick temporary solutions.

Always follow proper software engineering practices.

---

## Module Development Rules

A module is only complete as a full feature, never a subset. The rules for each part live in the detail docs — this section is just the map:

| Part of the module | Owning doc |
|---|---|
| Database model, relationships, indexes, soft delete | [database.md](docs/agents/database.md) |
| `house_id` + query/tenant scoping | [multi-tenancy.md](docs/agents/multi-tenancy.md) |
| API versioning, pagination, error shapes | [api-conventions.md](docs/agents/api-conventions.md) |
| Permissions, sidebar, route guards | [permissions.md](docs/agents/permissions.md) |
| Validation, forms, field-level errors | [forms-validation.md](docs/agents/forms-validation.md) |
| Activity log for every mutation | [audit-log.md](docs/agents/audit-log.md) |
| Page/nav registration, `allowed_modules` | [plan-modules.md](docs/agents/plan-modules.md) |
| UI standards (selects, filters, tables) | [ui-ux.md](docs/agents/ui-ux.md) |
| Page title, page guide, table accordion | [ui-components.md](docs/agents/ui-components.md) |
| `en` + `bn` copy | [i18n.md](docs/agents/i18n.md) |

Never ship a subset: model + API + validation + permissions + navigation + audit + both languages + responsive.

---

## Security Rules

Always protect against:
- Unauthorized access
- SQL injection
- XSS
- CSRF
- Data leakage
- Invalid input
- Privilege escalation

Never trust frontend data.

---

## Code Quality Rules

Before completing any task:
Check:
- Naming conventions
- Folder structure
- Reusable components
- Duplicate code
- Type safety
- Error handling

---

## New Feature Checklist

This is the **completion gate**. Detailed per-area checklists live in their owning docs ([i18n.md](docs/agents/i18n.md), [responsive.md](docs/agents/responsive.md), [ui-ux.md](docs/agents/ui-ux.md), [multi-tenancy.md](docs/agents/multi-tenancy.md)) — when a detail rule changes, change it there and keep this page a summary.

Before marking any feature complete:

**Backend**
- [ ] Database model created
- [ ] API created
- [ ] Validation added
- [ ] Authentication checked
- [ ] Permission checked

**Frontend** (details: [i18n.md](docs/agents/i18n.md), [ui-components.md](docs/agents/ui-components.md))
- [ ] Page created
- [ ] Components created
- [ ] Form validation added
- [ ] Error messages shown
- [ ] Permission based UI implemented
- [ ] Browser tab / page title set and tested (bilingual en/bn)
- [ ] HTML lang attribute sync verified (<html lang="en"> / <html lang="bn">)

**Security**
- [ ] Unauthorized users blocked
- [ ] API protected
- [ ] Sensitive actions restricted

**Permission**
- [ ] permissions.json updated
- [ ] Sidebar permission added
- [ ] Buttons permission controlled

**Audit**
- [ ] Activity log entry created for mutations

**UX** (details: [ui-ux.md](docs/agents/ui-ux.md))
- [ ] Content-aware skeleton added for loading states
- [ ] Filters follow the right-side filter drawer standard (no inline filter section, `DateRangePicker` for dates)

**Responsive** (all details and the full checklist live in [responsive.md](docs/agents/responsive.md))
- [ ] 375px / 768px / 1280px+ verified, no horizontal scroll, 44x44 touch targets

---

## Verification Commands

Run these before claiming any task is complete, and report the actual output. A "done" claim without a run is not accepted.

| Scope | Command | When |
|---|---|---|
| Frontend lint | `cd frontend && npm run lint` | Any frontend change |
| Frontend types | `cd frontend && npx tsc --noEmit` | Any frontend change (no `tsc` npm script exists — run it directly) |
| Backend tests | `cd backend && python -m pytest -q` | Any backend change |
| Tenancy / billing guard | `cd backend && python -m pytest -q tests/test_entitlement.py tests/test_house_access_guard.py tests/test_tenant_isolation.py` | Touching billing, entitlements, `X-House-ID` or house scoping |
| Plan-module wiring | `cd backend && python -m pytest -q tests/test_plan_modules_parity.py tests/test_module_coverage.py` | Adding a route, nav item, module key or leaf route |

Never create a new test runner, test framework or CI job to satisfy a skill. If a verification command is missing, say so instead of inventing one.

This table owns the **commands**. What each guard test covers is documented once, in [house-access-policy.md → Regression tests](docs/agents/house-access-policy.md#regression-tests--coverage-notes); do not duplicate that inventory here.

---

## Final Rule

Never create any module, page, API, button, action, or form without considering:
1. Permission
2. Security
3. Validation
4. User Experience
5. Scalability

Every implementation must be production-ready.
