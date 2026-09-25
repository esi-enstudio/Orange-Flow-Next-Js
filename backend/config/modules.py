"""Canonical top-level module catalog for plan-based module access control.

Every top-level navigation group (see `frontend/src/lib/constants.ts`
`navItems[].moduleKey`) has a matching key here. Plans store an explicit
`allowed_modules` list of these keys; when a plan is subscribed to by a house,
the active house may only access these modules plus the auto-included base
modules.

A path-prefix map (`PATH_TO_MODULE`) binds API endpoints to a module. Plugins
that are not mapped (value None) are always allowed (platform endpoints such as
auth, billing, plans, webhooks, uploads) or helper endpoints that are not part
of any restricted module.

NEW MODULES: when you add a top-level nav group in `constants.ts`, give it a
`moduleKey` (or let it auto-derive from `translationKey`) AND add at least one
route prefix in `PATH_TO_MODULE` here. The parity test
(`backend/tests/test_plan_modules_parity.py`) fails the build if you forget.
"""

from typing import Optional, Tuple, List

# Modules automatically granted to every plan. They are never selectable off.
BASE_MODULES: set = {"dashboard", "todos", "administration"}

# Order matters — first matching prefix wins. Use longest prefixes first so
# specific routes are not swallowed by a shorter sibling.
# value None => platform/always-allowed (never gated by plans).
PATH_TO_MODULE: List[Tuple[str, Optional[str]]] = [
    # ---- platform / always-allowed -------------------------------------------------
    ("/api/auth/", None),
    ("/admin/", None),
    ("/api/v1/admin/", None),
    ("/api/webhook/", None),
    ("/api/v1/plans", None),
    ("/api/v1/subscription", None),
    ("/api/v1/billing", None),
    ("/api/v1/payments", None),
    ("/api/v1/invoices", None),
    ("/api/v1/invoice", None),
    ("/uploads/", None),
    ("/api/settings/brand", None),
    ("/api/filter-tags", None),
    ("/api/retailer-filters", None),
    ("/api/shifts", None),  # helper used across modules; not a restricted module

    # ---- module-bound prefixes (longest first) -------------------------------------
    ("/api/v1/database-backups", "administration"),
    ("/api/v1/deploy", "administration"),
    ("/api/rule-config", "administration"),
    ("/api/settings", "administration"),
    ("/api/users", "administration"),
    ("/api/cv", "administration"),
    ("/api/bp-retailer-codes", "administration"),
    ("/api/roles", "roles_permissions"),
    ("/api/permissions", "roles_permissions"),

    ("/api/system-logs", "live_monitor"),
    ("/api/otp", "live_monitor"),

    ("/api/zoom-in", "zoom_in"),

    ("/api/houses", "data_import"),
    ("/api/bts", "data_import"),
    ("/api/v1/scratch-card-serials", "data_import"),

    ("/api/employees", "employee_hub"),

    ("/api/retailer-markings", "retailers"),
    ("/api/retailers", "retailers"),

    ("/api/lifting", "lifting"),
    ("/api/products", "lifting"),

    ("/api/stock", "stock_sales"),
    ("/api/sales", "stock_sales"),

    ("/api/commission", "commercial_sales"),

    ("/api/house-targets", "targets"),
    ("/api/supervisor-targets", "targets"),
    ("/api/rso-targets", "targets"),
    ("/api/bp-targets", "targets"),

    ("/api/dms", "dms"),
    ("/api/sync", "dms"),
    ("/api/v1/scratch-cards", "dms"),
    ("/api/scratch-cards", "dms"),

    # import endpoints belong to the data-import module (must precede the
    # shorter report prefixes below so they are not swallowed).
    ("/api/activations/import", "data_import"),
    ("/api/itopup-details/import", "data_import"),
    ("/api/live-activations/import", "data_import"),
    ("/api/scratch-card/import", "data_import"),
    ("/api/sim-issues/import", "data_import"),

    ("/api/ga-report-builder", "reports"),
    ("/api/ga-query", "reports"),
    ("/api/reports/target-achievement", "performance"),
    ("/api/reports/my-target-progress", "performance"),
    ("/api/reports/transactions", "reports"),
    ("/api/transactions", "reports"),
    ("/api/reports", "reports"),
    ("/api/activations", "reports"),
    ("/api/itopup-details", "reports"),
    ("/api/live-activations", "reports"),
    ("/api/itopup-balance", "reports"),
    ("/api/scratch-card", "reports"),
    ("/api/sim-issues", "reports"),

    ("/api/v1/ev-kit", "sim_management"),
    ("/api/v1/sim-inventory", "sim_management"),
    ("/api/v1/sim-products", "sim_management"),
    ("/api/v1/sim-replacement", "sim_management"),
    ("/api/sim-replacement", "sim_management"),
    ("/api/sim-inventory", "sim_management"),
    ("/api/ev-kit", "sim_management"),
    ("/api/sim-products", "sim_management"),

    ("/api/whatsapp", "whatsapp"),
    ("/api/telegram", "telegram"),

    # Dashboard helpers (base module -> always allowed).
    ("/api/stats", "dashboard"),
    ("/api/todos", "todos"),
]

