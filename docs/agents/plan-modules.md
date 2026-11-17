# Plan Module Access (allowed_modules)

> Detail spec referenced from [AGENTS.md](../../AGENTS.md). Rules here are binding; they are not optional guidance.

## Plan Module Access (`allowed_modules`)

Plans can be restricted to explicit module sets. A plan with `allowed_modules = null` is **unrestricted (legacy)**; a strict plan always includes at least one non-base module plus the always-on base modules (`dashboard`, `todos`, `administration`).

### Page-level ("leaf") grants

`allowed_modules` accepts **either** a top-level module key (grants the whole module) **or** a page route (grants a single page, e.g. `"/retailers/markings"`). In the Plans UI a group checkbox selects/clears the whole module, and a child checkbox selects only that page (group checkbox shows indeterminate when partially granted).

- **Backend catalog** — `backend/config/modules.py` `MODULE_LEAF_ROUTES` maps each module to its grantable page routes; `ALL_LEAF_ROUTES`, `LEAF_OWNER`, `valid_module_key()` (accepts leaves) and `module_for_key()` support it. `billing_group` and base modules are never grantable leaves.
- **API gating is leaf-aware** — `entitlement.api_path_allowed()` decides per-path: whole-module grants open the module; a leaf-only grant opens only the API prefixes owned by the granted page (`LEAF_TO_API_PREFIXES`, longest-match), plus genuinely module-wide `MODULE_SHARED_API_PREFIXES`. Unknown paths inside a leaf-gated module are **denied** (secure fail-closed) — always map new endpoints in `LEAF_TO_API_PREFIXES`/`MODULE_SHARED_API_PREFIXES` and add the prefix to `PATH_TO_MODULE`. The parity test asserts every leaf has a mapping and every mapped prefix belongs to its own module.
- **Page gating is frontend-only** — `EntitlementsContext.hasPage(path)` blocks un-granted pages via `ModuleAccessGuard` and hides un-granted children in the Sidebar/ReportsSheet/DMSSheet. Sub-routes not in the catalog (e.g. `/zoom-in/create`) fail open within an enabled module.
- **Parity** — when adding a new nav child page that should be individually grantable, add its route to `MODULE_LEAF_ROUTES` under its module, its API prefixes to `LEAF_TO_API_PREFIXES`, and the prefixes to `PATH_TO_MODULE`; `test_plan_modules_parity.py` asserts every cataloged leaf exists in `navItems` and owns only its own prefixes.

### How to register a NEW module/page so it auto-appears everywhere

Every new module must be registered in **three independent, mirrored locations** (the plan UI is derived from `navItems`, not a separate list — so nav registration is what makes it appear):

1. **Frontend nav** — `frontend/src/lib/constants.ts`: add the top-level `NavItem` and set a stable `moduleKey` (a new non-nav module still needs an entry here, even with `href` unset, to control the plan modal). Without a nav entry the page will NOT be restrictive-capable.
2. **Backend path map** — `backend/config/modules.py` `PATH_TO_MODULE`: add a `(path_prefix, module_key)` entry for every API route the module owns (module keys must be `snake_case`). Unmapped paths on strict plans are **denied fail-closed** with `403 PLAN_MODULE_UNMAPPED` (`backend/app/middleware/plan_module_guard.py`); only unlimited/legacy plans keep working with a warning. Forgetting this mapping breaks the endpoint in production — `tests/test_module_coverage.py` fails the build when a route is unmapped.
3. **Backend module set** — register the key in `MODULE_KEYS` so `valid_module_key()`/plan validation accepts it.

Optionally update the `backend/tests/test_plan_modules_parity.py` parity test, which asserts every `navItems` moduleKey is covered by `PATH_TO_MODULE`.

### Enforcement (do not regress)

- `backend/app/middleware/plan_module_guard.py`: gates `/api` requests by resolved module; admins + platform/billing paths bypass; deny = structured `403` `{"code": "PLAN_MODULE_DISABLED"}`. Leaf-only grants also enforce **per-path** page ownership via `entitlement.api_path_allowed()` (`config/modules.py` `LEAF_TO_API_PREFIXES` + `MODULE_SHARED_API_PREFIXES`, fail-closed for unmapped paths).
- `entitlement.module_enabled()` / `module_gated()` / `require_plan_module()` / `api_path_allowed()` for per-route defense in depth.
- Frontend: `EntitlementsContext.hasModule()` gates Sidebar/MoreSheet/ReportsSheet/DMSSheet/MobileNav and `ModuleAccessGuard` blocks whole routes for strict plans.