# All module keys that a plan may grant (path map values, excluding None).
MODULE_KEYS: List[str] = sorted({m for _, m in PATH_TO_MODULE if m})

# Modules that are globally/always accessible regardless of plan (platform).
PLATFORM_PATHS = tuple(p for p, m in PATH_TO_MODULE if m is None)

# Page-level ("leaf") routes per module, mirroring the top-level nav groups in
# `frontend/src/lib/constants.ts` (`navItems[].children[].href`). A plan's
# `allowed_modules` may contain either a top-level module key (whole module) or
# one of these individual page routes (a single page). When only a leaf of a
# module is granted, the module's APIs remain reachable (shared API surface) but
# the un-granted pages are blocked on the frontend route guard. Kept in sync by
# the parity test (`backend/tests/test_plan_modules_parity.py`).
MODULE_LEAF_ROUTES: dict = {
    "live_monitor": ("/live-monitor",),
    "data_import": (
        "/houses",
        "/bts",
        "/import/activations",
        "/import/itopup-details",
        "/import/live-activations",
        "/import/scratch-card",
        "/import/sim-issues",
        "/import/sc-serials",
    ),
    "employee_hub": ("/employees", "/employees/supervisors"),
    "retailers": (
        "/retailers",
        "/retailers/retailer-marking",
        "/retailers/markings",
        "/retailers/assign-marking",
        "/retailers/import-marking",
        "/retailers/marking-history",
    ),
    "commercial_sales": ("/commercial/commission", "/commercial/expenses"),
    "lifting": ("/liftings", "/liftings/products"),
    "stock_sales": ("/stock", "/sales"),
    "dms": (
        "/dms/sim-issue",
        "/dms/sim-status",
        "/dms/sim-return",
        "/dms/scratch-card",
        "/sync",
    ),
    "reports": (
        "/reports/activations",
        "/reports/recharge",
        "/reports/transactions",
        "/reports/active-lso",
        "/reports/active-sso",
        "/reports/live-activations",
        "/reports/ga-report-builder",
        "/reports/ga-query",
        "/reports/scratch-card",
        "/reports/sim-issues",
    ),
    "sim_management": ("/sim-inventory", "/sim-replacement"),
    "performance": ("/dashboard/manager", "/dashboard/supervisor", "/dashboard/rso"),
    "targets": ("/targets/house", "/targets/supervisor", "/targets/rso", "/targets/bp"),
    "roles_permissions": ("/roles", "/permissions"),
    "zoom_in": (
        "/zoom-in",
        "/zoom-in/event-types",
        "/zoom-in/activity",
        "/zoom-in/allocation",
        "/zoom-in/eligible-bts",
    ),
    "whatsapp": ("/whatsapp",),
    "telegram": ("/telegram",),
}

# Every grantable page route -> owning top-level module (derived once at import).
ALL_LEAF_ROUTES: frozenset = frozenset(
    route for routes in MODULE_LEAF_ROUTES.values() for route in routes
)
LEAF_OWNER: dict = {
    route: module
    for module, routes in MODULE_LEAF_ROUTES.items()
    for route in routes
}

# API path prefixes owned by each grantable page ("leaf"). Used for API-level
# enforcement: when a strict plan grants only SOME pages of a module (leaf-only
# grant), a request is allowed only when its path belongs to a granted page.
# Shared prefixes (MODULE_SHARED_API_PREFIXES) are open to any granted leaf of
# the module; prefixes with no leaf mapping are DENIED inside a leaf-gated
# module (secure fail-closed — new endpoints must be mapped here).
LEAF_TO_API_PREFIXES: dict = {
    # ---- live_monitor ----
    "/live-monitor": ("/api/system-logs", "/api/otp"),

    # ---- data_import ----
    "/houses": ("/api/houses",),
    "/bts": ("/api/bts",),
    "/import/activations": ("/api/activations/import",),
    "/import/itopup-details": ("/api/itopup-details/import",),
    "/import/live-activations": ("/api/live-activations/import",),
    "/import/scratch-card": ("/api/scratch-card/import",),
    "/import/sim-issues": ("/api/sim-issues/import",),
    "/import/sc-serials": ("/api/v1/scratch-card-serials",),

    # ---- employee_hub ----
    # the employees router serves both the list and the supervisors page.
    "/employees": ("/api/employees",),
    "/employees/supervisors": ("/api/employees",),

    # ---- retailers ----
    "/retailers": ("/api/retailers",),
    # the retailer-markings router serves the marking/assign/import/history pages.
    "/retailers/retailer-marking": ("/api/retailer-markings",),
    "/retailers/markings": ("/api/retailer-markings",),
    "/retailers/assign-marking": ("/api/retailer-markings",),
    "/retailers/import-marking": ("/api/retailer-markings",),
    "/retailers/marking-history": ("/api/retailer-markings",),

    # ---- commercial_sales ----
    "/commercial/commission": ("/api/commission",),
    "/commercial/expenses": ("/api/commission",),

    # ---- lifting ----
    "/liftings": ("/api/lifting",),
    "/liftings/products": ("/api/products",),

    # ---- stock_sales ----
    "/stock": ("/api/stock",),
    "/sales": ("/api/sales",),

    # ---- dms ----
    "/dms/sim-issue": ("/api/dms/sim-issue",),
    "/dms/sim-status": ("/api/dms/sim-status",),
    "/dms/sim-return": ("/api/dms/sim-return",),
    "/dms/scratch-card": ("/api/v1/scratch-cards", "/api/scratch-cards"),
    "/sync": ("/api/sync",),

    # ---- reports ----
    "/reports/activations": (
        "/api/activations",
        "/api/reports/activations/dashboard",
        "/api/reports/activations/whatsapp",
    ),
    "/reports/recharge": ("/api/reports/recharge/dashboard",),
    "/reports/transactions": ("/api/reports/transactions",),
    "/reports/active-lso": ("/api/reports/active-lso",),
    "/reports/active-sso": ("/api/reports/active-sso",),
    "/reports/live-activations": ("/api/reports/live-activations", "/api/live-activations"),
    "/reports/ga-report-builder": ("/api/ga-report-builder",),
    "/reports/ga-query": ("/api/ga-query",),
    "/reports/scratch-card": ("/api/scratch-card",),
    "/reports/sim-issues": ("/api/sim-issues",),

    # ---- sim_management ----
    "/sim-inventory": ("/api/v1/sim-inventory",),
    "/sim-replacement": ("/api/v1/sim-replacement",),

    # ---- performance ----
    # the target-achievement / my-target-progress APIs back all three dashboards.
    "/dashboard/manager": ("/api/reports/target-achievement", "/api/reports/my-target-progress"),
    "/dashboard/supervisor": ("/api/reports/target-achievement", "/api/reports/my-target-progress"),
    "/dashboard/rso": ("/api/reports/target-achievement", "/api/reports/my-target-progress"),

    # ---- targets ----
    "/targets/house": ("/api/house-targets",),
    "/targets/supervisor": ("/api/supervisor-targets",),
    "/targets/rso": ("/api/rso-targets",),
    "/targets/bp": ("/api/bp-targets",),

    # ---- roles_permissions ----
    "/roles": ("/api/roles",),
    "/permissions": ("/api/permissions",),

    # ---- zoom_in ----
    "/zoom-in": ("/api/zoom-in/events", "/api/zoom-in/dashboard/summary"),
    "/zoom-in/event-types": ("/api/zoom-in/event-types",),
    "/zoom-in/activity": (
        "/api/zoom-in/activities",
        "/api/zoom-in/thanas",
        "/api/zoom-in/retailers-by-rso",
        "/api/zoom-in/bps-by-house",
        "/api/zoom-in/rsos-by-house",
    ),
    "/zoom-in/allocation": ("/api/zoom-in/allocations",),
    "/zoom-in/eligible-bts": (
        "/api/zoom-in/eligible-bts",
        "/api/zoom-in/bts-by-thana",
    ),

    # ---- whatsapp / telegram ----
    "/whatsapp": ("/api/whatsapp", "/api/whatsapp-schedules"),
    "/telegram": ("/api/telegram",),
}

# Endpoints that belong to a whole module (no single page) — open whenever ANY
# leaf of the module is granted. Keeping them here avoids breaking pages that
# share a single router; page-specific endpoints stay strictly leaf-gated.
MODULE_SHARED_API_PREFIXES: dict = {
    "sim_management": ("/api/v1/ev-kit", "/api/v1/sim-products"),
    "reports": ("/api/itopup-details", "/api/itopup-balance"),
    "zoom_in": ("/api/zoom-in/filter-options",),
}


def module_for_path(path: str) -> Optional[str]:
    """Return the top-level module key an API path belongs to.

    None => platform helper / unmapped / always-allowed.
    """
    for prefix, module in PATH_TO_MODULE:
        if path.startswith(prefix):
            return module
    return None


def leaf_owners_for_path(module_key: str, path: str) -> List[str]:
    """Grantable pages (leaves) owning an API path, longest-prefix match.

    Only leaves of `module_key` are considered. Returns [] when the path is not
    scoped to any page of the module (module-level shared or unmapped).
    """
    best = -1
    owners: List[str] = []
    for leaf, prefixes in LEAF_TO_API_PREFIXES.items():
        if LEAF_OWNER.get(leaf) != module_key:
            continue
        for prefix in prefixes:
            if path.startswith(prefix):
                if len(prefix) > best:
                    best = len(prefix)
                    owners = [leaf]
                elif len(prefix) == best and leaf not in owners:
                    owners.append(leaf)
    return owners


def valid_module_key(key: str) -> bool:
    """Accept a top-level module key, a base module, or a grantable page route."""
    return key in MODULE_KEYS or key in BASE_MODULES or key in ALL_LEAF_ROUTES


def module_for_key(key: str) -> Optional[str]:
    """Resolve an allowed key (module or leaf route) to its top-level module."""
    if key in MODULE_KEYS or key in BASE_MODULES:
        return key
    return LEAF_OWNER.get(key)